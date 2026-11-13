using System.Text.Json.Serialization;

namespace DTOs;

/// <summary>
/// Presentation-only creature categories for Whale Ocean. The thresholds are
/// quote-notional thresholds, evaluated once per real aggTrade in the Worker.
/// They are deliberately independent from the Babylon visual budget.
/// </summary>
public enum MoneyFlowCreatureKind
{
    Small,
    Medium,
    Large,
    Shark,
    Whale
}

public static class MoneyFlowCreatureRules
{
    // These are shared product rules, not financial thresholds. The quote
    // amount is expressed in the market's quote currency (normally USDT).
    public const decimal MediumMinimumQuote = 1_000m;
    public const decimal LargeMinimumQuote = 10_000m;
    public const decimal SharkMinimumQuote = 100_000m;
    public const decimal WhaleMinimumQuote = 1_000_000m;

    public const int SmallPoints = 1;
    public const int MediumPoints = 3;
    public const int LargePoints = 8;
    public const int SharkPoints = 20;
    public const int WhalePoints = 60;

    public static MoneyFlowCreatureKind Classify(decimal quoteNotional)
    {
        if (quoteNotional >= WhaleMinimumQuote) return MoneyFlowCreatureKind.Whale;
        if (quoteNotional >= SharkMinimumQuote) return MoneyFlowCreatureKind.Shark;
        if (quoteNotional >= LargeMinimumQuote) return MoneyFlowCreatureKind.Large;
        if (quoteNotional >= MediumMinimumQuote) return MoneyFlowCreatureKind.Medium;
        return MoneyFlowCreatureKind.Small;
    }

    public static long Score(MoneyFlowCreatureSideCountsDto counts)
        => counts.Small * SmallPoints
         + counts.Medium * MediumPoints
         + counts.Large * LargePoints
         + counts.Shark * SharkPoints
         + counts.Whale * WhalePoints;
}

public sealed record MoneyFlowCreatureSideCountsDto
{
    public long Small { get; init; }
    public long Medium { get; init; }
    public long Large { get; init; }
    public long Shark { get; init; }
    public long Whale { get; init; }

    [JsonIgnore]
    public long TradeCount => Small + Medium + Large + Shark + Whale;

    [JsonIgnore]
    public long Points => MoneyFlowCreatureRules.Score(this);
}

public sealed record MoneyFlowCreatureCountsDto
{
    public MoneyFlowCreatureSideCountsDto Buy { get; init; } = new();
    public MoneyFlowCreatureSideCountsDto Sell { get; init; } = new();

    [JsonIgnore]
    public long TradeCount => Buy.TradeCount + Sell.TradeCount;

    [JsonIgnore]
    public long Points => Buy.Points + Sell.Points;
}

public sealed record MoneyFlowSourceSequenceDto
{
    public string SourceId { get; init; } = string.Empty;
    public string Symbol { get; init; } = string.Empty;
    public long Sequence { get; init; }
}

public sealed record WhaleOceanScoreboardTeamDto
{
    public string Symbol { get; init; } = string.Empty;
    public MoneyFlowCreatureCountsDto Last30Seconds { get; init; } = new();
    public MoneyFlowCreatureCountsDto MatchTotal { get; init; } = new();
    public IReadOnlyList<MoneyFlowSourceSequenceDto> LastSequences { get; init; } = Array.Empty<MoneyFlowSourceSequenceDto>();
}

public sealed record WhaleOceanScoreboardDto
{
    public int MatchId { get; init; }
    public DateTimeOffset WindowStartUtc { get; init; }
    public DateTimeOffset WindowEndUtc { get; init; }
    public bool IsFinalized { get; init; }
    public WhaleOceanScoreboardTeamDto TeamA { get; init; } = new();
    public WhaleOceanScoreboardTeamDto TeamB { get; init; } = new();
}

/// <summary>
/// Non-authoritative realtime money-flow snapshot. Decimal values are kept as
/// decimals on service boundaries; the browser treats them as visual data only.
/// </summary>
public sealed record MoneyFlowBatchDto
{
    public string Symbol { get; init; } = string.Empty;
    public long Sequence { get; init; }
    public DateTimeOffset WindowStartUtc { get; init; }
    public DateTimeOffset WindowEndUtc { get; init; }
    public DateTimeOffset EventTimeUtc { get; init; }
    public DateTimeOffset ReceivedAtUtc { get; init; }
    public DateTimeOffset PublishedAtUtc { get; init; }
    public long ReceivedMonotonicTicks { get; init; }
    public int TradeCount { get; init; }
    public decimal TotalBaseQuantity { get; init; }
    public decimal TakerBuyBaseQuantity { get; init; }
    public decimal TakerSellBaseQuantity { get; init; }
    public decimal TakerBuyQuote { get; init; }
    public decimal TakerSellQuote { get; init; }
    public decimal NetQuote { get; init; }
    public decimal FirstPrice { get; init; }
    public decimal LastPrice { get; init; }
    public decimal HighPrice { get; init; }
    public decimal LowPrice { get; init; }
    public bool IsPartial { get; init; }
    public MoneyFlowCreatureCountsDto CreatureCounts { get; init; } = new();
}

public sealed record MoneyFlowTransportRequest
{
    public string SourceId { get; init; } = string.Empty;
    public IReadOnlyList<MoneyFlowBatchDto> Batches { get; init; } = Array.Empty<MoneyFlowBatchDto>();
}

/// <summary>
/// SignalR contract. Financial values are strings so the browser never becomes
/// an accidental decimal/ledger authority; the future renderer can parse them
/// for presentation without changing the transport.
/// </summary>
public sealed record MoneyFlowClientBatchDto
{
    public int MatchId { get; init; }
    public string SourceId { get; init; } = string.Empty;
    public string Symbol { get; init; } = string.Empty;
    public long Sequence { get; init; }
    public DateTimeOffset WindowStartUtc { get; init; }
    public DateTimeOffset WindowEndUtc { get; init; }
    public DateTimeOffset EventTimeUtc { get; init; }
    public DateTimeOffset ReceivedAtUtc { get; init; }
    public DateTimeOffset PublishedAtUtc { get; init; }
    public int TradeCount { get; init; }
    public string TotalBaseQuantity { get; init; } = "0";
    public string TakerBuyBaseQuantity { get; init; } = "0";
    public string TakerSellBaseQuantity { get; init; } = "0";
    public string TakerBuyQuote { get; init; } = "0";
    public string TakerSellQuote { get; init; } = "0";
    public string NetQuote { get; init; } = "0";
    public string FirstPrice { get; init; } = "0";
    public string LastPrice { get; init; } = "0";
    public string HighPrice { get; init; } = "0";
    public string LowPrice { get; init; } = "0";
    public bool IsPartial { get; init; }
    /// <summary>
    /// True only for bounded catch-up data sent when a client joins a match group.
    /// Replay data is presentation-only and must never create a new live alert.
    /// </summary>
    public bool IsReplay { get; init; }
    public MoneyFlowCreatureCountsDto CreatureCounts { get; init; } = new();
}

public sealed record MoneyFlowTransportAccepted(int Accepted, int Duplicates, int Rejected);
