using System.Globalization;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using DTOs;
using EthicAI.EntityModel;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using DAL.NftFutebol;

namespace BLL.ArenaSentiment;

public sealed class ArenaSentimentService : IArenaSentimentService
{
    private static readonly TimeSpan CacheDuration = TimeSpan.FromSeconds(45);
    private static readonly TimeSpan FuturesExchangeInfoCacheDuration = TimeSpan.FromMinutes(30);
    private static readonly TimeSpan BinanceRequestTimeout = TimeSpan.FromSeconds(6);
    private const string FuturesExchangeInfoCacheKey = "arena-sentiment:futures-exchange-info";
    private const decimal PriceMomentumWeight = 0.30m;
    private const decimal VolumeWeight = 0.20m;
    private const decimal OrderBookWeight = 0.15m;
    private const decimal FundingWeight = 0.15m;
    private const decimal LongShortWeight = 0.10m;
    private const decimal VolatilityWeight = 0.10m;

    private readonly HttpClient _httpClient;
    private readonly EthicAIDbContext _db;
    private readonly IMemoryCache _cache;
    private readonly ILogger<ArenaSentimentService> _logger;
    private readonly ArenaSentimentOptions _options;

    public ArenaSentimentService(
        HttpClient httpClient,
        EthicAIDbContext db,
        IMemoryCache cache,
        ILogger<ArenaSentimentService> logger,
        IOptions<ArenaSentimentOptions> options)
    {
        _httpClient = httpClient;
        _db = db;
        _cache = cache;
        _logger = logger;
        _options = options.Value;
    }

    public async Task<ArenaSentimentDto> GetArenaSentimentAsync(string symbol, CancellationToken ct = default)
    {
        var normalizedSymbol = NormalizeSymbol(symbol);
        if (string.IsNullOrWhiteSpace(normalizedSymbol))
            return BuildFallback("UNKNOWN", "InsufficientData");

        var cacheKey = $"arena-sentiment:{normalizedSymbol}";
        if (_cache.TryGetValue<ArenaSentimentDto>(cacheKey, out var cached) && cached is not null)
            return cached;

        var sentiment = await BuildSentimentInternalAsync(normalizedSymbol, ct);
        _cache.Set(cacheKey, sentiment, CacheDuration);
        return sentiment;
    }

    public async Task<ArenaSentimentPairDto> GetArenaSentimentForMatchAsync(string homeSymbol, string awaySymbol, CancellationToken ct = default)
    {
        var teamATask = GetArenaSentimentAsync(homeSymbol, ct);
        var teamBTask = GetArenaSentimentAsync(awaySymbol, ct);
        await Task.WhenAll(teamATask, teamBTask);

        return new ArenaSentimentPairDto
        {
            TeamA = teamATask.Result,
            TeamB = teamBTask.Result
        };
    }

