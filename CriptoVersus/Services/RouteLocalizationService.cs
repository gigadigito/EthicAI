namespace CriptoVersus.Web.Services;

public sealed class RouteLocalizationService
{
    private readonly AppCultureService _appCultureService;

    private static readonly IReadOnlyDictionary<string, string> MatchSegments =
        new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            [AppCultureService.SecondaryRouteCulture] = "partida",
            [AppCultureService.DefaultRouteCulture] = "match",
            [AppCultureService.TertiaryRouteCulture] = "match"
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
        return $"/{normalizedCulture}/{GetMatchSegment(normalizedCulture)}/{id}/{NormalizeRouteSegment(slug)}";
    }

    public string BuildBestPath(string? culture, int id, string slug)
        => BuildLocalizedPath(NormalizeCulture(culture), id, slug);

    public string GetHrefLang(string culture)
        => _appCultureService.ToHrefLang(culture);

    public string BuildHomePath(string? culture)
        => $"/{NormalizeCulture(culture)}";

    public string BuildRoadmapPath(string? culture)
        => BuildGenericLocalizedPath(culture, "roadmap");

    public string BuildFaqPath(string? culture)
        => BuildGenericLocalizedPath(culture, "faq");

    public string BuildAboutPath(string? culture)
        => BuildGenericLocalizedPath(culture, "about");

    public string BuildScoringRulesPath(string? culture)
        => BuildGenericLocalizedPath(culture, "scoring-rules");

    public string BuildRiskDisclaimerPath(string? culture)
        => BuildGenericLocalizedPath(culture, "risk-disclaimer");

    public string BuildHotMatchesSocialPath(string? culture)
        => BuildGenericLocalizedPath(culture, "social/hot-matches");

    public string BuildHowItWorksPath(string? culture)
        => NormalizeCulture(culture) == AppCultureService.SecondaryRouteCulture
            ? "/pt/como-funciona"
            : $"/{NormalizeCulture(culture)}/how-it-works";

    public string BuildWalletPath(string? culture)
        => NormalizeCulture(culture) == AppCultureService.SecondaryRouteCulture
            ? "/pt/minha-carteira"
            : $"/{NormalizeCulture(culture)}/my-wallet";

    public string BuildAdminPath(string? culture)
        => NormalizeCulture(culture) == AppCultureService.SecondaryRouteCulture
            ? "/pt/admin-sistema"
            : $"/{NormalizeCulture(culture)}/admin-system";

    public string BuildAdminAudioAssetsPath(string? culture)
        => NormalizeCulture(culture) == AppCultureService.SecondaryRouteCulture
            ? "/pt/admin/audio-assets"
            : $"/{NormalizeCulture(culture)}/admin/audio-assets";

    public string BuildStatsPath(string? culture)
        => NormalizeCulture(culture) == AppCultureService.SecondaryRouteCulture
            ? "/pt/estatisticas"
            : $"/{NormalizeCulture(culture)}/stats";

    public string BuildStatsTeamsPath(string? culture)
        => NormalizeCulture(culture) == AppCultureService.SecondaryRouteCulture
            ? "/pt/estatisticas/times"
            : $"/{NormalizeCulture(culture)}/stats/teams";

    public string BuildStatsMatchesPath(string? culture)
        => NormalizeCulture(culture) == AppCultureService.SecondaryRouteCulture
            ? "/pt/estatisticas/partidas"
            : $"/{NormalizeCulture(culture)}/stats/matches";

    public string BuildStatsRankingsPath(string? culture)
        => NormalizeCulture(culture) == AppCultureService.SecondaryRouteCulture
            ? "/pt/estatisticas/rankings"
            : $"/{NormalizeCulture(culture)}/stats/rankings";

    public string BuildStatsRecordsPath(string? culture)
        => NormalizeCulture(culture) == AppCultureService.SecondaryRouteCulture
            ? "/pt/estatisticas/recordes"
            : $"/{NormalizeCulture(culture)}/stats/records";

    public string BuildStatsTeamDetailPath(string? culture, string slug)
    {
        var normalizedSlug = NormalizeRouteSegment(slug);
        return $"{BuildStatsTeamsPath(culture)}/{normalizedSlug}";
    }

    public string BuildTokenPath(string? culture)
        => $"/{NormalizeCulture(culture)}/token";

    public string BuildTvPath(string? culture)
        => $"/{NormalizeCulture(culture)}/tv";

    public string BuildTvBroadcastPath(string? culture)
        => $"{BuildTvPath(culture)}/broadcast";

    public string BuildTvMatchPath(string? culture, int id, string slug)
        => $"{BuildTvPath(culture)}/match/{id}/{NormalizeRouteSegment(slug)}";

    public string BuildLegacyTvPath()
        => "/tv";

    public string BuildLegacyTvMatchPath(int id, string slug)
        => $"/tv/match/{id}/{NormalizeRouteSegment(slug)}";

    public string BuildLegacyMatchPath(string? culture, int id, string slug)
        => NormalizeCulture(culture) == AppCultureService.SecondaryRouteCulture
            ? $"/partida/{id}/{NormalizeRouteSegment(slug)}"
            : $"/match/{id}/{NormalizeRouteSegment(slug)}";

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
            || cleanPath.Equals("/pt/roadmap", StringComparison.OrdinalIgnoreCase)
            || cleanPath.Equals("/zh/roadmap", StringComparison.OrdinalIgnoreCase))
            return BuildRoadmapPath(normalizedTarget) + querySuffix;

        if (cleanPath.Equals("/faq", StringComparison.OrdinalIgnoreCase)
            || cleanPath.Equals("/en/faq", StringComparison.OrdinalIgnoreCase)
            || cleanPath.Equals("/pt/faq", StringComparison.OrdinalIgnoreCase)
            || cleanPath.Equals("/zh/faq", StringComparison.OrdinalIgnoreCase))
            return BuildFaqPath(normalizedTarget) + querySuffix;

        if (cleanPath.Equals("/about", StringComparison.OrdinalIgnoreCase)
            || cleanPath.Equals("/en/about", StringComparison.OrdinalIgnoreCase)
            || cleanPath.Equals("/pt/about", StringComparison.OrdinalIgnoreCase)
            || cleanPath.Equals("/zh/about", StringComparison.OrdinalIgnoreCase))
            return BuildAboutPath(normalizedTarget) + querySuffix;

        if (cleanPath.Equals("/scoring-rules", StringComparison.OrdinalIgnoreCase)
            || cleanPath.Equals("/en/scoring-rules", StringComparison.OrdinalIgnoreCase)
            || cleanPath.Equals("/pt/scoring-rules", StringComparison.OrdinalIgnoreCase)
            || cleanPath.Equals("/zh/scoring-rules", StringComparison.OrdinalIgnoreCase))
            return BuildScoringRulesPath(normalizedTarget) + querySuffix;

        if (cleanPath.Equals("/risk-disclaimer", StringComparison.OrdinalIgnoreCase)
            || cleanPath.Equals("/en/risk-disclaimer", StringComparison.OrdinalIgnoreCase)
            || cleanPath.Equals("/pt/risk-disclaimer", StringComparison.OrdinalIgnoreCase)
            || cleanPath.Equals("/zh/risk-disclaimer", StringComparison.OrdinalIgnoreCase))
            return BuildRiskDisclaimerPath(normalizedTarget) + querySuffix;

        if (cleanPath.Equals("/social/hot-matches", StringComparison.OrdinalIgnoreCase)
            || cleanPath.Equals("/en/social/hot-matches", StringComparison.OrdinalIgnoreCase)
            || cleanPath.Equals("/pt/social/hot-matches", StringComparison.OrdinalIgnoreCase)
            || cleanPath.Equals("/zh/social/hot-matches", StringComparison.OrdinalIgnoreCase))
            return BuildHotMatchesSocialPath(normalizedTarget) + querySuffix;

        if (cleanPath.Equals("/tokenomics", StringComparison.OrdinalIgnoreCase)
            || cleanPath.Equals("/en/how-it-works", StringComparison.OrdinalIgnoreCase)
            || cleanPath.Equals("/pt/como-funciona", StringComparison.OrdinalIgnoreCase)
            || cleanPath.Equals("/zh/how-it-works", StringComparison.OrdinalIgnoreCase))
            return BuildHowItWorksPath(normalizedTarget) + querySuffix;

        if (cleanPath.Equals("/stats", StringComparison.OrdinalIgnoreCase)
            || cleanPath.Equals("/en/stats", StringComparison.OrdinalIgnoreCase)
            || cleanPath.Equals("/pt/estatisticas", StringComparison.OrdinalIgnoreCase)
            || cleanPath.Equals("/zh/stats", StringComparison.OrdinalIgnoreCase))
            return BuildStatsPath(normalizedTarget) + querySuffix;

        if (cleanPath.Equals("/stats/teams", StringComparison.OrdinalIgnoreCase)
            || cleanPath.Equals("/en/stats/teams", StringComparison.OrdinalIgnoreCase)
            || cleanPath.Equals("/pt/estatisticas/times", StringComparison.OrdinalIgnoreCase)
            || cleanPath.Equals("/zh/stats/teams", StringComparison.OrdinalIgnoreCase))
            return BuildStatsTeamsPath(normalizedTarget) + querySuffix;

        if (cleanPath.Equals("/stats/matches", StringComparison.OrdinalIgnoreCase)
            || cleanPath.Equals("/en/stats/matches", StringComparison.OrdinalIgnoreCase)
            || cleanPath.Equals("/pt/estatisticas/partidas", StringComparison.OrdinalIgnoreCase)
            || cleanPath.Equals("/zh/stats/matches", StringComparison.OrdinalIgnoreCase))
            return BuildStatsMatchesPath(normalizedTarget) + querySuffix;

        if (cleanPath.Equals("/stats/rankings", StringComparison.OrdinalIgnoreCase)
            || cleanPath.Equals("/en/stats/rankings", StringComparison.OrdinalIgnoreCase)
            || cleanPath.Equals("/pt/estatisticas/rankings", StringComparison.OrdinalIgnoreCase)
            || cleanPath.Equals("/zh/stats/rankings", StringComparison.OrdinalIgnoreCase))
            return BuildStatsRankingsPath(normalizedTarget) + querySuffix;

        if (cleanPath.Equals("/stats/records", StringComparison.OrdinalIgnoreCase)
            || cleanPath.Equals("/en/stats/records", StringComparison.OrdinalIgnoreCase)
            || cleanPath.Equals("/pt/estatisticas/recordes", StringComparison.OrdinalIgnoreCase)
            || cleanPath.Equals("/zh/stats/records", StringComparison.OrdinalIgnoreCase))
            return BuildStatsRecordsPath(normalizedTarget) + querySuffix;

        if (cleanPath.Equals("/token", StringComparison.OrdinalIgnoreCase)
            || cleanPath.Equals("/en/token", StringComparison.OrdinalIgnoreCase)
            || cleanPath.Equals("/pt/token", StringComparison.OrdinalIgnoreCase)
            || cleanPath.Equals("/zh/token", StringComparison.OrdinalIgnoreCase))
            return BuildTokenPath(normalizedTarget) + querySuffix;

        if (cleanPath.Equals("/admin/audio-assets", StringComparison.OrdinalIgnoreCase)
            || cleanPath.Equals("/en/admin/audio-assets", StringComparison.OrdinalIgnoreCase)
            || cleanPath.Equals("/pt/admin/audio-assets", StringComparison.OrdinalIgnoreCase)
            || cleanPath.Equals("/zh/admin/audio-assets", StringComparison.OrdinalIgnoreCase))
        {
            return BuildAdminAudioAssetsPath(normalizedTarget) + querySuffix;
        }

        var segments = cleanPath.Trim('/').Split('/', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

        if (cleanPath.Equals("/tv", StringComparison.OrdinalIgnoreCase)
            || cleanPath.Equals("/en/tv", StringComparison.OrdinalIgnoreCase)
            || cleanPath.Equals("/pt/tv", StringComparison.OrdinalIgnoreCase)
            || cleanPath.Equals("/zh/tv", StringComparison.OrdinalIgnoreCase))
        {
            return BuildTvPath(normalizedTarget) + querySuffix;
        }

        if (cleanPath.Equals("/tv/broadcast", StringComparison.OrdinalIgnoreCase)
            || cleanPath.Equals("/en/tv/broadcast", StringComparison.OrdinalIgnoreCase)
            || cleanPath.Equals("/pt/tv/broadcast", StringComparison.OrdinalIgnoreCase)
            || cleanPath.Equals("/zh/tv/broadcast", StringComparison.OrdinalIgnoreCase))
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
                || cleanPath.StartsWith("/pt/estatisticas/times/", StringComparison.OrdinalIgnoreCase)
                || cleanPath.StartsWith("/zh/stats/teams/", StringComparison.OrdinalIgnoreCase))
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

    private string BuildGenericLocalizedPath(string? culture, string slug)
        => NormalizeCulture(culture) == AppCultureService.SecondaryRouteCulture
            ? $"/pt/{slug}"
            : $"/{NormalizeCulture(culture)}/{slug}";

    private static string NormalizeRouteSegment(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
            return string.Empty;

        var trimmed = value.Trim();
        try
        {
            return Uri.EscapeDataString(Uri.UnescapeDataString(trimmed));
        }
        catch
        {
            return Uri.EscapeDataString(trimmed);
        }
    }
}

