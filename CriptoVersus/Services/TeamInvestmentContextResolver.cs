using DTOs;

namespace CriptoVersus.Web.Services;

public sealed class TeamInvestmentContextResolver
{
    private readonly CriptoVersusApiClient _api;

    public TeamInvestmentContextResolver(CriptoVersusApiClient api)
    {
        _api = api;
    }

    public async Task<TeamInvestmentContextResolution> ResolveAsync(string? teamSymbol, CancellationToken ct = default)
    {
        var normalizedSymbol = PublicInvestmentRules.NormalizeSymbol(teamSymbol);
        if (string.IsNullOrWhiteSpace(normalizedSymbol))
            return TeamInvestmentContextResolution.Unavailable("team_symbol_missing");

        var matches = await _api.GetMatchesAsync(ct) ?? [];

        var relatedMatches = matches
            .Where(x => PublicInvestmentRules.MatchIncludesTeam(x, normalizedSymbol))
            .ToList();

        if (relatedMatches.Count == 0)
            return TeamInvestmentContextResolution.Unavailable("team_match_missing");

        var advancedLive = relatedMatches
            .Where(x => string.Equals(x.Status, "Ongoing", StringComparison.OrdinalIgnoreCase))
            .Where(PublicInvestmentRules.IsAdvancedLiveMatch)
            .OrderByDescending(x => x.StartTime ?? DateTime.MinValue)
            .FirstOrDefault();

        if (advancedLive is not null)
            return TeamInvestmentContextResolution.Unavailable("team_match_advanced_live");

        var ongoing = relatedMatches
            .Where(x => string.Equals(x.Status, "Ongoing", StringComparison.OrdinalIgnoreCase))
            .Where(PublicInvestmentRules.IsBettingWindowOpen)
            .OrderByDescending(x => x.StartTime ?? DateTime.MinValue)
            .FirstOrDefault();

        var pending = relatedMatches
            .Where(PublicInvestmentRules.IsBettingWindowOpen)
            .Where(x => string.Equals(x.Status, "Pending", StringComparison.OrdinalIgnoreCase))
            .OrderBy(x => x.BettingCloseTime ?? (x.StartTime.HasValue ? new DateTimeOffset(DateTime.SpecifyKind(x.StartTime.Value, DateTimeKind.Utc)) : DateTimeOffset.MaxValue))
            .FirstOrDefault();

        var contextSource = ongoing
            ?? pending
            ?? relatedMatches
                .OrderByDescending(x => x.StartTime ?? DateTime.MinValue)
                .FirstOrDefault();

        if (contextSource is null)
            return TeamInvestmentContextResolution.Unavailable("team_context_invalid");

        var teamContext = PublicInvestmentRules.GetTeamContext(contextSource, normalizedSymbol);
        if (teamContext is null)
            return TeamInvestmentContextResolution.Unavailable("team_context_invalid");

        return TeamInvestmentContextResolution.Available(
            ongoing ?? pending,
            teamContext.Value.TeamId,
            teamContext.Value.TeamName,
            teamContext.Value.OpponentName,
            (ongoing ?? pending) is null ? "position_available_no_active_match" : string.Empty);
    }
}

public sealed record TeamInvestmentContextResolution(
    bool IsAvailable,
    MatchDto? Match,
    int TeamId,
    string TeamName,
    string OpponentName,
    string FailureReason)
{
    public static TeamInvestmentContextResolution Available(
        MatchDto? match,
        int teamId,
        string teamName,
        string opponentName,
        string failureReason = "")
        => new(true, match, teamId, teamName, opponentName, failureReason);

    public static TeamInvestmentContextResolution Unavailable(string failureReason)
        => new(false, null, 0, string.Empty, string.Empty, failureReason);
}
