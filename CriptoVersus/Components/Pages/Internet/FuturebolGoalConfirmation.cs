namespace CriptoVersus.Components.Pages.Internet;

public sealed record FuturebolGoalConfirmation(
    int MatchId,
    long EventId,
    string Team,
    string ScorerPlayerId,
    bool SynchronizationReplay);
