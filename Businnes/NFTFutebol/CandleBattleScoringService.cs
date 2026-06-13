using DAL.NftFutebol;
using EthicAI.EntityModel;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace BLL.NFTFutebol;

public interface ICandleBattleScoringService
{
    Task<CandleBattleScoringResult> EvaluateAsync(Match match, MatchScoreState scoreState, DateTime nowUtc, CancellationToken ct = default);
}

public sealed class CandleBattleScoringService : ICandleBattleScoringService
{
    public const int CandleBattleDominanceThreshold = 3;

    private const decimal Epsilon = 0.000001m;

    private readonly EthicAIDbContext _db;
    private readonly ILogger<CandleBattleScoringService> _logger;

    public CandleBattleScoringService(EthicAIDbContext db, ILogger<CandleBattleScoringService> logger)
    {
        _db = db;
        _logger = logger;
    }

    public async Task<CandleBattleScoringResult> EvaluateAsync(
        Match match,
        MatchScoreState scoreState,
        DateTime nowUtc,
        CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(match);
        ArgumentNullException.ThrowIfNull(scoreState);

        _logger.LogInformation("[CandleBattle] Match {MatchId}: start evaluation", match.MatchId);

        if (match.Status is not MatchStatus.Pending and not MatchStatus.Ongoing)
        {
            _logger.LogInformation(
                "[CandleBattle] Match {MatchId}: candles {LeftWins}x{RightWins}, diff={Diff}, dominanceTeam={DominanceTeamId}, previousDominance={PreviousDominanceTeamId}, action={Action}",
                match.MatchId,
                scoreState.LastCandleBattleLeftWins,
                scoreState.LastCandleBattleRightWins,
                Math.Abs(scoreState.LastCandleBattleLeftWins - scoreState.LastCandleBattleRightWins),
                FormatTeamId(scoreState.LastCandleBattleDominanceTeamId),
                FormatTeamId(scoreState.LastCandleBattleDominanceTeamId),
                "Skipped");

            return CandleBattleScoringResult.Empty(scoreState, match.ScoreA, match.ScoreB);
        }

        if (match.TeamA?.Currency is null || match.TeamB?.Currency is null)
        {
            _logger.LogInformation(
                "[CandleBattle] Match {MatchId}: candles {LeftWins}x{RightWins}, diff={Diff}, dominanceTeam={DominanceTeamId}, previousDominance={PreviousDominanceTeamId}, action={Action}",
                match.MatchId,
                scoreState.LastCandleBattleLeftWins,
                scoreState.LastCandleBattleRightWins,
                Math.Abs(scoreState.LastCandleBattleLeftWins - scoreState.LastCandleBattleRightWins),
                FormatTeamId(scoreState.LastCandleBattleDominanceTeamId),
                FormatTeamId(scoreState.LastCandleBattleDominanceTeamId),
                "Skipped");

            return CandleBattleScoringResult.Empty(scoreState, match.ScoreA, match.ScoreB);
        }

        var pairs = await LoadPairsAsync(match.MatchId, match.TeamAId, match.TeamBId, ct);
        if (pairs.Count == 0)
        {
            _logger.LogInformation(
                "[CandleBattle] Match {MatchId}: candles 0x0, diff=0, dominanceTeam=null, previousDominance=null, action=NoData",
                match.MatchId);

            return CandleBattleScoringResult.Empty(scoreState, match.ScoreA, match.ScoreB);
        }

        var bootstrapOnly = string.IsNullOrWhiteSpace(scoreState.LastCandleBattleStateKey);
        var processedAtUtc = bootstrapOnly
            ? null
            : scoreState.LastCandleBattleProcessedAtUtc;

        if (!bootstrapOnly && !processedAtUtc.HasValue)
            bootstrapOnly = true;

        var state = new WorkingState
        {
            ScoreA = match.ScoreA,
            ScoreB = match.ScoreB,
            LeftWins = bootstrapOnly ? 0 : scoreState.LastCandleBattleLeftWins,
            RightWins = bootstrapOnly ? 0 : scoreState.LastCandleBattleRightWins,
            DominanceTeamId = bootstrapOnly ? null : scoreState.LastCandleBattleDominanceTeamId,
            PreviousDominanceTeamId = bootstrapOnly ? null : scoreState.LastCandleBattleDominanceTeamId,
            PreviousCloseA = bootstrapOnly ? null : scoreState.LastCandleBattleClosePriceA,
            PreviousCloseB = bootstrapOnly ? null : scoreState.LastCandleBattleClosePriceB,
            ProcessedAtUtc = bootstrapOnly ? null : processedAtUtc
        };

        var events = new List<PendingMatchScoreEvent>();
        var lastAction = bootstrapOnly ? "InitializedNoRetroactive" : "Skipped";

        foreach (var pair in pairs)
        {
            if (state.ProcessedAtUtc.HasValue && pair.CapturedAtUtc <= state.ProcessedAtUtc.Value)
            {
                state.PreviousCloseA = pair.ClosePriceA ?? state.PreviousCloseA;
                state.PreviousCloseB = pair.ClosePriceB ?? state.PreviousCloseB;
                continue;
            }

            var candle = ResolveCandle(pair, state.PreviousCloseA, state.PreviousCloseB);
            state.PreviousCloseA = pair.ClosePriceA ?? state.PreviousCloseA;
            state.PreviousCloseB = pair.ClosePriceB ?? state.PreviousCloseB;

            if (candle.WinnerSide == CandleWinnerSide.Left)
                state.LeftWins++;
            else if (candle.WinnerSide == CandleWinnerSide.Right)
                state.RightWins++;

            var diff = Math.Abs(state.LeftWins - state.RightWins);
            var currentDominanceTeamId = ResolveDominanceTeamId(match.TeamAId, match.TeamBId, state.LeftWins, state.RightWins);
            var currentStateKey = BuildStateKey(match.MatchId, currentDominanceTeamId, state.LeftWins, state.RightWins);
            var previousDominanceTeamId = state.DominanceTeamId;
            var action = ResolveAction(
                bootstrapOnly,
                state.LeftWins,
                state.RightWins,
                previousDominanceTeamId,
                currentDominanceTeamId,
                currentStateKey,
                scoreState.LastCandleBattleStateKey);

            if (bootstrapOnly)
            {
                state.DominanceTeamId = currentDominanceTeamId;
                state.PreviousDominanceTeamId = currentDominanceTeamId;
                state.ProcessedAtUtc = pair.CapturedAtUtc;
                state.StateKey = currentStateKey;
                lastAction = action;
                continue;
            }

            if (currentDominanceTeamId is null)
            {
                if (diff == 0)
                {
                    state.DominanceTeamId = null;
                    action = "Tie";
                }
                else
                {
                    action = "Skipped";
                }
            }
            else if (currentDominanceTeamId == state.DominanceTeamId)
            {
                action = "SameDominance";
            }
            else
            {
                action = "GoalCreated";
                state.ScoreA += currentDominanceTeamId == match.TeamAId ? 1 : 0;
                state.ScoreB += currentDominanceTeamId == match.TeamBId ? 1 : 0;

                events.Add(BuildScoreEvent(match, candle, currentDominanceTeamId.Value, pair.CapturedAtUtc, state.LeftWins, state.RightWins));
                state.DominanceTeamId = currentDominanceTeamId;
                state.PreviousDominanceTeamId = currentDominanceTeamId;
            }

            state.StateKey = currentStateKey;
            state.ProcessedAtUtc = pair.CapturedAtUtc;
            lastAction = action;

            _logger.LogInformation(
                "[CandleBattle] Match {MatchId}: candles {LeftWins}x{RightWins}, diff={Diff}, dominanceTeam={DominanceTeamId}, previousDominance={PreviousDominanceTeamId}, action={Action}",
                match.MatchId,
                state.LeftWins,
                state.RightWins,
                diff,
                FormatTeamId(currentDominanceTeamId),
                FormatTeamId(previousDominanceTeamId),
                action);
        }

        if (bootstrapOnly)
        {
            state.DominanceTeamId = ResolveDominanceTeamId(match.TeamAId, match.TeamBId, state.LeftWins, state.RightWins);
            state.PreviousDominanceTeamId = state.DominanceTeamId;
            state.StateKey = BuildStateKey(match.MatchId, state.DominanceTeamId, state.LeftWins, state.RightWins);
            state.ProcessedAtUtc = pairs.Last().CapturedAtUtc;
            lastAction = "InitializedNoRetroactive";
        }

        ApplyState(scoreState, state);
        scoreState.UpdatedAtUtc = nowUtc;

        if (events.Count > 0)
        {
            match.ScoreA = state.ScoreA;
            match.ScoreB = state.ScoreB;
        }

        _logger.LogInformation(
            "[CandleBattle] Match {MatchId}: candles {LeftWins}x{RightWins}, diff={Diff}, dominanceTeam={DominanceTeamId}, previousDominance={PreviousDominanceTeamId}, action={Action}",
            match.MatchId,
            state.LeftWins,
            state.RightWins,
            Math.Abs(state.LeftWins - state.RightWins),
            FormatTeamId(state.DominanceTeamId),
            FormatTeamId(state.PreviousDominanceTeamId),
            events.Count > 0 ? "GoalCreated" : lastAction);

        return new CandleBattleScoringResult
        {
            ScoreA = state.ScoreA,
            ScoreB = state.ScoreB,
            State = scoreState,
            Events = events,
            CandleWinsA = state.LeftWins,
            CandleWinsB = state.RightWins,
            DominanceTeamId = state.DominanceTeamId,
            StateKey = state.StateKey
        };
    }

