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
    private const decimal Epsilon = 0.000001m;

    private readonly EthicAIDbContext _db;
    private readonly ILogger<CandleBattleScoringService> _logger;

    public CandleBattleScoringService(EthicAIDbContext db, ILogger<CandleBattleScoringService> logger)
    {
        _db = db;
        _logger = logger;
    }

    public async Task<CandleBattleScoringResult> EvaluateAsync(Match match, MatchScoreState scoreState, DateTime nowUtc, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(match);
        ArgumentNullException.ThrowIfNull(scoreState);

        if (match.Status is not MatchStatus.Pending and not MatchStatus.Ongoing)
            return CandleBattleScoringResult.Empty(scoreState, match.ScoreA, match.ScoreB);

        if (match.TeamA?.Currency is null || match.TeamB?.Currency is null)
            return CandleBattleScoringResult.Empty(scoreState, match.ScoreA, match.ScoreB);

        var pairs = await LoadPairsAsync(match.MatchId, match.TeamAId, match.TeamBId, ct);
        if (pairs.Count == 0)
            return CandleBattleScoringResult.Empty(scoreState, match.ScoreA, match.ScoreB);

        var hasBaseline = scoreState.LastCandleBattleProcessedAtUtc.HasValue
            && scoreState.LastCandleBattleClosePriceA.HasValue
            && scoreState.LastCandleBattleClosePriceB.HasValue;

        var result = hasBaseline
            ? Simulate(match, scoreState, pairs, match.ScoreA, match.ScoreB, scoreState.LastCandleBattleProcessedAtUtc, emitEvents: true)
            : Simulate(match, scoreState, pairs, match.ScoreA, match.ScoreB, null, emitEvents: false);

        ApplyState(scoreState, result);
        scoreState.UpdatedAtUtc = nowUtc;

        if (result.Events.Count > 0)
        {
            match.ScoreA = result.ScoreA;
            match.ScoreB = result.ScoreB;

            foreach (var scoreEvent in result.Events)
            {
                _logger.LogInformation(
                    "[CANDLE_BATTLE_LEAD_CHANGE] matchId={MatchId} leaderTeamId={LeaderTeamId} score={ScoreA}x{ScoreB} candleWins={CandleWinsA}x{CandleWinsB} eventTimeUtc={EventTimeUtc:o} signature={Signature}",
                    match.MatchId,
                    scoreEvent.TeamId,
                    result.ScoreA,
                    result.ScoreB,
                    result.CandleWinsA,
                    result.CandleWinsB,
                    scoreEvent.EventTimeUtc,
                    BuildSignature(match.MatchId, scoreEvent.TeamId, result.CandleWinsA, result.CandleWinsB));
            }
        }

        return result;
    }

    private CandleBattleScoringResult Simulate(
        Match match,
        MatchScoreState scoreState,
        IReadOnlyList<CandleBattleSnapshotPair> pairs,
        int currentScoreA,
        int currentScoreB,
        DateTime? startFromProcessedAtUtc,
        bool emitEvents)
    {
        var scoreA = currentScoreA;
        var scoreB = currentScoreB;
        var winsA = scoreState.CandleBattleWinsA;
        var winsB = scoreState.CandleBattleWinsB;
        var leaderTeamId = scoreState.LastCandleBattleLeaderTeamId;
        var processedAtUtc = scoreState.LastCandleBattleProcessedAtUtc;
        var prevCloseA = scoreState.LastCandleBattleClosePriceA;
        var prevCloseB = scoreState.LastCandleBattleClosePriceB;
        var events = new List<PendingMatchScoreEvent>();

        foreach (var pair in pairs.OrderBy(x => x.CapturedAtUtc).ThenBy(x => x.Sequence))
        {
            if (startFromProcessedAtUtc.HasValue && pair.CapturedAtUtc <= startFromProcessedAtUtc.Value)
            {
                prevCloseA = pair.ClosePriceA ?? prevCloseA;
                prevCloseB = pair.ClosePriceB ?? prevCloseB;
                continue;
            }

            var candle = ResolveCandle(pair, prevCloseA, prevCloseB);
            prevCloseA = pair.ClosePriceA ?? prevCloseA;
            prevCloseB = pair.ClosePriceB ?? prevCloseB;

            if (candle.WinnerSide == CandleWinnerSide.Left)
                winsA++;
            else if (candle.WinnerSide == CandleWinnerSide.Right)
                winsB++;

            var currentLeader = ResolveLeader(match.TeamAId, match.TeamBId, winsA, winsB);
            processedAtUtc = pair.CapturedAtUtc;

            if (!currentLeader.HasValue)
                continue;

            if (!leaderTeamId.HasValue)
            {
                if (!emitEvents || !scoreState.LastCandleBattleProcessedAtUtc.HasValue)
                {
                    leaderTeamId = currentLeader;
                    continue;
                }
            }
            else if (currentLeader.Value == leaderTeamId.Value)
            {
                continue;
            }

            leaderTeamId = currentLeader;

            if (!emitEvents)
                continue;

            var awardedTeamId = currentLeader.Value;
            var leaderSymbol = awardedTeamId == match.TeamAId ? match.TeamA!.Currency!.Symbol : match.TeamB!.Currency!.Symbol;
            var leaderDelta = awardedTeamId == match.TeamAId ? candle.LeftDeltaPercent : candle.RightDeltaPercent;
            var opponentDelta = awardedTeamId == match.TeamAId ? candle.RightDeltaPercent : candle.LeftDeltaPercent;

            scoreA += awardedTeamId == match.TeamAId ? 1 : 0;
            scoreB += awardedTeamId == match.TeamBId ? 1 : 0;

            events.Add(new PendingMatchScoreEvent
            {
                TeamId = awardedTeamId,
                RuleType = MatchScoringRuleType.CandleBattleLeadChange,
                EventType = "CANDLE_BATTLE_LEAD_CHANGE",
                ReasonCode = "CANDLE_BATTLE_LEAD_CHANGE",
                Points = 1,
                TeamPercentageChange = awardedTeamId == match.TeamAId ? candle.LeftDeltaPercent : candle.RightDeltaPercent,
                OpponentPercentageChange = awardedTeamId == match.TeamAId ? candle.RightDeltaPercent : candle.LeftDeltaPercent,
                MetricDelta = Math.Abs(leaderDelta - opponentDelta),
                EventTimeUtc = pair.CapturedAtUtc,
                Description = $"{leaderSymbol} virou a liderança no Candle Battle: {winsA} x {winsB} candles."
            });
        }

        return new CandleBattleScoringResult
        {
            ScoreA = scoreA,
            ScoreB = scoreB,
            State = scoreState,
            Events = events,
            CandleWinsA = winsA,
            CandleWinsB = winsB,
            LastLeaderTeamId = leaderTeamId,
            LastProcessedAtUtc = processedAtUtc,
            LastClosePriceA = prevCloseA,
            LastClosePriceB = prevCloseB
        };
    }

    private static CandleCandleResult ResolveCandle(
        CandleBattleSnapshotPair pair,
        decimal? previousCloseA,
        decimal? previousCloseB)
    {
        var leftDelta = ComputePercentChange(previousCloseA, pair.ClosePriceA);
        var rightDelta = ComputePercentChange(previousCloseB, pair.ClosePriceB);
        var difference = leftDelta - rightDelta;

        if (Math.Abs(difference) <= Epsilon)
            return new CandleCandleResult(leftDelta, rightDelta, CandleWinnerSide.Tie);

        return difference > 0m
            ? new CandleCandleResult(leftDelta, rightDelta, CandleWinnerSide.Left)
            : new CandleCandleResult(leftDelta, rightDelta, CandleWinnerSide.Right);
    }

    private static decimal ComputePercentChange(decimal? previous, decimal? current)
    {
        if (!current.HasValue)
            return 0m;

        if (!previous.HasValue || previous.Value == 0m)
            return current.Value == 0m ? 0m : current.Value * 100m;

        return ((current.Value - previous.Value) / Math.Abs(previous.Value)) * 100m;
    }

    private async Task<List<CandleBattleSnapshotPair>> LoadPairsAsync(int matchId, int teamAId, int teamBId, CancellationToken ct)
    {
        var snapshots = await _db.Set<MatchMetricSnapshot>()
            .AsNoTracking()
            .Where(x => x.MatchId == matchId)
            .OrderBy(x => x.CapturedAtUtc)
            .ThenBy(x => x.MatchMetricSnapshotId)
            .ToListAsync(ct);

        var result = new List<CandleBattleSnapshotPair>();
        var sequence = 0;

        foreach (var group in snapshots.GroupBy(x => x.CapturedAtUtc).OrderBy(x => x.Key))
        {
            var teamASnapshot = group
                .Where(x => x.TeamId == teamAId)
                .OrderByDescending(x => x.MatchMetricSnapshotId)
                .FirstOrDefault();

            var teamBSnapshot = group
                .Where(x => x.TeamId == teamBId)
                .OrderByDescending(x => x.MatchMetricSnapshotId)
                .FirstOrDefault();

            if (teamASnapshot is null || teamBSnapshot is null)
                continue;

            result.Add(new CandleBattleSnapshotPair
            {
                Sequence = sequence++,
                CapturedAtUtc = group.Key,
                ClosePriceA = teamASnapshot.LastPrice,
                ClosePriceB = teamBSnapshot.LastPrice
            });
        }

        return result;
    }

    private static int? ResolveLeader(int teamAId, int teamBId, int winsA, int winsB)
    {
        if (winsA == winsB)
            return null;

        return winsA > winsB ? teamAId : teamBId;
    }

    private static void ApplyState(MatchScoreState state, CandleBattleScoringResult result)
    {
        state.CandleBattleWinsA = result.CandleWinsA;
        state.CandleBattleWinsB = result.CandleWinsB;
        state.LastCandleBattleLeaderTeamId = result.LastLeaderTeamId;
        state.LastCandleBattleProcessedAtUtc = result.LastProcessedAtUtc;
        state.LastCandleBattleClosePriceA = result.LastClosePriceA;
        state.LastCandleBattleClosePriceB = result.LastClosePriceB;
    }

    private static string BuildSignature(int matchId, int leaderTeamId, int candleWinsA, int candleWinsB)
        => $"CandleBattleLeadChange:{matchId}:{leaderTeamId}:{candleWinsA}:{candleWinsB}";

    private sealed record CandleCandleResult(decimal LeftDeltaPercent, decimal RightDeltaPercent, CandleWinnerSide WinnerSide);

    private sealed class CandleBattleSnapshotPair
    {
        public int Sequence { get; init; }
        public DateTime CapturedAtUtc { get; init; }
        public decimal? ClosePriceA { get; init; }
        public decimal? ClosePriceB { get; init; }
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
    public bool Initialized { get; init; }
    public int ScoreA { get; init; }
    public int ScoreB { get; init; }
    public MatchScoreState State { get; init; } = null!;
    public IReadOnlyCollection<PendingMatchScoreEvent> Events { get; init; } = Array.Empty<PendingMatchScoreEvent>();
    public int CandleWinsA { get; init; }
    public int CandleWinsB { get; init; }
    public int? LastLeaderTeamId { get; init; }
    public DateTime? LastProcessedAtUtc { get; init; }
    public decimal? LastClosePriceA { get; init; }
    public decimal? LastClosePriceB { get; init; }

    public static CandleBattleScoringResult Empty(MatchScoreState state, int scoreA, int scoreB)
        => new()
        {
            State = state,
            ScoreA = scoreA,
            ScoreB = scoreB
        };
}
