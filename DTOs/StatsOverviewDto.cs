namespace DTOs;

public sealed class StatsOverviewDto
{
    public int TotalMatches { get; set; }
    public int FinishedMatches { get; set; }
    public int ActiveAssets { get; set; }
    public decimal AverageScore { get; set; }
    public int HighestScore { get; set; }
    public DateTime? LastUpdatedUtc { get; set; }
    public bool IsStale { get; set; }
    public string? StaleReason { get; set; }
    public List<StatsAssetPerformanceDto> TopTeams { get; set; } = [];
    public List<StatsMatchActivityDto> MatchActivity { get; set; } = [];
    public List<StatsLatestMatchDto> LatestMatches { get; set; } = [];
}

public sealed class StatsAssetPerformanceDto
{
    public int Rank { get; set; }
    public string Symbol { get; set; } = string.Empty;
    public string DisplayName { get; set; } = string.Empty;
    public int Matches { get; set; }
    public int Wins { get; set; }
    public int Losses { get; set; }
    public decimal WinRate { get; set; }
    public decimal AverageScore { get; set; }
    public int TotalScore { get; set; }
    public DateTime? LastMatchUtc { get; set; }
}

public sealed class StatsMatchActivityDto
{
    public string Date { get; set; } = string.Empty;
    public int Matches { get; set; }
}

public sealed class StatsLatestMatchDto
{
    public int MatchId { get; set; }
    public string HomeSymbol { get; set; } = string.Empty;
    public string AwaySymbol { get; set; } = string.Empty;
    public int HomeScore { get; set; }
    public int AwayScore { get; set; }
    public string Status { get; set; } = string.Empty;
    public DateTime? StartedAtUtc { get; set; }
    public DateTime? FinishedAtUtc { get; set; }
    public string? PublicUrl { get; set; }
}

public sealed class StatsArenaTeamDto
{
    public string Symbol { get; set; } = string.Empty;
    public string DisplaySymbol { get; set; } = string.Empty;
    public string DisplayName { get; set; } = string.Empty;
    public int Rank { get; set; }
    public int Matches { get; set; }
    public int Wins { get; set; }
    public int Losses { get; set; }
    public decimal WinRate { get; set; }
    public decimal AverageScore { get; set; }
    public int TotalScore { get; set; }
    public string Momentum { get; set; } = string.Empty;
    public string IconUrl { get; set; } = string.Empty;
    public DateTime? LastMatchUtc { get; set; }
}

public sealed class StatsArenaTeamDetailDto
{
    public string Symbol { get; set; } = string.Empty;
    public string DisplaySymbol { get; set; } = string.Empty;
    public string DisplayName { get; set; } = string.Empty;
    public int Rank { get; set; }
    public int Matches { get; set; }
    public int Wins { get; set; }
    public int Losses { get; set; }
    public decimal WinRate { get; set; }
    public decimal AverageScore { get; set; }
    public int TotalScore { get; set; }
    public string Momentum { get; set; } = string.Empty;
    public string IconUrl { get; set; } = string.Empty;
    public DateTime? LastMatchUtc { get; set; }
    public List<StatsMatchActivityDto> MatchActivity { get; set; } = [];
    public List<StatsLatestMatchDto> LatestMatches { get; set; } = [];
    public List<StatsArenaRivalDto> Rivalries { get; set; } = [];
}

public sealed class StatsArenaRivalDto
{
    public string Symbol { get; set; } = string.Empty;
    public string DisplaySymbol { get; set; } = string.Empty;
    public string DisplayName { get; set; } = string.Empty;
    public int Matches { get; set; }
    public int Wins { get; set; }
    public int Losses { get; set; }
    public string IconUrl { get; set; } = string.Empty;
}
