using DTOs;
using System.Globalization;
using System.Net;
using System.Text;

namespace CriptoVersus.Web.Services;

public sealed class MatchSeoService
{
    private readonly AppCultureService _appCultureService;
    private readonly IConfiguration _configuration;
    private readonly LocalizationService _localizationService;
    private readonly MatchSlugHelper _matchSlugHelper;
    private readonly RouteLocalizationService _routeLocalization;

    public MatchSeoService(
        AppCultureService appCultureService,
        IConfiguration configuration,
        LocalizationService localizationService,
        MatchSlugHelper matchSlugHelper,
        RouteLocalizationService routeLocalization)
    {
        _appCultureService = appCultureService;
        _configuration = configuration;
        _localizationService = localizationService;
        _matchSlugHelper = matchSlugHelper;
        _routeLocalization = routeLocalization;
    }

    public string BuildCanonicalUrl(string? culture, int id, string slug, string? fallbackBaseUri = null)
        => BuildAbsoluteUrl(_routeLocalization.BuildLocalizedPath(_appCultureService.NormalizeRouteCulture(culture), id, slug), fallbackBaseUri);

    public string BuildSocialImageUrl(string? culture, int id, string slug, string? fallbackBaseUri = null)
        => BuildAbsoluteUrl($"/social-images/match/{id}/{slug}.svg", fallbackBaseUri);

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

    public string BuildTitle(MatchDto match, string? culture)
    {
        var normalizedCulture = _appCultureService.NormalizeRouteCulture(culture);
        var (coinA, coinB) = GetCoinLabels(match);

        return NormalizeStatus(match.Status) switch
        {
            MatchSeoStatus.Completed => _localizationService.T("match.seo.completed.title", normalizedCulture, coinA, coinB),
            MatchSeoStatus.Ongoing => _localizationService.T("match.seo.live.title", normalizedCulture, coinA, coinB),
            MatchSeoStatus.Pending => _localizationService.T("match.seo.pending.title", normalizedCulture, coinA, coinB),
            _ => _localizationService.T("match.seo.fallback.title", normalizedCulture, coinA, coinB)
        };
    }

    public string BuildDescription(MatchDto match, string? culture = null)
    {
        var (coinA, coinB) = GetCoinLabels(match);
        var normalizedCulture = _appCultureService.NormalizeRouteCulture(culture);

        return NormalizeStatus(match.Status) switch
        {
            MatchSeoStatus.Completed => _localizationService.T("match.seo.completed.description", normalizedCulture, coinA, coinB),
            MatchSeoStatus.Ongoing => _localizationService.T("match.seo.live.description", normalizedCulture, coinA, coinB),
            MatchSeoStatus.Pending => _localizationService.T("match.seo.pending.description", normalizedCulture, coinA, coinB),
            _ => _localizationService.T("match.seo.fallback.description", normalizedCulture, coinA, coinB)
        };
    }

    public MatchSeoMetadata BuildMetadata(
        MatchDto match,
        string slug,
        string? culture,
        string? fallbackBaseUri = null)
    {
        var normalizedCulture = _appCultureService.NormalizeRouteCulture(culture);
        var canonicalUrl = BuildCanonicalUrl(normalizedCulture, match.MatchId, slug, fallbackBaseUri);
        var alternateLinks = BuildAlternateLinks(match.MatchId, slug, fallbackBaseUri);
        var description = BuildDescription(match, culture);
        var ogTitle = $"{FormatCoinLabel(match.TeamA)} vs {FormatCoinLabel(match.TeamB)} | CriptoVersus";
        var socialImageUrl = BuildSocialImageUrl(normalizedCulture, match.MatchId, slug, fallbackBaseUri);

        return new MatchSeoMetadata
        {
            Title = BuildTitle(match, normalizedCulture),
            Description = string.IsNullOrWhiteSpace(description)
                ? _localizationService.T("match.seo.fallback.description", normalizedCulture, FormatCoinLabel(match.TeamA), FormatCoinLabel(match.TeamB))
                : description,
            CanonicalUrl = canonicalUrl,
            AlternateLinks = alternateLinks,
            OpenGraphTitle = ogTitle,
            OpenGraphDescription = description,
            OpenGraphUrl = canonicalUrl,
            OpenGraphLocale = _appCultureService.ToOgLocale(normalizedCulture),
            OpenGraphAlternateLocale = _appCultureService.GetAlternateOgLocale(normalizedCulture),
            OpenGraphImageUrl = socialImageUrl,
            TwitterImageUrl = socialImageUrl,
            SocialImageAlt = _localizationService.T("match.seo.fallback.title", normalizedCulture, FormatCoinLabel(match.TeamA), FormatCoinLabel(match.TeamB)),
            TwitterTitle = BuildTitle(match, normalizedCulture),
            TwitterDescription = description,
            XDefaultUrl = BuildAbsoluteUrl(_routeLocalization.BuildLocalizedPath(AppCultureService.DefaultRouteCulture, match.MatchId, slug), fallbackBaseUri),
            TwitterCard = "summary_large_image"
        };
    }

