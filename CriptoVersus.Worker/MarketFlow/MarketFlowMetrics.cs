using System.Diagnostics.Metrics;
using System.Diagnostics;

namespace CriptoVersus.Worker.MarketFlow;

public sealed class MarketFlowMetrics : IDisposable
{
    private readonly Meter _meter = new("CriptoVersus.MarketFlow", "1.0");
    private long _receivedSinceLastObservation;
    private long _rateObservationTimestamp = Stopwatch.GetTimestamp();
    private int _connectionStatus;
    public Counter<long> ReceivedAggTrades { get; }
    public Counter<long> Batches { get; }
    public Counter<long> DuplicateTrades { get; }
    public Counter<long> Reconnects { get; }
    public Counter<long> InvalidMessages { get; }
    public Counter<long> BufferOverflow { get; }
    public Counter<long> Gaps { get; }
    public Counter<long> TransportEnqueued { get; }
    public Counter<long> TransportDropped { get; }
    public Counter<long> TransportFailures { get; }
    public Counter<long> TransportRetries { get; }
    public Histogram<double> BatchProcessingLatencyMs { get; }
    public Histogram<double> BatchAgeMs { get; }
    public UpDownCounter<long> ActiveSymbols { get; }

    public MarketFlowMetrics()
    {
        ReceivedAggTrades = _meter.CreateCounter<long>("marketflow_received_aggtrades_total");
        _meter.CreateObservableGauge<double>("marketflow_aggtrades_per_second", ObserveTradesPerSecond);
        _meter.CreateObservableGauge("marketflow_connection_status", () => Volatile.Read(ref _connectionStatus));
        Batches = _meter.CreateCounter<long>("marketflow_batches_total");
        DuplicateTrades = _meter.CreateCounter<long>("marketflow_duplicate_trades_total");
        Reconnects = _meter.CreateCounter<long>("marketflow_reconnects_total");
        InvalidMessages = _meter.CreateCounter<long>("marketflow_invalid_messages_total");
        BufferOverflow = _meter.CreateCounter<long>("marketflow_buffer_overflow_total");
        Gaps = _meter.CreateCounter<long>("marketflow_aggtrade_gaps_total");
        TransportEnqueued = _meter.CreateCounter<long>("marketflow_transport_enqueued_total");
        TransportDropped = _meter.CreateCounter<long>("marketflow_transport_dropped_total");
        TransportFailures = _meter.CreateCounter<long>("marketflow_transport_failures_total");
        TransportRetries = _meter.CreateCounter<long>("marketflow_transport_retries_total");
        BatchProcessingLatencyMs = _meter.CreateHistogram<double>("marketflow_batch_processing_latency_ms");
        BatchAgeMs = _meter.CreateHistogram<double>("marketflow_batch_age_ms");
        ActiveSymbols = _meter.CreateUpDownCounter<long>("marketflow_active_symbols");
    }

    public void RecordReceived()
    {
        ReceivedAggTrades.Add(1);
        Interlocked.Increment(ref _receivedSinceLastObservation);
    }

    public void SetConnectionStatus(bool connected) => Volatile.Write(ref _connectionStatus, connected ? 1 : 0);

    private double ObserveTradesPerSecond()
    {
        var now = Stopwatch.GetTimestamp();
        var previous = Interlocked.Exchange(ref _rateObservationTimestamp, now);
        var elapsedSeconds = (now - previous) / (double)Stopwatch.Frequency;
        var count = Interlocked.Exchange(ref _receivedSinceLastObservation, 0);
        return elapsedSeconds > 0 ? count / elapsedSeconds : 0;
    }

    public void Dispose() => _meter.Dispose();
}
