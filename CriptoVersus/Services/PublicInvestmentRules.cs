using BLL.Positions;
using DTOs;

namespace CriptoVersus.Web.Services;

public static class PublicInvestmentRules
{
    private static readonly string[] VisualSuffixes = ["USDT", "USDC", "BUSD", "FDUSD", "BRL", "EUR", "BTC", "ETH"];

    public static bool IsBettingWindowOpen(MatchDto? match)
    {
        if (match is null)
            return false;

        return EvaluateLegacyMatch(match).CanInvest;
    }

    public static bool IsPersistentExposureAllowed(MatchDto? match)
    {
        if (match is null)
            return true;

        return EvaluatePersistentExposure(match).CanInvest;
    }

    public static bool IsAdvancedLiveMatch(MatchDto? match)
    {
        if (match is null)
            return false;

        return EvaluatePersistentExposure(match).ReasonCode == InvestmentAccessPolicy.AdvancedLiveMatchReason;
    }

    public static string NormalizeSymbol(string? symbol)
    {
        if (string.IsNullOrWhiteSpace(symbol))
            return string.Empty;

        var normalized = new string(symbol.Trim().ToUpperInvariant().Where(char.IsLetterOrDigit).ToArray());
        foreach (var suffix in VisualSuffixes)
        {
            if (normalized.Length > suffix.Length + 1 && normalized.EndsWith(suffix, StringComparison.Ordinal))
                return normalized[..^suffix.Length];
        }

        return normalized;
    }

    public static bool MatchIncludesTeam(MatchDto? match, string normalizedSymbol)
    {
        if (match is null || string.IsNullOrWhiteSpace(normalizedSymbol))
            return false;

        return string.Equals(NormalizeSymbol(match.TeamA), normalizedSymbol, StringComparison.Ordinal)
            || string.Equals(NormalizeSymbol(match.TeamB), normalizedSymbol, StringComparison.Ordinal);
    }

    public static (int TeamId, string TeamName, string OpponentName)? GetTeamContext(MatchDto? match, string normalizedSymbol)
    {
        if (match is null || string.IsNullOrWhiteSpace(normalizedSymbol))
            return null;

        if (string.Equals(NormalizeSymbol(match.TeamA), normalizedSymbol, StringComparison.Ordinal))
            return (match.TeamAId, match.TeamA, match.TeamB);

        if (string.Equals(NormalizeSymbol(match.TeamB), normalizedSymbol, StringComparison.Ordinal))
            return (match.TeamBId, match.TeamB, match.TeamA);

        return null;
    }

    public static long GetOnChainBettingCloseUnix(MatchDto match)
    {
        var cutoffUtc = InvestmentAccessPolicy.GetEntryCutoffUtc(match.Status, match.StartTime);
        if (cutoffUtc.HasValue)
            return cutoffUtc.Value.ToUnixTimeSeconds();

        return DateTimeOffset.UtcNow.AddHours(24).ToUnixTimeSeconds();
    }

    public static InvestmentAccessDecision EvaluateLegacyMatch(MatchDto match)
        => InvestmentAccessPolicy.EvaluateLegacyMatch(
            match.Status,
            match.StartTime,
            match.BettingCloseTime,
            match.ElapsedMinutes,
            DateTimeOffset.UtcNow);

    public static InvestmentAccessDecision EvaluatePersistentExposure(MatchDto match)
        => InvestmentAccessPolicy.EvaluatePersistentExposure(
            match.Status,
            match.StartTime,
            match.BettingCloseTime,
            match.ElapsedMinutes,
            DateTimeOffset.UtcNow);
}
