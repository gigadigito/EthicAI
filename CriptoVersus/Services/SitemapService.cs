using System.Globalization;
using System.Net.Http.Json;
using System.Xml.Linq;
using DTOs;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Options;

namespace CriptoVersus.Web.Services;

public sealed class SitemapService
{
    private const int SitemapCacheMinutes = 5;
    private static readonly string[] StatsVisualSuffixes = ["USDT", "USDC", "BUSD", "FDUSD", "BTC", "ETH"];
    private const string IndexCacheKey = "sitemap::index";
    private const string PagesCacheKey = "sitemap::pages";
    private const string MatchesEnCacheKey = "sitemap::matches::en";
    private const string MatchesPtCacheKey = "sitemap::matches::pt";

    private static readonly XNamespace SitemapNamespace = "http://www.sitemaps.org/schemas/sitemap/0.9";
    private static readonly XNamespace XhtmlNamespace = "http://www.w3.org/1999/xhtml";

    private readonly IHttpClientFactory _httpClientFactory;
    private readonly IConfiguration _configuration;
    private readonly IMemoryCache _memoryCache;
    private readonly MatchSlugHelper _matchSlugHelper;
    private readonly RouteLocalizationService _routeLocalization;
    private readonly SitemapOptions _options;

    public SitemapService(
        IHttpClientFactory httpClientFactory,
        IConfiguration configuration,
        IMemoryCache memoryCache,
        MatchSlugHelper matchSlugHelper,
        RouteLocalizationService routeLocalization,
        IOptions<SitemapOptions> options)
    {
        _httpClientFactory = httpClientFactory;
        _configuration = configuration;
        _memoryCache = memoryCache;
        _matchSlugHelper = matchSlugHelper;
        _routeLocalization = routeLocalization;
        _options = options.Value;
    }

    public async Task<string> GetSitemapIndexXmlAsync(CancellationToken ct = default)
        => await GetCachedXmlAsync(IndexCacheKey, () => BuildSitemapIndexXmlAsync(ct));

    public async Task<string> GetPagesSitemapXmlAsync(CancellationToken ct = default)
        => await GetCachedXmlAsync(PagesCacheKey, () => BuildPagesSitemapXmlAsync(ct));

    public async Task<string> GetMatchSitemapXmlAsync(string culture, CancellationToken ct = default)
    {
        var normalizedCulture = _routeLocalization.NormalizeCulture(culture);
        var cacheKey = normalizedCulture == "pt" ? MatchesPtCacheKey : MatchesEnCacheKey;
        return await GetCachedXmlAsync(cacheKey, () => BuildMatchSitemapXmlAsync(normalizedCulture, ct));
    }

    public Task<string> GetRobotsTxtAsync(CancellationToken ct = default)
    {
        var baseUri = GetPublicBaseUri();
        var sitemapUri = new Uri(baseUri, "/sitemap.xml");
        var content = $"User-agent: *{Environment.NewLine}Allow: /{Environment.NewLine}Sitemap: {sitemapUri}";
        return Task.FromResult(content);
    }

    private async Task<string> GetCachedXmlAsync(string cacheKey, Func<Task<string>> factory)
    {
        var cached = await _memoryCache.GetOrCreateAsync(cacheKey, async entry =>
        {
            entry.AbsoluteExpirationRelativeToNow = TimeSpan.FromMinutes(SitemapCacheMinutes);
            return await factory();
        });

        return cached ?? string.Empty;
    }

    private Task<string> BuildSitemapIndexXmlAsync(CancellationToken ct)
    {
        var baseUri = GetPublicBaseUri();
        var now = DateTime.UtcNow;

        var elements =
            new[]
            {
                "/sitemap-pages.xml",
                "/sitemap-matches-en.xml",
                "/sitemap-matches-pt.xml"
            }
            .Select(path => new XElement(
                SitemapNamespace + "sitemap",
                new XElement(SitemapNamespace + "loc", new Uri(baseUri, path).AbsoluteUri),
                new XElement(SitemapNamespace + "lastmod", FormatSitemapUtc(now))));

        var document = new XDocument(
            new XDeclaration("1.0", "UTF-8", null),
            new XElement(SitemapNamespace + "sitemapindex", elements));

        return Task.FromResult(document.ToString(SaveOptions.DisableFormatting));
    }

