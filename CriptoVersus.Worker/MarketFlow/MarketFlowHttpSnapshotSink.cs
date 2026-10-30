using System.Net.Http.Json;
using DTOs;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace CriptoVersus.Worker.MarketFlow;

/// <summary>Bounded, newest-first transport queue for non-authoritative visual data.</summary>
public sealed class MarketFlowHttpSnapshotSink : BackgroundService, IMarketFlowSnapshotSink
{
    public const string WorkerKeyHeader = "X-Money-Flow-Worker-Key";
    public const string WorkerIdHeader = "X-Money-Flow-Worker-Id";

    private readonly IHttpClientFactory _httpClientFactory;
    private readonly IOptions<MarketFlowOptions> _options;
    private readonly MarketFlowMetrics _metrics;
    private readonly ILogger<MarketFlowHttpSnapshotSink> _logger;
    private readonly BoundedSnapshotQueue _queue;

    public MarketFlowHttpSnapshotSink(
        IHttpClientFactory httpClientFactory,
        IOptions<MarketFlowOptions> options,
        MarketFlowMetrics metrics,
        ILogger<MarketFlowHttpSnapshotSink> logger)
    {
        _httpClientFactory = httpClientFactory;
        _options = options;
        _metrics = metrics;
        _logger = logger;
        _queue = new BoundedSnapshotQueue(Math.Max(1, options.Value.TransportQueueCapacity));
    }

    public ValueTask PublishAsync(MarketFlowSnapshot snapshot, CancellationToken cancellationToken)
    {
        var dropped = _queue.Enqueue(snapshot);
        _metrics.TransportEnqueued.Add(1);
        if (dropped)
        {
            _metrics.TransportDropped.Add(1);
        }
        return ValueTask.CompletedTask;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var options = _options.Value;
        if (!options.TransportEnabled)
            return;

        options.Validate();
        if (string.IsNullOrWhiteSpace(options.ApiBatchUrl) || string.IsNullOrWhiteSpace(options.WorkerApiKey))
        {
            _logger.LogWarning("Money-flow transport is enabled but ApiBatchUrl or WorkerApiKey is not configured; transport remains idle.");
            return;
        }

        while (!stoppingToken.IsCancellationRequested)
        {
            IReadOnlyList<MarketFlowSnapshot> snapshots;
            try
            {
                snapshots = await _queue.ReadBatchAsync(options.TransportBatchSize, stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }

            if (snapshots.Count == 0) continue;
            await SendWithRetryAsync(snapshots, options, stoppingToken);
        }
    }

    private async Task SendWithRetryAsync(IReadOnlyList<MarketFlowSnapshot> snapshots, MarketFlowOptions options, CancellationToken stoppingToken)
    {
        var client = _httpClientFactory.CreateClient("MoneyFlowTransport");
        var sourceId = string.IsNullOrWhiteSpace(options.WorkerId)
            ? $"{Environment.MachineName}:{Environment.ProcessId}"
            : options.WorkerId.Trim();
        var request = new MoneyFlowTransportRequest
        {
            SourceId = sourceId,
            Batches = snapshots.Select(ToDto).ToArray()
        };

        for (var attempt = 0; attempt <= options.TransportRetryCount; attempt++)
        {
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(stoppingToken);
            timeout.CancelAfter(TimeSpan.FromMilliseconds(options.TransportTimeoutMs));
            try
            {
                using var message = new HttpRequestMessage(HttpMethod.Post, options.ApiBatchUrl)
                {
                    Content = JsonContent.Create(request)
                };
                message.Headers.TryAddWithoutValidation(WorkerKeyHeader, options.WorkerApiKey);
                message.Headers.TryAddWithoutValidation(WorkerIdHeader, sourceId);
                using var response = await client.SendAsync(message, HttpCompletionOption.ResponseHeadersRead, timeout.Token);
                if (response.IsSuccessStatusCode)
                    return;

                throw new HttpRequestException($"Money-flow API returned {(int)response.StatusCode}.");
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                return;
            }
            catch (Exception ex) when (attempt < options.TransportRetryCount)
            {
                _metrics.TransportRetries.Add(1);
                _logger.LogWarning(ex, "Money-flow transport attempt failed; retrying. attempt={Attempt} batchSize={BatchSize}", attempt + 1, snapshots.Count);
                await Task.Delay(TimeSpan.FromMilliseconds(50 * (attempt + 1)), stoppingToken);
            }
            catch (Exception ex)
            {
                _metrics.TransportFailures.Add(1);
                _logger.LogError(ex, "Money-flow transport failed after retries. batchSize={BatchSize}", snapshots.Count);
            }
        }
    }

    private static MoneyFlowBatchDto ToDto(MarketFlowSnapshot snapshot)
        => new()
        {
            Symbol = snapshot.Symbol,
            Sequence = snapshot.Sequence,
            WindowStartUtc = snapshot.WindowStart,
            WindowEndUtc = snapshot.WindowEnd,
            EventTimeUtc = snapshot.LastTradeTime,
            ReceivedAtUtc = snapshot.ReceivedAtUtc,
            PublishedAtUtc = DateTimeOffset.UtcNow,
            ReceivedMonotonicTicks = snapshot.ReceivedMonotonicTimestamp,
            TradeCount = snapshot.TradeCount,
            TotalBaseQuantity = snapshot.TotalBaseQuantity,
            TakerBuyBaseQuantity = snapshot.TakerBuyBaseQuantity,
            TakerSellBaseQuantity = snapshot.TakerSellBaseQuantity,
            TakerBuyQuote = snapshot.TakerBuyQuote,
            TakerSellQuote = snapshot.TakerSellQuote,
            NetQuote = snapshot.NetQuote,
            FirstPrice = snapshot.FirstPrice,
            LastPrice = snapshot.LastPrice,
            HighPrice = snapshot.HighPrice,
            LowPrice = snapshot.LowPrice,
            IsPartial = snapshot.IsPartial
        };

    private sealed class BoundedSnapshotQueue
    {
        private readonly object _gate = new();
        private readonly Queue<MarketFlowSnapshot> _items = new();
        private readonly int _capacity;
        private readonly SemaphoreSlim _signal = new(0);

        public BoundedSnapshotQueue(int capacity) => _capacity = capacity;

        public bool Enqueue(MarketFlowSnapshot snapshot)
        {
            var dropped = false;
            lock (_gate)
            {
                if (_items.Count >= _capacity)
                {
                    _items.Dequeue();
                    dropped = true;
                }
                _items.Enqueue(snapshot);
            }
            if (!dropped) _signal.Release();
            return dropped;
        }

        public async Task<IReadOnlyList<MarketFlowSnapshot>> ReadBatchAsync(int max, CancellationToken ct)
        {
            await _signal.WaitAsync(ct);
            var result = new List<MarketFlowSnapshot>(max);
            lock (_gate)
            {
                while (result.Count < max && _items.Count > 0)
                    result.Add(_items.Dequeue());
            }
            // Dropping an old item leaves one extra semaphore token. Drain it
            // opportunistically; it never causes unbounded memory growth.
            while (result.Count < max && _signal.Wait(0))
            {
                lock (_gate)
                {
                    if (_items.Count == 0) break;
                    result.Add(_items.Dequeue());
                }
            }
            return result;
        }
    }
}