    public async Task<ArenaPressureGoalResult> CalculateArenaPressureGoalAsync(int matchId, CancellationToken ct = default)
    {
        var match = await _db.Match
            .Include(x => x.TeamA).ThenInclude(t => t.Currency)
            .Include(x => x.TeamB).ThenInclude(t => t.Currency)
            .Include(x => x.ScoreState)
            .FirstOrDefaultAsync(x => x.MatchId == matchId, ct);

        if (match is null || match.Status != MatchStatus.Ongoing || match.TeamA?.Currency is null || match.TeamB?.Currency is null)
            return new ArenaPressureGoalResult();

        var scoreState = match.ScoreState ?? throw new InvalidOperationException($"Match {matchId} sem score state.");
        var pair = await GetArenaSentimentForMatchAsync(match.TeamA.Currency.Symbol, match.TeamB.Currency.Symbol, ct);

        await PersistSnapshotAsync(pair.TeamA, ct);
        await PersistSnapshotAsync(pair.TeamB, ct);

        LogSentiment(pair.TeamA);
        LogSentiment(pair.TeamB);

        var settings = _options;
        var startUtc = match.StartTime.HasValue
            ? DateTime.SpecifyKind(match.StartTime.Value, DateTimeKind.Utc)
            : (DateTime?)null;

        if (!startUtc.HasValue || DateTime.UtcNow - startUtc.Value < TimeSpan.FromMinutes(settings.BlockFirstMinutes))
        {
            ResetPressureDominance(scoreState);
            scoreState.UpdatedAtUtc = DateTime.UtcNow;
            return new ArenaPressureGoalResult
            {
                DataSufficient = pair.TeamA.HasSufficientData && pair.TeamB.HasSufficientData
            };
        }

        if (!pair.TeamA.HasSufficientData || !pair.TeamB.HasSufficientData || scoreState.TotalPressureGoalsAwarded >= settings.MaxGoalsPerMatch)
        {
            ResetPressureDominance(scoreState);
            scoreState.UpdatedAtUtc = DateTime.UtcNow;
            return new ArenaPressureGoalResult
            {
                DataSufficient = pair.TeamA.HasSufficientData && pair.TeamB.HasSufficientData
            };
        }

        var diff = pair.TeamA.Score - pair.TeamB.Score;
        if (Math.Abs(diff) < settings.MinScoreDiff)
        {
            ResetPressureDominance(scoreState);
            scoreState.UpdatedAtUtc = DateTime.UtcNow;
            return new ArenaPressureGoalResult
            {
                DataSufficient = true,
                WinnerScore = pair.TeamA.Score,
                LoserScore = pair.TeamB.Score,
                ScoreDiff = Math.Abs(diff)
            };
        }

        var leaderTeamId = diff > 0 ? match.TeamAId : match.TeamBId;
        var leaderSymbol = diff > 0 ? pair.TeamA.Symbol : pair.TeamB.Symbol;
        var loserSymbol = diff > 0 ? pair.TeamB.Symbol : pair.TeamA.Symbol;
        var winnerScore = diff > 0 ? pair.TeamA.Score : pair.TeamB.Score;
        var loserScore = diff > 0 ? pair.TeamB.Score : pair.TeamA.Score;
        var nowUtc = DateTime.UtcNow;

        EnsurePressureDominanceState(scoreState, leaderTeamId, nowUtc);

        if (scoreState.LastPressureLeaderTeamId == leaderTeamId)
            scoreState.LastPressureLeaderCycles++;
        else
        {
            scoreState.LastPressureLeaderTeamId = leaderTeamId;
            scoreState.LastPressureLeaderCycles = 1;
        }

        scoreState.UpdatedAtUtc = nowUtc;

        // One continuous dominance sequence gets a single scoring attempt.
        if (scoreState.CurrentPressureDominanceResolved)
        {
            return new ArenaPressureGoalResult
            {
                DataSufficient = true,
                WinnerTeamId = leaderTeamId,
                WinnerSymbol = leaderSymbol,
                LoserSymbol = loserSymbol,
                WinnerScore = winnerScore,
                LoserScore = loserScore,
                ScoreDiff = Math.Abs(diff)
            };
        }

        if (scoreState.LastPressureLeaderCycles < settings.RequiredCycles)
        {
            return new ArenaPressureGoalResult
            {
                DataSufficient = true,
                WinnerTeamId = leaderTeamId,
                WinnerSymbol = leaderSymbol,
                LoserSymbol = loserSymbol,
                WinnerScore = winnerScore,
                LoserScore = loserScore,
                ScoreDiff = Math.Abs(diff)
            };
        }

        var isTeamA = leaderTeamId == match.TeamAId;
        var chargesBefore = isTeamA ? scoreState.TeamAPressureCharges : scoreState.TeamBPressureCharges;
        var chargesAfter = Math.Min(2, chargesBefore + 1);

        if (isTeamA)
            scoreState.TeamAPressureCharges = chargesAfter;
        else
            scoreState.TeamBPressureCharges = chargesAfter;

        ResetPressureLeader(scoreState);

        var eligibleForGoal = chargesAfter >= 2 && IsPressureGoalWindowOpen(scoreState, isTeamA, settings, nowUtc);
        if (!eligibleForGoal)
        {
            if (chargesAfter >= 2)
            {
                if (isTeamA)
                    scoreState.TeamAPressureCharges = 0;
                else
                    scoreState.TeamBPressureCharges = 0;

                // Cooldown remains a secondary guard, but it cannot reopen
                // the same uninterrupted dominance sequence for a later goal.
                scoreState.CurrentPressureDominanceResolved = true;
                chargesAfter = 0;
            }

            return new ArenaPressureGoalResult
            {
                DataSufficient = true,
                WinnerTeamId = leaderTeamId,
                WinnerSymbol = leaderSymbol,
                LoserSymbol = loserSymbol,
                WinnerScore = winnerScore,
                LoserScore = loserScore,
                ScoreDiff = Math.Abs(diff),
                ChargesBefore = chargesBefore,
                ChargesAfter = chargesAfter
            };
        }

        if (isTeamA)
        {
            match.ScoreA += 1;
            scoreState.TeamAPressureCharges = 0;
            scoreState.LastPressureGoalTeamAAtUtc = nowUtc;
        }
        else
        {
            match.ScoreB += 1;
            scoreState.TeamBPressureCharges = 0;
            scoreState.LastPressureGoalTeamBAtUtc = nowUtc;
        }

        scoreState.CurrentPressureDominanceResolved = true;
        scoreState.CurrentPressureDominanceGoalAwarded = true;
        scoreState.TotalPressureGoalsAwarded++;
        scoreState.LastEventSequence++;

        _db.MatchScoreEvent.Add(new MatchScoreEvent
        {
            MatchId = match.MatchId,
            TeamId = leaderTeamId,
            RuleType = MatchScoringRuleType.ArenaPressure,
            EventType = "ARENA_PRESSURE_GOAL",
            ReasonCode = $"ARENA_SENTIMENT_DIFF_GTE_{settings.MinScoreDiff}",
            Points = 1,
            EventSequence = scoreState.LastEventSequence,
            TeamPercentageChange = diff > 0 ? (decimal?)match.TeamA.Currency.PercentageChange : (decimal?)match.TeamB.Currency.PercentageChange,
            OpponentPercentageChange = diff > 0 ? (decimal?)match.TeamB.Currency.PercentageChange : (decimal?)match.TeamA.Currency.PercentageChange,
            TeamQuoteVolume = diff > 0 ? match.TeamA.Currency.QuoteVolume : match.TeamB.Currency.QuoteVolume,
            OpponentQuoteVolume = diff > 0 ? match.TeamB.Currency.QuoteVolume : match.TeamA.Currency.QuoteVolume,
            MetricDelta = Math.Abs(diff),
            Description = $"Arena Pressure Goal: {leaderSymbol} manteve vantagem de sentimento sobre {loserSymbol} e converteu um gol bonus.",
            EventTimeUtc = nowUtc
        });

        _logger.LogInformation(
            "[ARENA_PRESSURE_GOAL] matchId={MatchId} winner={Winner} loser={Loser} winnerScore={WinnerScore} loserScore={LoserScore} diff={Diff} chargesBefore={ChargesBefore} chargesAfter={ChargesAfter}",
            match.MatchId,
            leaderSymbol,
            loserSymbol,
            winnerScore,
            loserScore,
            Math.Abs(diff),
            chargesBefore,
            2);

        return new ArenaPressureGoalResult
        {
            GoalAwarded = true,
            WinnerTeamId = leaderTeamId,
            WinnerSymbol = leaderSymbol,
            LoserSymbol = loserSymbol,
            WinnerScore = winnerScore,
            LoserScore = loserScore,
            ScoreDiff = Math.Abs(diff),
            ChargesBefore = chargesBefore,
            ChargesAfter = 0,
            DataSufficient = true
        };
    }

