using System.Globalization;
using DTOs;
using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.Options;
using CriptoVersus.API.Hubs;

namespace CriptoVersus.API.Services;

public sealed class MoneyFlowDispatcher : BackgroundService
{
    private sealed record Envelope(string SourceId, MoneyFlowBatchDto Batch);

    private readonly object _gate = new();
    private readonly Queue<Envelope> _queue = new();
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
            var clientBatch = ToClientBatch(matchId, envelope.Batch);
            await _hub.Clients.Group(DashboardHub.MoneyFlowGroup(matchId))
                .SendAsync(DashboardHub.MoneyFlowEventName, clientBatch, ct);
            _metrics.Published.Add(1);
            _metrics.ApiToFrontendAgeMs.Record(Math.Max(0, (now - envelope.Batch.PublishedAtUtc).TotalMilliseconds));
        }
    }

    private static MoneyFlowClientBatchDto ToClientBatch(int matchId, MoneyFlowBatchDto batch)
        => new()
        {
            MatchId = matchId,
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
            IsPartial = batch.IsPartial
        };

    private static string Format(decimal value) => value.ToString("G29", CultureInfo.InvariantCulture);
}
