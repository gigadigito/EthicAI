using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.Linq;
using System.Net.Http;
using System.Net.Http.Json;
using System.Net.Sockets;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using BLL;
using BLL.GameRules;
using BLL.NFTFutebol;
using DAL.NftFutebol;
using DTOs;
using EthicAI.EntityModel;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Npgsql;
using static BLL.BinanceService;

namespace CriptoVersus.Worker
{
    public class Worker : BackgroundService
    {
        private readonly ILogger<Worker> _logger;
        private readonly IServiceProvider _sp;
        private readonly IHttpClientFactory _httpClientFactory;
        private readonly CriptoVersusWorkerOptions _options;

        private const string WorkerName = "CriptoVersus.Worker";

        private static readonly TimeSpan CycleInterval = TimeSpan.FromSeconds(60);
        private static readonly TimeSpan MatchDuration = TimeSpan.FromMinutes(90);

        private const int DesiredOngoing = 10;
        private const int DesiredPending = 10;

        private static readonly TimeSpan PendingLeadTime = TimeSpan.FromMinutes(10);
        private static readonly TimeSpan BettingCloseOffset = TimeSpan.FromMinutes(2);

        private static readonly TimeSpan PendingPromotionGrace = TimeSpan.FromMinutes(3);
        private static readonly TimeSpan CancelVeryOldPendingAfter = TimeSpan.FromMinutes(15);

        private const decimal MinQuoteVolumeUsdt = 5_000_000m;
        private const int MinTradesCount = 2000;
        private const int TakeGainers = 40;
        private const int LogTop = 15;

        private const int MoneyScale = 8;

        public record HealthItem(bool Ok, string Message);
        public Worker(
            ILogger<Worker> logger,
            IServiceProvider sp,
            IHttpClientFactory httpClientFactory,
            IOptions<CriptoVersusWorkerOptions> options)
        {
            _logger = logger;
            _sp = sp;
            _httpClientFactory = httpClientFactory;
            _options = options.Value;
        }

        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            await WaitForPostgresAsync(stoppingToken);
            await EnsureWorkerStatusTableAsync(stoppingToken);

            await WriteWorkerStatusAsync(
                status: "starting",
                cycleStartUtc: null,
                cycleEndUtc: null,
                lastSuccessUtc: null,
                lastCycleMs: null,
                degraded: false,
                healthJson: null,
                lastErrorMsg: null,
                lastErrorStack: null,
                ct: stoppingToken);

            while (!stoppingToken.IsCancellationRequested)
            {
                await ExecuteCycleWithStatusAsync(stoppingToken);
                await Task.Delay(CycleInterval, stoppingToken);
            }
        }

        private async Task ExecuteCycleWithStatusAsync(CancellationToken ct)
        {
            var cycleStartUtc = DateTime.UtcNow;
            var sw = Stopwatch.StartNew();

            string status = "running";
            string? lastError = null;
            string? lastStack = null;
            DateTime? lastSuccessUtc = null;
            Dictionary<string, HealthItem>? checks = null;

            try
            {
                checks = await BuildHealthChecksAsync(ct);
                await RunCycleAsync(ct);
                lastSuccessUtc = DateTime.UtcNow;
            }
            catch (Exception ex)
            {
                lastError = ex.Message;
                lastStack = ex.ToString();
                status = IsDnsOrNetworkTransient(ex) ? "degraded" : "error";
                _logger.LogError(ex, "❌ Erro no ciclo do worker.");
            }
            finally
            {
                sw.Stop();

                checks ??= new Dictionary<string, HealthItem>
                {
                    ["health"] = new HealthItem(false, "Health check failed to build")
                };

                var degraded = status == "degraded" || checks.Values.Any(x => !x.Ok);
                var healthJson = JsonSerializer.Serialize(checks);

                if (status == "running" && degraded)
                    status = "degraded";

                await WriteWorkerStatusAsync(
                    status: status,
                    cycleStartUtc: cycleStartUtc,
                    cycleEndUtc: DateTime.UtcNow,
                    lastSuccessUtc: lastSuccessUtc,
                    lastCycleMs: (int)sw.ElapsedMilliseconds,
                    degraded: degraded,
                    healthJson: healthJson,
                    lastErrorMsg: lastError,
                    lastErrorStack: lastStack,
                    ct: ct);

                await NotifyDashboardChangedAsync(ct);
            }
        }

        private async Task RunCycleAsync(CancellationToken ct)
        {
            using var scope = _sp.CreateScope();

            var http = _httpClientFactory.CreateClient();
            var db = scope.ServiceProvider.GetRequiredService<EthicAIDbContext>();
            var matchService = scope.ServiceProvider.GetRequiredService<MatchService>();
            var ruleEngine = scope.ServiceProvider.GetRequiredService<IMatchRuleEngine>();
            var scoringEngine = scope.ServiceProvider.GetRequiredService<IMatchScoringEngine>();
            var ledgerService = scope.ServiceProvider.GetRequiredService<ILedgerService>();

            var nowUtc = DateTime.UtcNow;

            var topGainers = await LoadTopGainersAsync(http, ct);
            if (topGainers.Count < 6)
            {
                _logger.LogWarning("⚠️ Top gainers insuficiente (count={count}).", topGainers.Count);
                return;
            }

            LogTopGainers(topGainers);

            var snapshotUtc = nowUtc;
            var snapshot = BuildSnapshot(topGainers);

            var currencies = await matchService.SaveCurrenciesAsync(topGainers);
            var currencyBySymbol = BuildCurrencyMap(currencies);
            var allowedSymbols = BuildAllowedSet(snapshot);

            await NormalizePendingWindowsAsync(db, nowUtc, ct);
            await PromoteDuePendingToOngoingAsync(db, nowUtc, ct);
            await CancelVeryOldPendingAsync(db, nowUtc, ct);
            await CleanupOutOfSnapshotMatchesAsync(db, allowedSymbols, nowUtc, ct);
            await ProcessOngoingAsync(matchService, db, ruleEngine, scoringEngine, snapshot, snapshotUtc, allowedSymbols, nowUtc, ct);
            await ProcessCompletedMatchSettlementsAsync(db, ledgerService, nowUtc, ct);
            await EnsureOngoingPoolAsync(db, nowUtc, ct);
            await EnsurePendingPoolAsync(db, snapshot, currencyBySymbol, DesiredPending, nowUtc, ct);
            await NormalizePendingWindowsAsync(db, nowUtc, ct);
            await MaterializeRecurringPositionBetsAsync(db, nowUtc, ct);

            await LogPoolStatusAsync(db, nowUtc, ct);
        }

        private async Task<List<Crypto>> LoadTopGainersAsync(HttpClient http, CancellationToken ct)
        {
            var all = await http.GetFromJsonAsync<List<Crypto>>(
                "https://api.binance.com/api/v3/ticker/24hr",
                ct);

            if (all == null || all.Count == 0)
            {
                _logger.LogWarning("⚠️ Binance retornou vazio.");
                return new List<Crypto>();
            }

            static decimal ParseDec(string? s)
                => decimal.TryParse(s, NumberStyles.Any, CultureInfo.InvariantCulture, out var v) ? v : 0m;

            return all
                .Where(c => !string.IsNullOrWhiteSpace(c.Symbol))
                .Where(c => c.Symbol!.EndsWith("USDT", StringComparison.OrdinalIgnoreCase))
                .Where(c => c.Count >= MinTradesCount)
                .Where(c => ParseDec(c.QuoteVolume) >= MinQuoteVolumeUsdt)
                .OrderByDescending(c => ParsePercent(c.PriceChangePercent))
                .Take(TakeGainers)
                .ToList();
        }

        private void LogTopGainers(List<Crypto> topGainers)
        {
            _logger.LogInformation(
                "✅ TopGainers OK (USDT, trades>={minTrades}, qv>={minQv:n0}) count={count} :: {symbols}",
                MinTradesCount,
                MinQuoteVolumeUsdt,
                topGainers.Count,
                string.Join(", ", topGainers.Select(x => x.Symbol)));

            foreach (var c in topGainers.Take(LogTop))
            {
                _logger.LogInformation(
                    "Gainer {sym} pct={pct} quoteVol={qv} trades={cnt}",
                    c.Symbol, c.PriceChangePercent, c.QuoteVolume, c.Count);
            }
        }