    private async Task<ArenaSentimentDto> BuildSentimentInternalAsync(string symbol, CancellationToken ct)
    {
        try
        {
            var tickerTask = GetFromBinanceAsync<Binance24hTicker>($"https://api.binance.com/api/v3/ticker/24hr?symbol={symbol}", ct, required: true);
            var kline5mTask = GetFromBinanceAsync<List<List<JsonElement>>>($"https://api.binance.com/api/v3/klines?symbol={symbol}&interval=5m&limit=8", ct, required: true);
            var kline15mTask = GetFromBinanceAsync<List<List<JsonElement>>>($"https://api.binance.com/api/v3/klines?symbol={symbol}&interval=15m&limit=8", ct, required: true);
            var kline1hTask = GetFromBinanceAsync<List<List<JsonElement>>>($"https://api.binance.com/api/v3/klines?symbol={symbol}&interval=1h&limit=8", ct, required: true);
            var depthTask = GetFromBinanceAsync<BinanceDepth>($"https://api.binance.com/api/v3/depth?symbol={symbol}&limit=20", ct, required: false);
            var futuresSupported = await IsFuturesSymbolAsync(symbol, ct);

            Task<List<BinanceFundingRate>?> fundingTask;
            Task<BinanceOpenInterest?> oiTask;
            Task<List<BinanceOpenInterestHist>?> oiHistTask;
            Task<List<BinanceLongShortRatio>?> longShortTask;
            Task<List<BinanceTakerLongShortRatio>?> takerTask;

            if (futuresSupported)
            {
                fundingTask = GetFromBinanceAsync<List<BinanceFundingRate>>($"https://fapi.binance.com/fapi/v1/fundingRate?symbol={symbol}&limit=1", ct, required: false, symbol: symbol, futuresEndpoint: true);
                oiTask = GetFromBinanceAsync<BinanceOpenInterest>($"https://fapi.binance.com/fapi/v1/openInterest?symbol={symbol}", ct, required: false, symbol: symbol, futuresEndpoint: true);
                oiHistTask = GetFromBinanceAsync<List<BinanceOpenInterestHist>>($"https://fapi.binance.com/futures/data/openInterestHist?symbol={symbol}&period=5m&limit=2", ct, required: false, symbol: symbol, futuresEndpoint: true);
                longShortTask = GetFromBinanceAsync<List<BinanceLongShortRatio>>($"https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol={symbol}&period=5m&limit=1", ct, required: false, symbol: symbol, futuresEndpoint: true);
                takerTask = GetFromBinanceAsync<List<BinanceTakerLongShortRatio>>($"https://fapi.binance.com/futures/data/takerlongshortRatio?symbol={symbol}&period=5m&limit=1", ct, required: false, symbol: symbol, futuresEndpoint: true);
            }
            else
            {
                _logger.LogInformation("[FUTURES_UNAVAILABLE] {Symbol}", symbol);
                fundingTask = Task.FromResult<List<BinanceFundingRate>?>(default);
                oiTask = Task.FromResult<BinanceOpenInterest?>(default);
                oiHistTask = Task.FromResult<List<BinanceOpenInterestHist>?>(default);
                longShortTask = Task.FromResult<List<BinanceLongShortRatio>?>(default);
                takerTask = Task.FromResult<List<BinanceTakerLongShortRatio>?>(default);
            }

            await Task.WhenAll(tickerTask, kline5mTask, kline15mTask, kline1hTask, depthTask, fundingTask, oiTask, oiHistTask, longShortTask, takerTask);

            var ticker = tickerTask.Result;
            var kline5m = ParseKlines(kline5mTask.Result);
            var kline15m = ParseKlines(kline15mTask.Result);
            var kline1h = ParseKlines(kline1hTask.Result);
            var depth = depthTask.Result;
            var funding = fundingTask.Result?.FirstOrDefault();
            var openInterest = oiTask.Result;
            var openInterestHist = oiHistTask.Result;
            var longShort = longShortTask.Result?.FirstOrDefault();
            var taker = takerTask.Result?.FirstOrDefault();

            decimal? priceMomentum = CalculatePriceMomentumScore(ticker, kline5m, kline15m, kline1h);
            decimal? volume = CalculateVolumeScore(ticker, kline5m, kline15m, kline1h);
            decimal? orderBook = CalculateOrderBookScore(depth);
            decimal? fundingScore = CalculateFundingScore(funding);
            decimal? longShortScore = CalculateLongShortScore(longShort, taker, openInterest, openInterestHist);
            decimal? volatilityScore = CalculateVolatilityScore(kline5m, kline15m, kline1h);

            var weighted = new List<(decimal? Score, decimal Weight)>
            {
                (priceMomentum, PriceMomentumWeight),
                (volume, VolumeWeight),
                (orderBook, OrderBookWeight),
                (fundingScore, FundingWeight),
                (longShortScore, LongShortWeight),
                (volatilityScore, VolatilityWeight)
            };

            var availableWeight = weighted.Where(x => x.Score.HasValue).Sum(x => x.Weight);
            var weightedScore = availableWeight > 0m
                ? weighted.Where(x => x.Score.HasValue).Sum(x => x.Score!.Value * x.Weight) / availableWeight
                : 50m;

            var coverage = availableWeight;
            var hasSufficientData = coverage >= _options.MinimumCoverage;
            var finalScore = ClampToScore(weightedScore);

            return new ArenaSentimentDto
            {
                Symbol = symbol,
                Score = hasSufficientData ? finalScore : 50,
                Classification = hasSufficientData ? Classify(finalScore) : "InsufficientData",
                PriceMomentumScore = priceMomentum,
                VolumeScore = volume,
                OrderBookScore = orderBook,
                FundingScore = fundingScore,
                LongShortScore = longShortScore,
                VolatilityScore = volatilityScore,
                CalculatedAt = DateTime.UtcNow,
                HasSufficientData = hasSufficientData,
                DataCoverage = Math.Round(coverage, 2),
                Note = hasSufficientData ? null : "InsufficientData"
            };
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Arena sentiment fallback for {Symbol}", symbol);
            return BuildFallback(symbol, "InsufficientData");
        }
    }

