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
    private readonly IMarketFlowSymbolSource _symbolSource;
    private readonly TimeProvider _timeProvider;
    private readonly MarketFlowMetrics _metrics;
    private readonly ILogger<MarketFlowStreamService> _logger;

    public MarketFlowStreamService(
        IOptions<MarketFlowOptions> options,
        IMarketFlowTransport transport,
        IMarketFlowSnapshotSink sink,
        IMarketFlowSymbolSource symbolSource,
        TimeProvider timeProvider,
        MarketFlowMetrics metrics,
        ILogger<MarketFlowStreamService> logger)
    {
        _options = options;
        _transport = transport;
        _sink = sink;
        _symbolSource = symbolSource;
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
        var activeSymbolCount = 0;
        var reportedEmpty = false;
        var attempt = 0;
        // Owned by the service execution so per-symbol sequences stay monotonic across
        // Binance reconnects (which happen whenever the active symbol set changes).
        var sequenceBySymbol = new Dictionary<string, long>(StringComparer.Ordinal);

        void SetActiveSymbolCount(int next)
        {
            var delta = next - activeSymbolCount;
            if (delta != 0) _metrics.ActiveSymbols.Add(delta);
            activeSymbolCount = next;
        }

        try
        {
            while (!stoppingToken.IsCancellationRequested)
            {
                string[] symbols;
                try
                {
                    symbols = await ResolveSymbolsAsync(options, stoppingToken);
                }
                catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
                {
                    break;
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "Market flow active-symbol refresh failed; retaining no subscription until the next refresh.");
                    await Task.Delay(TimeSpan.FromSeconds(options.SubscriptionRefreshSeconds), stoppingToken);
                    continue;
                }

                if (symbols.Length == 0)
                {
                    SetActiveSymbolCount(0);
                    if (!reportedEmpty)
                    {
                        _logger.LogWarning("Market flow is enabled but no ongoing-match or explicit symbols are available; no Binance connection will be opened.");
                        reportedEmpty = true;
                    }
                    await Task.Delay(TimeSpan.FromSeconds(options.SubscriptionRefreshSeconds), stoppingToken);
                    continue;
                }

                reportedEmpty = false;
                SetActiveSymbolCount(symbols.Length);
                _logger.LogInformation("Market flow ingestion starting. source=AggTrade symbols={SymbolCount} windowMs={WindowMs}", symbols.Length, options.AggregationWindowMs);
                using var subscriptionCancellation = CancellationTokenSource.CreateLinkedTokenSource(stoppingToken);
                var symbolsChanged = false;
                try
                {
                    var connection = RunConnectionAsync(options, symbols, sequenceBySymbol, subscriptionCancellation.Token);
                    while (!connection.IsCompleted)
                    {
                        await Task.Delay(TimeSpan.FromSeconds(options.SubscriptionRefreshSeconds), stoppingToken);
                        string[] refreshed;
                        try
                        {
                            refreshed = await ResolveSymbolsAsync(options, stoppingToken);
                        }
                        catch (Exception ex) when (ex is not OperationCanceledException)
                        {
                            _logger.LogWarning(ex, "Market flow active-symbol refresh failed; retaining the current Binance subscription.");
                            continue;
                        }

                        if (symbols.SequenceEqual(refreshed, StringComparer.Ordinal)) continue;
                        symbolsChanged = true;
                        _logger.LogInformation("Market flow active symbols changed. previous={PreviousCount} current={CurrentCount}; reconnecting.",
                            symbols.Length, refreshed.Length);
                        subscriptionCancellation.Cancel();
                    }

                    await connection;
                    attempt = 0;
                }
                catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
                {
                    break;
                }
                catch (OperationCanceledException) when (symbolsChanged)
                {
                    attempt = 0;
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
            SetActiveSymbolCount(0);
            _logger.LogInformation("Market flow ingestion stopped.");
        }
    }

    private async Task<string[]> ResolveSymbolsAsync(MarketFlowOptions options, CancellationToken cancellationToken)
        => PriceSymbolSetBuilder.NormalizeSymbols(await _symbolSource.GetSymbolsAsync(cancellationToken))
            .Order(StringComparer.Ordinal)
            .Take(options.MaxSymbols)
            .ToArray();

    private async Task RunConnectionAsync(MarketFlowOptions options, IReadOnlyCollection<string> symbols, Dictionary<string, long> sequenceBySymbol, CancellationToken stoppingToken)
    {
        using var connectionCancellation = CancellationTokenSource.CreateLinkedTokenSource(stoppingToken);
        connectionCancellation.CancelAfter(TimeSpan.FromMinutes(options.MaxConnectionAgeMinutes));
        var buffer = new MarketFlowTradeBuffer(options.MaxBufferedTrades);
        var deduplicator = new MarketFlowDeduplicator(options.DeduplicationCapacity);
        var aggregator = new MarketFlowAggregator(TimeSpan.FromMilliseconds(options.AggregationWindowMs), Math.Max(8, options.MaxBufferedTrades / 10), sequenceBySymbol);
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
