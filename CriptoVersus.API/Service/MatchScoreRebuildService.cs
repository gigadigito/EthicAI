using BLL.NFTFutebol;
using DAL.NftFutebol;
using EthicAI.EntityModel;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace CriptoVersus.API.Services;

public interface IMatchScoreRebuildService
{
    Task<MatchScoreRebuildResult> RebuildAsync(int matchId, CancellationToken ct);
}

public sealed class MatchScoreRebuildService : IMatchScoreRebuildService
{
    private readonly EthicAIDbContext _db;
    private readonly IMatchScoringEngine _scoringEngine;
    private readonly MatchScoreRebuildOptions _options;

    public MatchScoreRebuildService(
        EthicAIDbContext db,
        IMatchScoringEngine scoringEngine,
        IOptions<MatchScoreRebuildOptions> options)
    {
        _db = db;
        _scoringEngine = scoringEngine;
        _options = options.Value;
    }

    public async Task<MatchScoreRebuildResult> RebuildAsync(int matchId, CancellationToken ct)
    {
        var match = await _db.Set<Match>()
            .Include(x => x.TeamA).ThenInclude(x => x.Currency)
            .Include(x => x.TeamB).ThenInclude(x => x.Currency)
            .Include(x => x.ScoreState)
            .FirstOrDefaultAsync(x => x.MatchId == matchId, ct);

        if (match is null)
            throw new InvalidOperationException($"Partida {matchId} nao encontrada.");

        if (match.TeamA?.Currency is null || match.TeamB?.Currency is null)
            throw new InvalidOperationException($"Partida {matchId} sem dados completos dos times.");

        if (match.ScoringRuleType == MatchScoringRuleType.VolumeWindow)
            throw new InvalidOperationException("Reprocessamento por snapshots ainda nao suporta partidas de janela de volume.");

        var scoreState = match.ScoreState ?? new MatchScoreState
        {
            MatchId = match.MatchId,
            CreatedAtUtc = DateTime.UtcNow,
            UpdatedAtUtc = DateTime.UtcNow
        };

        if (match.ScoreState is null)
        {
            _db.MatchScoreState.Add(scoreState);
            match.ScoreState = scoreState;
        }

        var snapshots = await _db.Set<MatchMetricSnapshot>()
            .AsNoTracking()
            .Where(x => x.MatchId == matchId)
            .OrderBy(x => x.CapturedAtUtc)
            .ThenBy(x => x.MatchMetricSnapshotId)
            .ToListAsync(ct);

        var pairedSnapshots = PairSnapshots(match, snapshots);

        var existingEvents = await _db.Set<MatchScoreEvent>()
            .Where(x => x.MatchId == matchId)
            .ToListAsync(ct);

        if (existingEvents.Count > 0)
            _db.MatchScoreEvent.RemoveRange(existingEvents);

        ResetState(scoreState);
        match.ScoreA = 0;
        match.ScoreB = 0;

        TeamMetricPoint? previousTeamA = null;
        TeamMetricPoint? previousTeamB = null;
        var rebuiltEvents = 0;

        foreach (var pair in pairedSnapshots)
        {
            scoreState.LastSnapshotAtUtc = pair.CapturedAtUtc;

            var scoringResult = _scoringEngine.Evaluate(new MatchScoringContext
            {
                RuleType = match.ScoringRuleType,
                CurrentScoreA = match.ScoreA,
                CurrentScoreB = match.ScoreB,
                TeamA = pair.TeamA,
                TeamB = pair.TeamB,
                PreviousTeamA = previousTeamA,
                PreviousTeamB = previousTeamB,
                State = scoreState,
                EvaluatedAtUtc = pair.CapturedAtUtc,
                PercentThresholds = _options.PercentThresholds,
                ClosedVolumeWindows = Array.Empty<ClosedVolumeWindow>()
            });

            match.ScoreA = scoringResult.ScoreA;
            match.ScoreB = scoringResult.ScoreB;

            foreach (var scoreEvent in scoringResult.Events.OrderBy(x => x.EventTimeUtc).ThenBy(x => x.TeamId))
            {
                scoreState.LastEventSequence++;

                _db.MatchScoreEvent.Add(new MatchScoreEvent
                {
                    MatchId = match.MatchId,
                    TeamId = scoreEvent.TeamId,
                    RuleType = scoreEvent.RuleType,
                    EventType = scoreEvent.EventType,
                    ReasonCode = scoreEvent.ReasonCode,
                    Points = scoreEvent.Points,
                    EventSequence = scoreState.LastEventSequence,
                    TeamPercentageChange = scoreEvent.TeamPercentageChange,
                    OpponentPercentageChange = scoreEvent.OpponentPercentageChange,
                    TeamQuoteVolume = scoreEvent.TeamQuoteVolume,
                    OpponentQuoteVolume = scoreEvent.OpponentQuoteVolume,
                    MetricDelta = scoreEvent.MetricDelta,
                    WindowStartUtc = scoreEvent.WindowStartUtc,
                    WindowEndUtc = scoreEvent.WindowEndUtc,
                    Description = scoreEvent.Description,
                    EventTimeUtc = scoreEvent.EventTimeUtc
                });

                rebuiltEvents++;
            }

            previousTeamA = pair.TeamA;
            previousTeamB = pair.TeamB;
        }

        scoreState.UpdatedAtUtc = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);

