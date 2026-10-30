using System.Diagnostics;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace CriptoVersus.Worker.MarketFlow;

public sealed class MarketFlowStreamService : BackgroundService
{
    private readonly IOptions<MarketFlowOptions> _options;
    private readonly IMarketFlowTransport _transport;
    private readonly IMarketFlowSnapshotSink _sink;
    private readonly TimeProvider _timeProvider;
    private readonly MarketFlowMetrics _metrics;
    private readonly ILogger<MarketFlowStreamService> _logger;

    public MarketFlowStreamService(
        IOptions<MarketFlowOptions> options,
        IMarketFlowTransport transport,
        IMarketFlowSnapshotSink sink,
        TimeProvider timeProvider,
        MarketFlowMetrics metrics,
        ILogger<MarketFlowStreamService> logger)
    {
        _options = options;
        _transport = transport;
        _sink = sink;
        _timeProvider = timeProvider;
        _metrics = metrics;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var options = _options.Value;
        if (!options.Enabled)
            return;

        options.Validate();
        var symbols = PriceSymbolSetBuilder.NormalizeSymbols(options.Symbols).Order(StringComparer.Ordinal).Take(options.MaxSymbols).ToArray();
        if (symbols.Length == 0)
        {
            _logger.LogWarning("Market flow is enabled but no symbols are configured; no Binance connection will be opened.");
            return;
        }
        if (symbols.Length < PriceSymbolSetBuilder.NormalizeSymbols(options.Symbols).Count)
            _logger.LogWarning("Market flow symbol configuration exceeded MaxSymbols; only {SymbolCount} symbols are used.", symbols.Length);

        _metrics.ActiveSymbols.Add(symbols.Length);
        _logger.LogInformation("Market flow ingestion starting. source=AggTrade symbols={SymbolCount} windowMs={WindowMs}", symbols.Length, options.AggregationWindowMs);
        try
        {
            var attempt = 0;
            while (!stoppingToken.IsCancellationRequested)
            {
                try
                {
                    await RunConnectionAsync(options, symbols, stoppingToken);
                    attempt = 0;
                }
                catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
                {
                    break;
                }
                catch (Exception ex)
                {
                    attempt++;
                    _metrics.Reconnects.Add(1);
                    _logger.LogWarning(ex, "Market flow connection ended; scheduling reconnect. attempt={Attempt}", attempt);
                    await Task.Delay(Backoff(attempt), stoppingToken);
                }
            }
        }
        finally
        {
            _metrics.SetConnectionStatus(false);
            _metrics.ActiveSymbols.Add(-symbols.Length);
            _logger.LogInformation("Market flow ingestion stopped.");
        }
    }

    private async Task RunConnectionAsync(MarketFlowOptions options, IReadOnlyCollection<string> symbols, CancellationToken stoppingToken)
    {
        using var connectionCancellation = CancellationTokenSource.CreateLinkedTokenSource(stoppingToken);
        connectionCancellation.CancelAfter(TimeSpan.FromMinutes(options.MaxConnectionAgeMinutes));
        var buffer = new MarketFlowTradeBuffer(options.MaxBufferedTrades);
        var deduplicator = new MarketFlowDeduplicator(options.DeduplicationCapacity);
        var aggregator = new MarketFlowAggregator(TimeSpan.FromMilliseconds(options.AggregationWindowMs), Math.Max(8, options.MaxBufferedTrades / 10));
        var aggregatorGate = new object();
        var allowedSymbols = new HashSet<string>(symbols, StringComparer.Ordinal);
        var received = _transport.RunAsync(symbols, (payload, ct) => OnMessageAsync(payload, allowedSymbols, deduplicator, buffer, aggregator, aggregatorGate, ct), options.MaxMessageBytes, connectionCancellation.Token);
        _metrics.SetConnectionStatus(true);
        _logger.LogInformation("Market flow Binance connection established. symbols={SymbolCount}", symbols.Count);

        using var timer = new PeriodicTimer(TimeSpan.FromMilliseconds(Math.Min(options.AggregationWindowMs, 100)));
        try
        {
            while (!received.IsCompleted && await timer.WaitForNextTickAsync(stoppingToken))
                await ProcessAvailableAsync(buffer, aggregator, aggregatorGate, options.MaxWorkItemsPerCycle, stoppingToken);
            await received;
            await ProcessAvailableAsync(buffer, aggregator, aggregatorGate, options.MaxWorkItemsPerCycle, stoppingToken);
            if (!stoppingToken.IsCancellationRequested)
            {
                IReadOnlyList<MarketFlowSnapshot> pending;
                lock (aggregatorGate) pending = aggregator.FlushPendingAsPartial();
                await PublishSnapshotsAsync(pending, stoppingToken);
            }
            if (!stoppingToken.IsCancellationRequested)
                throw new IOException("Binance market-flow socket closed.");
        }
        finally
        {
            _metrics.SetConnectionStatus(false);
            connectionCancellation.Cancel();
            try { await received; }
            catch (OperationCanceledException) when (connectionCancellation.IsCancellationRequested) { }
        }
    }

