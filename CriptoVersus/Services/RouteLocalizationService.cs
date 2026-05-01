namespace CriptoVersus.Web.Services;

public sealed class RouteLocalizationService
{
    private static readonly IReadOnlyDictionary<string, string> MatchSegments =
        new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            ["pt"] = "partida",
            ["en"] = "match"
        };

    public string? NormalizeCulture(string? culture)
    {
        if (string.IsNullOrWhiteSpace(culture))
            return null;

        var normalized = culture.Trim().ToLowerInvariant();
        return MatchSegments.ContainsKey(normalized) ? normalized : null;
    }

    public string GetMatchSegment(string? culture)
    {
        var normalizedCulture = NormalizeCulture(culture);
        return normalizedCulture is not null && MatchSegments.TryGetValue(normalizedCulture, out var segment)
            ? segment
            : "match";
    }

    public bool IsKnownMatchSegment(string? segment)
        => !string.IsNullOrWhiteSpace(segment)
           && MatchSegments.Values.Contains(segment.Trim(), StringComparer.OrdinalIgnoreCase);

    public string BuildCanonicalPath(int id, string slug)
        => $"/match/{id}/{slug}";

    public string BuildLocalizedPath(string culture, int id, string slug)
    {
        var normalizedCulture = NormalizeCulture(culture)
            ?? throw new ArgumentException("Unsupported culture.", nameof(culture));

        return $"/{normalizedCulture}/{GetMatchSegment(normalizedCulture)}/{id}/{slug}";
    }

    public string BuildBestPath(string? culture, int id, string slug)
    {
        var normalizedCulture = NormalizeCulture(culture);
        return normalizedCulture is null
            ? BuildCanonicalPath(id, slug)
            : BuildLocalizedPath(normalizedCulture, id, slug);
    }

    public string GetHrefLang(string culture)
        => NormalizeCulture(culture) switch
        {
            "pt" => "pt-br",
            "en" => "en",
            _ => throw new ArgumentException("Unsupported culture.", nameof(culture))
        };
}