        private static List<GainerEntry> BuildSnapshot(List<Crypto> topGainers)
        {
            return topGainers
                .Select((c, idx) => new GainerEntry
                {
                    Symbol = c.Symbol ?? "",
                    Rank = idx + 1,
                    PercentageChange = (decimal?)ParsePercent(c.PriceChangePercent),
                    QuoteVolume = ParseDecimal(c.QuoteVolume),
                    TradeCount = c.Count
                })
                .ToList();
        }

        private static Dictionary<string, Currency> BuildCurrencyMap(List<Currency> currencies)
        {
            return currencies
                .Where(c => !string.IsNullOrWhiteSpace(c.Symbol))
                .ToDictionary(c => c.Symbol!, StringComparer.OrdinalIgnoreCase);
        }

        private static HashSet<string> BuildAllowedSet(List<GainerEntry> snapshot)
        {
            return snapshot
                .Select(x => x.Symbol)
                .ToHashSet(StringComparer.OrdinalIgnoreCase);
        }

        private async Task NormalizePendingWindowsAsync(
            EthicAIDbContext db,
            DateTime nowUtc,
            CancellationToken ct)
        {
            var pending = await db.Match
                .Where(m => m.Status == MatchStatus.Pending)
                .ToListAsync(ct);

            if (pending.Count == 0)
                return;

            var fixedClose = 0;
            var fixedStart = 0;
            var promoted = 0;

            foreach (var match in pending)
            {
                if (!match.StartTime.HasValue)
                {
                    match.StartTime = nowUtc.Add(PendingLeadTime);
                    fixedStart++;
                }

                if (!match.BettingCloseTime.HasValue && match.StartTime.HasValue)
                {
                    match.BettingCloseTime = match.StartTime.Value.Subtract(BettingCloseOffset);
                    fixedClose++;
                }

                if (match.BettingCloseTime.HasValue &&
                    match.StartTime.HasValue &&
                    match.BettingCloseTime.Value >= match.StartTime.Value)
                {
                    match.BettingCloseTime = match.StartTime.Value.Subtract(BettingCloseOffset);
                    fixedClose++;
                }

                if (match.StartTime.HasValue && match.StartTime.Value <= nowUtc)
                {
                    match.Status = MatchStatus.Ongoing;
                    promoted++;
                }
            }

            if (fixedClose > 0 || fixedStart > 0 || promoted > 0)
            {
                await db.SaveChangesAsync(ct);

                _logger.LogInformation(
                    "🛠️ NormalizePendingWindows: fixedStart={fixedStart} fixedClose={fixedClose} promoted={promoted}",
                    fixedStart, fixedClose, promoted);
            }
        }

        private async Task CleanupOutOfSnapshotMatchesAsync(
            EthicAIDbContext db,
            HashSet<string> allowedSymbols,
            DateTime nowUtc,
            CancellationToken ct)
        {
            await CancelPendingOutsideSnapshotAsync(db, allowedSymbols, nowUtc, ct);
            await ForceEndOngoingOutsideSnapshotAsync(db, allowedSymbols, nowUtc, ct);
        }

        private async Task LogPoolStatusAsync(EthicAIDbContext db, DateTime nowUtc, CancellationToken ct)
        {
            var pendingBettable = await CountBettablePendingAsync(db, nowUtc, ct);
            var pendingClosed = await CountClosedPendingAsync(db, nowUtc, ct);
            var ongoingCount = await db.Match.CountAsync(x => x.Status == MatchStatus.Ongoing, ct);
            var cancelledRecent = await db.Match.CountAsync(
                x => x.Status == MatchStatus.Cancelled &&
                     x.EndTime.HasValue &&
                     x.EndTime.Value >= nowUtc.AddMinutes(-30),
                ct);

            _logger.LogInformation(
                "📦 Pool status: pendingBettable={pendingBettable} pendingClosed={pendingClosed} ongoing={ongoing} cancelledLast30m={cancelled} (targets p={pTarget} o={oTarget})",
                pendingBettable,
                pendingClosed,
                ongoingCount,
                cancelledRecent,
                DesiredPending,
                DesiredOngoing);
        }

        private async Task EnsurePendingPoolAsync(
            EthicAIDbContext db,
            List<GainerEntry> snapshot,
            Dictionary<string, Currency> currencyBySymbol,
            int desiredPending,
            DateTime nowUtc,
            CancellationToken ct)
        {
            var pendingCount = await CountBettablePendingAsync(db, nowUtc, ct);
            var missing = desiredPending - pendingCount;

            if (missing <= 0)
                return;

            var existing = await LoadExistingPoolMatchesAsync(db, nowUtc, ct);
            var existingPairs = BuildExistingPairs(existing);
            var busySymbols = BuildBusySymbols(existing);

            var rankedSymbols = snapshot
                .Where(x => !string.IsNullOrWhiteSpace(x.Symbol))
                .OrderBy(x => x.Rank)
                .Select(x => x.Symbol)
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToList();

            var candidates = BuildCandidatePairs(rankedSymbols);
            var created = 0;

            foreach (var (symA, symB, _) in candidates)
            {
                if (created >= missing) break;

                var key = PairKey(symA, symB);
                if (existingPairs.Contains(key)) continue;
                if (busySymbols.Contains(symA) || busySymbols.Contains(symB)) continue;
                if (!currencyBySymbol.TryGetValue(symA, out var curA)) continue;
                if (!currencyBySymbol.TryGetValue(symB, out var curB)) continue;

                var createdOk = await CreatePendingMatchAsync(db, curA, curB, nowUtc, ct);
                if (!createdOk) continue;

                existingPairs.Add(key);
                busySymbols.Add(symA);
                busySymbols.Add(symB);
                created++;
            }

            if (created < missing)
            {
                _logger.LogWarning(
                    "⚠️ Pending pool: consegui criar {created} de {missing}. remainingMissing={remaining}",
                    created, missing, missing - created);
            }
            else
            {
                _logger.LogInformation(
                    "✅ Pending pool reposto: criados {created} (meta={desired}).",
                    created, desiredPending);
            }
        }

        private async Task<List<Match>> LoadExistingPoolMatchesAsync(
            EthicAIDbContext db,
            DateTime nowUtc,
            CancellationToken ct)
        {
            return await db.Match
                .Where(m =>
                    m.Status == MatchStatus.Ongoing ||
                    (m.Status == MatchStatus.Pending &&
                     m.StartTime.HasValue &&
                     m.StartTime.Value > nowUtc))
                .Include(m => m.TeamA).ThenInclude(t => t.Currency)
                .Include(m => m.TeamB).ThenInclude(t => t.Currency)
                .ToListAsync(ct);
        }

        private static HashSet<string> BuildExistingPairs(List<Match> existing)
        {
            return new HashSet<string>(
                existing.Select(m =>
                    PairKey(m.TeamA?.Currency?.Symbol ?? "", m.TeamB?.Currency?.Symbol ?? ""))
                .Where(k => !string.IsNullOrWhiteSpace(k) && !k.StartsWith("|") && !k.EndsWith("|")),
                StringComparer.OrdinalIgnoreCase);
        }

        private static HashSet<string> BuildBusySymbols(List<Match> existing)
        {
            return new HashSet<string>(
                existing.SelectMany(m => new[]
                {
                    m.TeamA?.Currency?.Symbol ?? "",
                    m.TeamB?.Currency?.Symbol ?? ""
                })
                .Where(s => !string.IsNullOrWhiteSpace(s)),
                StringComparer.OrdinalIgnoreCase);
        }

        private static List<(string A, string B, int Score)> BuildCandidatePairs(List<string> rankedSymbols)
        {
            var result = new List<(string A, string B, int Score)>();

            for (int i = 0; i < rankedSymbols.Count; i++)
            {
                for (int j = i + 1; j < rankedSymbols.Count; j++)
                {
                    var a = rankedSymbols[i];
                    var b = rankedSymbols[j];
                    var diff = j - i;
                    var sum = i + j;
                    result.Add((a, b, diff * 1000 + sum));
                }
            }

            result.Sort((x, y) => x.Score.CompareTo(y.Score));
            return result;
        }

