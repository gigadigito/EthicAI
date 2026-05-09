namespace DAL.NftFutebol
{
    public class PositionLifecycleEvent
    {
        public int PositionLifecycleEventId { get; set; }
        public int PositionId { get; set; }
        public int? MatchId { get; set; }
        public int? BetId { get; set; }
        public PositionLifecycleEventType EventType { get; set; }
        public decimal? Amount { get; set; }
        public decimal? CapitalBefore { get; set; }
        public decimal? CapitalAfter { get; set; }
        public decimal? PnL { get; set; }
        public string? Notes { get; set; }
        public DateTime CreatedAt { get; set; }

        public virtual UserTeamPosition Position { get; set; } = null!;
        public virtual Match? Match { get; set; }
        public virtual Bet? Bet { get; set; }
    }
}
