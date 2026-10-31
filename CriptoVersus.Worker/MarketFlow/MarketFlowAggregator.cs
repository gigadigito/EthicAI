using System.Diagnostics;

namespace CriptoVersus.Worker.MarketFlow;

public sealed class MarketFlowAggregator(TimeSpan window, int maxTrackedWindows, Dictionary<string, long>? nextSequenceBySymbol = null)
{
    private readonly long _windowMilliseconds = Math.Max(1, (long)window.TotalMilliseconds);
    private readonly int _maxTrackedWindows = Math.Max(2, maxTrackedWindows);
    private readonly SortedDictionary<(string Symbol, long StartMs), Bucket> _buckets = new();
    private readonly HashSet<(string Symbol, long StartMs)> _partialWindows = new();
    private readonly Dictionary<string, long> _lastFlushedWindowBySymbol = new(StringComparer.Ordinal);
    // Per-symbol sequence counters may be shared across aggregator instances so that a
    // Binance reconnect (e.g. after the active symbol set changes) continues the monotonic
    // sequence instead of restarting at 1 and being dropped as a duplicate downstream.
    private readonly Dictionary<string, long> _nextSequenceBySymbol = nextSequenceBySymbol ?? new(StringComparer.Ordinal);

    public bool Add(BinanceAggregateTrade trade)
        => Add(new MarketFlowTradeEnvelope(trade, DateTimeOffset.UtcNow, Stopwatch.GetTimestamp()));

    public bool Add(MarketFlowTradeEnvelope envelope)
    {
        var trade = envelope.Trade;
        var startMs = trade.TradeTime.ToUnixTimeMilliseconds() / _windowMilliseconds * _windowMilliseconds;
        if (_lastFlushedWindowBySymbol.TryGetValue(trade.Symbol, out var lastFlushed) && startMs <= lastFlushed)
            return false;

        var key = (trade.Symbol, startMs);
        if (!_buckets.TryGetValue(key, out var bucket))
            _buckets[key] = bucket = new Bucket(trade.Symbol, startMs, _windowMilliseconds, _partialWindows.Remove(key), envelope.ReceivedAtUtc, envelope.ReceivedMonotonicTimestamp);
        bucket.Add(trade);
        TrimOldestWindows();
        return true;
    }

    public void MarkDataLoss(string symbol, DateTimeOffset tradeTime)
    {
        var startMs = tradeTime.ToUnixTimeMilliseconds() / _windowMilliseconds * _windowMilliseconds;
        var key = (symbol, startMs);
        if (_buckets.TryGetValue(key, out var bucket)) bucket.IsPartial = true;
        else _partialWindows.Add(key);
    }

    public IReadOnlyList<MarketFlowSnapshot> FlushDue(DateTimeOffset nowUtc)
    {
        var dueBeforeMs = nowUtc.ToUnixTimeMilliseconds() / _windowMilliseconds * _windowMilliseconds;
        var due = _buckets.Where(pair => pair.Key.StartMs + _windowMilliseconds <= dueBeforeMs).ToArray();
        var snapshots = new List<MarketFlowSnapshot>(due.Length);
        foreach (var pair in due)
        {
            _buckets.Remove(pair.Key);
            _lastFlushedWindowBySymbol[pair.Key.Symbol] = pair.Key.StartMs;
            var sequence = _nextSequenceBySymbol.TryGetValue(pair.Key.Symbol, out var previous) ? previous + 1 : 1;
            _nextSequenceBySymbol[pair.Key.Symbol] = sequence;
            snapshots.Add(pair.Value.ToSnapshot(sequence));
        }
        return snapshots;
    }

    /// <summary>
    /// Event timestamps define bucket identity. Processing monotonic time only
    /// decides when a populated bucket is released, so clock skew cannot hold
    /// realtime delivery behind Binance's wall clock.
    /// </summary>
    public IReadOnlyList<MarketFlowSnapshot> FlushDueByProcessing(DateTimeOffset nowUtc, long nowMonotonicTimestamp)
    {
        var due = _buckets.Where(pair => Stopwatch.GetElapsedTime(pair.Value.FirstReceivedMonotonicTimestamp, nowMonotonicTimestamp) >= TimeSpan.FromMilliseconds(_windowMilliseconds)).ToArray();
        return FlushBuckets(due);
    }

