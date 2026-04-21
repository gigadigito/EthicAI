namespace DTOs
{
    public class MatchScoreEventDto
    {
        public long MatchScoreEventId { get; set; }
        public int MatchId { get; set; }
        public int TeamId { get; set; }
        public string TeamSymbol { get; set; } = string.Empty;
        public string RuleType { get; set; } = string.Empty;
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
    }
}
