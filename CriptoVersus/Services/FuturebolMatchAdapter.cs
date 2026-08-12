using DTOs;

namespace CriptoVersus.Web.Services;

public sealed class FuturebolMatchAdapter
{
    public FuturebolMatchPresentationModel Build(
        MatchDto match,
        TvHotMatchDto? hotMatch,
        IReadOnlyCollection<MatchMetricSnapshotDto> snapshots,
        IEnumerable<MatchScoreEventDto> scoreEvents,
        DateTime? observedAtUtc = null)
    {
        ArgumentNullException.ThrowIfNull(match);
        ArgumentNullException.ThrowIfNull(snapshots);
        ArgumentNullException.ThrowIfNull(scoreEvents);

        var observedUtc = AsUtc(observedAtUtc ?? DateTime.UtcNow);
        var homeSymbol = NormalizeSymbol(match.TeamA, "HOME");
        var awaySymbol = NormalizeSymbol(match.TeamB, "AWAY");
        var matchingHotMatch = hotMatch is { HasMatch: true } && hotMatch.MatchId == match.MatchId ? hotMatch : null;
        var home = new FuturebolTeamPresentationModel(
            match.TeamAId,
            homeSymbol,
            ResolveText(matchingHotMatch?.LeftName, homeSymbol),
            ResolveLogoUrl(matchingHotMatch?.LeftLogoUrl, homeSymbol));
        var away = new FuturebolTeamPresentationModel(
            match.TeamBId,
            awaySymbol,
            ResolveText(matchingHotMatch?.RightName, awaySymbol),
            ResolveLogoUrl(matchingHotMatch?.RightLogoUrl, awaySymbol));
        var market = BuildMarketSnapshot(match, snapshots, homeSymbol, awaySymbol, observedUtc);
        var official = BuildOfficialMatchState(match, scoreEvents, observedUtc);

        return new FuturebolMatchPresentationModel(
            match.MatchId,
            home,
            away,
            market,
            official,
            new FuturebolMatchClockModel(
                ToUtcString(match.StartTime),
                ToUtcString(match.EndTime),
                official.ElapsedSeconds,
                Math.Max(0, matchingHotMatch?.RemainingSeconds ?? match.RemainingMinutes * 60),
                official.IsFinished),
            new FuturebolMatchResultModel(
                match.WinnerTeamId,
                match.WinnerTeamSymbol,
                match.EndReasonCode,
                match.EndReasonDetail));
    }

    public FuturebolMarketSnapshotModel BuildMarketSnapshot(
        MatchDto match,
        IReadOnlyCollection<MatchMetricSnapshotDto> snapshots,
        DateTime? observedAtUtc = null)
        => BuildMarketSnapshot(
            match,
            snapshots,
            NormalizeSymbol(match.TeamA, "HOME"),
            NormalizeSymbol(match.TeamB, "AWAY"),
            AsUtc(observedAtUtc ?? DateTime.UtcNow));

    public FuturebolOfficialMatchStateModel BuildOfficialMatchState(
        MatchDto match,
        IEnumerable<MatchScoreEventDto> scoreEvents,
        DateTime? observedAtUtc = null)
    {
        var observedUtc = AsUtc(observedAtUtc ?? DateTime.UtcNow);
        var events = scoreEvents
            .Where(scoreEvent => scoreEvent.MatchId == 0 || scoreEvent.MatchId == match.MatchId)
            .Where(scoreEvent => scoreEvent.Points > 0)
            .Select(scoreEvent => new { Event = scoreEvent, Team = ResolveOfficialEventTeam(match, scoreEvent) })
            .Where(item => item.Team is not null)
            .OrderBy(item => item.Event.EventSequence)
            .ThenBy(item => item.Event.MatchScoreEventId)
            .Select(item => new FuturebolOfficialScoreEventModel(
                item.Event.MatchScoreEventId,
                item.Event.EventSequence,
                item.Team!,
                item.Event.Points,
                item.Event.EventType,
                AsUtc(item.Event.EventTimeUtc).ToString("O")))
            .ToArray();
        var eventSequence = events.Length == 0 ? 0 : events.Max(scoreEvent => scoreEvent.Sequence);

        return new FuturebolOfficialMatchStateModel(
            match.MatchId,
            Math.Max(match.ScoreVersion, eventSequence),
            match.Status,
            Math.Max(0, match.ScoreA),
            Math.Max(0, match.ScoreB),
            ResolveOfficialElapsedSeconds(match, observedUtc),
            match.IsFinished,
            observedUtc.ToString("O"),
            events);
    }

