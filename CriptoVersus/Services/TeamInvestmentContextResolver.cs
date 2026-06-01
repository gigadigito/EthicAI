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

        var positionAsset = await ResolvePositionAssetAsync(normalizedSymbol, ct);

        var matches = await _api.GetMatchesAsync(ct) ?? [];

        var relatedMatches = matches
            .Where(x => PublicInvestmentRules.MatchIncludesTeam(x, normalizedSymbol))
            .ToList();

        if (relatedMatches.Count == 0)
        {
            if (positionAsset is not null)
            {
                return TeamInvestmentContextResolution.Available(
                    null,
                    positionAsset.TeamId,
                    string.IsNullOrWhiteSpace(positionAsset.Symbol) ? normalizedSymbol : positionAsset.Symbol,
                    string.Empty,
                    "position_available_no_active_match");
            }

            return TeamInvestmentContextResolution.Unavailable("team_match_missing");
        }

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
        {
            if (positionAsset is not null)
            {
                return TeamInvestmentContextResolution.Available(
                    ongoing ?? pending,
                    positionAsset.TeamId,
                    string.IsNullOrWhiteSpace(positionAsset.Symbol) ? normalizedSymbol : positionAsset.Symbol,
                    string.Empty,
                    (ongoing ?? pending) is null ? "position_available_no_active_match" : string.Empty);
            }

            return TeamInvestmentContextResolution.Unavailable("team_context_invalid");
        }

        return TeamInvestmentContextResolution.Available(
            ongoing ?? pending,
            teamContext.Value.TeamId,
            teamContext.Value.TeamName,
            teamContext.Value.OpponentName,
            (ongoing ?? pending) is null ? "position_available_no_active_match" : string.Empty);
    }

    private async Task<PositionAssetOptionDto?> ResolvePositionAssetAsync(string normalizedSymbol, CancellationToken ct)
    {
        var assets = await _api.GetPositionAssetsAsync(normalizedSymbol, take: 20, ct) ?? [];

        return assets
            .Where(x => x.TeamId > 0)
            .OrderByDescending(x => string.Equals(PublicInvestmentRules.NormalizeSymbol(x.Symbol), normalizedSymbol, StringComparison.Ordinal))
            .ThenByDescending(x => string.Equals(PublicInvestmentRules.NormalizeSymbol(x.CurrencyName), normalizedSymbol, StringComparison.Ordinal))
            .ThenByDescending(x => x.HasLiveMatch)
            .ThenByDescending(x => x.HasUpcomingMatch)
            .ThenBy(x => x.Symbol)
            .FirstOrDefault();
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
