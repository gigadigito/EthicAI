namespace DTOs;

public sealed class AdminSystemDto
{
    public DateTime ServerTimeUtc { get; set; }
    public string AdminWallet { get; set; } = "";
    public string OnChainAuthorityWallet { get; set; } = "";
    public string OnChainCluster { get; set; } = "devnet";
    public string ProgramId { get; set; } = "";
    public int Users { get; set; }
    public int MatchesTotal { get; set; }
    public int MatchesPending { get; set; }
    public int MatchesOngoing { get; set; }
    public int MatchesCompleted { get; set; }
    public int BetsTotal { get; set; }
    public int BetsOpen { get; set; }
    public int PositionsActive { get; set; }
    public int PositionsClosingRequested { get; set; }
    public int PositionsClosed { get; set; }
    public decimal ActivePositionCapital { get; set; }
    public decimal PrincipalAllocated { get; set; }
    public decimal OpenBetAmount { get; set; }
    public List<AdminPositionSummaryDto> RecentPositions { get; set; } = [];
}

public sealed class AdminPositionSummaryDto
{
    public int PositionId { get; set; }
    public int UserId { get; set; }
    public int TeamId { get; set; }
    public string Symbol { get; set; } = "";
    public string Wallet { get; set; } = "";
    public decimal CurrentCapital { get; set; }
    public decimal PrincipalAllocated { get; set; }
    public string Status { get; set; } = "";
    public string? OnChainPositionAddress { get; set; }
    public string? OnChainVaultAddress { get; set; }
    public string? LastOnChainSignature { get; set; }
    public long? CurrentLamports { get; set; }
    public DateTime UpdatedAt { get; set; }
}
