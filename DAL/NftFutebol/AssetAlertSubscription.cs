namespace DAL.NftFutebol
{
    public class AssetAlertSubscription
    {
        public long AssetAlertSubscriptionId { get; set; }
        public long PushSubscriptionId { get; set; }
        public int CurrencyId { get; set; }
        public string Symbol { get; set; } = string.Empty;
        public string Culture { get; set; } = "en";
        public bool IsActive { get; set; } = true;
        public DateTime CreatedAt { get; set; }

        public PushSubscription PushSubscription { get; set; } = null!;
        public Currency Currency { get; set; } = null!;
    }
}
