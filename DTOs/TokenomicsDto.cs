namespace DTOs;

public sealed class TokenomicsDto
{
    public DateTime ServerTimeUtc { get; set; }
    public string Cluster { get; set; } = "devnet";
    public string ProgramId { get; set; } = "";
    public string AuthorityWallet { get; set; } = "";
    public decimal HouseFeeRate { get; set; }
    public decimal LoserRefundRate { get; set; }
    public decimal WinnerPoolRate { get; set; }
    public bool AutoReenterEnabled { get; set; }
    public decimal MinPositionCapital { get; set; }
    public double PercentPerGoal { get; set; }
    public int MaxGoalsPerTeam { get; set; }
    public int MatchDurationMinutes { get; set; }
    public int ActivePositions { get; set; }
    public int ClosingPositions { get; set; }
    public int ClosedPositions { get; set; }
    public int Users { get; set; }
    public int TotalMatches { get; set; }
    public int PendingMatches { get; set; }
    public int OngoingMatches { get; set; }
    public int CompletedMatches { get; set; }
    public int OpenEntries { get; set; }
    public decimal ActiveCapital { get; set; }
    public decimal PrincipalAllocated { get; set; }
    public decimal OpenEntryAmount { get; set; }
    public List<TokenomicsPositionDto> TopPositions { get; set; } = [];
}

public sealed class TokenomicsPositionDto
{
    public string Symbol { get; set; } = "";
    public decimal CurrentCapital { get; set; }
    public decimal PrincipalAllocated { get; set; }
    public string Status { get; set; } = "";
}
