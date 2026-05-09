namespace DAL.NftFutebol
{
    public class PositionAllocation
    {
        public int PositionAllocationId { get; set; }
        public int PositionId { get; set; }
        public int MatchId { get; set; }
        public int? BetId { get; set; }
        public decimal AllocatedAmount { get; set; }
        public decimal? ResultAmount { get; set; }
        public decimal? PnL { get; set; }
        public PositionAllocationStatus Status { get; set; } = PositionAllocationStatus.Active;
        public DateTime CreatedAt { get; set; }
        public DateTime? SettledAt { get; set; }

        public virtual UserTeamPosition Position { get; set; } = null!;
        public virtual Match Match { get; set; } = null!;
        public virtual Bet? Bet { get; set; }
    }
}
