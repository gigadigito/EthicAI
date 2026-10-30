namespace CriptoVersus.Worker.MarketFlow;

// BuyerIsMaker=true means the taker/aggressor was a seller; it is not a price direction signal.
public sealed record BinanceAggregateTrade(
    string Symbol,
    long AggregateTradeId,
    decimal Price,
    decimal Quantity,
    DateTimeOffset TradeTime,
    bool BuyerIsMaker)
{
    public decimal QuoteQuantity => Price * Quantity;
    public bool IsTakerBuy => !BuyerIsMaker;
}

public sealed record MarketFlowSnapshot(
    string Symbol,
    long Sequence,
    DateTimeOffset WindowStart,
    DateTimeOffset WindowEnd,
    int TradeCount,
    decimal TotalBaseQuantity,
    decimal TakerBuyBaseQuantity,
    decimal TakerSellBaseQuantity,
    decimal TakerBuyQuote,
    decimal TakerSellQuote,
    decimal NetQuote,
    decimal FirstPrice,
    decimal LastPrice,
    decimal HighPrice,
    decimal LowPrice,
    DateTimeOffset FirstTradeTime,
    DateTimeOffset LastTradeTime,
    bool IsPartial)
{
    public DateTimeOffset ReceivedAtUtc { get; init; }
    public long ReceivedMonotonicTimestamp { get; init; }
}

public sealed record MarketFlowTradeEnvelope(
    BinanceAggregateTrade Trade,
    DateTimeOffset ReceivedAtUtc,
    long ReceivedMonotonicTimestamp);

public interface IMarketFlowSnapshotSink
{
    ValueTask PublishAsync(MarketFlowSnapshot snapshot, CancellationToken cancellationToken);
}

public sealed class NullMarketFlowSnapshotSink : IMarketFlowSnapshotSink
{
    public ValueTask PublishAsync(MarketFlowSnapshot snapshot, CancellationToken cancellationToken) => ValueTask.CompletedTask;
}
