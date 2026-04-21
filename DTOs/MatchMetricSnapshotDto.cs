namespace DTOs
{
    public class MatchMetricSnapshotDto
    {
        public long MatchMetricSnapshotId { get; set; }
        public int MatchId { get; set; }
        public int TeamId { get; set; }
        public string TeamSymbol { get; set; } = string.Empty;
        public DateTime CapturedAtUtc { get; set; }
        public decimal PercentageChange { get; set; }
        public decimal QuoteVolume { get; set; }
        public long TradeCount { get; set; }
    }
}
