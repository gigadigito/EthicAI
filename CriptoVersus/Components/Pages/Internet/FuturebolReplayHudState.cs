namespace CriptoVersus.Components.Pages.Internet;

public sealed record FuturebolReplayHudState(
    int MatchId,
    bool Active,
    int HomeScore,
    int AwayScore,
    int TargetHomeScore,
    int TargetAwayScore);