    private async Task<string> BuildPagesSitemapXmlAsync(CancellationToken ct)
    {
        var baseUri = GetPublicBaseUri();
        var now = DateTime.UtcNow;
        var statsTeams = await GetIndexableStatsTeamsAsync(ct);
        var statsLastModifiedUtc = statsTeams
            .Select(team => team.LastMatchUtc)
            .Where(value => value.HasValue)
            .Select(value => EnsureUtc(value!.Value))
            .DefaultIfEmpty(now)
            .Max();

        var entries = new List<SitemapEntry>
        {
            CreateLocalizedEntry(baseUri, "en", _routeLocalization.BuildHomePath("en"), now, "daily", 1.0m),
            CreateLocalizedEntry(baseUri, "pt", _routeLocalization.BuildHomePath("pt"), now, "daily", 0.9m),
            CreateLocalizedEntry(baseUri, "en", _routeLocalization.BuildStatsPath("en"), statsLastModifiedUtc, "hourly", 0.85m),
            CreateLocalizedEntry(baseUri, "pt", _routeLocalization.BuildStatsPath("pt"), statsLastModifiedUtc, "hourly", 0.85m),
            CreateLocalizedEntry(baseUri, "en", _routeLocalization.BuildStatsTeamsPath("en"), statsLastModifiedUtc, "daily", 0.8m),
            CreateLocalizedEntry(baseUri, "pt", _routeLocalization.BuildStatsTeamsPath("pt"), statsLastModifiedUtc, "daily", 0.8m),
            CreateLocalizedEntry(baseUri, "en", _routeLocalization.BuildRoadmapPath("en"), now, "weekly", 0.8m),
            CreateLocalizedEntry(baseUri, "pt", _routeLocalization.BuildRoadmapPath("pt"), now, "weekly", 0.8m),
            CreateLocalizedEntry(baseUri, "en", _routeLocalization.BuildHowItWorksPath("en"), now, "weekly", 0.8m),
            CreateLocalizedEntry(baseUri, "pt", _routeLocalization.BuildHowItWorksPath("pt"), now, "weekly", 0.8m),
            CreateAbsoluteEntry("https://mcp.criptoversus.com/", now, "weekly", 0.6m)
        };

        foreach (var team in statsTeams)
        {
            var slug = BuildStatsTeamSlug(team);
            if (string.IsNullOrWhiteSpace(slug))
                continue;

            var teamLastModifiedUtc = team.LastMatchUtc.HasValue
                ? EnsureUtc(team.LastMatchUtc.Value)
                : statsLastModifiedUtc;

            entries.Add(CreateLocalizedEntry(
                baseUri,
                "en",
                _routeLocalization.BuildStatsTeamDetailPath("en", slug),
                teamLastModifiedUtc,
                "daily",
                0.65m));

            entries.Add(CreateLocalizedEntry(
                baseUri,
                "pt",
                _routeLocalization.BuildStatsTeamDetailPath("pt", slug),
                teamLastModifiedUtc,
                "daily",
                0.65m));
        }

        return BuildUrlSet(entries);
    }

