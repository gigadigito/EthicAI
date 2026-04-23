namespace DTOs;

public sealed class MyWalletDto
{
    public int UserId { get; set; }
    public string Wallet { get; set; } = "";
    public string? Name { get; set; }
    public string? Email { get; set; }
    public DateTime DtCreate { get; set; }
    public DateTime? LastLogin { get; set; }
    public decimal Balance { get; set; }
    public decimal TotalInvested { get; set; }
    public decimal OpenAmount { get; set; }
    public decimal TotalPayout { get; set; }
    public decimal RealizedLoss { get; set; }
    public decimal NetPortfolioResult { get; set; }
    public decimal NetSettledResult { get; set; }
    public int OpenInvestments { get; set; }
    public int SettledInvestments { get; set; }
    public List<TeamPositionDto> ActivePositions { get; set; } = [];
    public List<MyInvestmentDto> Investments { get; set; } = [];
}

public sealed class MyInvestmentDto
{
    public int BetId { get; set; }
    public int MatchId { get; set; }
    public int TeamId { get; set; }
    public string Symbol { get; set; } = "";
    public string CurrencyName { get; set; } = "";
    public string OpponentSymbol { get; set; } = "";
    public decimal Amount { get; set; }
    public DateTime BetTime { get; set; }
    public string MatchStatus { get; set; } = "";
    public string InvestmentStatus { get; set; } = "";
    public bool Claimed { get; set; }
    public bool? IsWinner { get; set; }
    public decimal? PayoutAmount { get; set; }
    public DateTimeOffset? SettledAt { get; set; }
    public DateTimeOffset? BettingCloseTime { get; set; }
}
