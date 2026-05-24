namespace DTOs;

public sealed class HotMatchDto
{
    public int MatchId { get; set; }
    public string Slug { get; set; } = string.Empty;
    public string HomeSymbol { get; set; } = string.Empty;
    public string AwaySymbol { get; set; } = string.Empty;
    public string TeamA
    {
        get => HomeSymbol;
        set => HomeSymbol = value;
    }
    public string TeamB
    {
        get => AwaySymbol;
        set => AwaySymbol = value;
    }
    public int HomeScore { get; set; }
    public int AwayScore { get; set; }
    public int ScoreA
    {
        get => HomeScore;
        set => HomeScore = value;
    }
    public int ScoreB
    {
        get => AwayScore;
        set => AwayScore = value;
    }
    public int HotScore { get; set; }
    public decimal Momentum { get; set; }
    public decimal Fear { get; set; }
    public int ArenaPressure { get; set; }
    public DateTime? LastGoalAt { get; set; }
    public bool IsTrending { get; set; }
    public bool IsExplosive { get; set; }
    public int? ViewerCount { get; set; }
    public int ActivityLevel { get; set; }
    public int ScoreDifference { get; set; }
    public int RecentGoals { get; set; }
    public string Status { get; set; } = string.Empty;
    public int Minute { get; set; }
    public int ElapsedMinutes { get; set; }
    public int RemainingMinutes { get; set; }
    public bool IsFinished { get; set; }
    public decimal? PctA { get; set; }
    public decimal? PctB { get; set; }
    public decimal TotalPool { get; set; }
    public decimal TotalPoolAmount { get; set; }
    public bool HasBetsOnBothSides { get; set; }
    public int PoolStrengthTeamA { get; set; }
    public int PoolStrengthTeamB { get; set; }
    public int TotalGoals { get; set; }
    public int TotalBets { get; set; }
    public decimal HomeBetAmount { get; set; }
    public decimal AwayBetAmount { get; set; }
    public string Reason { get; set; } = string.Empty;
    public string PublicUrl { get; set; } = string.Empty;
    public string HomeLogoUrl { get; set; } = string.Empty;
    public string AwayLogoUrl { get; set; } = string.Empty;
    public decimal PriorityScore { get; set; }
    public MatchDto? MatchSnapshot { get; set; }
}
