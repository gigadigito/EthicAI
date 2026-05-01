namespace CriptoVersus.Web.Services;

public sealed class MatchRouteRedirectResolver
{
    public async Task<string?> ResolveRedirectPathAsync(
        string path,
        string? queryString,
        IMatchRouteLookupService matchRouteLookup,
        MatchSlugHelper matchSlugHelper,
        RouteLocalizationService routeLocalization,
        CancellationToken cancellationToken = default)
    {
        var segments = path
            .Split('/', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

        if (segments.Length is < 3 or > 4)
            return null;

        if (segments.Length == 3 && segments[0].Equals("match", StringComparison.OrdinalIgnoreCase))
        {
            if (int.TryParse(segments[1], out var canonicalId))
            {
                return await BuildRedirectIfMismatchAsync(
                    requestedPath: $"/match/{segments[1]}/{segments[2]}",
                    expectedPathFactory: slug => routeLocalization.BuildCanonicalPath(canonicalId, slug),
                    requestedSlug: segments[2],
                    matchId: canonicalId,
                    queryString,
                    matchRouteLookup,
                    cancellationToken);
            }

            if (int.TryParse(segments[2], out var legacyId))
            {
                var officialRoute = await matchRouteLookup.GetMatchRouteAsync(legacyId, cancellationToken);
                var slug = officialRoute?.Slug ?? matchSlugHelper.ParseLegacySlug(segments[1]);

                if (!string.IsNullOrWhiteSpace(slug))
                    return AppendQueryString(routeLocalization.BuildCanonicalPath(legacyId, slug), queryString);
            }
        }

        if (segments.Length == 4
            && int.TryParse(segments[2], out var localizedId)
            && routeLocalization.IsKnownMatchSegment(segments[1]))
        {
            var normalizedCulture = routeLocalization.NormalizeCulture(segments[0]);
            if (normalizedCulture is null)
            {
                return await BuildRedirectIfMismatchAsync(
                    requestedPath: $"/{segments[0]}/{segments[1]}/{segments[2]}/{segments[3]}",
                    expectedPathFactory: slug => routeLocalization.BuildCanonicalPath(localizedId, slug),
                    requestedSlug: segments[3],
                    matchId: localizedId,
                    queryString,
                    matchRouteLookup,
                    cancellationToken);
            }

            return await BuildRedirectIfMismatchAsync(
                requestedPath: $"/{segments[0]}/{segments[1]}/{segments[2]}/{segments[3]}",
                expectedPathFactory: slug => routeLocalization.BuildLocalizedPath(normalizedCulture, localizedId, slug),
                requestedSlug: segments[3],
                matchId: localizedId,
                queryString,
                matchRouteLookup,
                cancellationToken);
        }

        return null;
    }

    private static async Task<string?> BuildRedirectIfMismatchAsync(
        string requestedPath,
        Func<string, string> expectedPathFactory,
        string requestedSlug,
        int matchId,
        string? queryString,
        IMatchRouteLookupService matchRouteLookup,
        CancellationToken cancellationToken)
    {
        var officialRoute = await matchRouteLookup.GetMatchRouteAsync(matchId, cancellationToken);
        if (officialRoute is null)
            return null;

        var expectedPath = expectedPathFactory(officialRoute.Slug);
        if (requestedPath.Equals(expectedPath, StringComparison.OrdinalIgnoreCase)
            && requestedSlug.Equals(officialRoute.Slug, StringComparison.Ordinal))
        {
            return null;
        }

        return AppendQueryString(expectedPath, queryString);
    }

    private static string AppendQueryString(string path, string? queryString)
        => string.IsNullOrWhiteSpace(queryString) ? path : $"{path}{queryString}";
}
