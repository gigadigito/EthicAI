using System.Diagnostics;
using System.Threading.Channels;

namespace CriptoVersus.Worker.MarketFlow;

public sealed class MarketFlowTradeBuffer
{
    private readonly Channel<MarketFlowTradeEnvelope> _channel;
    private readonly int _capacity;
    private int _count;

    public MarketFlowTradeBuffer(int capacity)
    {
        _capacity = Math.Max(1, capacity);
        _channel = Channel.CreateBounded<MarketFlowTradeEnvelope>(new BoundedChannelOptions(_capacity)
        {
            FullMode = BoundedChannelFullMode.Wait,
            SingleWriter = true,
            SingleReader = true
            });
    }

    public bool TryWrite(BinanceAggregateTrade trade)
        => TryWrite(new MarketFlowTradeEnvelope(trade, DateTimeOffset.UtcNow, Stopwatch.GetTimestamp()));

    public bool TryWrite(MarketFlowTradeEnvelope envelope)
    {
        while (true)
        {
            var count = Volatile.Read(ref _count);
            if (count >= _capacity) return false;
            if (Interlocked.CompareExchange(ref _count, count + 1, count) == count) break;
        }

        if (_channel.Writer.TryWrite(envelope)) return true;
        Interlocked.Decrement(ref _count);
        return false;
    }

    public bool TryRead(out BinanceAggregateTrade? trade)
    {
        if (!TryReadEnvelope(out var envelope)) { trade = null; return false; }
        trade = envelope!.Trade;
        return true;
    }

    public bool TryReadEnvelope(out MarketFlowTradeEnvelope? envelope)
    {
        if (!_channel.Reader.TryRead(out envelope)) return false;
        Interlocked.Decrement(ref _count);
        return true;
    }
}