    private async Task<string> BuildMatchSitemapXmlAsync(string culture, CancellationToken ct)
    {
        var baseUri = GetPublicBaseUri();
        var entries = new List<SitemapEntry>();

        foreach (var match in await GetRelevantMatchesAsync(ct))
        {
            var slug = _matchSlugHelper.BuildSlug(match.TeamA, match.TeamB);
            if (string.IsNullOrWhiteSpace(slug))
                continue;

            var path = _routeLocalization.BuildLocalizedPath(culture, match.MatchId, slug);
            entries.Add(CreateLocalizedEntry(
                baseUri,
                culture,
                path,
                GetRelevantTimestampUtc(match),
                match.IsFinished ? "monthly" : "daily",
                match.IsFinished ? 0.6m : 0.7m));
        }

        return BuildUrlSet(entries);
    }

    private string BuildUrlSet(IEnumerable<SitemapEntry> entries)
    {
        var urlElements = entries
            .Where(entry => entry.IsValid)
            .GroupBy(entry => entry.Location, StringComparer.OrdinalIgnoreCase)
            .Select(group => group.OrderByDescending(item => item.LastModifiedUtc).First())
            .OrderByDescending(entry => entry.Priority)
            .ThenByDescending(entry => entry.LastModifiedUtc)
            .ThenBy(entry => entry.Location, StringComparer.OrdinalIgnoreCase)
            .Select(entry =>
            {
                var urlElement = new XElement(
                    SitemapNamespace + "url",
                    new XAttribute(XNamespace.Xmlns + "xhtml", XhtmlNamespace),
                    new XElement(SitemapNamespace + "loc", entry.Location),
                    new XElement(SitemapNamespace + "lastmod", FormatSitemapUtc(entry.LastModifiedUtc)),
                    new XElement(SitemapNamespace + "changefreq", entry.ChangeFrequency),
                    new XElement(SitemapNamespace + "priority", entry.Priority.ToString("0.00", CultureInfo.InvariantCulture)));

                foreach (var alternate in entry.Alternates)
                {
                    urlElement.Add(new XElement(
                        XhtmlNamespace + "link",
                        new XAttribute("rel", "alternate"),
                        new XAttribute("hreflang", alternate.HrefLang),
                        new XAttribute("href", alternate.Href)));
                }

                if (!string.IsNullOrWhiteSpace(entry.XDefaultHref))
                {
                    urlElement.Add(new XElement(
                        XhtmlNamespace + "link",
                        new XAttribute("rel", "alternate"),
                        new XAttribute("hreflang", "x-default"),
                        new XAttribute("href", entry.XDefaultHref)));
                }

                return urlElement;
            });

        var document = new XDocument(
            new XDeclaration("1.0", "UTF-8", null),
            new XElement(SitemapNamespace + "urlset", urlElements));

        return document.ToString(SaveOptions.DisableFormatting);
    }

    private async Task<IReadOnlyList<MatchDto>> GetRelevantMatchesAsync(CancellationToken ct)
    {
        var client = _httpClientFactory.CreateClient("CriptoVersusApi");
        var safeTake = Math.Clamp(_options.ApiTake, 1, 2000);
        var matches = await client.GetFromJsonAsync<List<MatchDto>>($"api/Matches?take={safeTake}", ct) ?? [];
        var cutoff = DateTime.UtcNow.AddDays(-Math.Max(1, _options.RecentMatchWindowDays));

        return matches
            .Where(match => match.MatchId > 0)
            .Where(match => IsIndexableMatch(match, cutoff))
            .OrderByDescending(GetRelevantTimestampUtc)
            .Take(Math.Max(1, _options.MaxMatchEntriesPerCulture))
            .ToArray();
    }

    private async Task<IReadOnlyList<StatsArenaTeamDto>> GetIndexableStatsTeamsAsync(CancellationToken ct)
    {
        try
        {
            var client = _httpClientFactory.CreateClient("CriptoVersusApi");
            var teams = await client.GetFromJsonAsync<List<StatsArenaTeamDto>>("api/stats/teams", ct) ?? [];

            return teams
                .Where(team => !string.IsNullOrWhiteSpace(BuildStatsTeamSlug(team)))
                .ToArray();
        }
        catch
        {
            return [];
        }
    }