    public string BuildSocialImageSvg(MatchDto match)
    {
        var teamA = FormatCoinLabel(match.TeamA);
        var teamB = FormatCoinLabel(match.TeamB);
        var score = $"{match.ScoreA} x {match.ScoreB}";
        var status = NormalizeStatus(match.Status) switch
        {
            MatchSeoStatus.Ongoing => _localizationService.T("match.status.ongoing", AppCultureService.DefaultRouteCulture),
            MatchSeoStatus.Completed => _localizationService.T("match.status.completed", AppCultureService.DefaultRouteCulture),
            MatchSeoStatus.Pending => _localizationService.T("match.status.pending", AppCultureService.DefaultRouteCulture),
            _ => string.IsNullOrWhiteSpace(match.Status) ? "PARTIDA" : match.Status.Trim().ToUpperInvariant()
        };

        var minuteText = NormalizeStatus(match.Status) switch
        {
            MatchSeoStatus.Ongoing => $"{Math.Max(match.ElapsedMinutes, 0)}'",
            MatchSeoStatus.Completed => "RESULTADO FINAL",
            MatchSeoStatus.Pending => "AGUARDANDO INICIO",
            _ => "CRYPTO ARENA"
        };

        var pctA = FormatSignedPercent(match.PctA);
        var pctB = FormatSignedPercent(match.PctB);
        var matchId = $"MATCH #{match.MatchId}";
        var poolA = $"{match.PoolStrengthTeamA}% POOL";
        var poolB = $"{match.PoolStrengthTeamB}% POOL";

        return $$"""
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" role="img" aria-labelledby="title desc">
  <title id="title">CriptoVersus - social share</title>
  <desc id="desc">Resumo visual da partida para compartilhamento social.</desc>
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#061a1e"/>
      <stop offset="55%" stop-color="#0b1220"/>
      <stop offset="100%" stop-color="#241128"/>
    </linearGradient>
    <linearGradient id="cardA" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="rgba(16,185,129,.22)"/>
      <stop offset="100%" stop-color="rgba(15,23,42,.88)"/>
    </linearGradient>
    <linearGradient id="cardB" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="rgba(168,85,247,.18)"/>
      <stop offset="100%" stop-color="rgba(15,23,42,.88)"/>
    </linearGradient>
    <linearGradient id="scoreCard" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="rgba(255,255,255,.08)"/>
      <stop offset="100%" stop-color="rgba(255,255,255,.02)"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" rx="34" fill="url(#bg)"/>
  <rect x="20" y="20" width="1160" height="590" rx="30" fill="none" stroke="rgba(255,255,255,.08)"/>
  <text x="64" y="76" fill="rgba(255,255,255,.62)" font-size="18" font-family="Arial, Helvetica, sans-serif" font-weight="700" letter-spacing="6">CRIPTO ARENA</text>
  <text x="64" y="126" fill="#f8fafc" font-size="54" font-family="Arial, Helvetica, sans-serif" font-weight="900">{{EscapeXml(teamA)}} vs {{EscapeXml(teamB)}}</text>
  <rect x="882" y="44" width="152" height="54" rx="27" fill="rgba(37,99,235,.14)" stroke="rgba(148,163,184,.2)"/>
  <text x="958" y="78" text-anchor="middle" fill="#f8fafc" font-size="24" font-family="Arial, Helvetica, sans-serif" font-weight="800">{{EscapeXml(status)}}</text>
  <rect x="1048" y="44" width="108" height="54" rx="27" fill="rgba(255,255,255,.06)" stroke="rgba(255,255,255,.1)"/>
  <text x="1102" y="78" text-anchor="middle" fill="#e2e8f0" font-size="22" font-family="Arial, Helvetica, sans-serif" font-weight="800">{{EscapeXml(matchId)}}</text>
  <rect x="64" y="168" width="330" height="210" rx="28" fill="url(#cardA)" stroke="rgba(255,255,255,.09)"/>
  <rect x="806" y="168" width="330" height="210" rx="28" fill="url(#cardB)" stroke="rgba(255,255,255,.09)"/>
  <rect x="426" y="168" width="348" height="210" rx="28" fill="url(#scoreCard)" stroke="rgba(255,255,255,.09)"/>
  <text x="96" y="232" fill="#f8fafc" font-size="40" font-family="Arial, Helvetica, sans-serif" font-weight="900">{{EscapeXml(teamA)}}</text>
  <text x="96" y="272" fill="#00f39a" font-size="28" font-family="Arial, Helvetica, sans-serif" font-weight="800">{{EscapeXml(pctA)}}</text>
  <text x="96" y="326" fill="rgba(255,255,255,.58)" font-size="21" font-family="Arial, Helvetica, sans-serif" font-weight="700" letter-spacing="2">{{EscapeXml(poolA)}}</text>
  <text x="96" y="356" fill="rgba(255,255,255,.42)" font-size="19" font-family="Arial, Helvetica, sans-serif">{{EscapeXml($"{match.BetCountTeamA} apostas")}}</text>
  <text x="96" y="386" fill="rgba(255,255,255,.42)" font-size="19" font-family="Arial, Helvetica, sans-serif">{{EscapeXml($"{FormatCompactNumber(match.TotalAmountTeamA)} volume")}}</text>
  <text x="970" y="232" text-anchor="middle" fill="#f8fafc" font-size="40" font-family="Arial, Helvetica, sans-serif" font-weight="900">{{EscapeXml(teamB)}}</text>
  <text x="970" y="272" text-anchor="middle" fill="#00f39a" font-size="28" font-family="Arial, Helvetica, sans-serif" font-weight="800">{{EscapeXml(pctB)}}</text>
  <text x="970" y="326" text-anchor="middle" fill="rgba(255,255,255,.58)" font-size="21" font-family="Arial, Helvetica, sans-serif" font-weight="700" letter-spacing="2">{{EscapeXml(poolB)}}</text>
  <text x="970" y="356" text-anchor="middle" fill="rgba(255,255,255,.42)" font-size="19" font-family="Arial, Helvetica, sans-serif">{{EscapeXml($"{match.BetCountTeamB} apostas")}}</text>
  <text x="970" y="386" text-anchor="middle" fill="rgba(255,255,255,.42)" font-size="19" font-family="Arial, Helvetica, sans-serif">{{EscapeXml($"{FormatCompactNumber(match.TotalAmountTeamB)} volume")}}</text>
  <text x="600" y="252" text-anchor="middle" fill="#f8fafc" font-size="88" font-family="Arial, Helvetica, sans-serif" font-weight="900">{{EscapeXml(score)}}</text>
  <text x="600" y="305" text-anchor="middle" fill="rgba(255,255,255,.56)" font-size="22" font-family="Arial, Helvetica, sans-serif" font-weight="800" letter-spacing="3">CRONOMETRO</text>
  <text x="600" y="346" text-anchor="middle" fill="#f8fafc" font-size="34" font-family="Arial, Helvetica, sans-serif" font-weight="900">{{EscapeXml(minuteText)}}</text>
  <rect x="64" y="418" width="1072" height="124" rx="26" fill="rgba(255,255,255,.03)" stroke="rgba(255,255,255,.08)"/>
  <text x="96" y="468" fill="#f8fafc" font-size="24" font-family="Arial, Helvetica, sans-serif" font-weight="800">Acompanhe ao vivo no CriptoVersus</text>
  <text x="96" y="508" fill="rgba(255,255,255,.66)" font-size="22" font-family="Arial, Helvetica, sans-serif">Placar, desempenho, volume e clima de arena em tempo real.</text>
  <text x="96" y="578" fill="rgba(255,255,255,.88)" font-size="32" font-family="Arial, Helvetica, sans-serif" font-weight="900" letter-spacing="2">CRIPTOVERSUS</text>
</svg>
""";
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

    private (string CoinA, string CoinB) GetCoinLabels(MatchDto match)
        => (FormatCoinLabel(match.TeamA), FormatCoinLabel(match.TeamB));

    private string FormatCoinLabel(string ticker)
    {
        var normalized = _matchSlugHelper.NormalizeTicker(ticker);
        return string.IsNullOrWhiteSpace(normalized)
            ? ticker
            : normalized.ToUpperInvariant();
    }

    private static string FormatSignedPercent(decimal? value)
    {
        if (!value.HasValue)
            return "0.00%";

        return value.Value >= 0
            ? $"+{value.Value:0.00}%"
            : $"{value.Value:0.00}%";
    }

    private static string FormatCompactNumber(decimal value)
    {
        var abs = Math.Abs(value);
        if (abs >= 1_000_000_000m)
            return $"{value / 1_000_000_000m:0.##}B";
        if (abs >= 1_000_000m)
            return $"{value / 1_000_000m:0.##}M";
        if (abs >= 1_000m)
            return $"{value / 1_000m:0.##}K";

        return $"{value:0.##} SOL";
    }

    private static string EscapeXml(string? value)
        => WebUtility.HtmlEncode(value ?? string.Empty);

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
    public string OpenGraphLocale { get; init; } = string.Empty;
    public string OpenGraphAlternateLocale { get; init; } = string.Empty;
    public string OpenGraphImageUrl { get; init; } = string.Empty;
    public string TwitterTitle { get; init; } = string.Empty;
    public string TwitterDescription { get; init; } = string.Empty;
    public string TwitterImageUrl { get; init; } = string.Empty;
    public string SocialImageAlt { get; init; } = string.Empty;
    public string XDefaultUrl { get; init; } = string.Empty;
    public string TwitterCard { get; init; } = "summary_large_image";
}

public enum MatchSeoStatus
{
    Unknown,
    Pending,
    Ongoing,
    Completed
}