        private async Task<bool> CreatePendingMatchAsync(
            EthicAIDbContext db,
            Currency curA,
            Currency curB,
            DateTime nowUtc,
            CancellationToken ct)
        {
            var teamA = await GetOrCreateTeamAsync(db, curA, ct);
            var teamB = await GetOrCreateTeamAsync(db, curB, ct);

            var startTime = nowUtc.Add(PendingLeadTime);
            var bettingCloseTime = startTime.Subtract(BettingCloseOffset);

            var alreadyExists = await db.Match.AnyAsync(m =>
                m.Status == MatchStatus.Pending &&
                m.TeamAId == teamA.TeamId &&
                m.TeamBId == teamB.TeamId &&
                m.StartTime.HasValue &&
                m.StartTime.Value > nowUtc, ct);

            if (alreadyExists)
                return false;

            var match = new Match
            {
                TeamAId = teamA.TeamId,
                TeamBId = teamB.TeamId,
                Status = MatchStatus.Pending,
                StartTime = startTime,
                BettingCloseTime = bettingCloseTime,
                ScoreA = 0,
                ScoreB = 0,
                WinnerTeamId = null,
                EndTime = null,
                EndReasonCode = null,
                EndReasonDetail = null,
                TeamAOutCycles = 0,
                TeamBOutCycles = 0,
                ScoringRuleType = _options.Scoring.DefaultRuleType,
                RulesetVersion = RuleConstants.DefaultRulesetVersion
            };

            db.Match.Add(match);
            await db.SaveChangesAsync(ct);

            db.MatchScoreState.Add(new MatchScoreState
            {
                MatchId = match.MatchId,
                CreatedAtUtc = nowUtc,
                UpdatedAtUtc = nowUtc
            });

            await db.SaveChangesAsync(ct);

            _logger.LogInformation(
                "🆕 Pending criada: MatchId={matchId} {a} vs {b} start={start} betClose={close} scoringRule={rule}",
                match.MatchId, curA.Symbol, curB.Symbol, startTime, bettingCloseTime, match.ScoringRuleType);

            return true;
        }

        private async Task<Team> GetOrCreateTeamAsync(
            EthicAIDbContext db,
            Currency currency,
            CancellationToken ct)
        {
            var existing = await db.Team
                .Include(t => t.Currency)
                .Where(t => t.Currency != null && t.Currency.Symbol == currency.Symbol)
                .OrderBy(t => t.TeamId)
                .FirstOrDefaultAsync(ct);

            if (existing != null)
                return existing;

            var created = new Team
            {
                CurrencyId = currency.CurrencyId
            };

            db.Team.Add(created);
            await db.SaveChangesAsync(ct);

            _logger.LogInformation(
                "🆕 Team criado automaticamente para {symbol}. TeamId={teamId}",
                currency.Symbol,
                created.TeamId);

            return created;
        }

        private async Task PromoteDuePendingToOngoingAsync(
            EthicAIDbContext db,
            DateTime nowUtc,
            CancellationToken ct)
        {
            var duePending = await db.Match
                .Where(m =>
                    m.Status == MatchStatus.Pending &&
                    m.StartTime.HasValue &&
                    m.StartTime.Value <= nowUtc)
                .OrderBy(m => m.StartTime)
                .ToListAsync(ct);

            if (duePending.Count == 0)
                return;

            foreach (var match in duePending)
            {
                match.Status = MatchStatus.Ongoing;

                if (!match.BettingCloseTime.HasValue && match.StartTime.HasValue)
                    match.BettingCloseTime = match.StartTime.Value.Subtract(BettingCloseOffset);
            }

            await db.SaveChangesAsync(ct);

            _logger.LogInformation(
                "🚀 Promovidas {count} partidas Pending -> Ongoing",
                duePending.Count);
        }

        private async Task EnsureOngoingPoolAsync(
            EthicAIDbContext db,
            DateTime nowUtc,
            CancellationToken ct)
        {
            var ongoingCount = await db.Match.CountAsync(x => x.Status == MatchStatus.Ongoing, ct);
            if (ongoingCount >= DesiredOngoing)
                return;

            var missing = DesiredOngoing - ongoingCount;

            var duePending = await db.Match
                .Where(m =>
                    m.Status == MatchStatus.Pending &&
                    m.StartTime.HasValue &&
                    m.StartTime.Value <= nowUtc)
                .OrderBy(m => m.StartTime)
                .Take(missing)
                .ToListAsync(ct);

            foreach (var match in duePending)
            {
                match.Status = MatchStatus.Ongoing;

                if (!match.BettingCloseTime.HasValue && match.StartTime.HasValue)
                    match.BettingCloseTime = match.StartTime.Value.Subtract(BettingCloseOffset);
            }

            if (duePending.Count > 0)
            {
                await db.SaveChangesAsync(ct);

                _logger.LogInformation(
                    "🚀 Ongoing pool ajustado: iniciadas {count} partidas",
                    duePending.Count);
            }
        }

        private async Task<int> CountBettablePendingAsync(
            EthicAIDbContext db,
            DateTime nowUtc,
            CancellationToken ct)
        {
            return await db.Match.CountAsync(m =>
                m.Status == MatchStatus.Pending &&
                m.StartTime.HasValue &&
                m.StartTime.Value > nowUtc &&
                (
                    (m.BettingCloseTime.HasValue && m.BettingCloseTime.Value > nowUtc) ||
                    (!m.BettingCloseTime.HasValue && m.StartTime.Value > nowUtc)
                ), ct);
        }

        private async Task MaterializeRecurringPositionBetsAsync(
            EthicAIDbContext db,
            DateTime nowUtc,
            CancellationToken ct)
        {
            if (!_options.Settlement.AutoReenterEnabled)
                return;

            var minCapital = Math.Max(_options.Settlement.MinPositionCapital, 0m);

            var openMatches = await db.Match
                .Where(m =>
                    m.Status == MatchStatus.Pending &&
                    m.StartTime.HasValue &&
                    m.StartTime.Value > nowUtc &&
                    (
                        (m.BettingCloseTime.HasValue && m.BettingCloseTime.Value > nowUtc) ||
                        (!m.BettingCloseTime.HasValue && m.StartTime.Value > nowUtc)
                    ))
                .OrderBy(m => m.StartTime)
                .ToListAsync(ct);

            if (openMatches.Count == 0)
                return;

            var teamIds = openMatches
                .SelectMany(m => new[] { m.TeamAId, m.TeamBId })
                .Distinct()
                .ToList();

            var positions = await db.UserTeamPosition
                .Where(p =>
                    p.Status == TeamPositionStatus.Active &&
                    p.AutoCompound &&
                    p.CurrentCapital > minCapital &&
                    teamIds.Contains(p.TeamId))
                .ToListAsync(ct);

            if (positions.Count == 0)
                return;

            var reservedPositionIds = await db.Bet
                .Where(b => b.PositionId.HasValue && b.SettledAt == null)
                .Select(b => b.PositionId!.Value)
                .ToListAsync(ct);

            var created = 0;
            var now = DateTime.UtcNow;
            var reserved = reservedPositionIds.ToHashSet();

            foreach (var match in openMatches)
            {
                var matchPositions = positions
                    .Where(p => p.TeamId == match.TeamAId || p.TeamId == match.TeamBId)
                    .ToList();

                if (matchPositions.Count == 0)
                    continue;

                var existingPositionIds = await db.Bet
                    .Where(b => b.MatchId == match.MatchId && b.PositionId.HasValue)
                    .Select(b => b.PositionId!.Value)
                    .ToListAsync(ct);

                var existing = existingPositionIds.ToHashSet();
                var nextPosition = (await db.Bet
                    .Where(b => b.MatchId == match.MatchId)
                    .Select(b => (int?)b.Position)
                    .MaxAsync(ct) ?? 0) + 1;

                foreach (var position in matchPositions)
                {
                    if (existing.Contains(position.PositionId) || reserved.Contains(position.PositionId))
                        continue;

                    db.Bet.Add(new Bet
                    {
                        MatchId = match.MatchId,
                        TeamId = position.TeamId,
                        UserId = position.UserId,
                        PositionId = position.PositionId,
                        Amount = RoundMoney(position.CurrentCapital),
                        BetTime = now,
                        Position = nextPosition++,
                        Claimed = false,
                        ClaimedAt = null,
                        IsWinner = null,
                        PayoutAmount = null,
                        SettledAt = null
                    });

                    reserved.Add(position.PositionId);
                    created++;
                }
            }

            if (created == 0)
                return;

            await db.SaveChangesAsync(ct);

            _logger.LogInformation(
                "🔁 Recurring positions materializadas: {count} entradas automáticas.",
                created);
        }

