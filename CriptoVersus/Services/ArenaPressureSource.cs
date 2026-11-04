using DTOs;

namespace CriptoVersus.Web.Services;

/// <summary>
/// Single owner of the Arena Pressure percentage shown by the Match Arena gauge.
/// The TV stage gauge and the Arena Pressure game both resolve their value here, so
/// the same match and the same instant always render the same pressure.
/// </summary>
public static class ArenaPressureSource
{
    /// <summary>
    /// Maximum number of samples pushed to the Arena Pressure replay. Keeps the
    /// interop payload small without flattening the real history.
    /// </summary>
    public const int MaxHistorySamples = 240;

    /// <summary>
    /// Normalizes a field-state possession pair exactly the way the Match Arena gauge does.
    /// </summary>
    public static (int Left, int Right) GetPair(TvFieldStateDto? fieldState)
        => fieldState is null
            ? (50, 50)
            : NormalizePair(fieldState.PossessionA, fieldState.PossessionB);

    /// <summary>
    /// Resolves the pressure pair straight from a match state. Identical to the value the
    /// gauge derives from the equivalent field state, without building player positions.
    /// </summary>
    public static (int Left, int Right) GetPair(MatchDto? match, TvHotMatchDto? hotMatch)
    {
        var inputs = TvFieldPositionService.BuildPossessionInputs(match, hotMatch);
        return NormalizePair(inputs.PossessionA, inputs.PossessionB);
    }

    /// <summary>
    /// Same normalization rule as the gauge: clamp to 0..100, rebalance to an exact
    /// 100% split and fall back to 50/50 when both sides are empty.
    /// </summary>
    public static (int Left, int Right) NormalizePair(int possessionA, int possessionB)
    {
        var left = Math.Clamp(possessionA, 0, 100);
        var right = Math.Clamp(possessionB, 0, 100);
        var total = left + right;
        if (total <= 0)
            return (50, 50);

        var normalizedLeft = (int)Math.Round((left / (double)total) * 100d, MidpointRounding.AwayFromZero);
        normalizedLeft = Math.Clamp(normalizedLeft, 0, 100);
        return (normalizedLeft, 100 - normalizedLeft);
    }