    private async Task PersistSnapshotAsync(ArenaSentimentDto dto, CancellationToken ct)
    {
        var fresh = await _db.Set<ArenaSentimentSnapshot>()
            .AsNoTracking()
            .Where(x => x.Symbol == dto.Symbol)
            .OrderByDescending(x => x.CalculatedAt)
            .Select(x => x.CalculatedAt)
            .FirstOrDefaultAsync(ct);

        if (fresh != default && DateTime.UtcNow - fresh < TimeSpan.FromSeconds(20))
            return;

        _db.Set<ArenaSentimentSnapshot>().Add(new ArenaSentimentSnapshot
        {
            Symbol = dto.Symbol,
            Score = dto.Score,
            Classification = dto.Classification,
            PriceMomentumScore = dto.PriceMomentumScore,
            VolumeScore = dto.VolumeScore,
            OrderBookScore = dto.OrderBookScore,
            FundingScore = dto.FundingScore,
            LongShortScore = dto.LongShortScore,
            VolatilityScore = dto.VolatilityScore,
            DataCoverage = dto.DataCoverage,
            HasSufficientData = dto.HasSufficientData,
            CalculatedAt = dto.CalculatedAt
        });
    }

    private void LogSentiment(ArenaSentimentDto dto)
    {
        _logger.LogInformation(
            "[ARENA_SENTIMENT] symbol={Symbol} score={Score} classification={Classification} priceScore={PriceScore} volumeScore={VolumeScore} orderBookScore={OrderBookScore} fundingScore={FundingScore} longShortScore={LongShortScore} volatilityScore={VolatilityScore}",
            dto.Symbol,
            dto.Score,
            dto.Classification,
            dto.PriceMomentumScore,
            dto.VolumeScore,
            dto.OrderBookScore,
            dto.FundingScore,
            dto.LongShortScore,
            dto.VolatilityScore);
    }