    private static FuturebolMarketSnapshotModel BuildMarketSnapshot(
        MatchDto match,
        IReadOnlyCollection<MatchMetricSnapshotDto> snapshots,
        string homeSymbol,
        string awaySymbol,
        DateTime observedUtc)
    {
        var relevantSnapshots = snapshots
            .Where(snapshot => snapshot.MatchId == 0 || snapshot.MatchId == match.MatchId)
            .ToArray();
        var homeLatest = ResolveLatestSnapshot(relevantSnapshots, match.TeamAId, match.TeamA);
        var awayLatest = ResolveLatestSnapshot(relevantSnapshots, match.TeamBId, match.TeamB);
        var homeChange = homeLatest?.PercentageChange ?? match.PctA ?? 0m;
        var awayChange = awayLatest?.PercentageChange ?? match.PctB ?? 0m;
        var momentumDifference = Math.Clamp((homeChange - awayChange) * 8m, -100m, 100m);
        var homeVolume = homeLatest?.QuoteVolume ?? match.QuoteVolumeA ?? 0m;
        var awayVolume = awayLatest?.QuoteVolume ?? match.QuoteVolumeB ?? 0m;
        var totalVolume = homeVolume + awayVolume;
        var newestSnapshot = relevantSnapshots
            .OrderByDescending(snapshot => snapshot.CapturedAtUtc)
            .ThenByDescending(snapshot => snapshot.MatchMetricSnapshotId)
            .FirstOrDefault();

        return new FuturebolMarketSnapshotModel(
            relevantSnapshots.Length == 0 ? Math.Max(0, match.ScoreVersion) : relevantSnapshots.Max(snapshot => snapshot.MatchMetricSnapshotId),
            AsUtc(newestSnapshot?.CapturedAtUtc ?? match.ScoreUpdatedAtUtc ?? observedUtc).ToString("O"),
            new FuturebolAssetStateModel(
                homeSymbol,
                decimal.ToDouble(homeLatest?.LastPrice ?? 0m),
                decimal.ToDouble(homeChange),
                decimal.ToDouble(50m + momentumDifference / 2m),
                decimal.ToDouble(totalVolume > 0m ? Math.Clamp(homeVolume / totalVolume * 100m, 0m, 100m) : 50m)),
            new FuturebolAssetStateModel(
                awaySymbol,
                decimal.ToDouble(awayLatest?.LastPrice ?? 0m),
                decimal.ToDouble(awayChange),
                decimal.ToDouble(50m - momentumDifference / 2m),
                decimal.ToDouble(totalVolume > 0m ? Math.Clamp(awayVolume / totalVolume * 100m, 0m, 100m) : 50m)));
    }

    private static MatchMetricSnapshotDto? ResolveLatestSnapshot(IEnumerable<MatchMetricSnapshotDto> snapshots, int teamId, string symbol)
    {
        var normalizedSymbol = symbol.Trim().ToUpperInvariant();
        return snapshots
            .Where(snapshot =>
                (teamId > 0 && snapshot.TeamId == teamId)
                || string.Equals(snapshot.TeamSymbol.Trim(), normalizedSymbol, StringComparison.OrdinalIgnoreCase))
            .OrderByDescending(snapshot => snapshot.CapturedAtUtc)
            .ThenByDescending(snapshot => snapshot.MatchMetricSnapshotId)
            .FirstOrDefault();
    }

