namespace DAL.NftFutebol
{
    public class MatchMetricSnapshot
    {
        public long MatchMetricSnapshotId { get; set; }
        public int MatchId { get; set; }
        public int TeamId { get; set; }
        public DateTime CapturedAtUtc { get; set; }
        public decimal PercentageChange { get; set; }
        public decimal QuoteVolume { get; set; }
        public long TradeCount { get; set; }

        public Match Match { get; set; } = null!;
        public Team Team { get; set; } = null!;
    }
}
