namespace DTOs;

public sealed class SocialHotMatchDto
{
    public int MatchId { get; set; }
    public string HomeSymbol { get; set; } = string.Empty;
    public string AwaySymbol { get; set; } = string.Empty;
    public int HomeGoals { get; set; }
    public int AwayGoals { get; set; }
    public string Status { get; set; } = string.Empty;
    public int Minute { get; set; }
    public int TotalGoals { get; set; }
    public int TotalBets { get; set; }
    public decimal HomeBetAmount { get; set; }
    public decimal AwayBetAmount { get; set; }
    public int HotScore { get; set; }
    public string PublicUrl { get; set; } = string.Empty;
    public string Reason { get; set; } = string.Empty;
}

public sealed class SocialGoalLogDto
{
    public int Minute { get; set; }
    public string TeamSymbol { get; set; } = string.Empty;
    public string EventType { get; set; } = string.Empty;
    public string ScoreAfter { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
}

public sealed class SocialShareCardDto
{
    public int MatchId { get; set; }
    public string HomeSymbol { get; set; } = string.Empty;
    public string AwaySymbol { get; set; } = string.Empty;
    public string Score { get; set; } = string.Empty;
    public string Status { get; set; } = string.Empty;
    public int Minute { get; set; }
    public int HotScore { get; set; }
    public string Reason { get; set; } = string.Empty;
    public string PublicUrl { get; set; } = string.Empty;
    public string SuggestedText { get; set; } = string.Empty;
    public List<string> Hashtags { get; set; } = [];
    public bool CanPost { get; set; }
    public string? SkipReason { get; set; }
    public List<SocialGoalLogDto> GoalLogs { get; set; } = [];
}

public sealed class SocialMatchImageDto
{
    public string? ImageUrl { get; set; }
    public string PublicUrl { get; set; } = string.Empty;
    public string Mode { get; set; } = "external-screenshot";
    public string Note { get; set; } = string.Empty;
}

public sealed class RegisterSocialPostRequest
{
    public int MatchId { get; set; }
    public string Platform { get; set; } = string.Empty;
    public string PostText { get; set; } = string.Empty;
    public string? PostUrl { get; set; }
    public string? ExternalPostId { get; set; }
    public int HotScore { get; set; }
    public string Reason { get; set; } = string.Empty;
}
