using DAL.NftFutebol;

namespace BLL.Push;

public interface IMatchAlertService
{
    string? ClassifyAlertType(MatchScoreEvent scoreEvent, MatchAlertSubscription subscription, Match match, MatchScoreState? scoreState);
    bool ShouldNotify(MatchScoreEvent scoreEvent);
    (bool isComeback, int? newLeaderTeamId) DetectComeback(MatchScoreEvent scoreEvent, Match match, MatchScoreState? scoreState);
    string BuildEventKey(MatchScoreEvent scoreEvent, string alertType);
    string BuildFinishedEventKey(int matchId);
    int? ResolveNewLeader(Match match, MatchScoreState? scoreState);
}

public sealed class MatchAlertService : IMatchAlertService
{
    private static readonly HashSet<string> NotifiableEventTypes =
    [
        "PERCENT_THRESHOLD_REACHED",
        "PERCENTAGE_CROSSOVER_UP",
        "PERCENTAGE_CROSSOVER_DOWN",
        "VOLUME_WINDOW_WINNER",
        "VOLUME_CROSSOVER_UP",
        "VOLUME_CROSSOVER_DOWN",
        "CANDLE_BATTLE_DOMINANCE",
        "CANDLE_BATTLE_LEAD_CHANGE",
        "ARENA_PRESSURE_GOAL"
    ];

    public bool ShouldNotify(MatchScoreEvent scoreEvent)
        => NotifiableEventTypes.Contains(scoreEvent.EventType);

    public string? ClassifyAlertType(
        MatchScoreEvent scoreEvent,
        MatchAlertSubscription subscription,
        Match match,
        MatchScoreState? scoreState)
    {
        if (!subscription.IsActive)
            return null;

        var (isComeback, _) = DetectComeback(scoreEvent, match, scoreState);
        var isScoreEvent = ShouldNotify(scoreEvent);

        if (isComeback && subscription.IsNotifyComeback)
            return "comeback";

        if (isScoreEvent && subscription.IsNotifyScore)
            return "score";

        return null;
    }

    public (bool isComeback, int? newLeaderTeamId) DetectComeback(
        MatchScoreEvent scoreEvent,
        Match match,
        MatchScoreState? scoreState)
    {
        if (scoreState is null)
            return (false, null);

        var scoreA = match.ScoreA;
        var scoreB = match.ScoreB;

        int? newLeader = scoreA > scoreB ? match.TeamAId
            : scoreB > scoreA ? match.TeamBId
            : null;

        if (newLeader is null)
            return (false, null);

        var previousSequence = scoreState.LastGoalEventSequence;
        var previousLeader = scoreState.LastUndisputedLeaderTeamId;

        var isFirstGoalEver = previousSequence == 0 && previousLeader is null;
        if (isFirstGoalEver)
            return (false, newLeader);

        var isLeaderChange = previousLeader.HasValue && previousLeader.Value != newLeader.Value;

        return (isLeaderChange, newLeader);
    }

    public int? ResolveNewLeader(Match match, MatchScoreState? scoreState)
    {
        if (scoreState is null)
            return null;

        var scoreA = match.ScoreA;
        var scoreB = match.ScoreB;

        if (scoreA > scoreB)
            return match.TeamAId;
        if (scoreB > scoreA)
            return match.TeamBId;

        return null;
    }

    public string BuildEventKey(MatchScoreEvent scoreEvent, string alertType)
        => $"match:{scoreEvent.MatchId}:seq:{scoreEvent.EventSequence}:{alertType}";

    public string BuildFinishedEventKey(int matchId)
        => $"match:{matchId}:finished";
}