        private async Task<int> CountClosedPendingAsync(
            EthicAIDbContext db,
            DateTime nowUtc,
            CancellationToken ct)
        {
            return await db.Match.CountAsync(m =>
                m.Status == MatchStatus.Pending &&
                m.StartTime.HasValue &&
                m.StartTime.Value > nowUtc &&
                m.BettingCloseTime.HasValue &&
                m.BettingCloseTime.Value <= nowUtc, ct);
        }

        private static async Task CancelPendingOutsideSnapshotAsync(
            EthicAIDbContext db,
            HashSet<string> allowed,
            DateTime nowUtc,
            CancellationToken ct)
        {
            var pendingNow = await db.Match
                .Include(x => x.TeamA).ThenInclude(t => t.Currency)
                .Include(x => x.TeamB).ThenInclude(t => t.Currency)
                .Where(x => x.Status == MatchStatus.Pending)
                .ToListAsync(ct);

            var changed = 0;

            foreach (var m in pendingNow)
            {
                var a = m.TeamA?.Currency?.Symbol ?? "";
                var b = m.TeamB?.Currency?.Symbol ?? "";

                if (!allowed.Contains(a) || !allowed.Contains(b))
                {
                    m.Status = MatchStatus.Cancelled;
                    m.EndTime = nowUtc;
                    m.EndReasonCode = "FILTERED_OUT";
                    m.EndReasonDetail = $"Pair not in TopGainers snapshot. A={a} B={b}";
                    m.WinnerTeamId = null;
                    m.TeamAOutCycles = 0;
                    m.TeamBOutCycles = 0;
                    m.RulesetVersion ??= RuleConstants.DefaultRulesetVersion;
                    changed++;
                }
            }

            if (changed > 0)
                await db.SaveChangesAsync(ct);
        }

        private static async Task ForceEndOngoingOutsideSnapshotAsync(
            EthicAIDbContext db,
            HashSet<string> allowed,
            DateTime nowUtc,
            CancellationToken ct)
        {
            var ongoingNow = await db.Match
                .Include(x => x.TeamA).ThenInclude(t => t.Currency)
                .Include(x => x.TeamB).ThenInclude(t => t.Currency)
                .Where(x => x.Status == MatchStatus.Ongoing)
                .ToListAsync(ct);

            var changed = 0;

            foreach (var m in ongoingNow)
            {
                var a = m.TeamA?.Currency?.Symbol ?? "";
                var b = m.TeamB?.Currency?.Symbol ?? "";

                if (!allowed.Contains(a) || !allowed.Contains(b))
                {
                    m.Status = MatchStatus.Completed;
                    m.EndTime = nowUtc;
                    m.WinnerTeamId = null;
                    m.EndReasonCode = "FILTERED_OUT_ONGOING";
                    m.EndReasonDetail = $"Forced end: pair not in TopGainers snapshot. A={a} B={b}";
                    m.TeamAOutCycles = 0;
                    m.TeamBOutCycles = 0;
                    m.RulesetVersion ??= RuleConstants.DefaultRulesetVersion;
                    changed++;
                }
            }

            if (changed > 0)
                await db.SaveChangesAsync(ct);
        }

        private static async Task CancelVeryOldPendingAsync(
            EthicAIDbContext db,
            DateTime nowUtc,
            CancellationToken ct)
        {
            var stalePending = await db.Match
                .Where(m =>
                    m.Status == MatchStatus.Pending &&
                    m.StartTime.HasValue &&
                    m.StartTime.Value < nowUtc.Subtract(CancelVeryOldPendingAfter))
                .ToListAsync(ct);

            if (stalePending.Count == 0)
                return;

            foreach (var m in stalePending)
            {
                m.Status = MatchStatus.Cancelled;
                m.EndTime = nowUtc;
                m.WinnerTeamId = null;
                m.EndReasonCode = "PENDING_ORPHAN";
                m.EndReasonDetail =
                    $"Pending não foi promovida após {CancelVeryOldPendingAfter.TotalMinutes} minutos do StartTime.";
            }

            await db.SaveChangesAsync(ct);
            db.ChangeTracker.Clear();
        }

