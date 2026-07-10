using DTOs;

namespace CriptoVersus.Web.Services;

public static class HotMatchesSocialCardRules
{
    public const int DefaultDisplayLimit = 5;
    public const int DefaultWindowHours = 24;

    public static IReadOnlyList<HotMatchDto> RankCandidates(
        IReadOnlyList<HotMatchDto> matches,
        int hours,
        int limit,
        DateTime utcNow)
    {
        var safeHours = Math.Clamp(hours, 1, 72);
        var safeLimit = Math.Clamp(limit, 1, DefaultDisplayLimit);
        var cutoffUtc = utcNow.AddHours(-safeHours);

        return matches
            .Where(match => IsEligible(match, cutoffUtc, utcNow))
            .OrderByDescending(match => match.HotScore)
            .ThenBy(match => GetStatusPriority(match.Status))
            .ThenBy(match => match.ScoreDifference)
            .ThenByDescending(match => ResolveActivityUtc(match) ?? DateTime.MinValue)
            .ThenByDescending(match => match.MatchId)
            .Take(safeLimit)
            .ToList();
    }

    public static bool IsEligible(HotMatchDto? match, DateTime cutoffUtc, DateTime utcNow)
    {
        if (match is null || match.MatchId <= 0)
            return false;

        if (string.IsNullOrWhiteSpace(match.HomeSymbol) || string.IsNullOrWhiteSpace(match.AwaySymbol))
            return false;

        var activityUtc = ResolveActivityUtc(match);
        if (!activityUtc.HasValue || activityUtc.Value < cutoffUtc || activityUtc.Value > utcNow)
            return false;

        return !IsCancelled(match.Status);
    }

    public static string GetTemperatureKey(int hotScore)
        => hotScore switch
        {
            <= 30 => "cold",
            <= 50 => "warm",
            <= 70 => "hot",
            <= 90 => "explosive",
            _ => "historic"
        };

    public static string GetBalanceKey(int scoreDifference)
        => scoreDifference switch
        {
            0 => "tied",
            1 => "veryClose",
            2 => "close",
            _ => "clearLead"
        };

    public static string GetStatusKey(string? status)
        => NormalizeStatus(status) switch
        {
            "ongoing" => "live",
            "closing" => "closing",
            "finished" => "final",
            "completed" => "final",
            "scheduled" => "scheduled",
            "pending" => "scheduled",
            "cancelled" => "cancelled",
            "canceled" => "cancelled",
            _ => "scheduled"
        };

    public static int GetStatusPriority(string? status)
        => NormalizeStatus(status) switch
        {
            "ongoing" => 0,
            "closing" => 1,
            "finished" => 2,
            "completed" => 2,
            "scheduled" => 3,
            "pending" => 3,
            _ => 4
        };

    public static string GetTemperatureEmoji(int hotScore)
        => hotScore switch
        {
            <= 30 => "\U0001F976",
            <= 50 => "\U0001F324\uFE0F",
            <= 70 => "\U0001F525",
            <= 90 => "\u26A1",
            _ => "\U0001F3C6"
        };

    public static string FormatLastGoalLabel(DateTime? lastGoalAt, DateTime utcNow, string waitingText)
    {
        if (!lastGoalAt.HasValue)
            return waitingText;

        var lastGoalUtc = NormalizeUtc(lastGoalAt.Value);
        var elapsed = utcNow - lastGoalUtc;
        if (elapsed < TimeSpan.Zero)
            elapsed = TimeSpan.Zero;

        if (elapsed.TotalMinutes < 1)
            return "1m";

        if (elapsed.TotalMinutes < 60)
            return $"{Math.Max(1, (int)Math.Round(elapsed.TotalMinutes, MidpointRounding.AwayFromZero))}m";

        return $"{Math.Max(1, (int)Math.Round(elapsed.TotalHours, MidpointRounding.AwayFromZero))}h";
    }

    private static DateTime? ResolveActivityUtc(HotMatchDto match)
    {
        var snapshot = match.MatchSnapshot;
        var candidate = snapshot?.EndTime
            ?? snapshot?.StartTime
            ?? match.LastGoalAt;

        if (!candidate.HasValue)
            return null;

        return NormalizeUtc(candidate.Value);
    }

    private static DateTime NormalizeUtc(DateTime value)
        => value.Kind switch
        {
            DateTimeKind.Utc => value,
            DateTimeKind.Local => value.ToUniversalTime(),
            _ => DateTime.SpecifyKind(value, DateTimeKind.Utc)
        };

    private static string NormalizeStatus(string? status)
        => string.IsNullOrWhiteSpace(status)
            ? string.Empty
            : status.Trim().ToLowerInvariant();

    private static bool IsCancelled(string? status)
        => NormalizeStatus(status) is "cancelled" or "canceled" or "aborted";
}



