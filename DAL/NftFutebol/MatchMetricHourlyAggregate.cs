namespace DAL.NftFutebol;

public sealed class MatchMetricHourlyAggregate
{
    public long Id { get; set; }
    public int MatchId { get; set; }
    public int TeamId { get; set; }
    public string Symbol { get; set; } = string.Empty;
    public DateTime HourBucketUtc { get; set; }
    public decimal AveragePercentageChange { get; set; }
    public decimal MinPercentageChange { get; set; }
    public decimal MaxPercentageChange { get; set; }
    public decimal AverageQuoteVolume { get; set; }
    public decimal MinQuoteVolume { get; set; }
    public decimal MaxQuoteVolume { get; set; }
    public decimal AverageTradeCount { get; set; }
    public long MinTradeCount { get; set; }
    public long MaxTradeCount { get; set; }
    public int SnapshotCount { get; set; }
    public DateTime CreatedAtUtc { get; set; }
    public DateTime UpdatedAtUtc { get; set; }

    public Match Match { get; set; } = null!;
    public Team Team { get; set; } = null!;
}