    /// <summary>
    /// Rebuilds the pressure evolution of a match from its real recorded history
    /// (score events and metric snapshots). Every sample is produced by the same
    /// possession composition the Match Arena uses, fed only with values that were
    /// actually recorded; nothing is simulated.
    /// </summary>
    /// <remarks>
    /// Live-only hot match enrichment (hot score, momentum and pressure labels) is not
    /// persisted, so historical samples resolve those inputs through the same fallbacks
    /// the field state already defines. The last sample is always pinned to the current
    /// authoritative pair so a finished match ends on its real final state.
    /// </remarks>
    public static IReadOnlyList<ArenaPressureHistoryPoint> BuildHistory(
        MatchDto match,
        IReadOnlyList<MatchScoreEventDto>? events,
        IReadOnlyList<MatchMetricSnapshotDto>? snapshots)
    {
        ArgumentNullException.ThrowIfNull(match);

        var final = GetPair(match, hotMatch: null);
        var scored = (events ?? [])
            .Where(x => x is not null)
            .OrderBy(x => x.EventSequence)
            .ThenBy(x => x.MatchScoreEventId)
            .ToList();

        var captured = (snapshots ?? [])
            .Where(x => x is not null)
            .OrderBy(x => x.CapturedAtUtc)
            .ThenBy(x => x.MatchMetricSnapshotId)
            .ToList();

        var startUtc = ResolveStartUtc(match, scored, captured);
        var endUtc = ResolveEndUtc(match, scored, captured);
        if (endUtc < startUtc)
            endUtc = startUtc;

        var hasHistory = (scored.Count + captured.Count) >= 2;
        if (!hasHistory)
            return [new ArenaPressureHistoryPoint(0d, final.Left)];

        // Score events are the real record of how the score evolved. When the recorded
        // totals drift from the persisted score (the API already reports that case), the
        // running score keeps the real event shape but is anchored so the final sample
        // still equals the persisted final state.
        var eventRows = new List<ScoreRow>(scored.Count);
        var totalsA = 0;
        var totalsB = 0;
        foreach (var scoreEvent in scored)
        {
            var isTeamA = ResolveIsTeamA(scoreEvent, match);
            var eventPoints = Math.Max(0, scoreEvent.Points);
            if (isTeamA) totalsA += eventPoints;
            else totalsB += eventPoints;
            eventRows.Add(new ScoreRow(AsUtc(scoreEvent.EventTimeUtc), isTeamA, eventPoints));
        }

        var baseA = Math.Max(0, match.ScoreA - totalsA);
        var baseB = Math.Max(0, match.ScoreB - totalsB);

        var variationA = BuildVariationSeries(match.TeamA, match.PctA, captured, scored);
        var variationB = BuildVariationSeries(match.TeamB, match.PctB, captured, scored);

        var stamps = new SortedSet<double>();
        foreach (var row in eventRows)
            stamps.Add(ToSeconds(startUtc, ClampToRange(row.AtUtc, startUtc, endUtc)));
        foreach (var snapshot in captured)
            stamps.Add(ToSeconds(startUtc, ClampToRange(AsUtc(snapshot.CapturedAtUtc), startUtc, endUtc)));
        stamps.Add(0d);
        stamps.Add(ToSeconds(startUtc, endUtc));

        var points = new List<ArenaPressureHistoryPoint>(Math.Min(stamps.Count, MaxHistorySamples));
        var runningA = baseA;
        var runningB = baseB;
        var eventIndex = 0;

        foreach (var seconds in stamps)
        {
            var atUtc = startUtc.AddSeconds(seconds);
            while (eventIndex < eventRows.Count && eventRows[eventIndex].AtUtc <= atUtc)
            {
                if (eventRows[eventIndex].IsTeamA) runningA += eventRows[eventIndex].Points;
                else runningB += eventRows[eventIndex].Points;
                eventIndex++;
            }

            var pctA = variationA.Resolve(atUtc);
            var pctB = variationB.Resolve(atUtc);

            // Same composition as the Match Arena gauge: no hot match exists for a
            // historical instant, so the documented fallbacks apply unchanged.
            var identity = TvFieldPositionService.BuildPossessionInputs(
                match.TeamA,
                match.TeamB,
                runningA,
                runningB,
                pctA,
                pctB,
                hotMatch: null);
            var pair = NormalizePair(identity.PossessionA, identity.PossessionB);
            points.Add(new ArenaPressureHistoryPoint(Math.Round(seconds, 3), pair.Left));
        }

        if (points.Count == 0)
            return [new ArenaPressureHistoryPoint(0d, final.Left)];

        // Pin the last sample to the authoritative current state so the replay ends on
        // exactly what the Match Arena shows for this match right now.
        var last = points[^1];
        points[^1] = last with { LeftPercent = final.Left };

        return Decimate(points, MaxHistorySamples);
    }

    private static bool ResolveIsTeamA(MatchScoreEventDto scoreEvent, MatchDto match)
    {
        if (scoreEvent.TeamId != 0 && match.TeamAId != 0 && match.TeamBId != 0)
            return scoreEvent.TeamId == match.TeamAId;

        return string.Equals(scoreEvent.TeamSymbol, match.TeamA, StringComparison.OrdinalIgnoreCase);
    }

    private static DateTime ResolveStartUtc(
        MatchDto match,
        IReadOnlyList<MatchScoreEventDto> events,
        IReadOnlyList<MatchMetricSnapshotDto> snapshots)
    {
        if (match.StartTime is { } startTime)
            return AsUtc(startTime);

        var candidates = new List<DateTime>(events.Count + snapshots.Count);
        candidates.AddRange(events.Select(x => AsUtc(x.EventTimeUtc)));
        candidates.AddRange(snapshots.Select(x => AsUtc(x.CapturedAtUtc)));

        return candidates.Count > 0 ? candidates.Min() : DateTime.UtcNow;
    }

    private static DateTime ResolveEndUtc(
        MatchDto match,
        IReadOnlyList<MatchScoreEventDto> events,
        IReadOnlyList<MatchMetricSnapshotDto> snapshots)
    {
        if (match.EndTime is { } endTime)
            return AsUtc(endTime);

        var candidates = new List<DateTime>(events.Count + snapshots.Count);
        candidates.AddRange(events.Select(x => AsUtc(x.EventTimeUtc)));
        candidates.AddRange(snapshots.Select(x => AsUtc(x.CapturedAtUtc)));

        return candidates.Count > 0 ? candidates.Max() : ResolveStartUtc(match, events, snapshots);
    }