        private async Task ProcessOngoingAsync(
            MatchService matchService,
            EthicAIDbContext db,
            IMatchRuleEngine ruleEngine,
            IMatchScoringEngine scoringEngine,
            List<GainerEntry> snapshot,
            DateTime snapshotUtc,
            HashSet<string> allowed,
            DateTime nowUtc,
            CancellationToken ct)
        {
            var ongoingNow = await matchService.GetOngoingMatchesAsync();

            if (ongoingNow.Count == 0)
            {
                _logger.LogInformation("ℹ️ Nenhum jogo Ongoing para processar.");
                return;
            }

            foreach (var m in ongoingNow)
            {
                var match = await db.Match
                    .Include(x => x.TeamA).ThenInclude(t => t.Currency)
                    .Include(x => x.TeamB).ThenInclude(t => t.Currency)
                    .Include(x => x.ScoreState)
                    .FirstOrDefaultAsync(x => x.MatchId == m.MatchId, ct);

                if (match == null || match.Status != MatchStatus.Ongoing)
                    continue;

                var symA = match.TeamA?.Currency?.Symbol ?? "";
                var symB = match.TeamB?.Currency?.Symbol ?? "";

                if (!allowed.Contains(symA) || !allowed.Contains(symB))
                {
                    match.Status = MatchStatus.Completed;
                    match.EndTime = nowUtc;
                    match.WinnerTeamId = null;
                    match.EndReasonCode = "FILTERED_OUT_ONGOING";
                    match.EndReasonDetail = $"Forced end: pair not in TopGainers snapshot. A={symA} B={symB}";
                    match.TeamAOutCycles = 0;
                    match.TeamBOutCycles = 0;
                    match.RulesetVersion ??= RuleConstants.DefaultRulesetVersion;

                    await db.SaveChangesAsync(ct);

                    _logger.LogWarning(
                        "🏁 FORCE END (WO) match {id} ({a} vs {b}) - fora do snapshot.",
                        match.MatchId, symA, symB);

                    continue;
                }

                var scoreState = await EnsureScoreStateAsync(db, match, nowUtc, ct);
                var previousSnapshots = await LoadPreviousSnapshotsAsync(db, match.MatchId, match.TeamAId, match.TeamBId, ct);

                if (match.TeamA is null || match.TeamB is null || match.TeamA.Currency is null || match.TeamB.Currency is null)
                {
                    _logger.LogWarning(
                        "⚠️ Match {id} sem times/moedas carregados para pontuacao.",
                        match.MatchId);
                    continue;
                }

                var currentTeamA = BuildTeamMetricPoint(match.TeamA);
                var currentTeamB = BuildTeamMetricPoint(match.TeamB);

                db.MatchMetricSnapshot.Add(new MatchMetricSnapshot
                {
                    MatchId = match.MatchId,
                    TeamId = match.TeamAId,
                    CapturedAtUtc = snapshotUtc,
                    PercentageChange = currentTeamA.PercentageChange,
                    QuoteVolume = currentTeamA.QuoteVolume,
                    TradeCount = currentTeamA.TradeCount
                });

                db.MatchMetricSnapshot.Add(new MatchMetricSnapshot
                {
                    MatchId = match.MatchId,
                    TeamId = match.TeamBId,
                    CapturedAtUtc = snapshotUtc,
                    PercentageChange = currentTeamB.PercentageChange,
                    QuoteVolume = currentTeamB.QuoteVolume,
                    TradeCount = currentTeamB.TradeCount
                });

                scoreState.LastSnapshotAtUtc = snapshotUtc;

                var closedWindows = match.ScoringRuleType == MatchScoringRuleType.VolumeWindow && match.StartTime.HasValue
                    ? await LoadClosedVolumeWindowsAsync(
                        currentTeamA.Symbol,
                        currentTeamB.Symbol,
                        ToUtcSafe(match.StartTime.Value),
                        nowUtc,
                        scoreState.LastProcessedVolumeWindowEndUtc,
                        ct)
                    : Array.Empty<ClosedVolumeWindow>();

                var scoringResult = scoringEngine.Evaluate(new MatchScoringContext
                {
                    RuleType = match.ScoringRuleType,
                    CurrentScoreA = match.ScoreA,
                    CurrentScoreB = match.ScoreB,
                    TeamA = currentTeamA,
                    TeamB = currentTeamB,
                    PreviousTeamA = previousSnapshots.TeamA,
                    PreviousTeamB = previousSnapshots.TeamB,
                    State = scoreState,
                    EvaluatedAtUtc = nowUtc,
                    PercentThresholds = _options.Scoring.PercentThresholds,
                    ClosedVolumeWindows = closedWindows
                });

                if (match.ScoreA != scoringResult.ScoreA || match.ScoreB != scoringResult.ScoreB)
                {
                    match.ScoreA = scoringResult.ScoreA;
                    match.ScoreB = scoringResult.ScoreB;

                    _logger.LogInformation(
                        "📊 Match {id} score atualizado pela regra {rule}: {a}:{b}",
                        match.MatchId, match.ScoringRuleType, match.ScoreA, match.ScoreB);
                }

                foreach (var scoreEvent in scoringResult.Events)
                {
                    scoreState.LastEventSequence++;

                    db.MatchScoreEvent.Add(new MatchScoreEvent
                    {
                        MatchId = match.MatchId,
                        TeamId = scoreEvent.TeamId,
                        RuleType = scoreEvent.RuleType,
                        EventType = scoreEvent.EventType,
                        ReasonCode = scoreEvent.ReasonCode,
                        Points = scoreEvent.Points,
                        EventSequence = scoreState.LastEventSequence,
                        TeamPercentageChange = scoreEvent.TeamPercentageChange,
                        OpponentPercentageChange = scoreEvent.OpponentPercentageChange,
                        TeamQuoteVolume = scoreEvent.TeamQuoteVolume,
                        OpponentQuoteVolume = scoreEvent.OpponentQuoteVolume,
                        MetricDelta = scoreEvent.MetricDelta,
                        WindowStartUtc = scoreEvent.WindowStartUtc,
                        WindowEndUtc = scoreEvent.WindowEndUtc,
                        Description = scoreEvent.Description,
                        EventTimeUtc = scoreEvent.EventTimeUtc
                    });

                    _logger.LogInformation(
                        "⚽ Match {matchId} evento #{seq}: team={teamId} rule={rule} type={type} desc={desc}",
                        match.MatchId,
                        scoreState.LastEventSequence,
                        scoreEvent.TeamId,
                        scoreEvent.RuleType,
                        scoreEvent.EventType,
                        scoreEvent.Description);
                }

                var decisionOngoing = ruleEngine.EvaluateOngoing(
                    teamAId: match.TeamAId,
                    teamBId: match.TeamBId,
                    teamASymbol: symA,
                    teamBSymbol: symB,
                    scoreA: match.ScoreA,
                    scoreB: match.ScoreB,
                    teamAOutCycles: match.TeamAOutCycles,
                    teamBOutCycles: match.TeamBOutCycles,
                    topGainersSnapshot: snapshot,
                    snapshotTimeUtc: snapshotUtc
                );

                if (decisionOngoing.UpdatedTeamAOutCycles.HasValue)
                    match.TeamAOutCycles = decisionOngoing.UpdatedTeamAOutCycles.Value;

                if (decisionOngoing.UpdatedTeamBOutCycles.HasValue)
                    match.TeamBOutCycles = decisionOngoing.UpdatedTeamBOutCycles.Value;

                if (decisionOngoing.Decision == MatchDecisionType.FinishWithWinner)
                {
                    var winnerId = decisionOngoing.WinnerTeamId
                        ?? (decisionOngoing.WinnerSide == MatchWinnerSide.A ? match.TeamAId : match.TeamBId);

                    ApplyFinish(match, winnerId, decisionOngoing, nowUtc);
                    await db.SaveChangesAsync(ct);

                    _logger.LogWarning(
                        "🏁 FINISH match {id} WINNER={winner}. Reason={code} Detail={detail}",
                        match.MatchId, winnerId, decisionOngoing.ReasonCode, decisionOngoing.ReasonDetail);

                    continue;
                }

                if (decisionOngoing.Decision == MatchDecisionType.FinishWithWO)
                {
                    ApplyFinish(match, null, decisionOngoing, nowUtc);
                    await db.SaveChangesAsync(ct);

                    _logger.LogWarning(
                        "🏁 FINISH match {id} WO. Reason={code} Detail={detail}",
                        match.MatchId, decisionOngoing.ReasonCode, decisionOngoing.ReasonDetail);

                    continue;
                }

                if (!match.StartTime.HasValue)
                {
                    _logger.LogWarning(
                        "⚠️ Match {id} sem StartTime. Pulando processamento.",
                        match.MatchId);
                    continue;
                }

                var startUtc = ToUtcSafe(match.StartTime.Value);

                if (nowUtc - startUtc >= MatchDuration)
                {
                    if (match.ScoreA > match.ScoreB)
                        match.WinnerTeamId = match.TeamAId;
                    else if (match.ScoreB > match.ScoreA)
                        match.WinnerTeamId = match.TeamBId;
                    else
                        match.WinnerTeamId = null;

                    match.Status = MatchStatus.Completed;
                    match.EndTime = nowUtc;
                    match.EndReasonCode = "TIME_LIMIT";
                    match.EndReasonDetail = $"Reached {MatchDuration.TotalMinutes}min time limit";
                    match.RulesetVersion ??= RuleConstants.DefaultRulesetVersion;

                    await db.SaveChangesAsync(ct);

                    _logger.LogInformation(
                        "⏱️ Match {id} atingiu 90min. Encerrado por tempo. WinnerTeamId={winnerTeamId} Score={scoreA}x{scoreB}",
                        match.MatchId,
                        match.WinnerTeamId,
                        match.ScoreA,
                        match.ScoreB);
                }
                else
                {
                    await db.SaveChangesAsync(ct);
                }
            }
        }

        private async Task ProcessCompletedMatchSettlementsAsync(
            EthicAIDbContext db,
            ILedgerService ledgerService,
            DateTime nowUtc,
            CancellationToken ct)
        {
            var matchesToSettle = await db.Match
                .Include(x => x.TeamA).ThenInclude(t => t.Currency)
                .Include(x => x.TeamB).ThenInclude(t => t.Currency)
                .Where(m =>
                    m.Status == MatchStatus.Completed &&
                    m.EndTime.HasValue &&
                    db.Bet.Any(b => b.MatchId == m.MatchId && b.SettledAt == null))
                .OrderBy(m => m.EndTime)
                .ToListAsync(ct);

            if (matchesToSettle.Count == 0)
                return;

            foreach (var match in matchesToSettle)
            {
                await ApplySettlementAsync(db, ledgerService, match, nowUtc, ct);
            }
        }

