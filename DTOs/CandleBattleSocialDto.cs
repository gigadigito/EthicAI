namespace DTOs;

public static class CandleBattleSocialCategories
{
    public const string Highlight = "candle_battle_highlight";
}

public sealed class CandleBattleSocialAssetDto
{
    public string Symbol { get; init; } = string.Empty;
    public string Pair { get; init; } = string.Empty;
    public string LogoUrl { get; init; } = string.Empty;
    public decimal? OpeningPrice { get; init; }
    public decimal? ClosingPrice { get; init; }
    public decimal? PerformancePercent { get; init; }
    public int GreenCandles { get; init; }
    public int RedCandles { get; init; }
}

public sealed class CandleBattleSocialResponse
{
    public string Category { get; init; } = CandleBattleSocialCategories.Highlight;
    public int MatchId { get; init; }
    public string BattleId { get; init; } = string.Empty;
    public string BattleType { get; init; } = "candle_battles_arcade";
    public string Status { get; init; } = string.Empty;
    public string BattleStatus { get; init; } = string.Empty;
    public DateTime? StartTimeUtc { get; init; }
    public DateTime? EndTimeUtc { get; init; }
    public int? DurationMinutes { get; init; }
    public CandleBattleSocialAssetDto AssetA { get; init; } = new();
    public CandleBattleSocialAssetDto AssetB { get; init; } = new();
    public int ScoreA { get; init; }
    public int ScoreB { get; init; }
    public string? WinnerSymbol { get; init; }
    public int ConfrontationCount { get; init; }
    public int ExpectedConfrontations { get; init; }
    public int InterestScore { get; init; }
    public IReadOnlyList<string> SelectionReasons { get; init; } = [];
    public IReadOnlyList<CandleBattlesRoundDto> Rounds { get; init; } = [];
    public bool ReplayAvailable { get; init; }
    public string? ReplayUnavailableReason { get; init; }
    public bool CanPost { get; init; }
    public string? SkipReason { get; init; }
    public bool AlreadyPublished { get; init; }
    public PriceCrossoverPublicationState? Publication { get; init; }
    public string? PublicUrl { get; init; }
    public bool PublicUrlAvailable { get; init; }
    public DateTime GeneratedAtUtc { get; init; }
}

public sealed class CandleBattleCandidateDto
{
    public int MatchId { get; init; }
    public string AssetASymbol { get; init; } = string.Empty;
    public string AssetBSymbol { get; init; } = string.Empty;
    public DateTime? EndTimeUtc { get; init; }
    public int ScoreA { get; init; }
    public int ScoreB { get; init; }
    public int InterestScore { get; init; }
    public bool IsEligible { get; init; }
    public IReadOnlyList<string> SelectionReasons { get; init; } = [];
    public IReadOnlyList<string> RejectionReasons { get; init; } = [];
}

public sealed class CandleBattleCandidatesResponse
{
    public DateTime GeneratedAtUtc { get; init; }
    public int LookbackHours { get; init; }
    public int MatchesScanned { get; init; }
    public int EligibleCount { get; init; }
    public int? SelectedMatchId { get; init; }
    public IReadOnlyList<CandleBattleCandidateDto> Candidates { get; init; } = [];
}

public sealed class CandleBattleHighlightResponse
{
    public CandleBattleSocialResponse? Highlight { get; init; }
    public bool HasHighlight { get; init; }
    public string? SkipReason { get; init; }
    public DateTime GeneratedAtUtc { get; init; }
    public int LookbackHours { get; init; }
    public int MatchesScanned { get; init; }
    public int EligibleCount { get; init; }
    public IReadOnlyList<CandleBattleCandidateDto> Candidates { get; init; } = [];
}
