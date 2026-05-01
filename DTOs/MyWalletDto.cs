namespace DTOs;

public sealed class MyWalletDto
{
    public int UserId { get; set; }
    public string Wallet { get; set; } = "";
    public string BlockchainMode { get; set; } = "";
    public string CustodyWalletPublicKey { get; set; } = "";
    public string CustodyWalletLabel { get; set; } = "";
    public bool UsesOnChainContract { get; set; }
    public bool EnableOnChainWithdrawals { get; set; }
    public string? Name { get; set; }
    public string? Email { get; set; }
    public DateTime DtCreate { get; set; }
    public DateTime? LastLogin { get; set; }
    public decimal SystemBalance { get; set; }
    public decimal TotalInvested { get; set; }
    public decimal OpenAmount { get; set; }
    public decimal AvailableReturns { get; set; }
    public decimal TotalClaimed { get; set; }
    public decimal TotalWithdrawn { get; set; }
    public decimal RealizedProfit { get; set; }
    public decimal RealizedLoss { get; set; }
    public decimal RealizedNetResult { get; set; }
    public int OpenInvestments { get; set; }
    public int SettledInvestments { get; set; }
    public bool CanClaim { get; set; }
    public bool CanWithdraw { get; set; }
    public List<ClaimableBetDto> ClaimableBets { get; set; } = [];
    public List<TeamPositionDto> ActivePositions { get; set; } = [];
    public List<MyWalletInvestmentGroupDto> InvestmentGroups { get; set; } = [];
}

public sealed class ClaimableBetDto
{
    public int BetId { get; set; }
    public int MatchId { get; set; }
    public int TeamId { get; set; }
    public decimal PayoutAmount { get; set; }
}

public sealed class MyWalletInvestmentGroupDto
{
    public int TeamId { get; set; }
    public string Symbol { get; set; } = "";
    public string CurrencyName { get; set; } = "";
    public decimal TotalInvested { get; set; }
    public decimal OpenAmount { get; set; }
    public decimal AvailableReturns { get; set; }
    public decimal RealizedNetResult { get; set; }
    public int MatchCount { get; set; }
    public int WonCount { get; set; }
    public int LostCount { get; set; }
    public int OpenCount { get; set; }
    public int RefundedCount { get; set; }
    public int CancelledCount { get; set; }
    public int DrawCount { get; set; }
    public DateTime? LastBetTime { get; set; }
}

public sealed class UserMatchHistoryPageDto
{
    public List<UserMatchHistoryItemDto> Items { get; set; } = [];
    public int Page { get; set; }
    public int PageSize { get; set; }
    public int TotalItems { get; set; }
    public int TotalPages { get; set; }
    public string Status { get; set; } = "all";
}

public sealed class UserMatchHistoryItemDto
{
    public int BetId { get; set; }
    public int MatchId { get; set; }
    public int UserId { get; set; }
    public int TeamId { get; set; }
    public int TeamAId { get; set; }
    public int TeamBId { get; set; }
    public int? WinnerTeamId { get; set; }
    public string UserTeamSymbol { get; set; } = "";
    public string OpponentSymbol { get; set; } = "";
    public string TeamASymbol { get; set; } = "";
    public string TeamBSymbol { get; set; } = "";
    public string? WinnerTeamSymbol { get; set; }
    public string CurrencyName { get; set; } = "";
    public decimal BetAmount { get; set; }
    public decimal ReceivedAmount { get; set; }
    public decimal PayoutAmount { get; set; }
    public decimal RefundAmount { get; set; }
    public decimal HouseFeeAmount { get; set; }
    public decimal NetResult { get; set; }
    public DateTime BetTime { get; set; }
    public DateTime? MatchStartTime { get; set; }
    public DateTime? MatchEndTime { get; set; }
    public int ScoreTeamA { get; set; }
    public int ScoreTeamB { get; set; }
    public string MatchStatus { get; set; } = "";
    public string UserResult { get; set; } = "";
    public string UserResultLabel { get; set; } = "";
    public string MatchResultSummary { get; set; } = "";
    public string HumanSummary { get; set; } = "";
    public string SettlementSummary { get; set; } = "";
    public bool Claimed { get; set; }
    public bool? IsWinner { get; set; }
    public bool IsLoser { get; set; }
    public bool IsOpen { get; set; }
    public bool IsRefunded { get; set; }
    public bool IsCancelled { get; set; }
    public bool IsDraw { get; set; }
    public bool IsPartialLoss { get; set; }
    public DateTimeOffset? SettledAt { get; set; }
    public DateTimeOffset? BettingCloseTime { get; set; }
    public decimal TotalBetOnTeamA { get; set; }
    public decimal TotalBetOnTeamB { get; set; }
    public int WalletCountTeamA { get; set; }
    public int WalletCountTeamB { get; set; }
    public int BetCountTeamA { get; set; }
    public int BetCountTeamB { get; set; }
    public decimal TotalPool { get; set; }
    public decimal WinningPool { get; set; }
    public decimal LosingPool { get; set; }
    public decimal TotalDistributed { get; set; }
    public bool HasBetsOnBothSides { get; set; }
    public bool HasValidFinancialDispute { get; set; }
    public string? SettlementReasonCode { get; set; }
    public string? SettlementReasonDetail { get; set; }
    public List<MatchScoreEventDto> ScoreEvents { get; set; } = [];
    public List<MatchParticipantDto> Participants { get; set; } = [];
    public List<string> SettlementSteps { get; set; } = [];
}

public sealed class MatchParticipantDto
{
    public string WalletMasked { get; set; } = "";
    public string TeamSymbol { get; set; } = "";
    public decimal BetAmount { get; set; }
    public string ResultLabel { get; set; } = "";
    public decimal ReceivedAmount { get; set; }
}