        private async Task ApplySettlementAsync(
            EthicAIDbContext db,
            ILedgerService ledgerService,
            Match match,
            DateTime settledAtUtc,
            CancellationToken ct)
        {
            var strategy = db.Database.CreateExecutionStrategy();

            await strategy.ExecuteAsync(async () =>
            {
                await using var tx = await db.Database.BeginTransactionAsync(ct);

                try
                {
                    var bets = await db.Bet
                        .Where(b => b.MatchId == match.MatchId && b.SettledAt == null)
                        .ToListAsync(ct);

                    if (bets.Count == 0)
                    {
                        await tx.CommitAsync(ct);
                        return;
                    }

                    var winnerTeamId = GetEffectiveWinnerTeamId(match);
                    var loserTeamId = winnerTeamId.HasValue
                        ? (winnerTeamId == match.TeamAId ? match.TeamBId : match.TeamAId)
                        : (int?)null;

                    if (winnerTeamId is not int settledWinnerTeamId || loserTeamId is not int settledLoserTeamId)
                    {
                        ApplyNoContestReason(match, "NO_WINNER", "Partida encerrada sem vencedor definido.");

                        if (match.ScoreA == 0 && match.ScoreB == 0)
                            ApplyNoContestReason(match, "DRAW_ZERO_ZERO", "Partida terminou em 0x0. Sem vencedor, sem taxa e com reembolso integral.");

                        _logger.LogInformation(
                            "🤝 Settlement DRAW/NO_WINNER match {matchId}: bets={betsCount}",
                            match.MatchId,
                            bets.Count);

                        await SettleNoContestAsync(
                            db,
                            ledgerService,
                            bets,
                            settledAtUtc,
                            ct);

                        await tx.CommitAsync(ct);
                        return;
                    }

                    var winnerBets = bets
                        .Where(b => b.TeamId == settledWinnerTeamId)
                        .ToList();

                    var loserBets = bets
                        .Where(b => b.TeamId == settledLoserTeamId)
                        .ToList();

                    var totalWinnerStake = winnerBets.Sum(b => SafeMoney(b.Amount));
                    var totalLoserStake = loserBets.Sum(b => SafeMoney(b.Amount));
                    var houseFeeRate = ClampRate(_options.Settlement.HouseFeeRate);
                    var loserRefundRate = ClampRate(_options.Settlement.LoserRefundRate, max: 1m - houseFeeRate);

                    var platformFee = RoundMoney(totalLoserStake * houseFeeRate);
                    var loserRefundPool = RoundMoney(totalLoserStake * loserRefundRate);
                    var distributablePool = RoundMoney(totalLoserStake - platformFee - loserRefundPool);

                    if (winnerBets.Count == 0 || loserBets.Count == 0 || totalWinnerStake <= 0m || totalLoserStake <= 0m)
                    {
                        var reasonCode = DetermineNoContestReason(
                            match,
                            winnerBets.Count,
                            loserBets.Count,
                            totalWinnerStake,
                            totalLoserStake);

                        ApplyNoContestReason(match, reasonCode, BuildNoContestReasonDetail(reasonCode, match));

                        _logger.LogWarning(
                            "⚠️ Settlement sem contraparte suficiente. match={matchId} winnerTeamId={winnerTeamId} winnerBets={winnerBets} loserBets={loserBets}",
                            match.MatchId,
                            winnerTeamId,
                            winnerBets.Count,
                            loserBets.Count);

                        await SettleNoContestAsync(
                            db,
                            ledgerService,
                            bets,
                            settledAtUtc,
                            ct);

                        await tx.CommitAsync(ct);
                        return;
                    }

                    foreach (var bet in loserBets)
                    {
                        bet.IsWinner = false;
                        var loserStake = SafeMoney(bet.Amount);
                        var loserRefund = totalLoserStake == 0m
                            ? 0m
                            : RoundMoney((loserStake / totalLoserStake) * loserRefundPool);

                        bet.PayoutAmount = loserRefund;
                        bet.SettledAt = settledAtUtc;

                        if (await ApplyPositionCapitalAsync(db, bet, loserRefund, settledAtUtc, ct))
                            continue;

                        if (loserRefund > 0m)
                        {
                            var user = await db.User.FirstOrDefaultAsync(u => u.UserID == bet.UserId, ct);
                            if (user == null)
                            {
                                throw new InvalidOperationException(
                                    $"Usuário não encontrado para devolver bet perdedora. UserId={bet.UserId}, BetId={bet.BetId}");
                            }

                            var balanceBefore = SafeMoney(user.Balance);
                            user.Balance = balanceBefore + loserRefund;

                            await ledgerService.AddEntryAsync(
                                user: user,
                                type: "LOSS_REFUND",
                                amount: loserRefund,
                                balanceBefore: balanceBefore,
                                balanceAfter: user.Balance,
                                referenceId: bet.BetId,
                                description: $"Devolucao parcial da bet {bet.BetId} no match {bet.MatchId}",
                                ct: ct);
                        }
                    }

                    foreach (var bet in winnerBets)
                    {
                        var stake = SafeMoney(bet.Amount);
                        var share = totalWinnerStake == 0m ? 0m : (stake / totalWinnerStake);
                        var profit = RoundMoney(share * distributablePool);
                        var payout = RoundMoney(stake + profit);

                        bet.IsWinner = true;
                        bet.PayoutAmount = payout;
                        bet.SettledAt = settledAtUtc;

                        if (await ApplyPositionCapitalAsync(db, bet, payout, settledAtUtc, ct))
                            continue;

                        var user = await db.User.FirstOrDefaultAsync(u => u.UserID == bet.UserId, ct);
                        if (user == null)
                        {
                            throw new InvalidOperationException(
                                $"Usuário não encontrado para liquidar bet. UserId={bet.UserId}, BetId={bet.BetId}");
                        }

                        var balanceBefore = SafeMoney(user.Balance);
                        user.Balance = balanceBefore + payout;

                        await ledgerService.AddEntryAsync(
                            user: user,
                            type: "WIN",
                            amount: payout,
                            balanceBefore: balanceBefore,
                            balanceAfter: user.Balance,
                            referenceId: bet.BetId,
                            description: $"Payout da bet {bet.BetId} no match {bet.MatchId}",
                            ct: ct);
                    }

                    await db.SaveChangesAsync(ct);
                    await tx.CommitAsync(ct);

                    _logger.LogInformation(
                        "💰 Settlement OK match={matchId} winnerTeamId={winnerTeamId} winnerBets={winnerBets} loserBets={loserBets} totalWinnerStake={totalWinnerStake} totalLoserStake={totalLoserStake} fee={fee} loserRefund={loserRefund} distributable={distributable}",
                        match.MatchId,
                        winnerTeamId,
                        winnerBets.Count,
                        loserBets.Count,
                        totalWinnerStake,
                        totalLoserStake,
                        platformFee,
                        loserRefundPool,
                        distributablePool);
                }
                catch (Exception ex)
                {
                    await tx.RollbackAsync(ct);
                    _logger.LogError(ex, "❌ Erro ao liquidar match {matchId}", match.MatchId);
                    throw;
                }
            });
        }

        private async Task SettleNoContestAsync(
            EthicAIDbContext db,
            ILedgerService ledgerService,
            IReadOnlyCollection<Bet> bets,
            DateTime settledAtUtc,
            CancellationToken ct)
        {
            foreach (var bet in bets)
            {
                var principal = SafeMoney(bet.Amount);

                bet.IsWinner = null;
                bet.PayoutAmount = principal;
                bet.SettledAt = settledAtUtc;

                if (await ApplyPositionCapitalAsync(db, bet, principal, settledAtUtc, ct))
                    continue;

                var user = await db.User.FirstOrDefaultAsync(u => u.UserID == bet.UserId, ct);
                if (user == null)
                {
                    throw new InvalidOperationException(
                        $"Usuário não encontrado para devolver principal. UserId={bet.UserId}, BetId={bet.BetId}");
                }

                var balanceBefore = SafeMoney(user.Balance);
                user.Balance = balanceBefore + principal;

                await ledgerService.AddEntryAsync(
                    user: user,
                    type: "NO_CONTEST_REFUND",
                    amount: principal,
                    balanceBefore: balanceBefore,
                    balanceAfter: user.Balance,
                    referenceId: bet.BetId,
                    description: $"Devolucao integral da bet {bet.BetId} no match {bet.MatchId} sem contraparte valida",
                    ct: ct);
            }

            await db.SaveChangesAsync(ct);
        }

        private static string DetermineNoContestReason(
            Match match,
            int winnerBetsCount,
            int loserBetsCount,
            decimal totalWinnerStake,
            decimal totalLoserStake)
        {
            var effectiveWinnerTeamId = GetEffectiveWinnerTeamId(match);

            if (match.Status == MatchStatus.Cancelled)
                return "CANCELLED";

            if (match.ScoreA == 0 && match.ScoreB == 0)
                return "DRAW_ZERO_ZERO";

            if (!effectiveWinnerTeamId.HasValue || match.ScoreA == match.ScoreB)
                return "NO_WINNER";

            if (effectiveWinnerTeamId == match.TeamAId && (winnerBetsCount <= 0 || totalWinnerStake <= 0m))
                return "NO_BETS_ON_TEAM_A";

            if (effectiveWinnerTeamId == match.TeamBId && (winnerBetsCount <= 0 || totalWinnerStake <= 0m))
                return "NO_BETS_ON_TEAM_B";

            if (effectiveWinnerTeamId == match.TeamAId && (loserBetsCount <= 0 || totalLoserStake <= 0m))
                return "NO_BETS_ON_TEAM_B";

            if (effectiveWinnerTeamId == match.TeamBId && (loserBetsCount <= 0 || totalLoserStake <= 0m))
                return "NO_BETS_ON_TEAM_A";

            return "NO_COUNTERPARTY";
        }

        private static int? GetEffectiveWinnerTeamId(Match match)
        {
            if (match.WinnerTeamId.HasValue)
                return match.WinnerTeamId;

            if (match.ScoreA > match.ScoreB)
                return match.TeamAId;

            if (match.ScoreB > match.ScoreA)
                return match.TeamBId;

            return null;
        }