    private ValueTask OnMessageAsync(ReadOnlyMemory<byte> payload, ISet<string> allowedSymbols, MarketFlowDeduplicator deduplicator, MarketFlowTradeBuffer buffer, MarketFlowAggregator aggregator, object aggregatorGate, CancellationToken cancellationToken)
    {
        if (!BinanceAggregateTradeParser.TryParse(payload.Span, out var trade))
        {
            // Binance subscription acknowledgements have no aggTrade event and are not invalid trades.
            if (!ContainsControlResponse(payload.Span)) _metrics.InvalidMessages.Add(1);
            return ValueTask.CompletedTask;
        }
        if (!allowedSymbols.Contains(trade!.Symbol))
        {
            _metrics.InvalidMessages.Add(1);
            return ValueTask.CompletedTask;
        }

        _metrics.RecordReceived();
        var deduplication = deduplicator.Add(trade);
        if (deduplication == MarketFlowDeduplicationResult.Duplicate)
        {
            _metrics.DuplicateTrades.Add(1);
            return ValueTask.CompletedTask;
        }
        if (deduplication == MarketFlowDeduplicationResult.GapDetected)
        {
            _metrics.Gaps.Add(1);
            lock (aggregatorGate) aggregator.MarkDataLoss(trade.Symbol, trade.TradeTime);
        }
        if (!buffer.TryWrite(new MarketFlowTradeEnvelope(trade, _timeProvider.GetUtcNow(), Stopwatch.GetTimestamp())))
        {
            _metrics.BufferOverflow.Add(1);
            lock (aggregatorGate) aggregator.MarkDataLoss(trade.Symbol, trade.TradeTime);
            _logger.LogWarning("Market flow buffer overflow. symbol={Symbol}", trade.Symbol);
        }
        return ValueTask.CompletedTask;
    }

    private async Task ProcessAvailableAsync(MarketFlowTradeBuffer buffer, MarketFlowAggregator aggregator, object aggregatorGate, int maxWorkItems, CancellationToken cancellationToken)
    {
        var started = Stopwatch.GetTimestamp();
        var processed = 0;
        while (processed++ < maxWorkItems && buffer.TryReadEnvelope(out var envelope))
            lock (aggregatorGate) aggregator.Add(envelope!);

        IReadOnlyList<MarketFlowSnapshot> snapshots;
        lock (aggregatorGate) snapshots = aggregator.FlushDueByProcessing(_timeProvider.GetUtcNow(), Stopwatch.GetTimestamp());
        await PublishSnapshotsAsync(snapshots, cancellationToken);
        if (processed > 1) _metrics.BatchProcessingLatencyMs.Record(Stopwatch.GetElapsedTime(started).TotalMilliseconds);
    }

    private async Task PublishSnapshotsAsync(IReadOnlyList<MarketFlowSnapshot> snapshots, CancellationToken cancellationToken)
    {
        foreach (var snapshot in snapshots)
        {
            try
            {
                await _sink.PublishAsync(snapshot, cancellationToken);
                _metrics.Batches.Add(1);
                _metrics.BatchAgeMs.Record(Math.Max(0, (_timeProvider.GetUtcNow() - snapshot.WindowEnd).TotalMilliseconds));
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                // A future sink must not take down Binance ingestion. The snapshot is intentionally not retried here.
                _logger.LogError(ex, "Market flow snapshot sink failed. symbol={Symbol} sequence={Sequence}", snapshot.Symbol, snapshot.Sequence);
            }
        }
    }

    private static TimeSpan Backoff(int attempt)
    {
        var baseSeconds = Math.Min(60, Math.Pow(2, Math.Min(attempt - 1, 6)));
        return TimeSpan.FromSeconds(baseSeconds + Random.Shared.NextDouble());
    }

    private static bool ContainsControlResponse(ReadOnlySpan<byte> payload)
        => payload.IndexOf("\"result\""u8) >= 0 || payload.IndexOf("\"id\""u8) >= 0;
}
