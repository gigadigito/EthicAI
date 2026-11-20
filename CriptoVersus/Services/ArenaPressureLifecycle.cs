using DTOs;

namespace CriptoVersus.Web.Services;

/// <summary>
/// Projects the official match lifecycle for the Arena Pressure presentation.
/// The Worker owns completion; this class only reads persisted status, winner and
/// timestamps. Gauge pressure never decides the winner.
/// </summary>
public static class ArenaPressureLifecycle
{
    public static string State(MatchDto match, DateTimeOffset nowUtc)
    {
        var status = match.Status?.Trim() ?? string.Empty;

        if (status.Equals("Cancelled", StringComparison.OrdinalIgnoreCase)) return "cancelled";
        if (status.Equals("Completed", StringComparison.OrdinalIgnoreCase))
            return match.EndTime.HasValue ? "finished" : "processing";
        if (status.Equals("Pending", StringComparison.OrdinalIgnoreCase)) return "pending";

        // An end timestamp without a terminal status is awaiting official confirmation.
        if (match.EndTime.HasValue) return "processing";

        if (status.Equals("Ongoing", StringComparison.OrdinalIgnoreCase))
        {
            if (match.ScheduledEndTimeUtc is { } end && Utc(end) <= nowUtc) return "processing";
            return "live";
        }

        // Unknown or missing status must never claim a live or finished match.
        return "pending";
    }

    public static string Result(MatchDto match)
    {
        // Never invent an outcome before the match is officially completed.
        if (match.Status is null || !match.Status.Equals("Completed", StringComparison.OrdinalIgnoreCase))
            return "resultPending";
        if (match.WinnerTeamId == match.TeamAId && match.TeamAId != 0) return "leftVictory";
        if (match.WinnerTeamId == match.TeamBId && match.TeamBId != 0) return "rightVictory";
        return match.WinnerTeamId is null && match.ScoreA == match.ScoreB ? "draw" : "resultPending";
    }

    public static DateTimeOffset Utc(DateTime value) => new(DateTime.SpecifyKind(value, DateTimeKind.Utc));

    public static string Clock(DateTime? targetUtc, DateTimeOffset nowUtc)
    {
        if (targetUtc is null) return string.Empty;
        var seconds = Math.Max(0, (int)Math.Ceiling((Utc(targetUtc.Value) - nowUtc).TotalSeconds));
        return $"{seconds / 60:00}:{seconds % 60:00}";
    }
}
