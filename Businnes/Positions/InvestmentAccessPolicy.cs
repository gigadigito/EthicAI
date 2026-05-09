namespace BLL.Positions;

public static class InvestmentAccessPolicy
{
    public const int MatchDurationMinutes = 90;
    public const int AdvancedLiveThresholdMinutes = (MatchDurationMinutes * 2) / 3;
    public const string AdvancedLiveMatchReason = "advanced_live_match";
    public const string MatchNotOpenReason = "match_not_open";

    public static InvestmentAccessDecision EvaluateLegacyMatch(
        string? status,
        DateTime? startTimeUtc,
        DateTimeOffset? bettingCloseTimeUtc,
        int? elapsedMinutes = null,
        DateTimeOffset? nowUtc = null)
    {
        var normalizedStatus = NormalizeStatus(status);
        var resolvedNow = nowUtc ?? DateTimeOffset.UtcNow;
        var resolvedElapsedMinutes = ResolveElapsedMinutes(startTimeUtc, elapsedMinutes, resolvedNow);

        return normalizedStatus switch
        {
            "pending" => InvestmentAccessDecision.Allow(resolvedElapsedMinutes),
            "ongoing" when resolvedElapsedMinutes < AdvancedLiveThresholdMinutes
                => InvestmentAccessDecision.Allow(resolvedElapsedMinutes),
            "ongoing" => InvestmentAccessDecision.Block(AdvancedLiveMatchReason, resolvedElapsedMinutes),
            _ => InvestmentAccessDecision.Block(MatchNotOpenReason, resolvedElapsedMinutes)
        };
    }

    public static InvestmentAccessDecision EvaluatePersistentExposure(
        string? status,
        DateTime? startTimeUtc,
        DateTimeOffset? bettingCloseTimeUtc,
        int? elapsedMinutes = null,
        DateTimeOffset? nowUtc = null)
    {
        var normalizedStatus = NormalizeStatus(status);
        var resolvedNow = nowUtc ?? DateTimeOffset.UtcNow;
        var resolvedElapsedMinutes = ResolveElapsedMinutes(startTimeUtc, elapsedMinutes, resolvedNow);

        return normalizedStatus switch
        {
            "ongoing" when resolvedElapsedMinutes >= AdvancedLiveThresholdMinutes
                => InvestmentAccessDecision.Block(AdvancedLiveMatchReason, resolvedElapsedMinutes),
            _ => InvestmentAccessDecision.Allow(resolvedElapsedMinutes)
        };
    }

    public static bool IsAdvancedLiveMatch(
        string? status,
        DateTime? startTimeUtc,
        int? elapsedMinutes = null,
        DateTimeOffset? nowUtc = null)
        => EvaluatePersistentExposure(status, startTimeUtc, null, elapsedMinutes, nowUtc).ReasonCode == AdvancedLiveMatchReason;

    public static DateTimeOffset? GetEntryCutoffUtc(
        string? status,
        DateTime? startTimeUtc)
    {
        var normalizedStatus = NormalizeStatus(status);
        if (normalizedStatus is not ("pending" or "ongoing"))
            return null;

        if (!startTimeUtc.HasValue)
            return null;

        var normalizedStart = startTimeUtc.Value.Kind == DateTimeKind.Unspecified
            ? DateTime.SpecifyKind(startTimeUtc.Value, DateTimeKind.Utc)
            : startTimeUtc.Value.ToUniversalTime();

        return new DateTimeOffset(normalizedStart).AddMinutes(AdvancedLiveThresholdMinutes);
    }

    public static int ResolveElapsedMinutes(
        DateTime? startTimeUtc,
        int? elapsedMinutes = null,
        DateTimeOffset? nowUtc = null)
    {
        if (elapsedMinutes.HasValue && elapsedMinutes.Value >= 0)
            return elapsedMinutes.Value;

        if (!startTimeUtc.HasValue)
            return 0;

        var normalizedStart = startTimeUtc.Value.Kind == DateTimeKind.Unspecified
            ? DateTime.SpecifyKind(startTimeUtc.Value, DateTimeKind.Utc)
            : startTimeUtc.Value.ToUniversalTime();

        var resolvedNow = nowUtc ?? DateTimeOffset.UtcNow;
        var elapsed = resolvedNow.UtcDateTime - normalizedStart;
        return elapsed.TotalMinutes <= 0d ? 0 : (int)elapsed.TotalMinutes;
    }

    private static string NormalizeStatus(string? status)
        => status?.Trim().ToLowerInvariant() ?? string.Empty;
}

public sealed record InvestmentAccessDecision(bool CanInvest, string? ReasonCode, int ElapsedMinutes)
{
    public static InvestmentAccessDecision Allow(int elapsedMinutes)
        => new(true, null, elapsedMinutes);

    public static InvestmentAccessDecision Block(string reasonCode, int elapsedMinutes)
        => new(false, reasonCode, elapsedMinutes);
}
