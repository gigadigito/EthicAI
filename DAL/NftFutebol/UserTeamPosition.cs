namespace DAL.NftFutebol
{
    public enum PositionExposureMode
    {
        MatchRecurring = 0
    }

    public enum PositionLifecycleEventType
    {
        Opened = 0,
        Increased = 1,
        Reduced = 2,
        Paused = 3,
        Resumed = 4,
        AutoAllocated = 5,
        MatchSettled = 6,
        Closed = 7,
        ClosingRequested = 8
    }

    public enum PositionAllocationStatus
    {
        Active = 0,
        Settled = 1,
        Cancelled = 2
    }

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
        public string? OnChainPositionAddress { get; set; }
        public string? OnChainVaultAddress { get; set; }
        public string? LastOnChainSignature { get; set; }
        public string? OnChainCluster { get; set; }
        public long? CurrentLamports { get; set; }
        public PositionExposureMode ExposureMode { get; set; } = PositionExposureMode.MatchRecurring;
        public string? BlockchainModeSnapshot { get; set; }
        public decimal TotalPnL { get; set; }
        public int TotalWins { get; set; }
        public int TotalLosses { get; set; }
        public DateTime CreatedAt { get; set; }
        public DateTime UpdatedAt { get; set; }
        public DateTime? ClosedAt { get; set; }

        public virtual User User { get; set; }
        public virtual Team Team { get; set; }
        public virtual ICollection<Bet> Bets { get; set; } = new List<Bet>();
        public virtual ICollection<PositionAllocation> Allocations { get; set; } = new List<PositionAllocation>();
        public virtual ICollection<PositionLifecycleEvent> LifecycleEvents { get; set; } = new List<PositionLifecycleEvent>();
    }
}