    private PendingMatchScoreEvent BuildScoreEvent(
        Match match,
        CandleResult candle,
        int teamId,
        DateTime eventTimeUtc,
        int candleWinsA,
        int candleWinsB)
    {
        var team = teamId == match.TeamAId ? match.TeamA : match.TeamB;
        var symbol = team?.Currency?.Symbol ?? string.Empty;

        return new PendingMatchScoreEvent
        {
            TeamId = teamId,
            RuleType = MatchScoringRuleType.CandleBattleDominance,
            EventType = "CANDLE_BATTLE_DOMINANCE",
            ReasonCode = "CANDLE_BATTLE_DOMINANCE",
            Points = 1,
            TeamPercentageChange = teamId == match.TeamAId ? candle.LeftDeltaPercent : candle.RightDeltaPercent,
            OpponentPercentageChange = teamId == match.TeamAId ? candle.RightDeltaPercent : candle.LeftDeltaPercent,
            MetricDelta = Math.Abs(candle.LeftDeltaPercent - candle.RightDeltaPercent),
            EventTimeUtc = eventTimeUtc,
            Description = teamId == match.TeamAId
                ? $"{symbol} abriu dominio no Candle Battle: {candleWinsA} x {candleWinsB} candles."
                : $"{symbol} abriu dominio no Candle Battle: {candleWinsA} x {candleWinsB} candles."
        };
    }

