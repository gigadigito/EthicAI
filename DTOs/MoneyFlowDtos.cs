namespace DTOs;

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
}

public sealed record MoneyFlowTransportAccepted(int Accepted, int Duplicates, int Rejected);