    private static string? ResolveOfficialEventTeam(MatchDto match, MatchScoreEventDto scoreEvent)
    {
        if (match.TeamAId > 0 && scoreEvent.TeamId == match.TeamAId)
            return "home";
        if (match.TeamBId > 0 && scoreEvent.TeamId == match.TeamBId)
            return "away";
        if (string.Equals(scoreEvent.TeamSymbol.Trim(), match.TeamA.Trim(), StringComparison.OrdinalIgnoreCase))
            return "home";
        return string.Equals(scoreEvent.TeamSymbol.Trim(), match.TeamB.Trim(), StringComparison.OrdinalIgnoreCase) ? "away" : null;
    }

    private static int ResolveOfficialElapsedSeconds(MatchDto match, DateTime observedAtUtc)
    {
        var fallbackSeconds = Math.Max(0, match.ElapsedMinutes) * 60;
        if (!match.StartTime.HasValue)
            return fallbackSeconds;

        var startUtc = AsUtc(match.StartTime.Value);
        DateTime referenceUtc;
        if (match.IsFinished)
        {
            if (!match.EndTime.HasValue)
                return fallbackSeconds;
            referenceUtc = AsUtc(match.EndTime.Value);
        }
        else if (string.Equals(match.Status, "Ongoing", StringComparison.OrdinalIgnoreCase))
        {
            referenceUtc = observedAtUtc;
        }
        else
        {
            return fallbackSeconds;
        }

        return Math.Max(fallbackSeconds, (int)Math.Floor(Math.Max(0, (referenceUtc - startUtc).TotalSeconds)));
    }

    private static string NormalizeSymbol(string? symbol, string fallback)
    {
        var normalized = EnvironmentIsolationGuard.NormalizeBinanceIconSymbol(symbol);
        if (!string.IsNullOrWhiteSpace(normalized))
            return normalized;
        normalized = EnvironmentIsolationGuard.NormalizeBinanceIconSymbol(fallback);
        return string.IsNullOrWhiteSpace(normalized) ? "?" : normalized;
    }

    private static string ResolveText(string? value, string fallback)
        => string.IsNullOrWhiteSpace(value) ? fallback : value.Trim();

    private static string? ResolveLogoUrl(string? value, string symbol)
        => string.IsNullOrWhiteSpace(value) ? EnvironmentIsolationGuard.BuildBinanceIconUrl(symbol) : value.Trim();

    private static string? ToUtcString(DateTime? value)
        => value.HasValue ? AsUtc(value.Value).ToString("O") : null;

    private static DateTime AsUtc(DateTime value)
        => value.Kind switch
        {
            DateTimeKind.Utc => value,
            DateTimeKind.Local => value.ToUniversalTime(),
            _ => DateTime.SpecifyKind(value, DateTimeKind.Utc)
        };
}

public sealed record FuturebolMatchPresentationModel(int MatchId, FuturebolTeamPresentationModel HomeTeam, FuturebolTeamPresentationModel AwayTeam, FuturebolMarketSnapshotModel Market, FuturebolOfficialMatchStateModel Official, FuturebolMatchClockModel Clock, FuturebolMatchResultModel Result);
public sealed record FuturebolTeamPresentationModel(int TeamId, string Symbol, string Name, string? LogoUrl);
public sealed record FuturebolMarketSnapshotModel(long Sequence, string Timestamp, FuturebolAssetStateModel Home, FuturebolAssetStateModel Away);
public sealed record FuturebolAssetStateModel(string Symbol, double Price, double ChangePercent, double Momentum, double VolumeStrength);
public sealed record FuturebolOfficialMatchStateModel(int MatchId, int Sequence, string Status, int HomeScore, int AwayScore, int ElapsedSeconds, bool IsFinished, string ObservedAtUtc, IReadOnlyList<FuturebolOfficialScoreEventModel> ScoreEvents);
public sealed record FuturebolOfficialScoreEventModel(long Id, int Sequence, string Team, int Points, string EventType, string OccurredAtUtc);
public sealed record FuturebolMatchClockModel(string? StartTimeUtc, string? EndTimeUtc, int ElapsedSeconds, int RemainingSeconds, bool IsFinished);
public sealed record FuturebolMatchResultModel(int? WinnerTeamId, string? WinnerTeamSymbol, string? EndReasonCode, string? EndReasonDetail);
