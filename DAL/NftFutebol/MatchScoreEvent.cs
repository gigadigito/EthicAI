namespace DAL.NftFutebol
{
    public class MatchScoreEvent
    {
        public long MatchScoreEventId { get; set; }
        public int MatchId { get; set; }
        public int TeamId { get; set; }
        public MatchScoringRuleType RuleType { get; set; }
        public string EventType { get; set; } = string.Empty;
        public string? ReasonCode { get; set; }
        public int Points { get; set; }
        public int EventSequence { get; set; }
        public decimal? TeamPercentageChange { get; set; }
        public decimal? OpponentPercentageChange { get; set; }
        public decimal? TeamQuoteVolume { get; set; }
        public decimal? OpponentQuoteVolume { get; set; }
        public decimal? MetricDelta { get; set; }
        public DateTime? WindowStartUtc { get; set; }
        public DateTime? WindowEndUtc { get; set; }
        public string Description { get; set; } = string.Empty;
        public DateTime EventTimeUtc { get; set; }

        public Match Match { get; set; } = null!;
        public Team Team { get; set; } = null!;
    }
}
