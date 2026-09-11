namespace DAL.NftFutebol
{
    public class PushSubscription
    {
        public long PushSubscriptionId { get; set; }
        public string Endpoint { get; set; } = string.Empty;
        public string P256dh { get; set; } = string.Empty;
        public string Auth { get; set; } = string.Empty;
        public string ClientId { get; set; } = string.Empty;
        public int? UserId { get; set; }
        public DateTime CreatedAt { get; set; }
        public DateTime UpdatedAt { get; set; }
        public bool IsActive { get; set; } = true;

        public User? User { get; set; }
        public ICollection<MatchAlertSubscription> AlertSubscriptions { get; set; } = [];
        public ICollection<MatchAlertDelivery> AlertDeliveries { get; set; } = [];
    }
}