        private static string BuildNoContestReasonDetail(string reasonCode, Match match)
            => reasonCode switch
            {
                "DRAW_ZERO_ZERO" => "Placar final 0x0. Nao houve vencedor nem disputa financeira valida.",
                "NO_BETS_ON_TEAM_A" => $"Nao havia apostas validas em {match.TeamAId}. Sem contraparte financeira valida.",
                "NO_BETS_ON_TEAM_B" => $"Nao havia apostas validas em {match.TeamBId}. Sem contraparte financeira valida.",
                "NO_COUNTERPARTY" => "Nao havia apostas validas nos dois lados para formar contraparte financeira.",
                "CANCELLED" => "Partida cancelada. Apostas devolvidas integralmente.",
                _ => "Partida encerrada sem vencedor definido. Apostas devolvidas integralmente."
            };

        private static void ApplyNoContestReason(Match match, string reasonCode, string reasonDetail)
        {
            match.EndReasonCode = reasonCode;
            match.EndReasonDetail = reasonDetail;
            match.RulesetVersion ??= RuleConstants.DefaultRulesetVersion;
        }

        private async Task<bool> ApplyPositionCapitalAsync(
            EthicAIDbContext db,
            Bet bet,
            decimal capital,
            DateTime settledAtUtc,
            CancellationToken ct)
        {
            if (!bet.PositionId.HasValue)
                return false;

            var position = await db.UserTeamPosition
                .FirstOrDefaultAsync(p => p.PositionId == bet.PositionId.Value, ct);

            if (position is null)
                return false;

            position.CurrentCapital = RoundMoney(capital);
            position.UpdatedAt = settledAtUtc;

            if (position.Status == TeamPositionStatus.ClosingRequested)
            {
                position.Status = TeamPositionStatus.Closed;
                position.AutoCompound = false;
                position.ClosedAt = settledAtUtc;
            }
            else if (position.CurrentCapital <= Math.Max(_options.Settlement.MinPositionCapital, 0m))
            {
                position.Status = TeamPositionStatus.Paused;
                position.AutoCompound = false;
            }
            else
            {
                position.Status = TeamPositionStatus.Active;
            }

            return true;
        }

        private static void ApplyFinish(Match match, int? winnerTeamId, MatchDecision decision, DateTime nowUtc)
        {
            match.Status = MatchStatus.Completed;
            match.EndTime = nowUtc;
            match.WinnerTeamId = winnerTeamId;
            match.EndReasonCode = decision.ReasonCode;
            match.EndReasonDetail = decision.ReasonDetail;
            match.RulesetVersion = decision.RulesetVersion;
        }

        private async Task<MatchScoreState> EnsureScoreStateAsync(
            EthicAIDbContext db,
            Match match,
            DateTime nowUtc,
            CancellationToken ct)
        {
            if (match.ScoreState != null)
                return match.ScoreState;

            var scoreState = await db.MatchScoreState.FirstOrDefaultAsync(x => x.MatchId == match.MatchId, ct);
            if (scoreState != null)
            {
                match.ScoreState = scoreState;
                return scoreState;
            }

            scoreState = new MatchScoreState
            {
                MatchId = match.MatchId,
                CreatedAtUtc = nowUtc,
                UpdatedAtUtc = nowUtc
            };

            db.MatchScoreState.Add(scoreState);
            match.ScoreState = scoreState;
            return scoreState;
        }

        private async Task<(TeamMetricPoint? TeamA, TeamMetricPoint? TeamB)> LoadPreviousSnapshotsAsync(
            EthicAIDbContext db,
            int matchId,
            int teamAId,
            int teamBId,
            CancellationToken ct)
        {
            var snapshots = await db.MatchMetricSnapshot
                .Where(x => x.MatchId == matchId)
                .OrderByDescending(x => x.CapturedAtUtc)
                .ToListAsync(ct);

            var teamASnapshot = snapshots.FirstOrDefault(x => x.TeamId == teamAId);
            var teamBSnapshot = snapshots.FirstOrDefault(x => x.TeamId == teamBId);

            return (ToMetricPoint(teamASnapshot), ToMetricPoint(teamBSnapshot));
        }

        private static TeamMetricPoint BuildTeamMetricPoint(Team team)
        {
            return new TeamMetricPoint
            {
                TeamId = team.TeamId,
                Symbol = team.Currency.Symbol,
                PercentageChange = Convert.ToDecimal(team.Currency.PercentageChange, CultureInfo.InvariantCulture),
                QuoteVolume = team.Currency.QuoteVolume,
                TradeCount = team.Currency.TradesCount
            };
        }

        private static TeamMetricPoint? ToMetricPoint(MatchMetricSnapshot? snapshot)
        {
            if (snapshot is null)
                return null;

            return new TeamMetricPoint
            {
                TeamId = snapshot.TeamId,
                PercentageChange = snapshot.PercentageChange,
                QuoteVolume = snapshot.QuoteVolume,
                TradeCount = snapshot.TradeCount
            };
        }

        private async Task<IReadOnlyCollection<ClosedVolumeWindow>> LoadClosedVolumeWindowsAsync(
            string symbolA,
            string symbolB,
            DateTime matchStartUtc,
            DateTime nowUtc,
            DateTime? lastProcessedWindowEndUtc,
            CancellationToken ct)
        {
            var windowMinutes = Math.Max(1, _options.Scoring.VolumeWindowMinutes);
            var firstWindowStart = AlignToNextWindow(matchStartUtc, windowMinutes);
            var nextWindowStart = lastProcessedWindowEndUtc.HasValue
                ? lastProcessedWindowEndUtc.Value
                : firstWindowStart;

            var latestClosedWindowEnd = AlignToWindow(nowUtc, windowMinutes);
            if (nextWindowStart >= latestClosedWindowEnd)
                return Array.Empty<ClosedVolumeWindow>();

            var windows = new List<ClosedVolumeWindow>();
            var client = _httpClientFactory.CreateClient();

            for (var cursor = nextWindowStart; cursor < latestClosedWindowEnd; cursor = cursor.AddMinutes(windowMinutes))
            {
                var windowEnd = cursor.AddMinutes(windowMinutes);
                var teamAKline = await LoadQuoteVolumeKlineAsync(client, symbolA, cursor, windowEnd, windowMinutes, ct);
                var teamBKline = await LoadQuoteVolumeKlineAsync(client, symbolB, cursor, windowEnd, windowMinutes, ct);

                if (teamAKline is null || teamBKline is null)
                    continue;

                windows.Add(new ClosedVolumeWindow
                {
                    WindowStartUtc = cursor,
                    WindowEndUtc = windowEnd,
                    TeamAVolume = teamAKline.Value,
                    TeamBVolume = teamBKline.Value
                });
            }

            return windows;
        }

        private async Task<decimal?> LoadQuoteVolumeKlineAsync(
            HttpClient client,
            string symbol,
            DateTime windowStartUtc,
            DateTime windowEndUtc,
            int windowMinutes,
            CancellationToken ct)
        {
            var startMs = new DateTimeOffset(windowStartUtc).ToUnixTimeMilliseconds();
            var endMs = new DateTimeOffset(windowEndUtc).ToUnixTimeMilliseconds();
            var url = $"https://api.binance.com/api/v3/klines?symbol={symbol}&interval={windowMinutes}m&startTime={startMs}&endTime={endMs}&limit=1";
            using var response = await client.GetAsync(url, ct);

            if (!response.IsSuccessStatusCode)
            {
                _logger.LogWarning("⚠️ Falha ao carregar kline {symbol} {start}->{end}: HTTP {statusCode}", symbol, windowStartUtc, windowEndUtc, (int)response.StatusCode);
                return null;
            }

            var payload = await response.Content.ReadFromJsonAsync<List<List<JsonElement>>>(cancellationToken: ct);
            if (payload is null || payload.Count == 0 || payload[0].Count < 8)
                return null;

            return ParseDecimal(payload[0][7].GetString());
        }

        private static DateTime AlignToWindow(DateTime utc, int windowMinutes)
        {
            var totalMinutes = utc.Hour * 60 + utc.Minute;
            var bucketMinutes = totalMinutes - (totalMinutes % windowMinutes);
            return new DateTime(utc.Year, utc.Month, utc.Day, 0, 0, 0, DateTimeKind.Utc).AddMinutes(bucketMinutes);
        }

        private static DateTime AlignToNextWindow(DateTime utc, int windowMinutes)
        {
            var aligned = AlignToWindow(utc, windowMinutes);
            return aligned == utc ? aligned : aligned.AddMinutes(windowMinutes);
        }

