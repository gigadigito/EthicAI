using System.Diagnostics.Metrics;

namespace CriptoVersus.API.Services;

public sealed class MoneyFlowMetrics : IDisposable
{
    private readonly Meter _meter = new("CriptoVersus.API.MoneyFlow", "1.0");
    private int _activeGroups;
    private int _activeSubscriptions;

    public Counter<long> Received { get; }
    public Counter<long> Published { get; }
    public Counter<long> Dropped { get; }
    public Counter<long> Duplicates { get; }
    public Counter<long> Gaps { get; }
    public Counter<long> Rejected { get; }
    public Histogram<double> WorkerToApiLatencyMs { get; }
    public Histogram<double> ApiToFrontendAgeMs { get; }
    public UpDownCounter<long> ActiveGroups { get; }
    public UpDownCounter<long> ActiveSubscriptions { get; }

    public MoneyFlowMetrics()
    {
        Received = _meter.CreateCounter<long>("moneyflow_api_batches_received_total");
        Published = _meter.CreateCounter<long>("moneyflow_signalr_batches_published_total");
        Dropped = _meter.CreateCounter<long>("moneyflow_api_batches_dropped_total");
        Duplicates = _meter.CreateCounter<long>("moneyflow_api_batches_duplicate_total");
        Gaps = _meter.CreateCounter<long>("moneyflow_api_sequence_gaps_total");
        Rejected = _meter.CreateCounter<long>("moneyflow_api_batches_rejected_total");
        WorkerToApiLatencyMs = _meter.CreateHistogram<double>("moneyflow_worker_api_latency_ms");
        ApiToFrontendAgeMs = _meter.CreateHistogram<double>("moneyflow_api_frontend_age_ms");
        ActiveGroups = _meter.CreateUpDownCounter<long>("moneyflow_active_groups");
        ActiveSubscriptions = _meter.CreateUpDownCounter<long>("moneyflow_active_subscriptions");
        _meter.CreateObservableGauge("moneyflow_groups_current", () => Volatile.Read(ref _activeGroups));
        _meter.CreateObservableGauge("moneyflow_subscriptions_current", () => Volatile.Read(ref _activeSubscriptions));
    }

    public void SetGroups(int count) => Volatile.Write(ref _activeGroups, count);
    public void SetSubscriptions(int count) => Volatile.Write(ref _activeSubscriptions, count);
    public void Dispose() => _meter.Dispose();
}