    private static string ResolveAction(
        bool bootstrapOnly,
        int leftWins,
        int rightWins,
        int? previousDominanceTeamId,
        int? currentDominanceTeamId,
        string currentStateKey,
        string? previousStateKey)
    {
        if (bootstrapOnly)
            return "InitializedNoRetroactive";

        if (string.Equals(currentStateKey, previousStateKey, StringComparison.Ordinal))
            return currentDominanceTeamId.HasValue ? "SameDominance" : "Tie";

        if (!currentDominanceTeamId.HasValue)
            return leftWins == rightWins ? "Tie" : "Skipped";

        if (previousDominanceTeamId.HasValue && previousDominanceTeamId.Value == currentDominanceTeamId.Value)
            return "SameDominance";

        return "GoalCreated";
    }

    private async Task<List<CandlePair>> LoadPairsAsync(int matchId, int teamAId, int teamBId, CancellationToken ct)
    {
        var snapshots = await _db.Set<MatchMetricSnapshot>()
            .AsNoTracking()
            .Where(x => x.MatchId == matchId)
            .OrderBy(x => x.CapturedAtUtc)
            .ThenBy(x => x.MatchMetricSnapshotId)
            .ToListAsync(ct);

        var result = new List<CandlePair>();
        var sequence = 0;

        foreach (var group in snapshots.GroupBy(x => x.CapturedAtUtc).OrderBy(x => x.Key))
        {
            var teamASnapshot = group.Where(x => x.TeamId == teamAId).OrderByDescending(x => x.MatchMetricSnapshotId).FirstOrDefault();
            var teamBSnapshot = group.Where(x => x.TeamId == teamBId).OrderByDescending(x => x.MatchMetricSnapshotId).FirstOrDefault();

            if (teamASnapshot is null || teamBSnapshot is null)
                continue;

            result.Add(new CandlePair
            {
                Sequence = sequence++,
                CapturedAtUtc = group.Key,
                ClosePriceA = teamASnapshot.LastPrice,
                ClosePriceB = teamBSnapshot.LastPrice
            });
        }

        return result;
    }