    private static void ResetPressureLeader(MatchScoreState scoreState)
    {
        scoreState.LastPressureLeaderTeamId = null;
        scoreState.LastPressureLeaderCycles = 0;
    }

    private static void ResetPressureDominance(MatchScoreState scoreState)
    {
        ResetPressureLeader(scoreState);
        scoreState.TeamAPressureCharges = 0;
        scoreState.TeamBPressureCharges = 0;
        scoreState.CurrentPressureDominanceLeaderTeamId = null;
        scoreState.CurrentPressureDominanceStartedAtUtc = null;
        scoreState.CurrentPressureDominanceResolved = false;
        scoreState.CurrentPressureDominanceGoalAwarded = false;
    }

    private static void EnsurePressureDominanceState(MatchScoreState scoreState, int leaderTeamId, DateTime nowUtc)
    {
        if (scoreState.CurrentPressureDominanceLeaderTeamId == leaderTeamId)
            return;

        ResetPressureDominance(scoreState);
        scoreState.CurrentPressureDominanceLeaderTeamId = leaderTeamId;
        scoreState.CurrentPressureDominanceStartedAtUtc = nowUtc;
    }

    private static bool IsPressureGoalWindowOpen(MatchScoreState state, bool isTeamA, ArenaSentimentOptions options, DateTime nowUtc)
        {
            var lastGoalAt = isTeamA ? state.LastPressureGoalTeamAAtUtc : state.LastPressureGoalTeamBAtUtc;
            return !lastGoalAt.HasValue || nowUtc - lastGoalAt.Value >= TimeSpan.FromMinutes(options.GoalCooldownMinutes);
        }

    private static string NormalizeSymbol(string? symbol) => (symbol ?? string.Empty).Trim().ToUpperInvariant();

    private async Task<bool> IsFuturesSymbolAsync(string symbol, CancellationToken ct)
    {
        var normalizedSymbol = NormalizeSymbol(symbol);
        if (string.IsNullOrWhiteSpace(normalizedSymbol))
            return false;

        var futuresCatalog = await GetFuturesPerpetualSymbolsAsync(ct);
        if (!futuresCatalog.IsAvailable)
        {
            _logger.LogWarning(
                "[FUTURES_CHECK] symbol={Symbol} supported=unknown source=fapi/exchangeInfo-unavailable fallback=allow",
                normalizedSymbol);
            return true;
        }

        var supported = futuresCatalog.Symbols.Contains(normalizedSymbol);

        _logger.LogInformation(
            "[FUTURES_CHECK] symbol={Symbol} supported={Supported} source=fapi/exchangeInfo",
            normalizedSymbol,
            supported);

        return supported;
    }

    private async Task<FuturesPerpetualCatalog> GetFuturesPerpetualSymbolsAsync(CancellationToken ct)
    {
        return await _cache.GetOrCreateAsync(FuturesExchangeInfoCacheKey, async entry =>
        {
            entry.AbsoluteExpirationRelativeToNow = FuturesExchangeInfoCacheDuration;

            var exchangeInfo = await GetFromBinanceAsync<BinanceFuturesExchangeInfo>(
                "https://fapi.binance.com/fapi/v1/exchangeInfo",
                ct,
                required: false,
                futuresEndpoint: true);

            if (exchangeInfo?.Symbols is null || exchangeInfo.Symbols.Count == 0)
            {
                _logger.LogWarning("[FUTURES_CHECK] exchangeInfo unavailable. Falling back to allow unknown symbols.");
                return new FuturesPerpetualCatalog(false, new HashSet<string>(StringComparer.OrdinalIgnoreCase));
            }

            var symbols = exchangeInfo.Symbols
                .Where(x => string.Equals(x.ContractType, "PERPETUAL", StringComparison.OrdinalIgnoreCase))
                .Where(x => string.Equals(x.Status, "TRADING", StringComparison.OrdinalIgnoreCase))
                .Where(x => string.Equals(x.QuoteAsset, "USDT", StringComparison.OrdinalIgnoreCase))
                .Where(x => !string.IsNullOrWhiteSpace(x.Symbol))
                .Select(x => NormalizeSymbol(x.Symbol))
                .ToHashSet(StringComparer.OrdinalIgnoreCase);

            return new FuturesPerpetualCatalog(true, symbols);
        }) ?? new FuturesPerpetualCatalog(false, new HashSet<string>(StringComparer.OrdinalIgnoreCase));
    }

