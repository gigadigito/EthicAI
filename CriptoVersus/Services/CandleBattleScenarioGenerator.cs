using System.Globalization;
using System.Text;
using System.Text.Json;
using BLL.NFTFutebol;

namespace CriptoVersus.Web.Services;

/// <summary>
/// Deterministic recipe for the mock scenario fixtures. Every candle comes from
/// closed-form functions (no RNG), so regenerating the JSON always yields the
/// same bytes and the same battles. Winners are still computed by
/// <see cref="CandleBattleScenarioCompiler"/> through the production rules.
/// </summary>
public static class CandleBattleScenarioGenerator
{
    /// <summary>2026-01-01T00:00:00Z, aligned to the 5-minute period.</summary>
    public const long BaseStartMs = 1_767_225_600_000;
    public const int HistoryCount = CandleBattlesResolver.HistoryLength;
    public const int MatchCount = CandleBattlesResolver.ExpectedRounds;
    public const int SeriesCount = HistoryCount + MatchCount;

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        WriteIndented = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase
    };

    public static IReadOnlyList<CandleBattleScenarioFile> BuildAll() =>
    [
        BullishVsBearish(),
        BullishVsBullish(),
        BearishVsBearish(),
        Reversal(),
        Volatility(),
        CompleteMatch(),
        WaitingStart()
    ];

    public static void WriteAll(string directory)
    {
        System.IO.Directory.CreateDirectory(directory);
        foreach (var file in BuildAll())
            File.WriteAllText(Path.Combine(directory, file.Scenario + ".json"),
                JsonSerializer.Serialize(file, JsonOptions) + Environment.NewLine);
    }

    private static long MatchStartMs => BaseStartMs + HistoryCount * CandleBattlesResolver.PeriodMs;

    private static CandleBattleScenarioFile BullishVsBearish() => new()
    {
        Scenario = "bullish-vs-bearish",
        Description = "Left climbs steadily while right falls; the green side wins most confrontations.",
        Match = new CandleBattleScenarioMatch
        {
            MatchId = 910001,
            LeftSymbol = "BTCUSDT",
            RightSymbol = "ETHUSDT",
            StartTimeMs = MatchStartMs,
            Status = CandleBattleScenarioCompiler.FinishedStatus
        },
        Logos = Logos("BTCUSDT", "ETHUSDT"),
        Series = new CandleBattleScenarioSeries
        {
            Left = BuildSeries(67_000m, k => k is 4 or 11 or 16 ? -0.0015m : 0.0055m),
            Right = BuildSeries(3_100m, k => k is 6 or 13 ? 0.0085m : -0.0045m)
        },
        Social = new CandleBattleScenarioSocial { InterestScore = 84, SelectionReasons = ["decisive_win", "performance_spread"] }
    };

    private static CandleBattleScenarioFile BullishVsBullish() => new()
    {
        Scenario = "bullish-vs-bullish",
        Description = "Both sides climb; the larger green candle beats the smaller one.",
        Match = new CandleBattleScenarioMatch
        {
            MatchId = 910002,
            LeftSymbol = "BTCUSDT",
            RightSymbol = "BNBUSDT",
            StartTimeMs = MatchStartMs,
            Status = CandleBattleScenarioCompiler.FinishedStatus
        },
        Logos = Logos("BTCUSDT", "BNBUSDT"),
        Series = new CandleBattleScenarioSeries
        {
            Left = BuildSeries(67_000m, k => k is 3 or 9 ? -0.001m : 0.005m),
            Right = BuildSeries(600m, k => k is 3 ? 0.0062m : k is 9 ? 0.0048m : 0.003m)
        },
        Social = new CandleBattleScenarioSocial { InterestScore = 71, SelectionReasons = ["balanced_score", "candle_movement"] }
    };

    private static CandleBattleScenarioFile BearishVsBearish() => new()
    {
        Scenario = "bearish-vs-bearish",
        Description = "Both sides fall; the smaller red candle defeats the larger one.",
        Match = new CandleBattleScenarioMatch
        {
            MatchId = 910003,
            LeftSymbol = "ETHUSDT",
            RightSymbol = "BTCUSDT",
            StartTimeMs = MatchStartMs,
            Status = CandleBattleScenarioCompiler.FinishedStatus
        },
        Logos = Logos("ETHUSDT", "BTCUSDT"),
        Series = new CandleBattleScenarioSeries
        {
            Left = BuildSeries(3_100m, k => k is 2 ? 0.001m : -0.006m),
            Right = BuildSeries(67_000m, k => k is 2 ? -0.0042m : k is 7 ? 0.0006m : -0.002m)
        },
        Social = new CandleBattleScenarioSocial { InterestScore = 66, SelectionReasons = ["performance_spread"] }
    };

    private static CandleBattleScenarioFile Reversal() => new()
    {
        Scenario = "reversal",
        Description = "Right dominates the first half; left turns the match around (comeback).",
        Match = new CandleBattleScenarioMatch
        {
            MatchId = 910004,
            LeftSymbol = "BTCUSDT",
            RightSymbol = "ETHUSDT",
            StartTimeMs = MatchStartMs,
            Status = CandleBattleScenarioCompiler.FinishedStatus
        },
        Logos = Logos("BTCUSDT", "ETHUSDT"),
        Series = new CandleBattleScenarioSeries
        {
            Left = BuildSeries(67_000m, k => k < 8 ? -0.0025m : 0.006m),
            Right = BuildSeries(3_100m, k => k < 8 ? 0.005m : -0.001m)
        },
        Social = new CandleBattleScenarioSocial { InterestScore = 93, SelectionReasons = ["comeback", "balanced_score"] }
    };

    private static CandleBattleScenarioFile Volatility() => new()
    {
        Scenario = "volatility",
        Description = "Wide wicks and mixed direction on a match still in progress (14 of 18 rounds).",
        Match = new CandleBattleScenarioMatch
        {
            MatchId = 910005,
            LeftSymbol = "SOLUSDT",
            RightSymbol = "BNBUSDT",
            StartTimeMs = MatchStartMs,
            Status = CandleBattleScenarioCompiler.LiveStatus,
            RevealRounds = 14
        },
        Logos = Logos("SOLUSDT", "BNBUSDT"),
        Series = new CandleBattleScenarioSeries
        {
            Left = BuildSeries(150m, k => k is 5 or 12 ? 0m : 0.008m * Wave(k * 1.7m), wide: true),
            Right = BuildSeries(600m, k => k is 5 or 12 ? 0m : -0.007m * Wave(k * 1.3m), wide: true)
        },
        Social = new CandleBattleScenarioSocial { InterestScore = 58, SelectionReasons = ["candle_movement"] }
    };

    private static CandleBattleScenarioFile CompleteMatch() => new()
    {
        Scenario = "complete-match",
        Description = "Canonical finished match: mirrored openings produce draws, then the left side pulls ahead.",
        Match = new CandleBattleScenarioMatch
        {
            MatchId = 910006,
            LeftSymbol = "BTCUSDT",
            RightSymbol = "ETHUSDT",
            StartTimeMs = MatchStartMs,
            Status = CandleBattleScenarioCompiler.FinishedStatus
        },
        Logos = Logos("BTCUSDT", "ETHUSDT"),
        Series = new CandleBattleScenarioSeries
        {
            // Rounds 0-3 mirror both sides exactly (equal return and equal
            // strength) so the production resolver must resolve them as draws.
            Left = BuildSeries(67_000m, k => k < 4 ? 0.0031m : k is 8 or 15 ? -0.0012m : 0.0042m),
            Right = BuildSeries(3_100m, k => k < 4 ? 0.0031m : k is 8 or 15 ? -0.0035m : k is 6 or 13 ? 0.0058m : 0.0018m)
        },
        Social = new CandleBattleScenarioSocial { InterestScore = 88, SelectionReasons = ["decisive_win", "balanced_score", "candle_movement"] }
    };

    private static CandleBattleScenarioFile WaitingStart() => new()
    {
        Scenario = "waiting-start",
        Description = "Match waiting for its first 5-minute candle to close (no confrontations yet).",
        Match = new CandleBattleScenarioMatch
        {
            MatchId = 910007,
            LeftSymbol = "BTCUSDT",
            RightSymbol = "BNBUSDT",
            StartTimeMs = MatchStartMs,
            Status = CandleBattleScenarioCompiler.WaitingStatus,
            RevealRounds = 0
        },
        Logos = Logos("BTCUSDT", "BNBUSDT"),
        Series = new CandleBattleScenarioSeries
        {
            Left = BuildSeries(67_000m, k => 0.003m),
            Right = BuildSeries(600m, k => -0.002m)
        },
        Social = new CandleBattleScenarioSocial { InterestScore = 12, SelectionReasons = [] }
    };

    // ---- series construction -------------------------------------------------

    private static List<CandleBattleScenarioCandle> BuildSeries(decimal basePrice, Func<int, decimal> matchMove, bool wide = false)
    {
        var candles = new List<CandleBattleScenarioCandle>(SeriesCount);
        var price = basePrice;
        for (var i = 0; i < SeriesCount; i++)
        {
            var change = i < HistoryCount ? 0.0009m * Wave(i * 1.1m) : matchMove(i - HistoryCount);
            var open = Round(price);
            var close = Round(open * (1m + change));
            var wick = wide ? 0.011m : 0.0022m;
            var upWick = wick * (1m + 0.4m * Wave(i * 0.8m));
            var downWick = wick * (1m + 0.4m * Wave(i * 0.6m + 1.2m));
            var high = Round(Math.Max(open, close) * (1m + Math.Abs(upWick)));
            var low = Round(Math.Min(open, close) * (1m - Math.Abs(downWick)));
            if (low <= 0m) low = Round(Math.Min(open, close) * 0.999m);
            var volume = Round(1_000m * (1m + 0.25m * Wave(i * 0.9m)) * (wide ? 2m : 1m));
            candles.Add(new CandleBattleScenarioCandle
            {
                OpenTimeMs = BaseStartMs + i * CandleBattlesResolver.PeriodMs,
                Open = open,
                High = high,
                Low = low,
                Close = close,
                Volume = volume
            });
            price = close;
        }
        return candles;
    }

    private static decimal Wave(decimal value) => (decimal)Math.Sin((double)value);

    private static decimal Round(decimal value) => decimal.Round(value, 8, MidpointRounding.AwayFromZero);

    // ---- logos ---------------------------------------------------------------

    private static Dictionary<string, string> Logos(params string[] symbols)
    {
        var map = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var symbol in symbols) map[symbol] = Logo(symbol);
        return map;
    }

    /// <summary>Inline SVG logo (data URI) so mock screens never call external icon services.</summary>
    public static string Logo(string symbol)
    {
        var label = symbol.EndsWith("USDT", StringComparison.OrdinalIgnoreCase) ? symbol[..^4] : symbol;
        // Stable hue (char-sum) so regeneration never depends on string hash randomization.
        var hue = (symbol.ToUpperInvariant().Sum(c => (int)c) % 360).ToString(CultureInfo.InvariantCulture);
        var svg = $"<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"128\" height=\"128\" viewBox=\"0 0 128 128\">"
            + $"<rect width=\"128\" height=\"128\" rx=\"24\" fill=\"hsl({hue},62%,38%)\"/>"
            + $"<circle cx=\"64\" cy=\"64\" r=\"40\" fill=\"hsl({hue},72%,52%)\"/>"
            + $"<text x=\"64\" y=\"76\" font-family=\"system-ui,sans-serif\" font-size=\"30\" font-weight=\"700\" "
            + $"fill=\"#0b1220\" text-anchor=\"middle\">{label[..Math.Min(4, label.Length)]}</text></svg>";
        return "data:image/svg+xml;base64," + Convert.ToBase64String(Encoding.UTF8.GetBytes(svg));
    }
}
