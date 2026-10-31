using System.Text;
using System.Diagnostics;
using System.Collections.Concurrent;
using CriptoVersus.Worker.MarketFlow;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;

namespace CriptoVersus.Worker.Tests;

public sealed class MarketFlowTests
{
    private static readonly DateTimeOffset Start = DateTimeOffset.FromUnixTimeMilliseconds(1_700_000_000_000);

    [Fact]
    public void Parse_ValidAggTrade_MapsTakerBuyAndQuoteValue()
    {
        const string json = "{\"e\":\"aggTrade\",\"s\":\"btcusdt\",\"a\":12,\"p\":\"100.25\",\"q\":\"2\",\"T\":1700000000000,\"m\":false}";

        Assert.True(BinanceAggregateTradeParser.TryParse(Encoding.UTF8.GetBytes(json), out var trade));
        Assert.NotNull(trade);
        Assert.Equal("BTCUSDT", trade.Symbol);
        Assert.True(trade.IsTakerBuy);
        Assert.Equal(200.50m, trade.QuoteQuantity);
    }

    [Theory]
    [InlineData("{\"e\":\"aggTrade\",\"s\":\"BTCUSDT\",\"a\":1,\"p\":\"0\",\"q\":\"1\",\"T\":1700000000000,\"m\":true}")]
    [InlineData("{\"e\":\"aggTrade\",\"s\":\"BTCUSDT\",\"a\":1,\"p\":\"1\",\"q\":\"-1\",\"T\":1700000000000,\"m\":true}")]
    [InlineData("{\"e\":\"aggTrade\",\"s\":\"BTCUSDT\",\"a\":1,\"p\":\"1\",\"q\":\"1\",\"T\":0,\"m\":true}")]
    [InlineData("{\"e\":\"aggTrade\",\"s\":\"BTCUSDT\",\"a\":1,\"p\":\"1\",\"q\":\"1\",\"T\":1700000000000}")]
    public void Parse_InvalidAggTrade_IsRejected(string json)
        => Assert.False(BinanceAggregateTradeParser.TryParse(Encoding.UTF8.GetBytes(json), out _));

    [Fact]
    public void Parse_BuyerIsMaker_MapsToTakerSell()
    {
        const string json = "{\"e\":\"aggTrade\",\"s\":\"ETHUSDT\",\"a\":5,\"p\":\"3\",\"q\":\"4\",\"T\":1700000000000,\"m\":true}";
        BinanceAggregateTradeParser.TryParse(Encoding.UTF8.GetBytes(json), out var trade);
        Assert.False(trade!.IsTakerBuy);
    }

    [Fact]
    public void Aggregator_AggregatesBothAggressorSidesAndPrices()
    {
        var aggregator = new MarketFlowAggregator(TimeSpan.FromMilliseconds(250), 20);
        aggregator.Add(Trade("BTCUSDT", 1, 100m, 2m, 10, false));
        aggregator.Add(Trade("BTCUSDT", 2, 98m, 1m, 80, true));
        aggregator.Add(Trade("BTCUSDT", 3, 105m, 3m, 90, false));

        var snapshot = Assert.Single(aggregator.FlushDue(Start.AddMilliseconds(250)));
        Assert.Equal(3, snapshot.TradeCount);
        Assert.Equal(6m, snapshot.TotalBaseQuantity);
        Assert.Equal(5m, snapshot.TakerBuyBaseQuantity);
        Assert.Equal(1m, snapshot.TakerSellBaseQuantity);
        Assert.Equal(515m, snapshot.TakerBuyQuote);
        Assert.Equal(98m, snapshot.TakerSellQuote);
        Assert.Equal(417m, snapshot.NetQuote);
        Assert.Equal(100m, snapshot.FirstPrice);
        Assert.Equal(105m, snapshot.LastPrice);
        Assert.Equal(105m, snapshot.HighPrice);
        Assert.Equal(98m, snapshot.LowPrice);
    }

    [Fact]
    public void Aggregator_SeparatesWindowsSymbolsAndOutOfOrderEvents()
    {
        var aggregator = new MarketFlowAggregator(TimeSpan.FromMilliseconds(250), 20);
        aggregator.Add(Trade("ETHUSDT", 2, 3m, 1m, 300, false));
        aggregator.Add(Trade("BTCUSDT", 2, 11m, 1m, 260, false));
        aggregator.Add(Trade("BTCUSDT", 1, 10m, 1m, 20, true));

        var snapshots = aggregator.FlushDue(Start.AddMilliseconds(600));
        Assert.Equal(3, snapshots.Count);
        Assert.Contains(snapshots, x => x.Symbol == "BTCUSDT" && x.FirstPrice == 10m && x.LastPrice == 10m);
        Assert.Contains(snapshots, x => x.Symbol == "BTCUSDT" && x.FirstPrice == 11m);
        Assert.Contains(snapshots, x => x.Symbol == "ETHUSDT");
        Assert.Empty(aggregator.FlushDue(Start.AddSeconds(1)));
    }