    private bool IsIndexableMatch(MatchDto match, DateTime cutoffUtc)
    {
        if (IsOngoing(match.Status))
            return _options.IncludeOngoingMatches;

        if (IsPending(match.Status))
            return _options.IncludePendingMatches && GetRelevantTimestampUtc(match) >= cutoffUtc;

        if (match.IsFinished || IsCompleted(match.Status))
            return _options.IncludeFinishedMatches && GetRelevantTimestampUtc(match) >= cutoffUtc;

        return GetRelevantTimestampUtc(match) >= cutoffUtc;
    }

    private Uri GetPublicBaseUri()
    {
        var publicBaseUrl = _configuration["CriptoVersus:PublicBaseUrl"]?.Trim();
        if (string.IsNullOrWhiteSpace(publicBaseUrl))
            throw new InvalidOperationException("CriptoVersus:PublicBaseUrl nao configurado para sitemap.");

        if (!Uri.TryCreate(publicBaseUrl.EndsWith('/') ? publicBaseUrl : publicBaseUrl + "/", UriKind.Absolute, out var baseUri))
            throw new InvalidOperationException("CriptoVersus:PublicBaseUrl invalido para sitemap.");

        return baseUri;
    }

    private SitemapEntry CreateLocalizedEntry(
        Uri baseUri,
        string culture,
        string relativePath,
        DateTime lastModifiedUtc,
        string changeFrequency,
        decimal priority)
    {
        if (!relativePath.StartsWith('/'))
            relativePath = "/" + relativePath;

        if (!Uri.TryCreate(baseUri, relativePath, out var fullUri))
            return SitemapEntry.Invalid;

        var slugAlternates = BuildAlternates(baseUri, relativePath);
        var xDefaultHref = BuildXDefaultHref(baseUri, relativePath);

        return new SitemapEntry(
            fullUri.AbsoluteUri,
            EnsureUtc(lastModifiedUtc),
            changeFrequency,
            priority,
            slugAlternates,
            xDefaultHref,
            true);
    }

    private static SitemapEntry CreateAbsoluteEntry(
        string absoluteUrl,
        DateTime lastModifiedUtc,
        string changeFrequency,
        decimal priority)
    {
        if (!Uri.TryCreate(absoluteUrl, UriKind.Absolute, out var fullUri))
            return SitemapEntry.Invalid;

        return new SitemapEntry(
            fullUri.AbsoluteUri,
            EnsureUtc(lastModifiedUtc),
            changeFrequency,
            priority,
            [],
            string.Empty,
            true);
    }

