namespace DAL.NftFutebol
{
    public class MatchAlertSubscription
    {
        public long MatchAlertSubscriptionId { get; set; }
        public long PushSubscriptionId { get; set; }
        public int MatchId { get; set; }
        public bool IsNotifyScore { get; set; } = true;
        public bool IsNotifyComeback { get; set; } = true;
        public bool IsNotifyFinished { get; set; } = true;
        public string Culture { get; set; } = "en";
        public DateTime CreatedAt { get; set; }
        public bool IsActive { get; set; } = true;

        public PushSubscription PushSubscription { get; set; } = null!;
        public Match Match { get; set; } = null!;
        public ICollection<MatchAlertDelivery> AlertDeliveries { get; set; } = [];
    }
}
