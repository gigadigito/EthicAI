using DTOs;

namespace CriptoVersus.Web.Services;

public enum CandleBattleV2Side
{
    None,
    Left,
    Right
}

public enum CandleBattleV2AnimationPhase
{
    Ready,
    Entering,
    Collision,
    Result,
    DropBlock,
    Complete
}

public sealed record CandleBattleV2PointAnimation(
    long EventId,
    int EventSequence,
    int PointIndex,
    CandleBattleV2Side Winner,
    decimal? LeftDeltaPercent,
    decimal? RightDeltaPercent,
    DateTime EventTimeUtc);

public sealed record CandleBattleV2OfficialState(
    int TeamAId,
    int TeamBId,
    int ScoreLeft,
    int ScoreRight,
    string Status,
    bool IsFinished,
    DateTime? EndTime);

public sealed class CandleBattleV2StateAdapter
{
    private const string CandleBattleEventType = "CANDLE_BATTLE_DOMINANCE";
    private readonly Queue<CandleBattleV2PointAnimation> _animationQueue = new();
    private readonly HashSet<long> _seenEventIds = [];
    private CandleBattleV2PointAnimation? _activeAnimation;

    public int OfficialScoreLeft { get; private set; }
    public int OfficialScoreRight { get; private set; }
    public int DisplayScoreLeft { get; private set; }
    public int DisplayScoreRight { get; private set; }
    public int TeamAId { get; private set; }
    public int TeamBId { get; private set; }
    public bool IsFinished { get; private set; }
    public bool IsBootstrapped { get; private set; }
    public int PendingAnimationCount => _animationQueue.Count + (_activeAnimation is null ? 0 : 1);
    public CandleBattleV2PointAnimation? ActiveAnimation => _activeAnimation;

    public void Bootstrap(CandleBattleV2OfficialState match, IEnumerable<MatchScoreEventDto> existingEvents)
    {
        ArgumentNullException.ThrowIfNull(match);
        ArgumentNullException.ThrowIfNull(existingEvents);

        TeamAId = match.TeamAId;
        TeamBId = match.TeamBId;
        OfficialScoreLeft = Math.Max(0, match.ScoreLeft);
        OfficialScoreRight = Math.Max(0, match.ScoreRight);
        DisplayScoreLeft = OfficialScoreLeft;
        DisplayScoreRight = OfficialScoreRight;
        IsFinished = IsTerminal(match);
        IsBootstrapped = true;

        _animationQueue.Clear();
        _activeAnimation = null;
        _seenEventIds.Clear();
        Remember(existingEvents);
    }

    public int MergeLive(CandleBattleV2OfficialState match, IEnumerable<MatchScoreEventDto> events)
    {
        ArgumentNullException.ThrowIfNull(match);
        ArgumentNullException.ThrowIfNull(events);

        if (!IsBootstrapped || TeamAId != match.TeamAId || TeamBId != match.TeamBId)
        {
            Bootstrap(match, events);
            return 0;
        }

        OfficialScoreLeft = Math.Max(0, match.ScoreLeft);
        OfficialScoreRight = Math.Max(0, match.ScoreRight);
        IsFinished = IsTerminal(match);

        var ordered = events
            .OrderBy(x => x.EventSequence)
            .ThenBy(x => x.MatchScoreEventId)
            .ToArray();

        if (IsFinished)
        {
            Remember(ordered);
            ReconcileScores(clearSeenEvents: false);
            return 0;
        }

        var projectedLeft = DisplayScoreLeft + CountPending(CandleBattleV2Side.Left);
        var projectedRight = DisplayScoreRight + CountPending(CandleBattleV2Side.Right);
        var accepted = 0;

        foreach (var scoreEvent in ordered)
        {
            if (scoreEvent.MatchScoreEventId <= 0 || !_seenEventIds.Add(scoreEvent.MatchScoreEventId))
                continue;

            if (!scoreEvent.EventType.Equals(CandleBattleEventType, StringComparison.OrdinalIgnoreCase))
                continue;

            var winner = scoreEvent.TeamId == TeamAId
                ? CandleBattleV2Side.Left
                : scoreEvent.TeamId == TeamBId
                    ? CandleBattleV2Side.Right
                    : CandleBattleV2Side.None;

            if (winner == CandleBattleV2Side.None || scoreEvent.Points <= 0)
                continue;

            var leftDelta = winner == CandleBattleV2Side.Left
                ? scoreEvent.TeamPercentageChange
                : scoreEvent.OpponentPercentageChange;
            var rightDelta = winner == CandleBattleV2Side.Right
                ? scoreEvent.TeamPercentageChange
                : scoreEvent.OpponentPercentageChange;

            for (var pointIndex = 0; pointIndex < scoreEvent.Points; pointIndex++)
            {
                if (winner == CandleBattleV2Side.Left)
                {
                    if (projectedLeft >= OfficialScoreLeft)
                        break;
                    projectedLeft++;
                }
                else
                {
                    if (projectedRight >= OfficialScoreRight)
                        break;
                    projectedRight++;
                }

                _animationQueue.Enqueue(new CandleBattleV2PointAnimation(
                    scoreEvent.MatchScoreEventId,
                    scoreEvent.EventSequence,
                    pointIndex,
                    winner,
                    leftDelta,
                    rightDelta,
                    scoreEvent.EventTimeUtc));
                accepted++;
            }
        }

        if (_activeAnimation is null && _animationQueue.Count == 0)
            ReconcileScores(clearSeenEvents: false);

        return accepted;
    }

