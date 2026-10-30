namespace CriptoVersus.Worker.MarketFlow;

public enum MarketFlowDeduplicationResult { Accepted, Duplicate, GapDetected }

public sealed class MarketFlowDeduplicator(int capacity)
{
    private readonly int _capacity = Math.Max(1, capacity);
    private readonly HashSet<(string Symbol, long Id)> _seen = new();
    private readonly Queue<(string Symbol, long Id)> _order = new();
    private readonly Dictionary<string, long> _highestIdBySymbol = new(StringComparer.Ordinal);

    public MarketFlowDeduplicationResult Add(BinanceAggregateTrade trade)
    {
        var key = (trade.Symbol, trade.AggregateTradeId);
        if (!_seen.Add(key)) return MarketFlowDeduplicationResult.Duplicate;

        _order.Enqueue(key);
        while (_order.Count > _capacity) _seen.Remove(_order.Dequeue());

        var result = MarketFlowDeduplicationResult.Accepted;
        if (_highestIdBySymbol.TryGetValue(trade.Symbol, out var highest) && trade.AggregateTradeId > highest + 1)
            result = MarketFlowDeduplicationResult.GapDetected;
        if (!_highestIdBySymbol.TryGetValue(trade.Symbol, out highest) || trade.AggregateTradeId > highest)
            _highestIdBySymbol[trade.Symbol] = trade.AggregateTradeId;
        return result;
    }
}
