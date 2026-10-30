namespace CriptoVersus.API.Services;

public sealed class MoneyFlowTransportOptions
{
    public const string SectionName = "CandleBattles:MoneyFlow";

    public bool Enabled { get; set; }
    public bool TransportEnabled { get; set; }
    public string? WorkerApiKey { get; set; }
    public int QueueCapacity { get; set; } = 128;
    public int MaxBatchCount { get; set; } = 100;
    public int RegistryRefreshSeconds { get; set; } = 5;
    public int ReplayWindowMinutes { get; set; } = 10;
    public int FrontendBufferCapacity { get; set; } = 32;

    public MoneyFlowTransportOptions Validate()
    {
        if (QueueCapacity is < 1 or > 10_000) throw new InvalidOperationException("CandleBattles:MoneyFlow:QueueCapacity is outside the safe range.");
        if (MaxBatchCount is < 1 or > 100) throw new InvalidOperationException("CandleBattles:MoneyFlow:MaxBatchCount is outside the safe range.");
        if (RegistryRefreshSeconds is < 1 or > 300) throw new InvalidOperationException("CandleBattles:MoneyFlow:RegistryRefreshSeconds is outside the safe range.");
        if (ReplayWindowMinutes is < 1 or > 60) throw new InvalidOperationException("CandleBattles:MoneyFlow:ReplayWindowMinutes is outside the safe range.");
        if (FrontendBufferCapacity is < 1 or > 500) throw new InvalidOperationException("CandleBattles:MoneyFlow:FrontendBufferCapacity is outside the safe range.");
        return this;
    }
}