        return new MatchScoreRebuildResult
        {
            MatchId = match.MatchId,
            RuleType = match.ScoringRuleType.ToString(),
            SnapshotPairsProcessed = pairedSnapshots.Count,
            EventsRebuilt = rebuiltEvents,
            ScoreA = match.ScoreA,
            ScoreB = match.ScoreB
        };
    }

    private static void ResetState(MatchScoreState state)
    {
        state.ThresholdsAwardedToTeamA = 0;
        state.ThresholdsAwardedToTeamB = 0;
        state.LastPercentageLeaderTeamId = null;
        state.LastVolumeLeaderTeamId = null;
        state.LastProcessedVolumeWindowStartUtc = null;
        state.LastProcessedVolumeWindowEndUtc = null;
        state.LastEventSequence = 0;
        state.LastSnapshotAtUtc = null;
    }

    private static List<SnapshotPair> PairSnapshots(Match match, IReadOnlyCollection<MatchMetricSnapshot> snapshots)
    {
        var byTime = snapshots
            .GroupBy(x => x.CapturedAtUtc)
            .OrderBy(x => x.Key)
            .ToList();

        var result = new List<SnapshotPair>(byTime.Count);

        foreach (var group in byTime)
        {
            var teamASnapshot = group
                .Where(x => x.TeamId == match.TeamAId)
                .OrderByDescending(x => x.MatchMetricSnapshotId)
                .FirstOrDefault();

            var teamBSnapshot = group
                .Where(x => x.TeamId == match.TeamBId)
                .OrderByDescending(x => x.MatchMetricSnapshotId)
                .FirstOrDefault();

            if (teamASnapshot is null || teamBSnapshot is null)
                continue;

            result.Add(new SnapshotPair
            {
                CapturedAtUtc = group.Key,
                TeamA = ToMetricPoint(teamASnapshot, match.TeamA.Currency.Symbol),
                TeamB = ToMetricPoint(teamBSnapshot, match.TeamB.Currency.Symbol)
            });
        }

        return result;
    }

    private static TeamMetricPoint ToMetricPoint(MatchMetricSnapshot snapshot, string symbol)
        => new()
        {
            TeamId = snapshot.TeamId,
            Symbol = symbol,
            PercentageChange = snapshot.PercentageChange,
            QuoteVolume = snapshot.QuoteVolume,
            TradeCount = snapshot.TradeCount
        };

    private sealed class SnapshotPair
    {
        public required DateTime CapturedAtUtc { get; init; }
        public required TeamMetricPoint TeamA { get; init; }
        public required TeamMetricPoint TeamB { get; init; }
    }
}

public sealed class MatchScoreRebuildOptions
{
    public int VolumeWindowMinutes { get; set; } = 15;
    public List<decimal> PercentThresholds { get; set; } = [2m, 8m, 16m];
}

public sealed class MatchScoreRebuildResult
{
    public int MatchId { get; init; }
    public string RuleType { get; init; } = string.Empty;
    public int SnapshotPairsProcessed { get; init; }
    public int EventsRebuilt { get; init; }
    public int ScoreA { get; init; }
    public int ScoreB { get; init; }
}