    public bool TryStartNext(out CandleBattleV2PointAnimation? animation)
    {
        if (IsFinished || _activeAnimation is not null || !_animationQueue.TryDequeue(out animation))
        {
            animation = null;
            return false;
        }

        _activeAnimation = animation;
        return true;
    }

    public void CompleteActive()
    {
        if (_activeAnimation is null)
            return;

        if (_activeAnimation.Winner == CandleBattleV2Side.Left)
            DisplayScoreLeft = Math.Min(OfficialScoreLeft, DisplayScoreLeft + 1);
        else if (_activeAnimation.Winner == CandleBattleV2Side.Right)
            DisplayScoreRight = Math.Min(OfficialScoreRight, DisplayScoreRight + 1);

        _activeAnimation = null;

        if (_animationQueue.Count == 0)
            ReconcileScores(clearSeenEvents: false);
    }

    public void Reconcile(CandleBattleV2OfficialState match, IEnumerable<MatchScoreEventDto> events)
    {
        ArgumentNullException.ThrowIfNull(match);
        ArgumentNullException.ThrowIfNull(events);

        TeamAId = match.TeamAId;
        TeamBId = match.TeamBId;
        OfficialScoreLeft = Math.Max(0, match.ScoreLeft);
        OfficialScoreRight = Math.Max(0, match.ScoreRight);
        IsFinished = IsTerminal(match);
        IsBootstrapped = true;
        Remember(events);
        ReconcileScores(clearSeenEvents: false);
    }

    private int CountPending(CandleBattleV2Side side)
    {
        var count = _animationQueue.Count(x => x.Winner == side);
        if (_activeAnimation?.Winner == side)
            count++;
        return count;
    }

    private void Remember(IEnumerable<MatchScoreEventDto> events)
    {
        foreach (var scoreEvent in events)
        {
            if (scoreEvent.MatchScoreEventId > 0)
                _seenEventIds.Add(scoreEvent.MatchScoreEventId);
        }
    }

    private void ReconcileScores(bool clearSeenEvents)
    {
        _animationQueue.Clear();
        _activeAnimation = null;
        DisplayScoreLeft = OfficialScoreLeft;
        DisplayScoreRight = OfficialScoreRight;
        if (clearSeenEvents)
            _seenEventIds.Clear();
    }

    private static bool IsTerminal(CandleBattleV2OfficialState match)
        => match.IsFinished
           || match.EndTime.HasValue
           || match.Status.Equals("Completed", StringComparison.OrdinalIgnoreCase)
           || match.Status.Equals("Cancelled", StringComparison.OrdinalIgnoreCase)
           || match.Status.Equals("Finished", StringComparison.OrdinalIgnoreCase);
}