    private async Task<T?> GetFromBinanceAsync<T>(
        string url,
        CancellationToken ct,
        bool required,
        string? symbol = null,
        bool futuresEndpoint = false)
    {
        using var requestCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        requestCts.CancelAfter(BinanceRequestTimeout);
        using var response = await _httpClient.GetAsync(url, requestCts.Token);
        if (!response.IsSuccessStatusCode)
        {
            var responseBody = await SafeReadBodyAsync(response, requestCts.Token);
            LogBinanceHttpFailure(response, url, symbol, required, futuresEndpoint, responseBody);

            if (required)
                response.EnsureSuccessStatusCode();

            return default;
        }

        return await response.Content.ReadFromJsonAsync<T>(cancellationToken: requestCts.Token);
    }

    private void LogBinanceHttpFailure(HttpResponseMessage response, string url, string? symbol, bool required, bool futuresEndpoint, string? responseBody)
    {
        if (!futuresEndpoint)
        {
            if (required)
                _logger.LogWarning("Binance HTTP failure. statusCode={StatusCode} url={Url}", (int)response.StatusCode, url);

            return;
        }

        var uri = new Uri(url);
        var normalizedSymbol = NormalizeSymbol(symbol);

        if (response.StatusCode == HttpStatusCode.BadRequest)
        {
            _logger.LogWarning(
                "[FUTURES_HTTP_400] symbol={Symbol} endpoint={Endpoint} query={Query} response={Response}",
                normalizedSymbol,
                uri.AbsolutePath,
                uri.Query.TrimStart('?'),
                Truncate(responseBody, 512));
            return;
        }

        _logger.LogWarning(
            "[FUTURES_HTTP_FAILURE] symbol={Symbol} endpoint={Endpoint} statusCode={StatusCode} query={Query} response={Response}",
            normalizedSymbol,
            uri.AbsolutePath,
            (int)response.StatusCode,
            uri.Query.TrimStart('?'),
            Truncate(responseBody, 512));
    }

    private static async Task<string?> SafeReadBodyAsync(HttpResponseMessage response, CancellationToken ct)
    {
        try
        {
            return await response.Content.ReadAsStringAsync(ct);
        }
        catch
        {
            return null;
        }
    }

    private static string? Truncate(string? value, int maxLength)
    {
        if (string.IsNullOrWhiteSpace(value) || value.Length <= maxLength)
            return value;

        return value[..maxLength];
    }

    private static List<KlinePoint> ParseKlines(List<List<JsonElement>>? rows)
    {
        var result = new List<KlinePoint>();
        if (rows is null)
            return result;

        foreach (var row in rows)
        {
            if (row.Count < 11)
                continue;

            result.Add(new KlinePoint
            {
                Open = ParseDecimal(row[1]),
                High = ParseDecimal(row[2]),
                Low = ParseDecimal(row[3]),
                Close = ParseDecimal(row[4]),
                Volume = ParseDecimal(row[5]),
                QuoteVolume = ParseDecimal(row[7]),
                TradeCount = row[8].GetInt32(),
                TakerBuyBaseVolume = ParseDecimal(row[9]),
                TakerBuyQuoteVolume = ParseDecimal(row[10])
            });
        }

        return result;
    }

    private static decimal ParseDecimal(JsonElement element)
        => decimal.Parse(element.GetString() ?? "0", CultureInfo.InvariantCulture);

    private static int ClampToScore(decimal value)
        => (int)Math.Clamp(Math.Round(value, MidpointRounding.AwayFromZero), 0m, 100m);

    private static decimal? CalculatePriceMomentumScore(Binance24hTicker? ticker, List<KlinePoint> kline5m, List<KlinePoint> kline15m, List<KlinePoint> kline1h)
    {
        if (ticker is null)
            return null;

        var change24h = NormalizeCentered(ParseDecimalOrDefault(ticker.PriceChangePercent), 10m);
        var move5m = NormalizeCentered(GetRecentReturn(kline5m), 1.5m);
        var move15m = NormalizeCentered(GetRecentReturn(kline15m), 3m);
        var move1h = NormalizeCentered(GetRecentReturn(kline1h), 6m);

        return AverageWeighted(
            (change24h, 0.45m),
            (move5m, 0.20m),
            (move15m, 0.20m),
            (move1h, 0.15m));
    }

    private static decimal? CalculateVolumeScore(Binance24hTicker? ticker, List<KlinePoint> kline5m, List<KlinePoint> kline15m, List<KlinePoint> kline1h)
    {
        if (ticker is null)
            return null;

        var direction = Math.Sign(GetRecentReturn(kline15m) + GetRecentReturn(kline1h));
        var ratio5 = GetLatestToAverageVolumeRatio(kline5m);
        var ratio15 = GetLatestToAverageVolumeRatio(kline15m);
        var ratio1h = GetLatestToAverageVolumeRatio(kline1h);
        var excitement = AverageWeighted((NormalizeUnboundedRatio(ratio5), 0.4m), (NormalizeUnboundedRatio(ratio15), 0.35m), (NormalizeUnboundedRatio(ratio1h), 0.25m));
        var signedScore = 50m + ((excitement ?? 50m) - 50m) * direction;
        var quoteVolumeBias = NormalizeCentered(ParseDecimalOrDefault(ticker.PriceChangePercent) * NormalizeVolumeScale(ParseDecimalOrDefault(ticker.QuoteVolume)), 20m);

        return AverageWeighted((signedScore, 0.7m), (quoteVolumeBias, 0.3m));
    }

