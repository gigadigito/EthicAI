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

    public string BuildHowItWorksPath(string? culture)
        => NormalizeCulture(culture) == AppCultureService.SecondaryRouteCulture
            ? "/pt/como-funciona"
            : "/en/how-it-works";

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

        if (cleanPath.Equals("/tokenomics", StringComparison.OrdinalIgnoreCase)
            || cleanPath.Equals("/en/how-it-works", StringComparison.OrdinalIgnoreCase)
            || cleanPath.Equals("/pt/como-funciona", StringComparison.OrdinalIgnoreCase))
            return BuildHowItWorksPath(normalizedTarget) + querySuffix;

        var segments = cleanPath.Trim('/').Split('/', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
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
