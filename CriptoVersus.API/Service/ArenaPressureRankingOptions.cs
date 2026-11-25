namespace CriptoVersus.API.Services;

public sealed class ArenaPressureRankingOptions
{
    public const string SectionName = "ArenaPressureRanking";
    public int ReversalWeight { get; set; } = 35;
    public int MovementWeight { get; set; } = 35;
    public int TopGainersWeight { get; set; } = 30;
    public int MinimumHistorySamples { get; set; } = 4;
    public int MaximumCandidates { get; set; } = 100;
    public int MaximumPageSize { get; set; } = 50;
    public decimal LeadershipMargin { get; set; } = 4m;
    public int MinimumSustainedSamples { get; set; } = 2;
    public decimal SignificantMovementThreshold { get; set; } = 3m;
    public decimal NoiseFloor { get; set; } = 1m;
    public int TopGainersLimit { get; set; } = 50;
    public decimal MinimumQuoteVolume { get; set; } = 1_000_000m;
    public int MarketCacheMinutes { get; set; } = 5;
    public int MarketSnapshotMaxAgeMinutes { get; set; } = 15;
    public string[] ExcludedBaseAssets { get; set; } = ["USDT", "USDC", "FDUSD", "TUSD", "DAI", "BUSD", "EUR", "BRL"];
}
