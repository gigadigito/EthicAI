using DTOs;

namespace CriptoVersus.Web.Services;

public sealed class MatchSeoService
{
    private readonly IConfiguration _configuration;
    private readonly MatchSlugHelper _matchSlugHelper;
    private readonly RouteLocalizationService _routeLocalization;

    public MatchSeoService(
        IConfiguration configuration,
        MatchSlugHelper matchSlugHelper,
        RouteLocalizationService routeLocalization)
    {
        _configuration = configuration;
        _matchSlugHelper = matchSlugHelper;
        _routeLocalization = routeLocalization;
    }

    public string BuildCanonicalUrl(int id, string slug, string? fallbackBaseUri = null)
        => BuildAbsoluteUrl(_routeLocalization.BuildCanonicalPath(id, slug), fallbackBaseUri);

    public IReadOnlyList<AlternateLink> BuildAlternateLinks(int id, string slug, string? fallbackBaseUri = null)
        =>
        [
            new AlternateLink(
                _routeLocalization.GetHrefLang("pt"),
                BuildAbsoluteUrl(_routeLocalization.BuildLocalizedPath("pt", id, slug), fallbackBaseUri)),
            new AlternateLink(
                _routeLocalization.GetHrefLang("en"),
                BuildAbsoluteUrl(_routeLocalization.BuildLocalizedPath("en", id, slug), fallbackBaseUri))
        ];

    public string BuildTitle(MatchDto match)
        => $"{FormatCoinLabel(match.TeamA)} vs {FormatCoinLabel(match.TeamB)} - Resultado da Partida #{match.MatchId} | CriptoVersus";

    public string BuildDescription(MatchDto match)
        => $"Confira resultado, valorizacao, placar, vencedores e desempenho da partida {FormatCoinLabel(match.TeamA)} vs {FormatCoinLabel(match.TeamB)} no CriptoVersus.";

    private string BuildAbsoluteUrl(string path, string? fallbackBaseUri)
    {
        var configuredBaseUrl = _configuration["CriptoVersus:PublicBaseUrl"];
        var baseUrl = !string.IsNullOrWhiteSpace(configuredBaseUrl)
            ? configuredBaseUrl
            : fallbackBaseUri;

        if (string.IsNullOrWhiteSpace(baseUrl))
            throw new InvalidOperationException("Configure CriptoVersus:PublicBaseUrl para gerar URLs SEO absolutas.");

        return new Uri(new Uri(baseUrl.TrimEnd('/') + "/"), path.TrimStart('/')).ToString();
    }

    private string FormatCoinLabel(string ticker)
    {
        var normalized = _matchSlugHelper.NormalizeTicker(ticker);
        return string.IsNullOrWhiteSpace(normalized)
            ? ticker
            : normalized.ToUpperInvariant();
    }
}

public sealed record AlternateLink(string HrefLang, string Href);
