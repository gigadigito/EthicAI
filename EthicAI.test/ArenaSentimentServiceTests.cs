using System.Net;
using System.Net.Http;
using System.Text;
using BLL.ArenaSentiment;
using DAL.NftFutebol;
using EthicAI.EntityModel;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;

public class ArenaSentimentServiceTests
{
    [Fact]
    public async Task GetArenaSentimentAsync_SpotOnlySymbol_SkipsFuturesMetricEndpoints()
    {
        using var db = CreateDbContext();
        using var cache = new MemoryCache(new MemoryCacheOptions());
        using var handler = new ArenaSentimentHttpHandler(exchangeInfoJson: """
            {
              "symbols": [
                { "symbol": "BTCUSDT", "quoteAsset": "USDT", "contractType": "PERPETUAL" }
              ]
            }
            """);
        using var httpClient = new HttpClient(handler);

        var service = CreateService(httpClient, db, cache);

        var sentiment = await service.GetArenaSentimentAsync("RLUSDUSDT");

        Assert.Equal("RLUSDUSDT", sentiment.Symbol);
        Assert.Null(sentiment.FundingScore);
        Assert.Null(sentiment.LongShortScore);

        var calls = handler.Requests.ToArray();
        Assert.DoesNotContain(calls, url => url.Contains("/fapi/v1/fundingRate?symbol=RLUSDUSDT", StringComparison.OrdinalIgnoreCase));
        Assert.DoesNotContain(calls, url => url.Contains("/fapi/v1/openInterest?symbol=RLUSDUSDT", StringComparison.OrdinalIgnoreCase));
        Assert.DoesNotContain(calls, url => url.Contains("/futures/data/openInterestHist?symbol=RLUSDUSDT", StringComparison.OrdinalIgnoreCase));
        Assert.DoesNotContain(calls, url => url.Contains("/futures/data/globalLongShortAccountRatio?symbol=RLUSDUSDT", StringComparison.OrdinalIgnoreCase));
        Assert.DoesNotContain(calls, url => url.Contains("/futures/data/takerlongshortRatio?symbol=RLUSDUSDT", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public async Task GetArenaSentimentAsync_ExchangeInfoUnavailable_FallsBackToFuturesRequests()
    {
        using var db = CreateDbContext();
        using var cache = new MemoryCache(new MemoryCacheOptions());
        using var handler = new ArenaSentimentHttpHandler(exchangeInfoStatusCode: HttpStatusCode.InternalServerError);
        using var httpClient = new HttpClient(handler);

        var service = CreateService(httpClient, db, cache);

        var sentiment = await service.GetArenaSentimentAsync("BTCUSDT");

        Assert.Equal("BTCUSDT", sentiment.Symbol);
        Assert.NotNull(sentiment.FundingScore);
        Assert.NotNull(sentiment.LongShortScore);

        var calls = handler.Requests.ToArray();
        Assert.Contains(calls, url => url.Contains("/fapi/v1/fundingRate?symbol=BTCUSDT", StringComparison.OrdinalIgnoreCase));
        Assert.Contains(calls, url => url.Contains("/futures/data/openInterestHist?symbol=BTCUSDT", StringComparison.OrdinalIgnoreCase));
        Assert.Contains(calls, url => url.Contains("/futures/data/globalLongShortAccountRatio?symbol=BTCUSDT", StringComparison.OrdinalIgnoreCase));
        Assert.Contains(calls, url => url.Contains("/futures/data/takerlongshortRatio?symbol=BTCUSDT", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public async Task CalculateArenaPressureGoalAsync_SameDominanceSequence_AwardsAtMostOneGoal()
    {
        using var db = CreateDbContext();
        await SeedMatchAsync(db);

        using var handler = ScriptedArenaSentimentHttpHandler.Create(new Dictionary<string, IReadOnlyList<SentimentBias>>
        {
            ["ALLOUSDT"] = Repeat(SentimentBias.Bearish, 8),
            ["XPLUSDT"] = Repeat(SentimentBias.Bullish, 8)
        });

        for (var i = 0; i < 8; i++)
            await ExecuteArenaPressureCycleAsync(db, handler);

        var match = await db.Match.Include(x => x.ScoreState).SingleAsync(x => x.MatchId == 15123);
        var arenaPressureEvents = await db.Set<MatchScoreEvent>()
            .Where(x => x.MatchId == 15123 && x.RuleType == MatchScoringRuleType.ArenaPressure)
            .ToListAsync();

        Assert.Equal(1, arenaPressureEvents.Count);
        Assert.Equal(1, match.ScoreB);
        Assert.True(match.ScoreState!.CurrentPressureDominanceResolved);
        Assert.True(match.ScoreState.CurrentPressureDominanceGoalAwarded);
    }

    [Fact]
    public async Task CalculateArenaPressureGoalAsync_SameLeaderAfterCooldown_DoesNotAwardSecondGoal()
    {
        using var db = CreateDbContext();
        await SeedMatchAsync(db);

        using var handler = ScriptedArenaSentimentHttpHandler.Create(new Dictionary<string, IReadOnlyList<SentimentBias>>
        {
            ["ALLOUSDT"] = Repeat(SentimentBias.Bearish, 8),
            ["XPLUSDT"] = Repeat(SentimentBias.Bullish, 8)
        });

        for (var i = 0; i < 4; i++)
            await ExecuteArenaPressureCycleAsync(db, handler);

        var state = await db.MatchScoreState.SingleAsync(x => x.MatchId == 15123);
        state.LastPressureGoalTeamBAtUtc = DateTime.UtcNow.AddMinutes(-16);
        await db.SaveChangesAsync();

        for (var i = 0; i < 4; i++)
            await ExecuteArenaPressureCycleAsync(db, handler);

        var arenaPressureEvents = await db.Set<MatchScoreEvent>()
            .Where(x => x.MatchId == 15123 && x.RuleType == MatchScoringRuleType.ArenaPressure)
            .ToListAsync();

        Assert.Equal(1, arenaPressureEvents.Count);
        Assert.True(state.CurrentPressureDominanceResolved);
        Assert.True(state.CurrentPressureDominanceGoalAwarded);
        Assert.Equal(0, state.TeamBPressureCharges);
    }

    [Fact]
    public async Task CalculateArenaPressureGoalAsync_SequenceResetsAfterThresholdBreak_AndCanAwardAgain()
    {
        using var db = CreateDbContext();
        await SeedMatchAsync(db);

        using var handler = ScriptedArenaSentimentHttpHandler.Create(new Dictionary<string, IReadOnlyList<SentimentBias>>
        {
            ["ALLOUSDT"] =
            [
                SentimentBias.Bearish, SentimentBias.Bearish, SentimentBias.Bearish, SentimentBias.Bearish,
                SentimentBias.Neutral,
                SentimentBias.Bearish, SentimentBias.Bearish, SentimentBias.Bearish, SentimentBias.Bearish
            ],
            ["XPLUSDT"] =
            [
                SentimentBias.Bullish, SentimentBias.Bullish, SentimentBias.Bullish, SentimentBias.Bullish,
                SentimentBias.Neutral,
                SentimentBias.Bullish, SentimentBias.Bullish, SentimentBias.Bullish, SentimentBias.Bullish
            ]
        });

        for (var i = 0; i < 4; i++)
            await ExecuteArenaPressureCycleAsync(db, handler);

        var state = await db.MatchScoreState.SingleAsync(x => x.MatchId == 15123);
        state.LastPressureGoalTeamBAtUtc = DateTime.UtcNow.AddMinutes(-16);
        await db.SaveChangesAsync();

        await ExecuteArenaPressureCycleAsync(db, handler);

        Assert.Null(state.CurrentPressureDominanceLeaderTeamId);
        Assert.False(state.CurrentPressureDominanceResolved);
        Assert.False(state.CurrentPressureDominanceGoalAwarded);

        for (var i = 0; i < 4; i++)
            await ExecuteArenaPressureCycleAsync(db, handler);

        var arenaPressureEvents = await db.Set<MatchScoreEvent>()
            .Where(x => x.MatchId == 15123 && x.RuleType == MatchScoringRuleType.ArenaPressure)
            .OrderBy(x => x.EventSequence)
            .ToListAsync();

        Assert.Equal(2, arenaPressureEvents.Count);
        Assert.Equal(2, (await db.Match.SingleAsync(x => x.MatchId == 15123)).ScoreB);
    }

    [Fact]
    public async Task CalculateArenaPressureGoalAsync_OpponentCanStartNewSequenceAfterLeadershipSwap()
    {
        using var db = CreateDbContext();
        await SeedMatchAsync(db);

        using var handler = ScriptedArenaSentimentHttpHandler.Create(new Dictionary<string, IReadOnlyList<SentimentBias>>
        {
            ["ALLOUSDT"] =
            [
                SentimentBias.Bearish, SentimentBias.Bearish, SentimentBias.Bearish, SentimentBias.Bearish,
                SentimentBias.Bullish, SentimentBias.Bullish, SentimentBias.Bullish, SentimentBias.Bullish
            ],
            ["XPLUSDT"] =
            [
                SentimentBias.Bullish, SentimentBias.Bullish, SentimentBias.Bullish, SentimentBias.Bullish,
                SentimentBias.Bearish, SentimentBias.Bearish, SentimentBias.Bearish, SentimentBias.Bearish
            ]
        });

        for (var i = 0; i < 8; i++)
            await ExecuteArenaPressureCycleAsync(db, handler);

        var events = await db.Set<MatchScoreEvent>()
            .Where(x => x.MatchId == 15123 && x.RuleType == MatchScoringRuleType.ArenaPressure)
            .OrderBy(x => x.EventSequence)
            .ToListAsync();

        Assert.Equal(2, events.Count);
        Assert.Equal(39, events[0].TeamId);
        Assert.Equal(4181, events[1].TeamId);

        var match = await db.Match.SingleAsync(x => x.MatchId == 15123);
        Assert.Equal((1, 1), (match.ScoreA, match.ScoreB));
    }

    private static ArenaSentimentService CreateService(HttpClient httpClient, EthicAIDbContext db, IMemoryCache cache, ArenaSentimentOptions? options = null)
    {
        return new ArenaSentimentService(
            httpClient,
            db,
            cache,
            NullLogger<ArenaSentimentService>.Instance,
            Options.Create(options ?? new ArenaSentimentOptions()));
    }

    private static EthicAIDbContext CreateDbContext()
    {
        var options = new DbContextOptionsBuilder<EthicAIDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString("N"))
            .Options;
        return new EthicAIDbContext(options);
    }

    private static async Task ExecuteArenaPressureCycleAsync(EthicAIDbContext db, HttpMessageHandler handler)
    {
        using var cache = new MemoryCache(new MemoryCacheOptions());
        using var httpClient = new HttpClient(handler, disposeHandler: false);
        var service = CreateService(httpClient, db, cache, new ArenaSentimentOptions
        {
            MinScoreDiff = 10,
            RequiredCycles = 2,
            GoalCooldownMinutes = 15,
            MaxGoalsPerMatch = 6,
            BlockFirstMinutes = 0
        });

        await service.CalculateArenaPressureGoalAsync(15123);
        await db.SaveChangesAsync();
    }

    private static async Task SeedMatchAsync(EthicAIDbContext db)
    {
        var currencyA = new Currency
        {
            CurrencyId = 1,
            Name = "ALLO",
            Symbol = "ALLOUSDT",
            PercentageChange = 100,
            QuoteVolume = 1_000_000m,
            TradesCount = 100_000,
            LastUpdated = DateTime.UtcNow
        };
        var currencyB = new Currency
        {
            CurrencyId = 2,
            Name = "XPLUS",
            Symbol = "XPLUSDT",
            PercentageChange = 5,
            QuoteVolume = 500_000m,
            TradesCount = 50_000,
            LastUpdated = DateTime.UtcNow
        };

        var teamA = new Team { TeamId = 4181, CurrencyId = currencyA.CurrencyId, Currency = currencyA };
        var teamB = new Team { TeamId = 39, CurrencyId = currencyB.CurrencyId, Currency = currencyB };

        var match = new Match
        {
            MatchId = 15123,
            TeamAId = teamA.TeamId,
            TeamBId = teamB.TeamId,
            TeamA = teamA,
            TeamB = teamB,
            Status = MatchStatus.Ongoing,
            StartTime = DateTime.UtcNow.AddMinutes(-30),
            ScoreA = 0,
            ScoreB = 0
        };

        var scoreState = new MatchScoreState
        {
            MatchId = match.MatchId,
            Match = match,
            CreatedAtUtc = DateTime.UtcNow,
            UpdatedAtUtc = DateTime.UtcNow
        };

        db.AddRange(currencyA, currencyB, teamA, teamB, match, scoreState);
        await db.SaveChangesAsync();
    }

    private static IReadOnlyList<SentimentBias> Repeat(SentimentBias bias, int count)
        => Enumerable.Repeat(bias, count).ToArray();

    private sealed class ArenaSentimentHttpHandler : HttpMessageHandler
    {
        private readonly string _exchangeInfoJson;
        private readonly HttpStatusCode _exchangeInfoStatusCode;

        public ArenaSentimentHttpHandler(
            string? exchangeInfoJson = null,
            HttpStatusCode exchangeInfoStatusCode = HttpStatusCode.OK)
        {
            _exchangeInfoJson = exchangeInfoJson ?? """
                {
                  "symbols": [
                    { "symbol": "BTCUSDT", "quoteAsset": "USDT", "contractType": "PERPETUAL" }
                  ]
                }
                """;
            _exchangeInfoStatusCode = exchangeInfoStatusCode;
        }

        public List<string> Requests { get; } = [];

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            var url = request.RequestUri!.ToString();
            Requests.Add(url);

            var path = request.RequestUri!.AbsolutePath;
            var query = request.RequestUri.Query;

            if (path == "/api/v3/ticker/24hr")
                return Task.FromResult(Json("""{ "priceChangePercent": "2.5", "quoteVolume": "1500000" }"""));

            if (path == "/api/v3/klines")
                return Task.FromResult(Json("""
                    [
                      [0,"100","103","99","102","10",0,"1000",5,"6","600"],
                      [0,"102","104","101","103","12",0,"1100",6,"7","700"],
                      [0,"103","105","102","104","11",0,"1200",6,"6","650"],
                      [0,"104","106","103","105","10",0,"1300",7,"7","750"],
                      [0,"105","108","104","107","15",0,"1400",8,"9","900"],
                      [0,"107","109","106","108","13",0,"1450",8,"8","850"],
                      [0,"108","110","107","109","14",0,"1500",9,"9","950"],
                      [0,"109","112","108","111","18",0,"1600",10,"11","1000"]
                    ]
                    """));

            if (path == "/api/v3/depth")
                return Task.FromResult(Json("""{ "bids": [["1","100"]], "asks": [["1","50"]] }"""));

            if (path == "/fapi/v1/exchangeInfo")
                return Task.FromResult(Json(_exchangeInfoJson, _exchangeInfoStatusCode));

            if (path == "/fapi/v1/fundingRate")
                return Task.FromResult(Json("""[{ "fundingRate": "0.001" }]"""));

            if (path == "/fapi/v1/openInterest")
                return Task.FromResult(Json("""{ "openInterest": "1200" }"""));

            if (path == "/futures/data/openInterestHist")
                return Task.FromResult(Json("""[{ "sumOpenInterest": "1000" }, { "sumOpenInterest": "1100" }]"""));

            if (path == "/futures/data/globalLongShortAccountRatio")
                return Task.FromResult(Json("""[{ "longShortRatio": "1.2" }]"""));

            if (path == "/futures/data/takerlongshortRatio")
                return Task.FromResult(Json("""[{ "buySellRatio": "1.3" }]"""));

            throw new InvalidOperationException($"Unhandled request: {url}");
        }

        private static HttpResponseMessage Json(string json, HttpStatusCode statusCode = HttpStatusCode.OK)
        {
            return new HttpResponseMessage(statusCode)
            {
                Content = new StringContent(json, Encoding.UTF8, "application/json")
            };
        }
    }

    private enum SentimentBias
    {
        Bullish,
        Bearish,
        Neutral
    }

    private sealed class ScriptedArenaSentimentHttpHandler : HttpMessageHandler
    {
        private const int RequestsPerSentimentBuild = 10;
        private readonly Dictionary<string, Queue<SentimentBias>> _scripts;
        private readonly Dictionary<string, int> _remainingRequests = new(StringComparer.OrdinalIgnoreCase);
        private readonly Dictionary<string, SentimentBias> _activeBiases = new(StringComparer.OrdinalIgnoreCase);

        private ScriptedArenaSentimentHttpHandler(Dictionary<string, Queue<SentimentBias>> scripts)
        {
            _scripts = scripts;
        }

        public static ScriptedArenaSentimentHttpHandler Create(Dictionary<string, IReadOnlyList<SentimentBias>> scripts)
        {
            return new ScriptedArenaSentimentHttpHandler(
                scripts.ToDictionary(
                    kvp => kvp.Key,
                    kvp => new Queue<SentimentBias>(kvp.Value),
                    StringComparer.OrdinalIgnoreCase));
        }

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            var path = request.RequestUri!.AbsolutePath;
            if (path == "/fapi/v1/exchangeInfo")
            {
                var exchangeInfo = """
                    {
                      "symbols": [
                        { "symbol": "ALLOUSDT", "quoteAsset": "USDT", "contractType": "PERPETUAL", "status": "TRADING" },
                        { "symbol": "XPLUSDT", "quoteAsset": "USDT", "contractType": "PERPETUAL", "status": "TRADING" }
                      ]
                    }
                    """;
                return Task.FromResult(Json(exchangeInfo));
            }

            var symbol = GetSymbol(request.RequestUri);
            var bias = GetBias(symbol);

            return Task.FromResult(path switch
            {
                "/api/v3/ticker/24hr" => Json(BuildTickerJson(bias)),
                "/api/v3/klines" => Json(BuildKlinesJson(bias)),
                "/api/v3/depth" => Json(BuildDepthJson(bias)),
                "/fapi/v1/fundingRate" => Json(BuildFundingJson(bias)),
                "/fapi/v1/openInterest" => Json(BuildOpenInterestJson(bias)),
                "/futures/data/openInterestHist" => Json(BuildOpenInterestHistoryJson(bias)),
                "/futures/data/globalLongShortAccountRatio" => Json(BuildLongShortJson(bias)),
                "/futures/data/takerlongshortRatio" => Json(BuildTakerJson(bias)),
                _ => throw new InvalidOperationException($"Unhandled request path: {path}")
            });
        }

        private SentimentBias GetBias(string symbol)
        {
            if (!_remainingRequests.TryGetValue(symbol, out var remaining) || remaining <= 0)
            {
                if (!_scripts.TryGetValue(symbol, out var queue) || queue.Count == 0)
                    throw new InvalidOperationException($"No scripted bias left for {symbol}.");

                _activeBiases[symbol] = queue.Dequeue();
                remaining = RequestsPerSentimentBuild;
            }

            _remainingRequests[symbol] = remaining - 1;
            return _activeBiases[symbol];
        }

        private static string GetSymbol(Uri uri)
        {
            var query = uri.Query.TrimStart('?')
                .Split('&', StringSplitOptions.RemoveEmptyEntries)
                .Select(part => part.Split('=', 2))
                .FirstOrDefault(part => part.Length == 2 && string.Equals(part[0], "symbol", StringComparison.OrdinalIgnoreCase));

            if (query is null)
                throw new InvalidOperationException($"Missing symbol in {uri}.");

            return Uri.UnescapeDataString(query[1]).ToUpperInvariant();
        }

        private static string BuildTickerJson(SentimentBias bias)
            => bias switch
            {
                SentimentBias.Bullish => """{ "priceChangePercent": "18", "quoteVolume": "4500000" }""",
                SentimentBias.Bearish => """{ "priceChangePercent": "-18", "quoteVolume": "4500000" }""",
                _ => """{ "priceChangePercent": "0.2", "quoteVolume": "1200000" }"""
            };

        private static string BuildKlinesJson(SentimentBias bias)
            => bias switch
            {
                SentimentBias.Bullish => """
                    [
                      [0,"100","108","99","107","10",0,"1000",5,"6","600"],
                      [0,"107","115","106","114","12",0,"1200",6,"7","700"],
                      [0,"114","121","113","120","13",0,"1400",7,"8","800"],
                      [0,"120","129","119","128","15",0,"1700",8,"9","900"],
                      [0,"128","136","127","135","18",0,"2000",9,"10","1000"],
                      [0,"135","145","134","144","20",0,"2400",10,"11","1100"],
                      [0,"144","154","143","153","24",0,"2800",11,"12","1200"],
                      [0,"153","165","152","164","28",0,"3300",12,"13","1300"]
                    ]
                    """,
                SentimentBias.Bearish => """
                    [
                      [0,"165","166","154","155","28",0,"3300",12,"4","400"],
                      [0,"155","156","145","146","24",0,"2800",11,"4","380"],
                      [0,"146","147","137","138","20",0,"2400",10,"4","360"],
                      [0,"138","139","130","131","18",0,"2000",9,"4","340"],
                      [0,"131","132","124","125","15",0,"1700",8,"4","320"],
                      [0,"125","126","119","120","13",0,"1400",7,"4","300"],
                      [0,"120","121","113","114","12",0,"1200",6,"4","280"],
                      [0,"114","115","107","108","10",0,"1000",5,"4","260"]
                    ]
                    """,
                _ => """
                    [
                      [0,"100","101","99","100.2","10",0,"1000",5,"5","500"],
                      [0,"100.2","101","99.5","100.1","10",0,"1010",5,"5","505"],
                      [0,"100.1","101","99.8","100.0","10",0,"1020",5,"5","510"],
                      [0,"100.0","100.8","99.7","100.0","10",0,"1030",5,"5","515"],
                      [0,"100.0","100.7","99.8","100.1","10",0,"1040",5,"5","520"],
                      [0,"100.1","100.9","99.9","100.0","10",0,"1050",5,"5","525"],
                      [0,"100.0","100.8","99.9","100.1","10",0,"1060",5,"5","530"],
                      [0,"100.1","100.9","100.0","100.2","10",0,"1070",5,"5","535"]
                    ]
                    """
            };

        private static string BuildDepthJson(SentimentBias bias)
            => bias switch
            {
                SentimentBias.Bullish => """{ "bids": [["1","220"]], "asks": [["1","25"]] }""",
                SentimentBias.Bearish => """{ "bids": [["1","25"]], "asks": [["1","220"]] }""",
                _ => """{ "bids": [["1","100"]], "asks": [["1","100"]] }"""
            };

        private static string BuildFundingJson(SentimentBias bias)
            => bias switch
            {
                SentimentBias.Bullish => """[{ "fundingRate": "0.0015" }]""",
                SentimentBias.Bearish => """[{ "fundingRate": "-0.0015" }]""",
                _ => """[{ "fundingRate": "0" }]"""
            };

        private static string BuildOpenInterestJson(SentimentBias bias)
            => bias switch
            {
                SentimentBias.Bullish => """{ "openInterest": "1400" }""",
                SentimentBias.Bearish => """{ "openInterest": "800" }""",
                _ => """{ "openInterest": "1000" }"""
            };

        private static string BuildOpenInterestHistoryJson(SentimentBias bias)
            => bias switch
            {
                SentimentBias.Bullish => """[{ "sumOpenInterest": "1000" }, { "sumOpenInterest": "1200" }]""",
                SentimentBias.Bearish => """[{ "sumOpenInterest": "1000" }, { "sumOpenInterest": "900" }]""",
                _ => """[{ "sumOpenInterest": "1000" }, { "sumOpenInterest": "1000" }]"""
            };

        private static string BuildLongShortJson(SentimentBias bias)
            => bias switch
            {
                SentimentBias.Bullish => """[{ "longShortRatio": "1.9" }]""",
                SentimentBias.Bearish => """[{ "longShortRatio": "0.55" }]""",
                _ => """[{ "longShortRatio": "1.0" }]"""
            };

        private static string BuildTakerJson(SentimentBias bias)
            => bias switch
            {
                SentimentBias.Bullish => """[{ "buySellRatio": "2.1" }]""",
                SentimentBias.Bearish => """[{ "buySellRatio": "0.5" }]""",
                _ => """[{ "buySellRatio": "1.0" }]"""
            };

        private static HttpResponseMessage Json(string json)
        {
            return new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(json, Encoding.UTF8, "application/json")
            };
        }
    }
}
