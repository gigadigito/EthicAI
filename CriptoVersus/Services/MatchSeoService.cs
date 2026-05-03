using DTOs;
using System.Globalization;

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

    public string BuildDescription(MatchDto match, string? culture = null)
    {
        var (coinA, coinB) = GetCoinLabels(match);
        var matchLabel = $"{coinA} vs {coinB}";
        var normalizedCulture = _routeLocalization.NormalizeCulture(culture);

        return NormalizeStatus(match.Status) switch
        {
            MatchSeoStatus.Completed => BuildCompletedDescription(match, normalizedCulture, matchLabel),
            MatchSeoStatus.Ongoing => $"Acompanhe ao vivo a partida {matchLabel} no CriptoVersus. Veja placar, desempenho e movimentacao em tempo real.",
            MatchSeoStatus.Pending => $"Veja detalhes da proxima partida {matchLabel} no CriptoVersus.",
            _ => $"Veja detalhes da partida {matchLabel} no CriptoVersus."
        };
    }

    public MatchSeoMetadata BuildMetadata(
        MatchDto match,
        string slug,
        string? culture,
        string? fallbackBaseUri = null)
    {
        var canonicalUrl = BuildCanonicalUrl(match.MatchId, slug, fallbackBaseUri);
        var alternateLinks = BuildAlternateLinks(match.MatchId, slug, fallbackBaseUri);
        var description = BuildDescription(match, culture);
        var ogTitle = $"{FormatCoinLabel(match.TeamA)} vs {FormatCoinLabel(match.TeamB)} | CriptoVersus";

        return new MatchSeoMetadata
        {
            Title = BuildTitle(match),
            Description = string.IsNullOrWhiteSpace(description)
                ? $"Veja detalhes da partida {FormatCoinLabel(match.TeamA)} vs {FormatCoinLabel(match.TeamB)} no CriptoVersus."
                : description,
            CanonicalUrl = canonicalUrl,
            AlternateLinks = alternateLinks,
            OpenGraphTitle = ogTitle,
            OpenGraphDescription = description,
            OpenGraphUrl = canonicalUrl,
            TwitterCard = "summary_large_image"
        };
    }

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

    private string BuildCompletedDescription(MatchDto match, string? culture, string matchLabel)
    {
        var settledAt = match.EndTime ?? match.StartTime;
        if (settledAt is null)
            return $"Resultado da partida {matchLabel} encerrada no CriptoVersus. Veja placar, desempenho, lucros e perdas.";

        var localizedDate = FormatSettledAt(settledAt.Value, culture);
        return $"Resultado da partida {matchLabel} encerrada em {localizedDate} no CriptoVersus. Veja placar, desempenho, lucros e perdas.";
    }

    private string FormatSettledAt(DateTime settledAtUtc, string? culture)
    {
        var utc = settledAtUtc.Kind == DateTimeKind.Utc
            ? settledAtUtc
            : DateTime.SpecifyKind(settledAtUtc, DateTimeKind.Utc);

        if (string.Equals(culture, "en", StringComparison.OrdinalIgnoreCase))
        {
            var timezone = ResolveTimeZone(
                _configuration["CriptoVersus:Seo:TimeZones:En"],
                "UTC",
                TimeZoneInfo.Utc);

            var localized = TimeZoneInfo.ConvertTimeFromUtc(utc, timezone);
            return localized.ToString("MMM d, yyyy", CultureInfo.InvariantCulture);
        }

        var saoPaulo = ResolveTimeZone(
            _configuration["CriptoVersus:Seo:TimeZones:Pt"],
            "America/Sao_Paulo",
            ResolveTimeZone("E. South America Standard Time", null, TimeZoneInfo.Utc));

        return TimeZoneInfo.ConvertTimeFromUtc(utc, saoPaulo)
            .ToString("dd/MM/yyyy", CultureInfo.GetCultureInfo("pt-BR"));
    }

    private static TimeZoneInfo ResolveTimeZone(
        string? preferredTimeZoneId,
        string? fallbackTimeZoneId,
        TimeZoneInfo defaultTimeZone)
    {
        foreach (var candidate in new[] { preferredTimeZoneId, fallbackTimeZoneId })
        {
            if (string.IsNullOrWhiteSpace(candidate))
                continue;

            try
            {
                return TimeZoneInfo.FindSystemTimeZoneById(candidate);
            }
            catch (TimeZoneNotFoundException)
            {
            }
            catch (InvalidTimeZoneException)
            {
            }
        }

        return defaultTimeZone;
    }

    private (string CoinA, string CoinB) GetCoinLabels(MatchDto match)
        => (FormatCoinLabel(match.TeamA), FormatCoinLabel(match.TeamB));

    private string FormatCoinLabel(string ticker)
    {
        var normalized = _matchSlugHelper.NormalizeTicker(ticker);
        return string.IsNullOrWhiteSpace(normalized)
            ? ticker
            : normalized.ToUpperInvariant();
    }

    private static MatchSeoStatus NormalizeStatus(string? status)
        => status?.Trim().ToLowerInvariant() switch
        {
            "completed" => MatchSeoStatus.Completed,
            "ongoing" => MatchSeoStatus.Ongoing,
            "pending" => MatchSeoStatus.Pending,
            _ => MatchSeoStatus.Unknown
        };
}

public sealed record AlternateLink(string HrefLang, string Href);

public sealed class MatchSeoMetadata
{
    public string Title { get; init; } = string.Empty;
    public string Description { get; init; } = string.Empty;
    public string CanonicalUrl { get; init; } = string.Empty;
    public IReadOnlyList<AlternateLink> AlternateLinks { get; init; } = [];
    public string OpenGraphTitle { get; init; } = string.Empty;
    public string OpenGraphDescription { get; init; } = string.Empty;
    public string OpenGraphUrl { get; init; } = string.Empty;
    public string TwitterCard { get; init; } = "summary_large_image";
}

public enum MatchSeoStatus
{
    Unknown,
    Pending,
    Ongoing,
    Completed
}
