namespace DAL.NftFutebol
{
    public enum TeamPositionStatus
    {
        Active = 0,
        ClosingRequested = 1,
        Closed = 2,
        Paused = 3
    }

    public class UserTeamPosition
    {
        public int PositionId { get; set; }
        public int UserId { get; set; }
        public int TeamId { get; set; }
        public decimal PrincipalAllocated { get; set; }
        public decimal CurrentCapital { get; set; }
        public bool AutoCompound { get; set; } = true;
        public TeamPositionStatus Status { get; set; } = TeamPositionStatus.Active;
        public DateTime CreatedAt { get; set; }
        public DateTime UpdatedAt { get; set; }
        public DateTime? ClosedAt { get; set; }

        public virtual User User { get; set; }
        public virtual Team Team { get; set; }
        public virtual ICollection<Bet> Bets { get; set; } = new List<Bet>();
    }
}