    private static decimal? CalculateOrderBookScore(BinanceDepth? depth)
    {
        if (depth?.Bids is null || depth.Asks is null || depth.Bids.Count == 0 || depth.Asks.Count == 0)
            return null;

        decimal bidValue = depth.Bids.Sum(LevelValue);
        decimal askValue = depth.Asks.Sum(LevelValue);
        var total = bidValue + askValue;
        if (total <= 0m)
            return null;

        var ratio = bidValue / total;
        return Math.Clamp(ratio * 100m, 0m, 100m);
    }

    private static decimal? CalculateFundingScore(BinanceFundingRate? funding)
    {
        if (funding is null)
            return null;

        var rate = ParseDecimalOrDefault(funding.FundingRate);
        return NormalizeCentered(rate * 10000m, 15m);
    }

    private static decimal? CalculateLongShortScore(
        BinanceLongShortRatio? longShort,
        BinanceTakerLongShortRatio? taker,
        BinanceOpenInterest? openInterest,
        List<BinanceOpenInterestHist>? openInterestHist)
    {
        decimal? longShortScore = null;
        if (longShort is not null && decimal.TryParse(longShort.LongShortRatio, NumberStyles.Any, CultureInfo.InvariantCulture, out var ratio) && ratio > 0m)
            longShortScore = NormalizeLogRatio(ratio);

        decimal? takerScore = null;
        if (taker is not null
            && decimal.TryParse(taker.BuySellRatio, NumberStyles.Any, CultureInfo.InvariantCulture, out var buySellRatio)
            && buySellRatio > 0m)
            takerScore = NormalizeLogRatio(buySellRatio);

        decimal? oiBias = null;
        if (openInterest is not null
            && openInterestHist is { Count: >= 2 }
            && decimal.TryParse(openInterest.OpenInterest, NumberStyles.Any, CultureInfo.InvariantCulture, out var currentOi)
            && decimal.TryParse(openInterestHist[^2].SumOpenInterest, NumberStyles.Any, CultureInfo.InvariantCulture, out var previousOi)
            && previousOi > 0m)
        {
            var deltaPct = ((currentOi - previousOi) / previousOi) * 100m;
            oiBias = NormalizeCentered(deltaPct, 8m);
        }

        return AverageWeighted((longShortScore, 0.45m), (takerScore, 0.35m), (oiBias, 0.20m));
    }

    private static decimal? CalculateVolatilityScore(List<KlinePoint> kline5m, List<KlinePoint> kline15m, List<KlinePoint> kline1h)
    {
        var range5 = GetAverageRangePercent(kline5m);
        var range15 = GetAverageRangePercent(kline15m);
        var range1h = GetAverageRangePercent(kline1h);
        var direction = GetRecentReturn(kline15m) + GetRecentReturn(kline1h);
        var volatilityBase = AverageWeighted(
            (NormalizeRange(range5), 0.40m),
            (NormalizeRange(range15), 0.35m),
            (NormalizeRange(range1h), 0.25m));

        if (!volatilityBase.HasValue)
            return null;

        var directionalTilt = NormalizeCentered(direction, 5m);
        return AverageWeighted((50m + ((volatilityBase.Value - 50m) * Math.Sign(direction == 0m ? 1m : direction)), 0.65m), (directionalTilt, 0.35m));
    }

    private static decimal ParseDecimalOrDefault(string? value)
        => decimal.TryParse(value, NumberStyles.Any, CultureInfo.InvariantCulture, out var parsed) ? parsed : 0m;

    private static decimal GetRecentReturn(List<KlinePoint> klines)
    {
        if (klines.Count == 0)
            return 0m;

        var latest = klines[^1];
        if (latest.Open <= 0m)
            return 0m;

        return ((latest.Close - latest.Open) / latest.Open) * 100m;
    }

    private static decimal GetLatestToAverageVolumeRatio(List<KlinePoint> klines)
    {
        if (klines.Count < 2)
            return 1m;

        var latest = klines[^1].QuoteVolume;
        var previous = klines.Take(klines.Count - 1).Select(x => x.QuoteVolume).DefaultIfEmpty(0m).Average();
        if (previous <= 0m)
            return 1m;

        return latest / previous;
    }

    private static decimal GetAverageRangePercent(List<KlinePoint> klines)
    {
        if (klines.Count == 0)
            return 0m;

        var ranges = klines
            .Where(x => x.Close > 0m)
            .Select(x => ((x.High - x.Low) / x.Close) * 100m)
            .ToList();

        return ranges.Count == 0 ? 0m : ranges.Average();
    }