    [Fact]
    public void Deduplicator_ReconnectReplayIsNotCountedAndGapMarksDiagnosticResult()
    {
        var deduplicator = new MarketFlowDeduplicator(10);
        Assert.Equal(MarketFlowDeduplicationResult.Accepted, deduplicator.Add(Trade("BTCUSDT", 10, 1m, 1m, 0, false)));
        Assert.Equal(MarketFlowDeduplicationResult.Duplicate, deduplicator.Add(Trade("BTCUSDT", 10, 1m, 1m, 0, false)));
        Assert.Equal(MarketFlowDeduplicationResult.GapDetected, deduplicator.Add(Trade("BTCUSDT", 12, 1m, 1m, 0, false)));
        Assert.Equal(MarketFlowDeduplicationResult.Accepted, deduplicator.Add(Trade("BTCUSDT", 11, 1m, 1m, 0, false)));
    }

    [Fact]
    public void Aggregator_GapOrOverflowMarksExistingWindowPartial()
    {
        var aggregator = new MarketFlowAggregator(TimeSpan.FromMilliseconds(250), 20);
        aggregator.Add(Trade("BTCUSDT", 1, 10m, 1m, 0, false));
        aggregator.MarkDataLoss("BTCUSDT", Start.AddMilliseconds(100));
        var snapshot = Assert.Single(aggregator.FlushDue(Start.AddMilliseconds(250)));
        Assert.True(snapshot.IsPartial);
    }

    [Fact]
    public void Aggregator_ProcessingFlushIgnoresTenSecondEventClockSkew()
    {
        var aggregator = new MarketFlowAggregator(TimeSpan.FromMilliseconds(250), 20);
        var receivedAt = DateTimeOffset.UtcNow;
        var receivedMonotonic = Stopwatch.GetTimestamp();
        var eventTime = receivedAt.AddSeconds(-10);
        var trade = new BinanceAggregateTrade("BTCUSDT", 1, 100m, 1m, eventTime, false);

        aggregator.Add(new MarketFlowTradeEnvelope(trade, receivedAt, receivedMonotonic));

        var dueTimestamp = receivedMonotonic + (long)(Stopwatch.Frequency * 0.251);
        var snapshots = aggregator.FlushDueByProcessing(receivedAt.AddMilliseconds(251), dueTimestamp);

        var snapshot = Assert.Single(snapshots);
        Assert.Equal(eventTime, snapshot.FirstTradeTime);
        Assert.Equal(receivedAt, snapshot.ReceivedAtUtc);
    }

    [Fact]
    public void Buffer_IsBoundedAndRejectsOverflow()
    {
        var buffer = new MarketFlowTradeBuffer(1);
        Assert.True(buffer.TryWrite(Trade("BTCUSDT", 1, 1m, 1m, 0, false)));
        Assert.False(buffer.TryWrite(Trade("BTCUSDT", 2, 1m, 1m, 0, false)));
        Assert.True(buffer.TryRead(out _));
    }

    [Fact]
    public void Options_RejectUnsafeValuesAndEnforceBinanceConnectionAge()
    {
        Assert.Throws<InvalidOperationException>(() => new MarketFlowOptions { MaxSymbols = 1025 }.Validate());
        Assert.Throws<InvalidOperationException>(() => new MarketFlowOptions { MaxConnectionAgeMinutes = 1440 }.Validate());
        Assert.Throws<InvalidOperationException>(() => new MarketFlowOptions { SubscriptionRefreshSeconds = 0 }.Validate());
    }

    [Fact]
    public async Task StreamService_DisabledFeatureDoesNotOpenTransport()
    {
        var transport = new ControlledTransport();
        var service = CreateService(new MarketFlowOptions { Enabled = false }, transport);
        await service.StartAsync(CancellationToken.None);
        await service.StopAsync(CancellationToken.None);
        Assert.Equal(0, transport.Calls);
    }