    private IReadOnlyList<SitemapAlternate> BuildAlternates(Uri baseUri, string relativePath)
    {
        var alternates = new List<SitemapAlternate>(2);

        switch (relativePath)
        {
            case "/en":
            case "/pt":
                alternates.Add(new SitemapAlternate("en-US", new Uri(baseUri, _routeLocalization.BuildHomePath("en")).AbsoluteUri));
                alternates.Add(new SitemapAlternate("pt-BR", new Uri(baseUri, _routeLocalization.BuildHomePath("pt")).AbsoluteUri));
                return alternates;
            case "/en/roadmap":
            case "/pt/roadmap":
                alternates.Add(new SitemapAlternate("en-US", new Uri(baseUri, _routeLocalization.BuildRoadmapPath("en")).AbsoluteUri));
                alternates.Add(new SitemapAlternate("pt-BR", new Uri(baseUri, _routeLocalization.BuildRoadmapPath("pt")).AbsoluteUri));
                return alternates;
            case "/stats":
            case "/pt/estatisticas":
                alternates.Add(new SitemapAlternate("en-US", new Uri(baseUri, _routeLocalization.BuildStatsPath("en")).AbsoluteUri));
                alternates.Add(new SitemapAlternate("pt-BR", new Uri(baseUri, _routeLocalization.BuildStatsPath("pt")).AbsoluteUri));
                return alternates;
            case "/stats/teams":
            case "/pt/estatisticas/times":
                alternates.Add(new SitemapAlternate("en-US", new Uri(baseUri, _routeLocalization.BuildStatsTeamsPath("en")).AbsoluteUri));
                alternates.Add(new SitemapAlternate("pt-BR", new Uri(baseUri, _routeLocalization.BuildStatsTeamsPath("pt")).AbsoluteUri));
                return alternates;
            case "/en/how-it-works":
            case "/pt/como-funciona":
                alternates.Add(new SitemapAlternate("en-US", new Uri(baseUri, _routeLocalization.BuildHowItWorksPath("en")).AbsoluteUri));
                alternates.Add(new SitemapAlternate("pt-BR", new Uri(baseUri, _routeLocalization.BuildHowItWorksPath("pt")).AbsoluteUri));
                return alternates;
        }

        if (TryExtractStatsTeamSlug(relativePath, out var statsTeamSlug))
        {
            alternates.Add(new SitemapAlternate("en-US", new Uri(baseUri, _routeLocalization.BuildStatsTeamDetailPath("en", statsTeamSlug)).AbsoluteUri));
            alternates.Add(new SitemapAlternate("pt-BR", new Uri(baseUri, _routeLocalization.BuildStatsTeamDetailPath("pt", statsTeamSlug)).AbsoluteUri));
            return alternates;
        }

        var segments = relativePath.Trim('/').Split('/', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        if (segments.Length >= 4 && int.TryParse(segments[2], out var matchId))
        {
            var slug = segments[3];
            alternates.Add(new SitemapAlternate("en-US", new Uri(baseUri, _routeLocalization.BuildLocalizedPath("en", matchId, slug)).AbsoluteUri));
            alternates.Add(new SitemapAlternate("pt-BR", new Uri(baseUri, _routeLocalization.BuildLocalizedPath("pt", matchId, slug)).AbsoluteUri));
        }

        return alternates;
    }

    private string BuildXDefaultHref(Uri baseUri, string relativePath)
    {
        switch (relativePath)
        {
            case "/en":
            case "/pt":
                return new Uri(baseUri, _routeLocalization.BuildHomePath("en")).AbsoluteUri;
            case "/en/roadmap":
            case "/pt/roadmap":
                return new Uri(baseUri, _routeLocalization.BuildRoadmapPath("en")).AbsoluteUri;
            case "/stats":
            case "/pt/estatisticas":
                return new Uri(baseUri, _routeLocalization.BuildStatsPath("en")).AbsoluteUri;
            case "/stats/teams":
            case "/pt/estatisticas/times":
                return new Uri(baseUri, _routeLocalization.BuildStatsTeamsPath("en")).AbsoluteUri;
            case "/en/how-it-works":
            case "/pt/como-funciona":
                return new Uri(baseUri, _routeLocalization.BuildHowItWorksPath("en")).AbsoluteUri;
        }

        if (TryExtractStatsTeamSlug(relativePath, out var statsTeamSlug))
            return new Uri(baseUri, _routeLocalization.BuildStatsTeamDetailPath("en", statsTeamSlug)).AbsoluteUri;

        var segments = relativePath.Trim('/').Split('/', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        if (segments.Length >= 4 && int.TryParse(segments[2], out var matchId))
        {
            var slug = segments[3];
            return new Uri(baseUri, _routeLocalization.BuildLocalizedPath("en", matchId, slug)).AbsoluteUri;
        }

        return new Uri(baseUri, _routeLocalization.BuildHomePath("en")).AbsoluteUri;
    }

    private static bool IsOngoing(string? status)
        => !string.IsNullOrWhiteSpace(status)
           && status.Trim().Equals("Ongoing", StringComparison.OrdinalIgnoreCase);

    private static bool IsPending(string? status)
        => !string.IsNullOrWhiteSpace(status)
           && status.Trim().Equals("Pending", StringComparison.OrdinalIgnoreCase);

    private static bool IsCompleted(string? status)
        => !string.IsNullOrWhiteSpace(status)
           && status.Trim().Equals("Completed", StringComparison.OrdinalIgnoreCase);

    private static DateTime GetRelevantTimestampUtc(MatchDto match)
    {
        if (match.EndTime.HasValue)
            return EnsureUtc(match.EndTime.Value);

        if (match.StartTime.HasValue)
            return EnsureUtc(match.StartTime.Value);

        if (match.BettingCloseTime.HasValue)
            return match.BettingCloseTime.Value.UtcDateTime;

        return DateTime.UtcNow;
    }

    private static DateTime EnsureUtc(DateTime value)
        => value.Kind switch
        {
            DateTimeKind.Utc => value,
            DateTimeKind.Local => value.ToUniversalTime(),
            _ => DateTime.SpecifyKind(value, DateTimeKind.Utc)
        };

    private static string FormatSitemapUtc(DateTime value)
        => EnsureUtc(value).ToString("yyyy-MM-ddTHH:mm:ssZ", CultureInfo.InvariantCulture);

    private static bool TryExtractStatsTeamSlug(string relativePath, out string slug)
    {
        slug = string.Empty;
        if (string.IsNullOrWhiteSpace(relativePath))
            return false;

        if (relativePath.StartsWith("/stats/teams/", StringComparison.OrdinalIgnoreCase))
        {
            slug = relativePath["/stats/teams/".Length..].Trim('/');
            return !string.IsNullOrWhiteSpace(slug);
        }

        if (relativePath.StartsWith("/en/stats/teams/", StringComparison.OrdinalIgnoreCase))
        {
            slug = relativePath["/en/stats/teams/".Length..].Trim('/');
            return !string.IsNullOrWhiteSpace(slug);
        }

        if (relativePath.StartsWith("/pt/estatisticas/times/", StringComparison.OrdinalIgnoreCase))
        {
            slug = relativePath["/pt/estatisticas/times/".Length..].Trim('/');
            return !string.IsNullOrWhiteSpace(slug);
        }

        return false;
    }

    private static string BuildStatsTeamSlug(StatsArenaTeamDto team)
    {
        var symbol = CleanStatsAssetSymbol(!string.IsNullOrWhiteSpace(team.DisplaySymbol) ? team.DisplaySymbol : team.Symbol);
        if (string.IsNullOrWhiteSpace(symbol) || symbol == "-")
            return string.Empty;

        var buffer = new List<char>(symbol.Length);
        foreach (var ch in symbol.ToLowerInvariant())
        {
            if (char.IsLetterOrDigit(ch))
                buffer.Add(ch);
            else if (buffer.Count > 0 && buffer[^1] != '-')
                buffer.Add('-');
        }

        return new string(buffer.ToArray()).Trim('-');
    }

    private static string CleanStatsAssetSymbol(string? symbol)
    {
        if (string.IsNullOrWhiteSpace(symbol))
            return "-";

        var normalized = new string(symbol.Trim().ToUpperInvariant().Where(char.IsLetterOrDigit).ToArray());
        foreach (var suffix in StatsVisualSuffixes)
        {
            if (normalized.Length > suffix.Length + 1 && normalized.EndsWith(suffix, StringComparison.Ordinal))
                return normalized[..^suffix.Length];
        }

        return normalized;
    }

    private sealed record SitemapAlternate(string HrefLang, string Href);

    private sealed record SitemapEntry(
        string Location,
        DateTime LastModifiedUtc,
        string ChangeFrequency,
        decimal Priority,
        IReadOnlyList<SitemapAlternate> Alternates,
        string XDefaultHref,
        bool IsValid)
    {
        public static SitemapEntry Invalid { get; } = new(string.Empty, DateTime.UtcNow, string.Empty, 0m, [], string.Empty, false);
    }
}
