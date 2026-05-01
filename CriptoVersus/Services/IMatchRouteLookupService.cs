namespace CriptoVersus.Web.Services;

public interface IMatchRouteLookupService
{
    Task<MatchRouteInfo?> GetMatchRouteAsync(int matchId, CancellationToken cancellationToken = default);
}

public sealed record MatchRouteInfo(int MatchId, string Slug);
