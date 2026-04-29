namespace CriptoVersus.Tests.Integration.Infrastructure;

public sealed record InternalTestSessionRequest(string Wallet, decimal InitialBalance, string Name, string? Email);

public sealed class InternalTestSessionResponse
{
    public string Token { get; set; } = string.Empty;
    public string Wallet { get; set; } = string.Empty;
    public int UserId { get; set; }
    public decimal SystemBalance { get; set; }
    public int ExpiresInMinutes { get; set; }
}

public sealed class InternalTestCreateMatchRequest
{
    public bool StartImmediately { get; set; } = true;
    public string? TeamASymbol { get; set; }
    public string? TeamBSymbol { get; set; }
}

public sealed class InternalTestMatchResponse
{
    public int MatchId { get; set; }
    public int TeamAId { get; set; }
    public int TeamBId { get; set; }
    public string TeamASymbol { get; set; } = string.Empty;
    public string TeamBSymbol { get; set; } = string.Empty;
    public string Status { get; set; } = string.Empty;
}

public sealed class InternalTestScoreAndSettleRequest
{
    public int ScoreA { get; set; }
    public int ScoreB { get; set; }
}

public sealed class InternalTestSettlementResponse
{
    public int MatchId { get; set; }
    public int ScoreA { get; set; }
    public int ScoreB { get; set; }
    public int? WinnerTeamId { get; set; }
    public string? EndReasonCode { get; set; }
    public string? EndReasonDetail { get; set; }
    public decimal TeamAPool { get; set; }
    public decimal TeamBPool { get; set; }
    public decimal HouseFeeAmount { get; set; }
    public decimal LoserRefundPool { get; set; }
}

public sealed class InternalTestLedgerEntryDto
{
    public int Id { get; set; }
    public string Type { get; set; } = string.Empty;
    public decimal Amount { get; set; }
    public decimal BalanceBefore { get; set; }
    public decimal BalanceAfter { get; set; }
    public int? ReferenceId { get; set; }
    public string? Description { get; set; }
    public DateTime CreatedAt { get; set; }
}

public sealed record PreparedScenario(
    TestWallet UserA,
    TestWallet? UserB,
    InternalTestMatchResponse Match,
    decimal StakeA,
    decimal StakeB);
