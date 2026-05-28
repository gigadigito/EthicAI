namespace CriptoVersus.Worker;

public sealed class DataRetentionOptions
{
    public const string SectionName = "DataRetention";

    public bool Enabled { get; set; } = true;
    public bool DryRun { get; set; } = true;
    public int RawSnapshotRetentionDays { get; set; } = 30;
    public int HourlyAggregateRetentionDays { get; set; } = 365;
    public int RunAtHourUtc { get; set; } = 3;
    public int BatchSize { get; set; } = 50_000;
}
