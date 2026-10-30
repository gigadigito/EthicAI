namespace CriptoVersus.Worker.MarketFlow;

public sealed class MarketFlowOptions
{
    public const string SectionName = "CandleBattles:MoneyFlow";

    // Deliberately opt-in: each active Worker replica has its own Binance connection.
    public bool Enabled { get; set; }
    public string MarketSource { get; set; } = "AggTrade";
    public int AggregationWindowMs { get; set; } = 250;
    public int MaxSymbols { get; set; } = 20;
    public int MaxBufferedTrades { get; set; } = 5_000;
    public int MaxMessageBytes { get; set; } = 64 * 1024;
    public int MaxWorkItemsPerCycle { get; set; } = 2_000;
    public int DeduplicationCapacity { get; set; } = 50_000;
    public int MaxConnectionAgeMinutes { get; set; } = 1_430;
    public bool DiagnosticsEnabled { get; set; }
    public bool TransportEnabled { get; set; }
    public string? ApiBatchUrl { get; set; }
    public string? WorkerApiKey { get; set; }
    public string? WorkerId { get; set; }
    public int TransportTimeoutMs { get; set; } = 1_500;
    public int TransportQueueCapacity { get; set; } = 128;
    public int TransportBatchSize { get; set; } = 16;
    public int TransportRetryCount { get; set; } = 2;
    public List<string> Symbols { get; set; } = [];

    public MarketFlowOptions Validate()
    {
        if (!string.Equals(MarketSource, "AggTrade", StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("CandleBattles:MoneyFlow:MarketSource must be AggTrade.");
        if (AggregationWindowMs is < 50 or > 60_000)
            throw new InvalidOperationException("CandleBattles:MoneyFlow:AggregationWindowMs must be between 50 and 60000.");
        if (MaxSymbols is < 1 or > 1_024)
            throw new InvalidOperationException("CandleBattles:MoneyFlow:MaxSymbols must be between 1 and 1024.");
        if (MaxBufferedTrades is < 1 or > 1_000_000)
            throw new InvalidOperationException("CandleBattles:MoneyFlow:MaxBufferedTrades is outside the safe range.");
        if (MaxMessageBytes is < 1_024 or > 1_048_576)
            throw new InvalidOperationException("CandleBattles:MoneyFlow:MaxMessageBytes is outside the safe range.");
        if (MaxWorkItemsPerCycle is < 1 or > 100_000 || DeduplicationCapacity < MaxBufferedTrades)
            throw new InvalidOperationException("CandleBattles:MoneyFlow processing limits are invalid.");
        if (MaxConnectionAgeMinutes is < 1 or > 1_430)
            throw new InvalidOperationException("CandleBattles:MoneyFlow:MaxConnectionAgeMinutes must be at most 1430.");
        if (TransportTimeoutMs is < 100 or > 30_000)
            throw new InvalidOperationException("CandleBattles:MoneyFlow:TransportTimeoutMs is outside the safe range.");
        if (TransportQueueCapacity is < 1 or > 10_000)
            throw new InvalidOperationException("CandleBattles:MoneyFlow:TransportQueueCapacity is outside the safe range.");
        if (TransportBatchSize is < 1 or > 100)
            throw new InvalidOperationException("CandleBattles:MoneyFlow:TransportBatchSize is outside the safe range.");
        if (TransportRetryCount is < 0 or > 5)
            throw new InvalidOperationException("CandleBattles:MoneyFlow:TransportRetryCount is outside the safe range.");
        return this;
    }
}