    /// <summary>
    /// Normalizes transport timestamps to UTC. Unspecified kinds are already UTC in this
    /// schema (PostgreSQL <c>timestamptz</c>), so they are re-tagged instead of shifted.
    /// </summary>
    private static DateTime AsUtc(DateTime value) => value.Kind switch
    {
        DateTimeKind.Utc => value,
        DateTimeKind.Local => value.ToUniversalTime(),
        _ => DateTime.SpecifyKind(value, DateTimeKind.Utc)
    };

    private static DateTime ClampToRange(DateTime value, DateTime startUtc, DateTime endUtc)
    {
        var utc = AsUtc(value);
        if (utc < startUtc) return startUtc;
        if (utc > endUtc) return endUtc;
        return utc;
    }

    private static double ToSeconds(DateTime startUtc, DateTime value)
    {
        var seconds = (AsUtc(value) - startUtc).TotalSeconds;
        return seconds < 0d ? 0d : seconds;
    }

    private static VariationSeries BuildVariationSeries(
        string teamSymbol,
        decimal? fallback,
        IReadOnlyList<MatchMetricSnapshotDto> snapshots,
        IReadOnlyList<MatchScoreEventDto> events)
    {
        var samples = new List<VariationSample>(snapshots.Count + events.Count);

        foreach (var snapshot in snapshots)
        {
            if (string.Equals(snapshot.TeamSymbol, teamSymbol, StringComparison.OrdinalIgnoreCase))
                samples.Add(new VariationSample(AsUtc(snapshot.CapturedAtUtc), snapshot.PercentageChange));
        }

        foreach (var scoreEvent in events)
        {
            // An event recorded for this team carries this team's change in
            // TeamPercentageChange; for the opponent's event the same team appears in
            // OpponentPercentageChange. Both are real recorded values.
            var belongsToTeam = string.Equals(scoreEvent.TeamSymbol, teamSymbol, StringComparison.OrdinalIgnoreCase);
            var value = belongsToTeam ? scoreEvent.TeamPercentageChange : scoreEvent.OpponentPercentageChange;
            if (value is null)
                continue;

            samples.Add(new VariationSample(AsUtc(scoreEvent.EventTimeUtc), value.Value));
        }

        return new VariationSeries(fallback, samples);
    }

    private static IReadOnlyList<ArenaPressureHistoryPoint> Decimate(
        IReadOnlyList<ArenaPressureHistoryPoint> points,
        int maxSamples)
    {
        if (points.Count <= maxSamples)
            return points;

        var result = new List<ArenaPressureHistoryPoint>(maxSamples) { points[0] };
        var step = (points.Count - 1) / (double)(maxSamples - 1);
        for (var i = 1; i < maxSamples - 1; i++)
            result.Add(points[(int)Math.Round(i * step)]);
        result.Add(points[^1]);
        return result;
    }

    private readonly record struct ScoreRow(DateTime AtUtc, bool IsTeamA, int Points);

    private readonly record struct VariationSample(DateTime AtUtc, decimal Pct);

    private sealed class VariationSeries
    {
        private readonly decimal? _fallback;
        private readonly List<VariationSample> _samples;

        public VariationSeries(decimal? fallback, List<VariationSample> samples)
        {
            _fallback = fallback;
            _samples = samples.OrderBy(x => x.AtUtc).ToList();
        }

        public decimal? Resolve(DateTime atUtc)
        {
            if (_samples.Count == 0)
                return _fallback;

            decimal? current = null;
            foreach (var sample in _samples)
            {
                if (sample.AtUtc > atUtc)
                    break;
                current = sample.Pct;
            }

            return current ?? _samples[0].Pct;
        }
    }
}

/// <summary>
/// One reconstructed Arena Pressure sample. <see cref="SecondsFromStart"/> is relative to
/// the match start so the game can replay it against a clock.
/// </summary>
public sealed record ArenaPressureHistoryPoint(double SecondsFromStart, int LeftPercent);
