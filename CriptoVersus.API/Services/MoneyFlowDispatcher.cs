using System.Globalization;
using DTOs;
using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.Options;
using CriptoVersus.API.Hubs;

namespace CriptoVersus.API.Services;

public sealed class MoneyFlowDispatcher : BackgroundService
{
    // At the 250 ms aggregation cadence, this covers a full five-minute
    // two-symbol round with headroom while keeping a busy match bounded.
    private const int MaxReplayBatchesPerMatch = 5_000;
    private sealed record Envelope(string SourceId, MoneyFlowBatchDto Batch);
    private sealed record ReplayEnvelope(DateTimeOffset PublishedAtUtc, MoneyFlowClientBatchDto Batch);

    private readonly object _gate = new();
    private readonly Queue<Envelope> _queue = new();
    private readonly Dictionary<int, Queue<ReplayEnvelope>> _replayByMatch = new();
    private readonly SemaphoreSlim _signal = new(0);
    private readonly Dictionary<(string Source, string Symbol), long> _highestSequence = new();
    private readonly IHubContext<DashboardHub> _hub;
    private readonly MoneyFlowMatchRegistry _registry;
    private readonly IOptions<MoneyFlowTransportOptions> _options;
    private readonly MoneyFlowMetrics _metrics;

    public MoneyFlowDispatcher(
        IHubContext<DashboardHub> hub,
        MoneyFlowMatchRegistry registry,
        IOptions<MoneyFlowTransportOptions> options,
        MoneyFlowMetrics metrics)
    {
        _hub = hub;
        _registry = registry;
        _options = options;
        _metrics = metrics;
    }

    public Task<MoneyFlowTransportAccepted> EnqueueAsync(MoneyFlowTransportRequest request, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        var accepted = 0;
        var duplicates = 0;
        var dropped = 0;
        lock (_gate)
        {
            foreach (var batch in request.Batches)
            {
                var normalizedBatch = batch;
                var key = (request.SourceId, MoneyFlowMatchRegistry.Normalize(batch.Symbol));
                if (_highestSequence.TryGetValue(key, out var highest))
                {
                    if (batch.Sequence <= highest)
                    {
                        duplicates++;
                        _metrics.Duplicates.Add(1);
                        continue;
                    }
                    if (batch.Sequence > highest + 1)
                    {
                        _metrics.Gaps.Add(1);
                        normalizedBatch = normalizedBatch with { IsPartial = true };
                    }
                }
                _highestSequence[key] = batch.Sequence;
                if (_queue.Count >= _options.Value.QueueCapacity)
                {
                    _queue.Dequeue();
                    dropped++;
                    _metrics.Dropped.Add(1);
                    normalizedBatch = normalizedBatch with { IsPartial = true };
                }
                _queue.Enqueue(new Envelope(request.SourceId, normalizedBatch));
                accepted++;
                _metrics.Received.Add(1);
            }
        }
        for (var i = 0; i < accepted - dropped; i++) _signal.Release();
        if (dropped > 0 && accepted == dropped)
        {
            // Replacing a full queue does not increase its semaphore count.
        }
        return Task.FromResult(new MoneyFlowTransportAccepted(accepted, duplicates, dropped));
    }