    [Fact]
    public async Task StreamService_CancellationStopsTransportGracefully()
    {
        var transport = new ControlledTransport();
        var service = CreateService(new MarketFlowOptions { Enabled = true, Symbols = ["BTCUSDT"] }, transport);
        await service.StartAsync(CancellationToken.None);
        await transport.Started.Task.WaitAsync(TimeSpan.FromSeconds(2));
        await service.StopAsync(CancellationToken.None);
        Assert.Equal(1, transport.Calls);
    }

    [Fact]
    public async Task StreamService_ReconnectsWhenOngoingMatchSymbolsChange()
    {
        var transport = new ControlledTransport();
        var symbols = new MutableSymbolSource(["BTCUSDT"]);
        var service = CreateService(new MarketFlowOptions
        {
            Enabled = true,
            SubscriptionRefreshSeconds = 1
        }, transport, symbols);

        await service.StartAsync(CancellationToken.None);
        await transport.WaitForCallsAsync(1, TimeSpan.FromSeconds(2));
        symbols.Set(["ETHUSDT", "SOLUSDT"]);
        await transport.WaitForCallsAsync(2, TimeSpan.FromSeconds(4));
        await service.StopAsync(CancellationToken.None);

        var subscriptions = transport.Subscriptions.ToArray();
        Assert.Equal(["BTCUSDT"], subscriptions[0]);
        Assert.Equal(["ETHUSDT", "SOLUSDT"], subscriptions[1]);
    }

    [Fact]
    public async Task StreamService_NoSymbols_DoesNotOpenTransport()
    {
        var transport = new ControlledTransport();
        var symbols = new MutableSymbolSource([]);
        var service = CreateService(new MarketFlowOptions { Enabled = true, SubscriptionRefreshSeconds = 1 }, transport, symbols);

        await service.StartAsync(CancellationToken.None);
        await Task.Delay(300, CancellationToken.None);
        await service.StopAsync(CancellationToken.None);

        Assert.Equal(0, transport.Calls);
    }

    [Fact]
    public async Task StreamService_TransientSymbolFailure_RetainsCurrentSubscription()
    {
        var transport = new ControlledTransport();
        var symbols = new MutableSymbolSource(["BTCUSDT"]);
        var service = CreateService(new MarketFlowOptions { Enabled = true, SubscriptionRefreshSeconds = 1 }, transport, symbols);

        await service.StartAsync(CancellationToken.None);
        await transport.WaitForCallsAsync(1, TimeSpan.FromSeconds(2));

        symbols.FailNext(2);
        await Task.Delay(1500, CancellationToken.None);

        Assert.Equal(1, transport.Calls);
        await service.StopAsync(CancellationToken.None);
    }

    [Fact]
    public async Task StreamService_RecoversAfterSymbolSourceFailure()
    {
        var transport = new ControlledTransport();
        var symbols = new MutableSymbolSource(["BTCUSDT"]);
        var service = CreateService(new MarketFlowOptions { Enabled = true, SubscriptionRefreshSeconds = 1 }, transport, symbols);

        await service.StartAsync(CancellationToken.None);
        await transport.WaitForCallsAsync(1, TimeSpan.FromSeconds(2));

        symbols.FailNext(1);
        symbols.Set(["ETHUSDT"]);
        await transport.WaitForCallsAsync(2, TimeSpan.FromSeconds(4));

        await service.StopAsync(CancellationToken.None);
        Assert.Equal(2, transport.Calls);
    }

    [Fact]
    public async Task StreamService_DoesNotReconnectWhenUnchanged()
    {
        var transport = new ControlledTransport();
        var symbols = new MutableSymbolSource(["BTCUSDT"]);
        var service = CreateService(new MarketFlowOptions { Enabled = true, SubscriptionRefreshSeconds = 1 }, transport, symbols);

        await service.StartAsync(CancellationToken.None);
        await transport.WaitForCallsAsync(1, TimeSpan.FromSeconds(2));
        await Task.Delay(1200, CancellationToken.None);
        await service.StopAsync(CancellationToken.None);

        Assert.Equal(1, transport.Calls);
    }

    [Fact]
    public async Task StreamService_CancellationDuringSymbolRefresh_StopsGracefully()
    {
        var transport = new ControlledTransport();
        var symbols = new MutableSymbolSource(["BTCUSDT"]);
        var service = CreateService(new MarketFlowOptions { Enabled = true, SubscriptionRefreshSeconds = 1 }, transport, symbols);

        await service.StartAsync(CancellationToken.None);
        await transport.WaitForCallsAsync(1, TimeSpan.FromSeconds(2));
        await service.StopAsync(CancellationToken.None);

        Assert.Equal(1, transport.Calls);
    }

