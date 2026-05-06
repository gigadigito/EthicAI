using DTOs;
using System.Globalization;
using System.Net;
using System.Text;

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

    public string BuildSocialImageUrl(int id, string slug, string? fallbackBaseUri = null)
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
        var socialImageUrl = BuildSocialImageUrl(match.MatchId, slug, fallbackBaseUri);

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
            OpenGraphImageUrl = socialImageUrl,
            TwitterImageUrl = socialImageUrl,
            SocialImageAlt = $"Placar da partida {FormatCoinLabel(match.TeamA)} vs {FormatCoinLabel(match.TeamB)} no CriptoVersus.",
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
            MatchSeoStatus.Ongoing => "AO VIVO",
            MatchSeoStatus.Completed => "ENCERRADA",
            MatchSeoStatus.Pending => "EM BREVE",
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
    public string OpenGraphImageUrl { get; init; } = string.Empty;
    public string TwitterImageUrl { get; init; } = string.Empty;
    public string SocialImageAlt { get; init; } = string.Empty;
    public string TwitterCard { get; init; } = "summary_large_image";
}

public enum MatchSeoStatus
{
    Unknown,
    Pending,
    Ongoing,
    Completed
}
