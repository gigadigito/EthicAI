namespace DTOs;

public sealed class TeamPositionDto
{
    public int PositionId { get; set; }
    public int UserId { get; set; }
    public int TeamId { get; set; }
    public string Symbol { get; set; } = "";
    public string CurrencyName { get; set; } = "";
    public decimal PrincipalAllocated { get; set; }
    public decimal CurrentCapital { get; set; }
    public bool AutoCompound { get; set; }
    public string Status { get; set; } = "";
    public bool HasOpenBet { get; set; }
    public string? OpenBetMatchStatus { get; set; }
    public bool CanCloseNow { get; set; }
    public string? OnChainPositionAddress { get; set; }
    public string? OnChainVaultAddress { get; set; }
    public string? LastOnChainSignature { get; set; }
    public string? OnChainCluster { get; set; }
    public long? CurrentLamports { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
    public DateTime? ClosedAt { get; set; }
}

public sealed class CreateTeamPositionRequest
{
    public int TeamId { get; set; }
    public decimal Amount { get; set; }
    public bool AutoCompound { get; set; } = true;
    public string? OnChainPositionAccount { get; set; }
    public string? OnChainPositionVault { get; set; }
    public string? OnChainSignature { get; set; }
    public string? OnChainAmountLamports { get; set; }
}

public sealed class UpdateTeamPositionRequest
{
    public decimal? AddAmount { get; set; }
    public bool? AutoCompound { get; set; }
}
