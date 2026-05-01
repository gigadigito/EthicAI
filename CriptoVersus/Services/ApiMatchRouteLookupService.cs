namespace CriptoVersus.Web.Services;

public sealed class ApiMatchRouteLookupService : IMatchRouteLookupService
{
    private readonly CriptoVersusApiClient _apiClient;
    private readonly MatchSlugHelper _matchSlugHelper;

    public ApiMatchRouteLookupService(
        CriptoVersusApiClient apiClient,
        MatchSlugHelper matchSlugHelper)
    {
        _apiClient = apiClient;
        _matchSlugHelper = matchSlugHelper;
    }

    public async Task<MatchRouteInfo?> GetMatchRouteAsync(int matchId, CancellationToken cancellationToken = default)
    {
        var match = await _apiClient.GetMatchByIdAsync(matchId, cancellationToken);
        if (match is null)
            return null;

        var slug = _matchSlugHelper.BuildSlug(match.TeamA, match.TeamB);
        if (string.IsNullOrWhiteSpace(slug))
            return null;

        return new MatchRouteInfo(match.MatchId, slug);
    }
}