    public IReadOnlyList<MarketFlowSnapshot> FlushPendingAsPartial()
    {
        foreach (var bucket in _buckets.Values) bucket.IsPartial = true;
        return FlushBuckets(_buckets.ToArray());
    }

    private IReadOnlyList<MarketFlowSnapshot> FlushBuckets(KeyValuePair<(string Symbol, long StartMs), Bucket>[] due)
    {
        var snapshots = new List<MarketFlowSnapshot>(due.Length);
        foreach (var pair in due)
        {
            _buckets.Remove(pair.Key);
            _lastFlushedWindowBySymbol[pair.Key.Symbol] = pair.Key.StartMs;
            var sequence = _nextSequenceBySymbol.TryGetValue(pair.Key.Symbol, out var previous) ? previous + 1 : 1;
            _nextSequenceBySymbol[pair.Key.Symbol] = sequence;
            snapshots.Add(pair.Value.ToSnapshot(sequence));
        }
        return snapshots;
    }

    private void TrimOldestWindows()
    {
        while (_buckets.Count > _maxTrackedWindows)
        {
            var oldest = _buckets.First();
            _buckets.Remove(oldest.Key);
            _partialWindows.Add(oldest.Key);
        }
    }

    private sealed class Bucket(string symbol, long startMs, long windowMilliseconds, bool isPartial, DateTimeOffset firstReceivedAtUtc, long firstReceivedMonotonicTimestamp)
    {
        private BinanceAggregateTrade? _first;
        private BinanceAggregateTrade? _last;
        public bool IsPartial { get; set; } = isPartial;
        public DateTimeOffset FirstReceivedAtUtc { get; } = firstReceivedAtUtc;
        public long FirstReceivedMonotonicTimestamp { get; } = firstReceivedMonotonicTimestamp;
        private int TradeCount { get; set; }
        private decimal TotalBase { get; set; }
        private decimal BuyBase { get; set; }
        private decimal SellBase { get; set; }
        private decimal BuyQuote { get; set; }
        private decimal SellQuote { get; set; }
        private decimal High { get; set; }
        private decimal Low { get; set; }

        public void Add(BinanceAggregateTrade trade)
        {
            TradeCount++;
            TotalBase += trade.Quantity;
            if (trade.IsTakerBuy) { BuyBase += trade.Quantity; BuyQuote += trade.QuoteQuantity; }
            else { SellBase += trade.Quantity; SellQuote += trade.QuoteQuantity; }
            High = TradeCount == 1 ? trade.Price : Math.Max(High, trade.Price);
            Low = TradeCount == 1 ? trade.Price : Math.Min(Low, trade.Price);
            if (_first is null || Compare(trade, _first) < 0) _first = trade;
            if (_last is null || Compare(trade, _last) > 0) _last = trade;
        }

        public MarketFlowSnapshot ToSnapshot(long sequence)
        {
            var first = _first!;
            var last = _last!;
            return new MarketFlowSnapshot(symbol, sequence,
                DateTimeOffset.FromUnixTimeMilliseconds(startMs), DateTimeOffset.FromUnixTimeMilliseconds(startMs + windowMilliseconds),
                TradeCount, TotalBase, BuyBase, SellBase, BuyQuote, SellQuote, BuyQuote - SellQuote,
                first.Price, last.Price, High, Low, first.TradeTime, last.TradeTime, IsPartial)
            {
                ReceivedAtUtc = FirstReceivedAtUtc,
                ReceivedMonotonicTimestamp = FirstReceivedMonotonicTimestamp
            };
        }

        private static int Compare(BinanceAggregateTrade left, BinanceAggregateTrade right)
        {
            var byTime = left.TradeTime.CompareTo(right.TradeTime);
            return byTime != 0 ? byTime : left.AggregateTradeId.CompareTo(right.AggregateTradeId);
        }
    }
}
