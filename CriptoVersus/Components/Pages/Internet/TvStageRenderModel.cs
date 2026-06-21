using DTOs;
using CriptoVersus.Components.Shared;

namespace CriptoVersus.Components.Pages.Internet;

public sealed class TvStageRenderModel
{
    public int CurrentStageMatchId { get; init; }
    public string Culture { get; init; } = string.Empty;
    public bool IsBroadcastMode { get; init; }
    public bool IsTvFullscreenLayout { get; init; }
    public bool UseFootballFieldLayout { get; init; }
    public bool CanInvestInArena { get; init; }
    public string ArenaInvestmentUrl { get; init; } = "#";
    public string InvestLabel { get; init; } = string.Empty;
    public string HomeUrl { get; init; } = "/";
    public string EyebrowLabel { get; init; } = string.Empty;
    public string Headline { get; init; } = string.Empty;
    public string CurrentRealMatchUrl { get; init; } = string.Empty;

    public string LeftSymbol { get; init; } = string.Empty;
    public string RightSymbol { get; init; } = string.Empty;
    public string LeftTickerLabel { get; init; } = string.Empty;
    public string RightTickerLabel { get; init; } = string.Empty;
    public string LeftHeroLabel { get; init; } = string.Empty;
    public string RightHeroLabel { get; init; } = string.Empty;
    public string LeftName { get; init; } = string.Empty;
    public string RightName { get; init; } = string.Empty;
    public string LeftLogoUrl { get; init; } = string.Empty;
    public string RightLogoUrl { get; init; } = string.Empty;

    public int LeftScore { get; init; }
    public int RightScore { get; init; }
    public bool PulseScoreboard { get; init; }
    public bool PulseLeftScore { get; init; }
    public bool PulseRightScore { get; init; }

    public decimal? LeftChangePercent { get; init; }
    public decimal? RightChangePercent { get; init; }
    public string LeftChangeDisplay { get; init; } = string.Empty;
    public string RightChangeDisplay { get; init; } = string.Empty;
    public string LeftChangeClass { get; init; } = string.Empty;
    public string RightChangeClass { get; init; } = string.Empty;
    public decimal? LeftCurrentPrice { get; init; }
    public decimal? RightCurrentPrice { get; init; }

    public string TeamLeftStyle { get; init; } = string.Empty;
    public string TeamRightStyle { get; init; } = string.Empty;
    public string LeftBetButtonStyle { get; init; } = string.Empty;
    public string RightBetButtonStyle { get; init; } = string.Empty;

    public string RemainingTime { get; init; } = string.Empty;
    public string ClockPrimary { get; init; } = string.Empty;
    public string ClockPhaseLabel { get; init; } = string.Empty;
    public string ScoreContext { get; init; } = string.Empty;
    public string CommentaryText { get; init; } = string.Empty;
    public string CommentaryMeta { get; init; } = string.Empty;

    public bool ShowBroadcastRotationGauge { get; init; }
    public int BroadcastRotationMinutes { get; init; }
    public string BroadcastRotationLabel { get; init; } = string.Empty;
    public string BroadcastRotationRemaining { get; init; } = string.Empty;
    public string BroadcastRotationTitle { get; init; } = string.Empty;
    public double BroadcastRotationProgress { get; init; }
    public double BroadcastRotationPercent { get; init; }
    public string BroadcastFocusLabel { get; init; } = string.Empty;
    public double BroadcastFocusProgress { get; init; }
    public string BroadcastFocusColor { get; init; } = string.Empty;
    public bool IsSignalStable { get; init; }
    public int Competitiveness { get; init; }

    public IReadOnlyList<TvPriceChartPoint> LeftPriceBattlePoints { get; init; } = Array.Empty<TvPriceChartPoint>();
    public IReadOnlyList<TvPriceChartPoint> RightPriceBattlePoints { get; init; } = Array.Empty<TvPriceChartPoint>();
    public bool LeftPriceBattleHasHistory { get; init; }
    public bool RightPriceBattleHasHistory { get; init; }
    public string LeftPriceBattleColor { get; init; } = string.Empty;
    public string RightPriceBattleColor { get; init; } = string.Empty;

    public string GoalLogTitle { get; init; } = string.Empty;
    public string GoalLogHeadline { get; init; } = string.Empty;
    public string GoalLogLeaderSymbol { get; init; } = string.Empty;
    public string GoalLogEmptyState { get; init; } = string.Empty;
    public IReadOnlyList<MatchScoreEventDto> RecentScoreEvents { get; init; } = Array.Empty<MatchScoreEventDto>();

    public object? FieldState { get; init; }
    public IReadOnlyList<TvStageCommentaryEntryModel> CommentaryEntries { get; init; } = Array.Empty<TvStageCommentaryEntryModel>();

    public int ArenaPressureLeftPercent { get; init; }
    public int ArenaPressureRightPercent { get; init; }
    public string ArenaPressureLeftMomentumLabel { get; init; } = string.Empty;
    public string ArenaPressureRightMomentumLabel { get; init; } = string.Empty;
    public int ArenaCurrentPressurePercent { get; init; }
    public string ArenaPressureStatusLabel { get; init; } = string.Empty;
    public string ArenaPressureDescription { get; init; } = string.Empty;
    public bool UseCompactArenaGauge { get; init; }
}

public sealed record TvStageCommentaryEntryModel(
    string Id,
    int MatchId,
    string TypeKey,
    string TypeLabel,
    string MinuteLabel,
    string Text,
    string HighlightSymbol,
    string AccentHex,
    int Priority,
    string? AudioKey,
    string? AudioUrl,
    long? AudioAssetId,
    string? NormalizedText,
    string? TextHash,
    bool AudioQueued,
    string? AudioQueueStatus,
    string? AudioQueueReason,
    AudioResolveRequest? AudioRequest,
    bool Silent,
    DateTime CreatedAtUtc,
    bool IsLatest);
