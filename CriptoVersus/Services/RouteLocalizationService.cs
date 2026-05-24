namespace CriptoVersus.Web.Services;

public sealed class RouteLocalizationService
{
    private readonly AppCultureService _appCultureService;

    private static readonly IReadOnlyDictionary<string, string> MatchSegments =
        new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            [AppCultureService.SecondaryRouteCulture] = "partida",
            [AppCultureService.DefaultRouteCulture] = "match"
        };

    public RouteLocalizationService(AppCultureService appCultureService)
    {
        _appCultureService = appCultureService;
    }

    public string NormalizeCulture(string? culture)
        => _appCultureService.NormalizeRouteCulture(culture);

    public string GetMatchSegment(string? culture)
        => MatchSegments.TryGetValue(NormalizeCulture(culture), out var segment)
            ? segment
            : "match";

    public bool IsKnownMatchSegment(string? segment)
        => !string.IsNullOrWhiteSpace(segment)
           && MatchSegments.Values.Contains(segment.Trim(), StringComparer.OrdinalIgnoreCase);

    public string BuildCanonicalPath(int id, string slug)
        => BuildLocalizedPath(AppCultureService.DefaultRouteCulture, id, slug);

    public string BuildLocalizedPath(string culture, int id, string slug)
    {
        var normalizedCulture = NormalizeCulture(culture);
        return $"/{normalizedCulture}/{GetMatchSegment(normalizedCulture)}/{id}/{slug}";
    }

    public string BuildBestPath(string? culture, int id, string slug)
        => BuildLocalizedPath(NormalizeCulture(culture), id, slug);

    public string GetHrefLang(string culture)
        => _appCultureService.ToHrefLang(culture);

    public string BuildHomePath(string? culture)
        => $"/{NormalizeCulture(culture)}";

    public string BuildRoadmapPath(string? culture)
        => $"/{NormalizeCulture(culture)}/roadmap";

    public string BuildFaqPath(string? culture)
        => $"/{NormalizeCulture(culture)}/faq";

    public string BuildHowItWorksPath(string? culture)
        => NormalizeCulture(culture) == AppCultureService.SecondaryRouteCulture
            ? "/pt/como-funciona"
            : "/en/how-it-works";
    public string BuildWalletPath(string? culture)
    => NormalizeCulture(culture) == AppCultureService.SecondaryRouteCulture
        ? "/pt/minha-carteira"
        : "/en/my-wallet";

    public string BuildAdminPath(string? culture)
        => NormalizeCulture(culture) == AppCultureService.SecondaryRouteCulture
            ? "/pt/admin-sistema"
            : "/en/admin-system";
    public string BuildStatsPath(string? culture)
        => NormalizeCulture(culture) == AppCultureService.SecondaryRouteCulture
            ? "/pt/estatisticas"
            : "/stats";

    public string BuildStatsTeamsPath(string? culture)
        => NormalizeCulture(culture) == AppCultureService.SecondaryRouteCulture
            ? "/pt/estatisticas/times"
            : "/stats/teams";

    public string BuildStatsTeamDetailPath(string? culture, string slug)
    {
        var normalizedSlug = slug.Trim().ToLowerInvariant();
        return $"{BuildStatsTeamsPath(culture)}/{normalizedSlug}";
    }

    public string BuildTokenPath(string? culture)
        => $"/{NormalizeCulture(culture)}/token";

    public string BuildTvPath(string? culture)
        => $"/{NormalizeCulture(culture)}/tv";

    public string BuildTvBroadcastPath(string? culture)
        => $"{BuildTvPath(culture)}/broadcast";

    public string BuildTvMatchPath(string? culture, int id, string slug)
        => $"{BuildTvPath(culture)}/match/{id}/{slug.Trim().ToLowerInvariant()}";

    public string BuildLegacyTvPath()
        => "/tv";

    public string BuildLegacyTvMatchPath(int id, string slug)
        => $"/tv/match/{id}/{slug.Trim().ToLowerInvariant()}";

    public string BuildLegacyMatchPath(string? culture, int id, string slug)
        => NormalizeCulture(culture) == AppCultureService.SecondaryRouteCulture
            ? $"/partida/{id}/{slug}"
            : $"/match/{id}/{slug}";

    public string BuildLocalizedPathForCurrentPage(string targetCulture, string currentRelativePath)
    {
        var path = "/" + currentRelativePath.TrimStart('/');
        var cleanPath = path.Split('?', '#')[0];
        var querySuffix = path.Length > cleanPath.Length ? path[cleanPath.Length..] : string.Empty;
        var normalizedTarget = NormalizeCulture(targetCulture);
        var normalizedCurrent = _appCultureService.TryGetExplicitCultureFromPath(cleanPath);

        if (string.IsNullOrWhiteSpace(cleanPath) || cleanPath == "/")
            return BuildHomePath(normalizedTarget) + querySuffix;

        if (normalizedCurrent is not null && cleanPath.Equals(BuildHomePath(normalizedCurrent), StringComparison.OrdinalIgnoreCase))
            return BuildHomePath(normalizedTarget) + querySuffix;

        if (cleanPath.Equals("/roadmap", StringComparison.OrdinalIgnoreCase)
            || cleanPath.Equals("/en/roadmap", StringComparison.OrdinalIgnoreCase)
            || cleanPath.Equals("/pt/roadmap", StringComparison.OrdinalIgnoreCase))
            return BuildRoadmapPath(normalizedTarget) + querySuffix;

        if (cleanPath.Equals("/faq", StringComparison.OrdinalIgnoreCase)
            || cleanPath.Equals("/en/faq", StringComparison.OrdinalIgnoreCase)
            || cleanPath.Equals("/pt/faq", StringComparison.OrdinalIgnoreCase))
            return BuildFaqPath(normalizedTarget) + querySuffix;

        if (cleanPath.Equals("/tokenomics", StringComparison.OrdinalIgnoreCase)
            || cleanPath.Equals("/en/how-it-works", StringComparison.OrdinalIgnoreCase)
            || cleanPath.Equals("/pt/como-funciona", StringComparison.OrdinalIgnoreCase))
            return BuildHowItWorksPath(normalizedTarget) + querySuffix;

        if (cleanPath.Equals("/stats", StringComparison.OrdinalIgnoreCase)
            || cleanPath.Equals("/en/stats", StringComparison.OrdinalIgnoreCase)
            || cleanPath.Equals("/pt/estatisticas", StringComparison.OrdinalIgnoreCase))
            return BuildStatsPath(normalizedTarget) + querySuffix;

        if (cleanPath.Equals("/stats/teams", StringComparison.OrdinalIgnoreCase)
            || cleanPath.Equals("/en/stats/teams", StringComparison.OrdinalIgnoreCase)
            || cleanPath.Equals("/pt/estatisticas/times", StringComparison.OrdinalIgnoreCase))
            return BuildStatsTeamsPath(normalizedTarget) + querySuffix;

        if (cleanPath.Equals("/token", StringComparison.OrdinalIgnoreCase)
            || cleanPath.Equals("/en/token", StringComparison.OrdinalIgnoreCase)
            || cleanPath.Equals("/pt/token", StringComparison.OrdinalIgnoreCase))
            return BuildTokenPath(normalizedTarget) + querySuffix;

        var segments = cleanPath.Trim('/').Split('/', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

        if (cleanPath.Equals("/tv", StringComparison.OrdinalIgnoreCase)
            || cleanPath.Equals("/en/tv", StringComparison.OrdinalIgnoreCase)
            || cleanPath.Equals("/pt/tv", StringComparison.OrdinalIgnoreCase))
        {
            return BuildTvPath(normalizedTarget) + querySuffix;
        }

        if (cleanPath.Equals("/tv/broadcast", StringComparison.OrdinalIgnoreCase)
            || cleanPath.Equals("/en/tv/broadcast", StringComparison.OrdinalIgnoreCase)
            || cleanPath.Equals("/pt/tv/broadcast", StringComparison.OrdinalIgnoreCase))
        {
            return BuildTvBroadcastPath(normalizedTarget) + querySuffix;
        }

        if (segments.Length >= 4
            && cleanPath.StartsWith("/tv/match/", StringComparison.OrdinalIgnoreCase)
            && int.TryParse(segments[2], out var legacyTvMatchId))
        {
            return BuildTvMatchPath(normalizedTarget, legacyTvMatchId, segments[3]) + querySuffix;
        }

        if (segments.Length >= 5
            && segments[1].Equals("tv", StringComparison.OrdinalIgnoreCase)
            && segments[2].Equals("match", StringComparison.OrdinalIgnoreCase)
            && int.TryParse(segments[3], out var localizedTvMatchId))
        {
            return BuildTvMatchPath(normalizedTarget, localizedTvMatchId, segments[4]) + querySuffix;
        }
        if (segments.Length >= 3)
        {
            if (cleanPath.StartsWith("/stats/teams/", StringComparison.OrdinalIgnoreCase)
                || cleanPath.StartsWith("/en/stats/teams/", StringComparison.OrdinalIgnoreCase)
                || cleanPath.StartsWith("/pt/estatisticas/times/", StringComparison.OrdinalIgnoreCase))
            {
                var slug = segments[^1];
                return BuildStatsTeamDetailPath(normalizedTarget, slug) + querySuffix;
            }
        }

        if (segments.Length >= 3)
        {
            var offset = 0;
            if (_appCultureService.TryGetExplicitCultureFromPath(cleanPath) is not null)
                offset = 1;

            if (segments.Length > offset + 2
                && int.TryParse(segments[offset + 1], out var matchId)
                && IsKnownMatchSegment(segments[offset]))
            {
                return BuildLocalizedPath(normalizedTarget, matchId, segments[offset + 2]) + querySuffix;
            }
        }

        return path;
    }
}