    private static CandleResult ResolveCandle(CandlePair pair, decimal? previousCloseA, decimal? previousCloseB)
    {
        var leftDelta = ComputePercentChange(previousCloseA, pair.ClosePriceA);
        var rightDelta = ComputePercentChange(previousCloseB, pair.ClosePriceB);
        var difference = leftDelta - rightDelta;

        if (Math.Abs(difference) <= Epsilon)
            return new CandleResult(leftDelta, rightDelta, CandleWinnerSide.Tie);

        return difference > 0m
            ? new CandleResult(leftDelta, rightDelta, CandleWinnerSide.Left)
            : new CandleResult(leftDelta, rightDelta, CandleWinnerSide.Right);
    }

    private static decimal ComputePercentChange(decimal? previous, decimal? current)
    {
        if (!current.HasValue)
            return 0m;

        if (!previous.HasValue || previous.Value == 0m)
            return current.Value == 0m ? 0m : current.Value * 100m;

        return ((current.Value - previous.Value) / Math.Abs(previous.Value)) * 100m;
    }

    private static int? ResolveDominanceTeamId(int teamAId, int teamBId, int leftWins, int rightWins)
    {
        var diff = Math.Abs(leftWins - rightWins);
        if (diff < CandleBattleDominanceThreshold)
            return null;

        if (leftWins > rightWins)
            return teamAId;

        if (rightWins > leftWins)
            return teamBId;

        return null;
    }

    private static string BuildStateKey(int matchId, int? dominanceTeamId, int leftWins, int rightWins)
        => $"CandleBattleDominance:{matchId}:{FormatTeamId(dominanceTeamId)}:{leftWins}:{rightWins}";

    private static string FormatTeamId(int? teamId)
        => teamId.HasValue ? teamId.Value.ToString() : "null";

    private static void ApplyState(MatchScoreState target, WorkingState source)
    {
        target.CandleBattleWinsA = source.LeftWins;
        target.CandleBattleWinsB = source.RightWins;
        target.LastCandleBattleLeaderTeamId = source.DominanceTeamId;
        target.LastCandleBattleProcessedAtUtc = source.ProcessedAtUtc;
        target.LastCandleBattleClosePriceA = source.PreviousCloseA;
        target.LastCandleBattleClosePriceB = source.PreviousCloseB;
        target.LastCandleBattleLeftWins = source.LeftWins;
        target.LastCandleBattleRightWins = source.RightWins;
        target.LastCandleBattleDominanceTeamId = source.DominanceTeamId;
        target.LastCandleBattleStateKey = source.StateKey;
    }

    private sealed record CandleResult(decimal LeftDeltaPercent, decimal RightDeltaPercent, CandleWinnerSide WinnerSide);

    private sealed class CandlePair
    {
        public int Sequence { get; init; }
        public DateTime CapturedAtUtc { get; init; }
        public decimal? ClosePriceA { get; init; }
        public decimal? ClosePriceB { get; init; }
    }

    private sealed class WorkingState
    {
        public int ScoreA { get; set; }
        public int ScoreB { get; set; }
        public int LeftWins { get; set; }
        public int RightWins { get; set; }
        public int? DominanceTeamId { get; set; }
        public int? PreviousDominanceTeamId { get; set; }
        public DateTime? ProcessedAtUtc { get; set; }
        public decimal? PreviousCloseA { get; set; }
        public decimal? PreviousCloseB { get; set; }
        public string? StateKey { get; set; }
    }

    private enum CandleWinnerSide
    {
        Left,
        Right,
        Tie
    }
}

public sealed class CandleBattleScoringResult
{
    public int ScoreA { get; init; }
    public int ScoreB { get; init; }
    public MatchScoreState State { get; init; } = null!;
    public IReadOnlyCollection<PendingMatchScoreEvent> Events { get; init; } = Array.Empty<PendingMatchScoreEvent>();
    public int CandleWinsA { get; init; }
    public int CandleWinsB { get; init; }
    public int? DominanceTeamId { get; init; }
    public string? StateKey { get; init; }

    public static CandleBattleScoringResult Empty(MatchScoreState state, int scoreA, int scoreB)
        => new()
        {
            ScoreA = scoreA,
            ScoreB = scoreB,
            State = state,
            Events = Array.Empty<PendingMatchScoreEvent>()
        };
}