    /// <summary>
    /// Returns the bounded, in-memory SignalR catch-up for one active match.
    /// The browser still assigns every batch to its exchange-time round, so an
    /// older replay batch cannot affect the counters of the currently forming
    /// candle.
    /// </summary>
    public IReadOnlyList<MoneyFlowClientBatchDto> GetReplay(int matchId)
    {
        var now = DateTimeOffset.UtcNow;
        var cutoff = now.AddMinutes(-_options.Value.ReplayWindowMinutes);
        lock (_gate)
        {
            if (!_replayByMatch.TryGetValue(matchId, out var replay)) return Array.Empty<MoneyFlowClientBatchDto>();
            TrimReplay(replay, cutoff);
            if (replay.Count == 0)
            {
                _replayByMatch.Remove(matchId);
                return Array.Empty<MoneyFlowClientBatchDto>();
            }
            return replay.Select(x => x.Batch with { IsReplay = true }).ToArray();
        }
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!_options.Value.Enabled || !_options.Value.TransportEnabled) return;
        while (!stoppingToken.IsCancellationRequested)
        {
            Envelope? envelope;
            try
            {
                await _signal.WaitAsync(stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
            lock (_gate)
            {
                envelope = _queue.Count == 0 ? null : _queue.Dequeue();
            }
            if (envelope is null) continue;
            await PublishAsync(envelope, stoppingToken);
        }
    }

    private async Task PublishAsync(Envelope envelope, CancellationToken ct)
    {
        var matches = await _registry.GetMatchesForSymbolAsync(envelope.Batch.Symbol, ct);
        if (matches.Count == 0) return;
        var now = DateTimeOffset.UtcNow;
        if (envelope.Batch.ReceivedAtUtc != default)
            _metrics.WorkerToApiLatencyMs.Record(Math.Max(0, (now - envelope.Batch.ReceivedAtUtc).TotalMilliseconds));
        foreach (var matchId in matches)
        {
            var clientBatch = ToClientBatch(matchId, envelope.SourceId, envelope.Batch);
            StoreReplay(matchId, clientBatch, now);
            await _hub.Clients.Group(DashboardHub.MoneyFlowGroup(matchId))
                .SendAsync(DashboardHub.MoneyFlowEventName, clientBatch, ct);
            _metrics.Published.Add(1);
            _metrics.ApiToFrontendAgeMs.Record(Math.Max(0, (now - envelope.Batch.PublishedAtUtc).TotalMilliseconds));
        }
    }

    private static MoneyFlowClientBatchDto ToClientBatch(int matchId, string sourceId, MoneyFlowBatchDto batch)
        => new()
        {
            MatchId = matchId,
            SourceId = sourceId,
            Symbol = batch.Symbol,
            Sequence = batch.Sequence,
            WindowStartUtc = batch.WindowStartUtc,
            WindowEndUtc = batch.WindowEndUtc,
            EventTimeUtc = batch.EventTimeUtc,
            ReceivedAtUtc = batch.ReceivedAtUtc,
            PublishedAtUtc = batch.PublishedAtUtc,
            TradeCount = batch.TradeCount,
            TotalBaseQuantity = Format(batch.TotalBaseQuantity),
            TakerBuyBaseQuantity = Format(batch.TakerBuyBaseQuantity),
            TakerSellBaseQuantity = Format(batch.TakerSellBaseQuantity),
            TakerBuyQuote = Format(batch.TakerBuyQuote),
            TakerSellQuote = Format(batch.TakerSellQuote),
            NetQuote = Format(batch.NetQuote),
            FirstPrice = Format(batch.FirstPrice),
            LastPrice = Format(batch.LastPrice),
            HighPrice = Format(batch.HighPrice),
            LowPrice = Format(batch.LowPrice),
            IsPartial = batch.IsPartial,
            CreatureCounts = batch.CreatureCounts
        };

    private void StoreReplay(int matchId, MoneyFlowClientBatchDto batch, DateTimeOffset now)
    {
        var cutoff = now.AddMinutes(-_options.Value.ReplayWindowMinutes);
        lock (_gate)
        {
            if (!_replayByMatch.TryGetValue(matchId, out var replay))
                _replayByMatch[matchId] = replay = new Queue<ReplayEnvelope>();
            TrimReplay(replay, cutoff);
            replay.Enqueue(new ReplayEnvelope(now, batch));
            while (replay.Count > MaxReplayBatchesPerMatch) replay.Dequeue();
        }
    }

    private static void TrimReplay(Queue<ReplayEnvelope> replay, DateTimeOffset cutoff)
    {
        while (replay.Count > 0 && replay.Peek().PublishedAtUtc < cutoff) replay.Dequeue();
    }

    private static string Format(decimal value) => value.ToString("G29", CultureInfo.InvariantCulture);
}