    [Fact]
    public void Aggregator_SequencesStayMonotonicAcrossReconnectWhenCounterIsShared()
    {
        var shared = new Dictionary<string, long>(StringComparer.Ordinal);
        var first = new MarketFlowAggregator(TimeSpan.FromMilliseconds(250), 20, shared);
        first.Add(Trade("BTCUSDT", 1, 10m, 1m, 0, false));
        var firstSnapshots = first.FlushDue(Start.AddMilliseconds(250));
        Assert.Equal(1, Assert.Single(firstSnapshots).Sequence);

        // Simulates the Worker reconnecting after the active symbol set changes: a new
        // aggregator is created but the per-symbol sequence counter is shared.
        var second = new MarketFlowAggregator(TimeSpan.FromMilliseconds(250), 20, shared);
        second.Add(Trade("BTCUSDT", 2, 11m, 1m, 300, false));
        var secondSnapshots = second.FlushDue(Start.AddMilliseconds(600));
        Assert.Equal(2, Assert.Single(secondSnapshots).Sequence);
    }

    [Fact]
    public void Aggregator_SequencesRestartPerInstanceWhenCounterIsNotShared()
    {
        var first = new MarketFlowAggregator(TimeSpan.FromMilliseconds(250), 20);
        first.Add(Trade("BTCUSDT", 1, 10m, 1m, 0, false));
        Assert.Equal(1, Assert.Single(first.FlushDue(Start.AddMilliseconds(250))).Sequence);

        var second = new MarketFlowAggregator(TimeSpan.FromMilliseconds(250), 20);
        second.Add(Trade("BTCUSDT", 2, 11m, 1m, 300, false));
        Assert.Equal(1, Assert.Single(second.FlushDue(Start.AddMilliseconds(600))).Sequence);
    }

    private static BinanceAggregateTrade Trade(string symbol, long id, decimal price, decimal quantity, int offsetMs, bool buyerIsMaker)
        => new(symbol, id, price, quantity, Start.AddMilliseconds(offsetMs), buyerIsMaker);

    private static MarketFlowStreamService CreateService(
        MarketFlowOptions options,
        ControlledTransport transport,
        IMarketFlowSymbolSource? symbolSource = null)
        => new(Options.Create(options), transport, new NullMarketFlowSnapshotSink(),
            symbolSource ?? new MutableSymbolSource(options.Symbols), TimeProvider.System,
            new MarketFlowMetrics(), NullLogger<MarketFlowStreamService>.Instance);

    private sealed class ControlledTransport : IMarketFlowTransport
    {
        private int _calls;
        public int Calls => Volatile.Read(ref _calls);
        public TaskCompletionSource Started { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public ConcurrentQueue<string[]> Subscriptions { get; } = new();

        public async Task RunAsync(IReadOnlyCollection<string> symbols, Func<ReadOnlyMemory<byte>, CancellationToken, ValueTask> onMessage, int maxMessageBytes, CancellationToken cancellationToken)
        {
            Subscriptions.Enqueue(symbols.Order(StringComparer.Ordinal).ToArray());
            Interlocked.Increment(ref _calls);
            Started.TrySetResult();
            await Task.Delay(Timeout.InfiniteTimeSpan, cancellationToken);
        }

        public async Task WaitForCallsAsync(int expected, TimeSpan timeout)
        {
            using var cancellation = new CancellationTokenSource(timeout);
            while (Calls < expected)
                await Task.Delay(25, cancellation.Token);
        }
    }

    private sealed class MutableSymbolSource(IEnumerable<string> symbols) : IMarketFlowSymbolSource
    {
        private string[] _symbols = symbols.ToArray();
        private int _failuresRemaining;

        public Task<IReadOnlyCollection<string>> GetSymbolsAsync(CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (Volatile.Read(ref _failuresRemaining) > 0 && Interlocked.Decrement(ref _failuresRemaining) >= 0)
                throw new InvalidOperationException("Simulated symbol source failure.");
            return Task.FromResult<IReadOnlyCollection<string>>(Volatile.Read(ref _symbols));
        }

        public void Set(IEnumerable<string> symbols) => Volatile.Write(ref _symbols, symbols.ToArray());

        public void FailNext(int count) => Interlocked.Add(ref _failuresRemaining, count);
    }
}