    private static decimal NormalizeCentered(decimal value, decimal scale)
    {
        if (scale <= 0m)
            return 50m;

        var normalized = Math.Clamp(value / scale, -1m, 1m);
        return 50m + normalized * 50m;
    }

    private static decimal NormalizeUnboundedRatio(decimal ratio)
    {
        if (ratio <= 0m)
            return 50m;

        var adjusted = Math.Clamp((ratio - 1m) / 1.5m, -1m, 1m);
        return 50m + adjusted * 50m;
    }

    private static decimal NormalizeLogRatio(decimal ratio)
    {
        if (ratio <= 0m)
            return 50m;

        var log = (decimal)Math.Log((double)ratio);
        return NormalizeCentered(log, 0.45m);
    }

    private static decimal NormalizeRange(decimal rangePercent)
    {
        if (rangePercent <= 0m)
            return 50m;

        if (rangePercent < 0.8m)
            return 50m;

        return NormalizeCentered(rangePercent - 0.8m, 4m);
    }

    private static decimal NormalizeVolumeScale(decimal quoteVolume)
    {
        if (quoteVolume <= 0m)
            return 0m;

        var log = Math.Log10((double)Math.Max(quoteVolume, 1m));
        return (decimal)Math.Clamp(log / 9d, 0d, 1d);
    }

    private static decimal? AverageWeighted(params (decimal? Value, decimal Weight)[] values)
    {
        var availableWeight = values.Where(x => x.Value.HasValue).Sum(x => x.Weight);
        if (availableWeight <= 0m)
            return null;

        return values.Where(x => x.Value.HasValue).Sum(x => x.Value!.Value * x.Weight) / availableWeight;
    }

    private static decimal LevelValue(List<string> level)
    {
        if (level.Count < 2)
            return 0m;

        var price = ParseDecimalOrDefault(level[0]);
        var qty = ParseDecimalOrDefault(level[1]);
        return price * qty;
    }

    private static string Classify(int score) => score switch
    {
        <= 20 => "ExtremeFear",
        <= 40 => "Fear",
        <= 60 => "Neutral",
        <= 80 => "Greed",
        _ => "ExtremeGreed"
    };

    private static ArenaSentimentDto BuildFallback(string symbol, string classification)
        => new()
        {
            Symbol = symbol,
            Score = 50,
            Classification = classification,
            CalculatedAt = DateTime.UtcNow,
            HasSufficientData = false,
            DataCoverage = 0m,
            Note = "InsufficientData"
        };

    private sealed class Binance24hTicker
    {
        [JsonPropertyName("priceChangePercent")]
        public string PriceChangePercent { get; set; } = "0";

        [JsonPropertyName("quoteVolume")]
        public string QuoteVolume { get; set; } = "0";
    }

    private sealed class BinanceDepth
    {
        [JsonPropertyName("bids")]
        public List<List<string>> Bids { get; set; } = [];

        [JsonPropertyName("asks")]
        public List<List<string>> Asks { get; set; } = [];
    }

    private sealed class BinanceFundingRate
    {
        [JsonPropertyName("fundingRate")]
        public string FundingRate { get; set; } = "0";
    }

    private sealed class BinanceOpenInterest
    {
        [JsonPropertyName("openInterest")]
        public string OpenInterest { get; set; } = "0";
    }

    private sealed class BinanceOpenInterestHist
    {
        [JsonPropertyName("sumOpenInterest")]
        public string SumOpenInterest { get; set; } = "0";
    }

    private sealed class BinanceLongShortRatio
    {
        [JsonPropertyName("longShortRatio")]
        public string LongShortRatio { get; set; } = "1";
    }

    private sealed class BinanceTakerLongShortRatio
    {
        [JsonPropertyName("buySellRatio")]
        public string BuySellRatio { get; set; } = "1";
    }

    private sealed class BinanceFuturesExchangeInfo
    {
        [JsonPropertyName("symbols")]
        public List<BinanceFuturesExchangeInfoSymbol> Symbols { get; set; } = [];
    }

    private sealed class BinanceFuturesExchangeInfoSymbol
    {
        [JsonPropertyName("symbol")]
        public string Symbol { get; set; } = string.Empty;

        [JsonPropertyName("quoteAsset")]
        public string QuoteAsset { get; set; } = string.Empty;

        [JsonPropertyName("contractType")]
        public string ContractType { get; set; } = string.Empty;

        [JsonPropertyName("status")]
        public string Status { get; set; } = string.Empty;
    }

    private sealed record FuturesPerpetualCatalog(bool IsAvailable, HashSet<string> Symbols);

    private sealed class KlinePoint
    {
        public decimal Open { get; init; }
        public decimal High { get; init; }
        public decimal Low { get; init; }
        public decimal Close { get; init; }
        public decimal Volume { get; init; }
        public decimal QuoteVolume { get; init; }
        public int TradeCount { get; init; }
        public decimal TakerBuyBaseVolume { get; init; }
        public decimal TakerBuyQuoteVolume { get; init; }
    }
}
