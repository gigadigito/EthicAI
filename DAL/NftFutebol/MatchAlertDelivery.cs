namespace DAL.NftFutebol
{
    public class MatchAlertDelivery
    {
        public long MatchAlertDeliveryId { get; set; }
        public long PushSubscriptionId { get; set; }
        public int MatchId { get; set; }
        public long? MatchScoreEventId { get; set; }
        public string EventKey { get; set; } = string.Empty;
        public string AlertType { get; set; } = string.Empty;
        public string Status { get; set; } = "PENDING";
        public int Attempts { get; set; }
        public DateTime NextAttemptAt { get; set; }
        public DateTime? LastAttemptAt { get; set; }
        public DateTime? SentAt { get; set; }
        public DateTime CreatedAt { get; set; }

        public PushSubscription PushSubscription { get; set; } = null!;
        public Match Match { get; set; } = null!;
        public MatchScoreEvent? MatchScoreEvent { get; set; }
    }
}
