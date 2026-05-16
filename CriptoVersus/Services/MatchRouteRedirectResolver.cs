namespace CriptoVersus.Web.Services;

public sealed class MatchRouteRedirectResolver
{
    public async Task<string?> ResolveRedirectPathAsync(
        string path,
        string? queryString,
        HttpContext httpContext,
        AppCultureService appCultureService,
        IMatchRouteLookupService matchRouteLookup,
        MatchSlugHelper matchSlugHelper,
        RouteLocalizationService routeLocalization,
        CancellationToken cancellationToken = default)
    {
        var preferredCulture = appCultureService.DetectPreferredRouteCulture(httpContext);
        var cleanPath = path.Split('?', '#')[0];

        if (cleanPath == "/")
            return AppendQueryString(routeLocalization.BuildHomePath(preferredCulture), queryString);

        if (cleanPath.Equals("/roadmap", StringComparison.OrdinalIgnoreCase))
            return AppendQueryString(routeLocalization.BuildRoadmapPath(preferredCulture), queryString);

        if (cleanPath.Equals("/faq", StringComparison.OrdinalIgnoreCase))
            return AppendQueryString(routeLocalization.BuildFaqPath(preferredCulture), queryString);

        if (cleanPath.Equals("/tokenomics", StringComparison.OrdinalIgnoreCase))
            return AppendQueryString(routeLocalization.BuildHowItWorksPath(preferredCulture), queryString);

        if (cleanPath.Equals("/tv", StringComparison.OrdinalIgnoreCase))
            return AppendQueryString(routeLocalization.BuildTvPath(preferredCulture), queryString);

        if (cleanPath.Equals("/tv/broadcast", StringComparison.OrdinalIgnoreCase))
            return AppendQueryString(routeLocalization.BuildTvBroadcastPath(preferredCulture), queryString);

        if (cleanPath.Equals("/en/tv", StringComparison.OrdinalIgnoreCase)
            || cleanPath.Equals("/pt/tv", StringComparison.OrdinalIgnoreCase))
        {
            var explicitCulture = appCultureService.TryGetExplicitCultureFromPath(cleanPath)
                ?? preferredCulture;

            var canonicalTvPath = routeLocalization.BuildTvPath(explicitCulture);
            if (!cleanPath.Equals(canonicalTvPath, StringComparison.OrdinalIgnoreCase))
                return AppendQueryString(canonicalTvPath, queryString);

            return null;
        }

        if (cleanPath.Equals("/en/tv/broadcast", StringComparison.OrdinalIgnoreCase)
            || cleanPath.Equals("/pt/tv/broadcast", StringComparison.OrdinalIgnoreCase))
        {
            var explicitCulture = appCultureService.TryGetExplicitCultureFromPath(cleanPath)
                ?? preferredCulture;

            var canonicalTvPath = routeLocalization.BuildTvBroadcastPath(explicitCulture);
            if (!cleanPath.Equals(canonicalTvPath, StringComparison.OrdinalIgnoreCase))
                return AppendQueryString(canonicalTvPath, queryString);

            return null;
        }

        if (cleanPath.Equals("/en/how-it-works", StringComparison.OrdinalIgnoreCase)
            || cleanPath.Equals("/pt/como-funciona", StringComparison.OrdinalIgnoreCase))
        {
            var explicitCulture = appCultureService.TryGetExplicitCultureFromPath(cleanPath)
                ?? preferredCulture;

            var canonicalHowItWorksPath = routeLocalization.BuildHowItWorksPath(explicitCulture);
            if (!cleanPath.Equals(canonicalHowItWorksPath, StringComparison.OrdinalIgnoreCase))
                return AppendQueryString(canonicalHowItWorksPath, queryString);

            return null;
        }

        if (cleanPath.Equals("/en/faq", StringComparison.OrdinalIgnoreCase)
            || cleanPath.Equals("/pt/faq", StringComparison.OrdinalIgnoreCase))
        {
            var explicitCulture = appCultureService.TryGetExplicitCultureFromPath(cleanPath)
                ?? preferredCulture;

            var canonicalFaqPath = routeLocalization.BuildFaqPath(explicitCulture);
            if (!cleanPath.Equals(canonicalFaqPath, StringComparison.OrdinalIgnoreCase))
                return AppendQueryString(canonicalFaqPath, queryString);

            return null;
        }

        var segments = path
            .Split('/', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

        if (segments.Length == 4
            && segments[0].Equals("tv", StringComparison.OrdinalIgnoreCase)
            && segments[1].Equals("match", StringComparison.OrdinalIgnoreCase)
            && int.TryParse(segments[2], out var legacyTvMatchId))
        {
            return await BuildRedirectIfMismatchAsync(
                requestedPath: $"/tv/match/{segments[2]}/{segments[3]}",
                expectedPathFactory: slug => routeLocalization.BuildTvMatchPath(preferredCulture, legacyTvMatchId, slug),
                requestedSlug: segments[3],
                matchId: legacyTvMatchId,
                queryString,
                matchRouteLookup,
                cancellationToken);
        }

        if (segments.Length == 5
            && segments[1].Equals("tv", StringComparison.OrdinalIgnoreCase)
            && segments[2].Equals("match", StringComparison.OrdinalIgnoreCase)
            && int.TryParse(segments[3], out var localizedTvMatchId))
        {
            var normalizedCulture = routeLocalization.NormalizeCulture(segments[0]);

            return await BuildRedirectIfMismatchAsync(
                requestedPath: $"/{segments[0]}/tv/match/{segments[3]}/{segments[4]}",
                expectedPathFactory: slug => routeLocalization.BuildTvMatchPath(normalizedCulture, localizedTvMatchId, slug),
                requestedSlug: segments[4],
                matchId: localizedTvMatchId,
                queryString,
                matchRouteLookup,
                cancellationToken);
        }

        if (segments.Length is < 3 or > 4)
            return null;

        if (segments.Length == 3 && segments[0].Equals("match", StringComparison.OrdinalIgnoreCase))
        {
            if (int.TryParse(segments[1], out var canonicalId))
            {
                return await BuildRedirectIfMismatchAsync(
                    requestedPath: $"/match/{segments[1]}/{segments[2]}",
                    expectedPathFactory: slug => routeLocalization.BuildLocalizedPath(AppCultureService.DefaultRouteCulture, canonicalId, slug),
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
                    return AppendQueryString(routeLocalization.BuildLocalizedPath(AppCultureService.DefaultRouteCulture, legacyId, slug), queryString);
            }
        }

        if (segments.Length == 3 && segments[0].Equals("partida", StringComparison.OrdinalIgnoreCase))
        {
            if (int.TryParse(segments[1], out var matchId))
            {
                return await BuildRedirectIfMismatchAsync(
                    requestedPath: $"/partida/{segments[1]}/{segments[2]}",
                    expectedPathFactory: slug => routeLocalization.BuildLocalizedPath(AppCultureService.SecondaryRouteCulture, matchId, slug),
                    requestedSlug: segments[2],
                    matchId,
                    queryString,
                    matchRouteLookup,
                    cancellationToken);
            }
        }

        if (segments.Length == 4
            && int.TryParse(segments[2], out var localizedId)
            && routeLocalization.IsKnownMatchSegment(segments[1]))
        {
            var normalizedCulture = routeLocalization.NormalizeCulture(segments[0]);

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