        private static double ParsePercent(string? s)
        {
            if (string.IsNullOrWhiteSpace(s)) return 0;

            return double.TryParse(
                s,
                NumberStyles.Any,
                CultureInfo.InvariantCulture,
                out var v)
                ? v
                : 0;
        }

        private static decimal ParseDecimal(string? s)
        {
            if (string.IsNullOrWhiteSpace(s))
                return 0m;

            return decimal.TryParse(s, NumberStyles.Any, CultureInfo.InvariantCulture, out var value)
                ? value
                : 0m;
        }

        private static decimal SafeMoney(decimal? value) => value ?? 0m;

        private static decimal RoundMoney(decimal value)
            => Math.Round(value, MoneyScale, MidpointRounding.ToZero);

        private static decimal ClampRate(decimal value, decimal max = 1m)
        {
            if (value < 0m)
                return 0m;

            if (max < 0m)
                return 0m;

            if (value > max)
                return max;

            return value;
        }

        private static string PairKey(string a, string b)
            => string.CompareOrdinal(a, b) < 0 ? $"{a}|{b}" : $"{b}|{a}";

        private static DateTime ToUtcSafe(DateTime dt)
        {
            if (dt.Kind == DateTimeKind.Unspecified)
                return DateTime.SpecifyKind(dt, DateTimeKind.Utc);

            return dt.ToUniversalTime();
        }

        private async Task EnsureWorkerStatusTableAsync(CancellationToken ct)
        {
            using var scope = _sp.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<EthicAIDbContext>();

            var sql = @"
                CREATE TABLE IF NOT EXISTS worker_status (
                  tx_worker_name      varchar(50) PRIMARY KEY,
                  dt_last_heartbeat   timestamptz NOT NULL,
                  dt_last_cycle_start timestamptz NULL,
                  dt_last_cycle_end   timestamptz NULL,
                  dt_last_success     timestamptz NULL,
                  nr_last_cycle_ms    integer NULL,
                  in_degraded         boolean NOT NULL DEFAULT false,
                  tx_health_json      text NULL,
                  tx_last_error       text NULL,
                  tx_last_error_stack text NULL,
                  in_status           varchar(20) NOT NULL,
                  dt_updated_at       timestamptz NOT NULL DEFAULT now()
                );";

            await db.Database.ExecuteSqlRawAsync(sql, ct);
        }

        private async Task WriteWorkerStatusAsync(
            string status,
            DateTime? cycleStartUtc,
            DateTime? cycleEndUtc,
            DateTime? lastSuccessUtc,
            int? lastCycleMs,
            bool degraded,
            string? healthJson,
            string? lastErrorMsg,
            string? lastErrorStack,
            CancellationToken ct)
        {
            using var scope = _sp.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<EthicAIDbContext>();

            var utcNow = DateTime.UtcNow;

            var sql = @"
INSERT INTO worker_status
  (tx_worker_name, in_status, dt_last_heartbeat, dt_last_cycle_start, dt_last_cycle_end, dt_last_success,
   nr_last_cycle_ms, in_degraded, tx_health_json, tx_last_error, tx_last_error_stack, dt_updated_at)
VALUES
  ({0}, {1}, {2}, {3}, {4}, {5},
   {6}, {7}, {8}, {9}, {10}, now())
ON CONFLICT (tx_worker_name) DO UPDATE SET
  in_status           = EXCLUDED.in_status,
  dt_last_heartbeat   = EXCLUDED.dt_last_heartbeat,
  dt_last_cycle_start = COALESCE(EXCLUDED.dt_last_cycle_start, worker_status.dt_last_cycle_start),
  dt_last_cycle_end   = COALESCE(EXCLUDED.dt_last_cycle_end, worker_status.dt_last_cycle_end),
  dt_last_success     = COALESCE(EXCLUDED.dt_last_success, worker_status.dt_last_success),
  nr_last_cycle_ms    = COALESCE(EXCLUDED.nr_last_cycle_ms, worker_status.nr_last_cycle_ms),
  in_degraded         = EXCLUDED.in_degraded,
  tx_health_json      = COALESCE(EXCLUDED.tx_health_json, worker_status.tx_health_json),
  tx_last_error       = EXCLUDED.tx_last_error,
  tx_last_error_stack = COALESCE(EXCLUDED.tx_last_error_stack, worker_status.tx_last_error_stack),
  dt_updated_at       = now();";

            await db.Database.ExecuteSqlRawAsync(
                sql,
                new object?[]
                {
                    WorkerName,
                    status,
                    utcNow,
                    cycleStartUtc,
                    cycleEndUtc,
                    lastSuccessUtc,
                    lastCycleMs,
                    degraded,
                    healthJson,
                    lastErrorMsg,
                    lastErrorStack
                },
                ct);
        }

        private async Task NotifyDashboardChangedAsync(CancellationToken ct)
        {
            try
            {
                using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(5) };
                using var content = new StringContent("{}", System.Text.Encoding.UTF8, "application/json");
                var resp = await http.PostAsync("http://criptoversus-api:8080/api/dashboard/notify", content, ct);

                _logger.LogInformation(
                    "📣 Notify dashboard_changed -> HTTP {StatusCode}",
                    (int)resp.StatusCode);
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "⚠️ Falha ao notificar dashboard_changed.");
            }
        }

        private async Task<Dictionary<string, HealthItem>> BuildHealthChecksAsync(CancellationToken ct)
        {
            var checks = new Dictionary<string, HealthItem>();

            try
            {
                using var scope = _sp.CreateScope();
                var db = scope.ServiceProvider.GetRequiredService<EthicAIDbContext>();

                var connStr = db.Database.GetDbConnection().ConnectionString;
                await using var conn = new NpgsqlConnection(connStr);
                await conn.OpenAsync(ct);

                await using var cmd = new NpgsqlCommand("SELECT 1;", conn);
                _ = await cmd.ExecuteScalarAsync(ct);

                checks["database"] = new HealthItem(true, "Connected");
            }
            catch (Exception ex)
            {
                checks["database"] = new HealthItem(false, ex.Message);
            }

            try
            {
                var http = _httpClientFactory.CreateClient();
                http.Timeout = TimeSpan.FromSeconds(3);

                var resp = await http.GetAsync("https://api.binance.com/api/v3/ping", ct);
                checks["binance"] = resp.IsSuccessStatusCode
                    ? new HealthItem(true, "Ping OK")
                    : new HealthItem(false, $"HTTP {(int)resp.StatusCode}");
            }
            catch (Exception ex)
            {
                checks["binance"] = new HealthItem(false, ex.Message);
            }

            try
            {
                using var scope = _sp.CreateScope();
                _ = scope.ServiceProvider.GetRequiredService<IMatchRuleEngine>();
                checks["rules"] = new HealthItem(true, "Registered");
            }
            catch (Exception ex)
            {
                checks["rules"] = new HealthItem(false, ex.Message);
            }

            return checks;
        }

        private static bool IsDnsOrNetworkTransient(Exception ex)
        {
            for (var e = ex; e != null; e = e.InnerException)
                if (e is SocketException) return true;

            return false;
        }

        private async Task WaitForPostgresAsync(CancellationToken ct)
        {
            const string host = "postgres";
            const int port = 5432;

            var deadline = DateTime.UtcNow.AddMinutes(3);
            var attempt = 0;

            while (!ct.IsCancellationRequested && DateTime.UtcNow < deadline)
            {
                attempt++;

                try
                {
                    using var tcp = new TcpClient();
                    var connectTask = tcp.ConnectAsync(host, port);

                    var completed = await Task.WhenAny(connectTask, Task.Delay(TimeSpan.FromSeconds(3), ct));
                    if (completed != connectTask)
                        throw new TimeoutException("Timeout conectando no Postgres.");

                    _logger.LogInformation(
                        "✅ Postgres acessível em {host}:{port} (tentativa {attempt})",
                        host, port, attempt);
                    return;
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(
                        "⏳ Postgres ainda não está pronto ({host}:{port}) tentativa {attempt}: {msg}",
                        host, port, attempt, ex.Message);

                    await Task.Delay(TimeSpan.FromSeconds(Math.Min(10, 2 + attempt)), ct);
                }
            }

            _logger.LogWarning("⚠️ Timeout aguardando Postgres. O worker vai continuar.");
        }
    }
}
