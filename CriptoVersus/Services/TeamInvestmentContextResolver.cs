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

        var selectedMatch = ongoing ?? pending;
        if (selectedMatch is null)
            return TeamInvestmentContextResolution.Unavailable("team_match_closed");

        var teamContext = PublicInvestmentRules.GetTeamContext(selectedMatch, normalizedSymbol);
        if (teamContext is null)
            return TeamInvestmentContextResolution.Unavailable("team_context_invalid");

        return TeamInvestmentContextResolution.Available(
            selectedMatch,
            teamContext.Value.TeamId,
            teamContext.Value.TeamName,
            teamContext.Value.OpponentName);
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
    public static TeamInvestmentContextResolution Available(MatchDto match, int teamId, string teamName, string opponentName)
        => new(true, match, teamId, teamName, opponentName, string.Empty);

    public static TeamInvestmentContextResolution Unavailable(string failureReason)
        => new(false, null, 0, string.Empty, string.Empty, failureReason);
}
