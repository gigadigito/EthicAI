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
    private const int ConverterTopSymbolLimit = 18;
    private const int ConverterMaxSymbolLimit = 24;
    private static readonly string[] StatsVisualSuffixes = ["USDT", "USDC", "BUSD", "FDUSD", "BTC", "ETH"];
    private static readonly string[] ConverterStableSymbols = ["USDT", "USDC", "BUSD", "FDUSD"];
    private static readonly string[] ConverterSeoSymbols = ["ZEC", "XLM"];
    private const string IndexCacheKey = "sitemap::index";
    private const string PagesCacheKey = "sitemap::pages";

    private static readonly XNamespace SitemapNamespace = "http://www.sitemaps.org/schemas/sitemap/0.9";
    private static readonly XNamespace XhtmlNamespace = "http://www.w3.org/1999/xhtml";

    private readonly IHttpClientFactory _httpClientFactory;
    private readonly IConfiguration _configuration;
    private readonly IMemoryCache _memoryCache;
    private readonly MatchSlugHelper _matchSlugHelper;
    private readonly RouteLocalizationService _routeLocalization;
    private readonly SupportedLanguageCatalog _languages;
    private readonly SitemapOptions _options;

    public SitemapService(
        IHttpClientFactory httpClientFactory,
        IConfiguration configuration,
        IMemoryCache memoryCache,
        MatchSlugHelper matchSlugHelper,
        RouteLocalizationService routeLocalization,
        SupportedLanguageCatalog languages,
        IOptions<SitemapOptions> options)
    {
        _httpClientFactory = httpClientFactory;
        _configuration = configuration;
        _memoryCache = memoryCache;
        _matchSlugHelper = matchSlugHelper;
        _routeLocalization = routeLocalization;
        _languages = languages;
        _options = options.Value;
    }

    private IReadOnlyList<string> AllRouteCultures
        => _languages.EnabledLanguages.Select(l => l.RouteCulture).ToArray();

    private string DefaultRouteCulture => _languages.DefaultLanguage.RouteCulture;

    public async Task<string> GetSitemapIndexXmlAsync(CancellationToken ct = default)
        => await GetCachedXmlAsync(IndexCacheKey, () => BuildSitemapIndexXmlAsync(ct));

    public async Task<string> GetPagesSitemapXmlAsync(CancellationToken ct = default)
        => await GetCachedXmlAsync(PagesCacheKey, () => BuildPagesSitemapXmlAsync(ct));

    public async Task<string> GetMatchSitemapXmlAsync(string culture, CancellationToken ct = default)
    {
        var normalizedCulture = _routeLocalization.NormalizeCulture(culture);
        var cacheKey = $"sitemap::matches::{normalizedCulture}";
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

        var paths = new List<string> { "/sitemap-pages.xml" };
        foreach (var culture in AllRouteCultures)
            paths.Add($"/sitemap-matches-{culture}.xml");

        var elements = paths
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

        var cultures = AllRouteCultures;
        var entries = new List<SitemapEntry>();

        foreach (var culture in cultures)
        {
            var isDefault = string.Equals(culture, DefaultRouteCulture, StringComparison.OrdinalIgnoreCase);
            var homePriority = isDefault ? 1.0m : 0.9m;

            entries.Add(CreateLocalizedEntry(baseUri, culture, _routeLocalization.BuildHomePath(culture), now, "daily", homePriority));
            entries.Add(CreateLocalizedEntry(baseUri, culture, _routeLocalization.BuildFaqPath(culture), now, "weekly", 0.86m));
            entries.Add(CreateLocalizedEntry(baseUri, culture, _routeLocalization.BuildTvPath(culture), now, "hourly", 0.9m));
            entries.Add(CreateLocalizedEntry(baseUri, culture, _routeLocalization.BuildTvBroadcastPath(culture), now, "hourly", 0.95m));
            entries.Add(CreateLocalizedEntry(baseUri, culture, _routeLocalization.BuildStatsPath(culture), statsLastModifiedUtc, "hourly", 0.85m));
            entries.Add(CreateLocalizedEntry(baseUri, culture, _routeLocalization.BuildStatsMatchesPath(culture), statsLastModifiedUtc, "daily", 0.78m));
            entries.Add(CreateLocalizedEntry(baseUri, culture, _routeLocalization.BuildStatsTeamsPath(culture), statsLastModifiedUtc, "daily", 0.8m));
            entries.Add(CreateLocalizedEntry(baseUri, culture, _routeLocalization.BuildStatsRankingsPath(culture), statsLastModifiedUtc, "daily", 0.78m));
            entries.Add(CreateLocalizedEntry(baseUri, culture, _routeLocalization.BuildStatsRecordsPath(culture), statsLastModifiedUtc, "daily", 0.75m));
            entries.Add(CreateLocalizedEntry(baseUri, culture, _routeLocalization.BuildTokenPath(culture), now, "weekly", 0.74m));
            entries.Add(CreateLocalizedEntry(baseUri, culture, _routeLocalization.BuildRoadmapPath(culture), now, "weekly", 0.8m));
            entries.Add(CreateLocalizedEntry(baseUri, culture, _routeLocalization.BuildHowItWorksPath(culture), now, "weekly", 0.8m));
            entries.Add(CreateLocalizedEntry(baseUri, culture, _routeLocalization.BuildAboutPath(culture), now, "weekly", 0.78m));
            entries.Add(CreateLocalizedEntry(baseUri, culture, _routeLocalization.BuildScoringRulesPath(culture), now, "weekly", 0.76m));
            entries.Add(CreateLocalizedEntry(baseUri, culture, _routeLocalization.BuildRiskDisclaimerPath(culture), now, "weekly", 0.74m));
        }

        entries.Add(CreateAbsoluteEntry(new Uri(baseUri, "/tokenomics/regras-das-partidas").AbsoluteUri, now, "weekly", 0.7m));
        entries.Add(CreateAbsoluteEntry("https://mcp.criptoversus.com/", now, "weekly", 0.6m));

        foreach (var team in statsTeams)
        {
            var slug = BuildStatsTeamSlug(team);
            if (string.IsNullOrWhiteSpace(slug))
                continue;

            var teamLastModifiedUtc = team.LastMatchUtc.HasValue
                ? EnsureUtc(team.LastMatchUtc.Value)
                : statsLastModifiedUtc;

            foreach (var culture in cultures)
            {
                entries.Add(CreateLocalizedEntry(
                    baseUri,
                    culture,
                    _routeLocalization.BuildStatsTeamDetailPath(culture, slug),
                    teamLastModifiedUtc,
                    "daily",
                    0.65m));
            }
        }

        entries.AddRange(BuildConverterEntries(baseUri, statsTeams, statsLastModifiedUtc));

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
            var response = await client.GetFromJsonAsync<PagedResultDto<StatsArenaTeamDto>>("api/stats/teams?page=1&pageSize=100", ct);
            var teams = response?.Items ?? [];

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
        var alternates = new List<SitemapAlternate>();
        var cultures = AllRouteCultures;

        if (TryMatchPageAlternates(baseUri, relativePath, cultures,
            _routeLocalization.BuildHomePath, ["/en", "/pt", "/zh", "/es", "/fr", "/de", "/it", "/ja"], out var homeAlternates))
            return homeAlternates;

        if (TryMatchPageAlternates(baseUri, relativePath, cultures,
            _routeLocalization.BuildRoadmapPath, ["/en/roadmap", "/pt/roadmap", "/zh/roadmap", "/es/roadmap", "/fr/roadmap", "/de/roadmap", "/it/roadmap", "/ja/roadmap"], out var roadmapAlternates))
            return roadmapAlternates;

        if (TryMatchPageAlternates(baseUri, relativePath, cultures,
            _routeLocalization.BuildFaqPath, ["/en/faq", "/pt/faq", "/zh/faq", "/es/faq", "/fr/faq", "/de/faq", "/it/faq", "/ja/faq"], out var faqAlternates))
            return faqAlternates;

        if (TryMatchPageAlternates(baseUri, relativePath, cultures,
            _routeLocalization.BuildTvPath, ["/en/tv", "/pt/tv", "/zh/tv", "/es/tv", "/fr/tv", "/de/tv", "/it/tv", "/ja/tv"], out var tvAlternates))
            return tvAlternates;

        if (TryMatchPageAlternates(baseUri, relativePath, cultures,
            _routeLocalization.BuildTvBroadcastPath, ["/en/tv/broadcast", "/pt/tv/broadcast", "/zh/tv/broadcast", "/es/tv/broadcast", "/fr/tv/broadcast", "/de/tv/broadcast", "/it/tv/broadcast", "/ja/tv/broadcast"], out var tvBroadcastAlternates))
            return tvBroadcastAlternates;

        if (TryMatchPageAlternates(baseUri, relativePath, cultures,
            _routeLocalization.BuildStatsPath, ["/stats", "/en/stats", "/pt/estatisticas", "/zh/stats", "/es/stats", "/fr/stats", "/de/stats", "/it/stats", "/ja/stats"], out var statsAlternates))
            return statsAlternates;

        if (TryMatchPageAlternates(baseUri, relativePath, cultures,
            _routeLocalization.BuildStatsMatchesPath, ["/stats/matches", "/en/stats/matches", "/pt/estatisticas/partidas", "/zh/stats/matches", "/es/stats/matches", "/fr/stats/matches", "/de/stats/matches", "/it/stats/matches", "/ja/stats/matches"], out var statsMatchesAlternates))
            return statsMatchesAlternates;

        if (TryMatchPageAlternates(baseUri, relativePath, cultures,
            _routeLocalization.BuildStatsTeamsPath, ["/stats/teams", "/pt/estatisticas/times", "/zh/stats/teams", "/es/stats/teams", "/fr/stats/teams", "/de/stats/teams", "/it/stats/teams", "/ja/stats/teams"], out var statsTeamsAlternates))
            return statsTeamsAlternates;

        if (TryMatchPageAlternates(baseUri, relativePath, cultures,
            _routeLocalization.BuildStatsRankingsPath, ["/stats/rankings", "/en/stats/rankings", "/pt/estatisticas/rankings", "/zh/stats/rankings", "/es/stats/rankings", "/fr/stats/rankings", "/de/stats/rankings", "/it/stats/rankings", "/ja/stats/rankings"], out var statsRankingsAlternates))
            return statsRankingsAlternates;

        if (TryMatchPageAlternates(baseUri, relativePath, cultures,
            _routeLocalization.BuildStatsRecordsPath, ["/stats/records", "/en/stats/records", "/pt/estatisticas/recordes", "/zh/stats/records", "/es/stats/records", "/fr/stats/records", "/de/stats/records", "/it/stats/records", "/ja/stats/records"], out var statsRecordsAlternates))
            return statsRecordsAlternates;

        if (TryMatchPageAlternates(baseUri, relativePath, cultures,
            _routeLocalization.BuildHowItWorksPath, ["/en/how-it-works", "/pt/como-funciona", "/zh/how-it-works", "/es/how-it-works", "/fr/how-it-works", "/de/how-it-works", "/it/how-it-works", "/ja/how-it-works"], out var howItWorksAlternates))
            return howItWorksAlternates;

        if (TryMatchPageAlternates(baseUri, relativePath, cultures,
            _routeLocalization.BuildAboutPath, ["/en/about", "/pt/about", "/zh/about", "/es/about", "/fr/about", "/de/about", "/it/about", "/ja/about"], out var aboutAlternates))
            return aboutAlternates;

        if (TryMatchPageAlternates(baseUri, relativePath, cultures,
            _routeLocalization.BuildScoringRulesPath, ["/en/scoring-rules", "/pt/scoring-rules", "/zh/scoring-rules", "/es/scoring-rules", "/fr/scoring-rules", "/de/scoring-rules", "/it/scoring-rules", "/ja/scoring-rules"], out var scoringRulesAlternates))
            return scoringRulesAlternates;

        if (TryMatchPageAlternates(baseUri, relativePath, cultures,
            _routeLocalization.BuildRiskDisclaimerPath, ["/en/risk-disclaimer", "/pt/risk-disclaimer", "/zh/risk-disclaimer", "/es/risk-disclaimer", "/fr/risk-disclaimer", "/de/risk-disclaimer", "/it/risk-disclaimer", "/ja/risk-disclaimer"], out var riskDisclaimerAlternates))
            return riskDisclaimerAlternates;

        if (TryMatchPageAlternates(baseUri, relativePath, cultures,
            _routeLocalization.BuildTokenPath, ["/token", "/en/token", "/pt/token", "/zh/token", "/es/token", "/fr/token", "/de/token", "/it/token", "/ja/token"], out var tokenAlternates))
            return tokenAlternates;

        if (TryExtractStatsTeamSlug(relativePath, out var statsTeamSlug))
        {
            foreach (var culture in cultures)
                alternates.Add(new SitemapAlternate(_routeLocalization.GetHrefLang(culture), new Uri(baseUri, _routeLocalization.BuildStatsTeamDetailPath(culture, statsTeamSlug)).AbsoluteUri));
            return alternates;
        }

        if (TryExtractConverterPair(relativePath, out var fromSymbol, out var toSymbol))
        {
            foreach (var culture in cultures)
                alternates.Add(new SitemapAlternate(_routeLocalization.GetHrefLang(culture), new Uri(baseUri, BuildConverterPath(culture, fromSymbol, toSymbol)).AbsoluteUri));
            return alternates;
        }

        var segments = relativePath.Trim('/').Split('/', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        if (segments.Length >= 4 && int.TryParse(segments[2], out var matchId))
        {
            var slug = segments[3];
            foreach (var culture in cultures)
                alternates.Add(new SitemapAlternate(_routeLocalization.GetHrefLang(culture), new Uri(baseUri, _routeLocalization.BuildLocalizedPath(culture, matchId, slug)).AbsoluteUri));
        }

        return alternates;
    }

    private bool TryMatchPageAlternates(
        Uri baseUri,
        string relativePath,
        IReadOnlyList<string> cultures,
        Func<string?, string> pathBuilder,
        string[] knownPaths,
        out IReadOnlyList<SitemapAlternate> alternates)
    {
        if (knownPaths.Any(p => string.Equals(p, relativePath, StringComparison.OrdinalIgnoreCase)))
        {
            var result = new List<SitemapAlternate>(cultures.Count);
            foreach (var culture in cultures)
                result.Add(new SitemapAlternate(_routeLocalization.GetHrefLang(culture), new Uri(baseUri, pathBuilder(culture)).AbsoluteUri));
            alternates = result;
            return true;
        }

        alternates = [];
        return false;
    }

    private string BuildXDefaultHref(Uri baseUri, string relativePath)
    {
        var defaultPathFunc = ResolveDefaultPathFunc(relativePath);
        if (defaultPathFunc is not null)
            return new Uri(baseUri, defaultPathFunc(DefaultRouteCulture)).AbsoluteUri;

        if (TryExtractStatsTeamSlug(relativePath, out var statsTeamSlug))
            return new Uri(baseUri, _routeLocalization.BuildStatsTeamDetailPath(DefaultRouteCulture, statsTeamSlug)).AbsoluteUri;

        if (TryExtractConverterPair(relativePath, out var fromSymbol, out var toSymbol))
            return new Uri(baseUri, BuildConverterPath(DefaultRouteCulture, fromSymbol, toSymbol)).AbsoluteUri;

        var segments = relativePath.Trim('/').Split('/', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        if (segments.Length >= 4 && int.TryParse(segments[2], out var matchId))
        {
            var slug = segments[3];
            return new Uri(baseUri, _routeLocalization.BuildLocalizedPath(DefaultRouteCulture, matchId, slug)).AbsoluteUri;
        }

        return new Uri(baseUri, _routeLocalization.BuildHomePath(DefaultRouteCulture)).AbsoluteUri;
    }

    private Func<string?, string>? ResolveDefaultPathFunc(string relativePath)
    {
        if (MatchesAny(relativePath, "/en", "/pt", "/zh", "/es", "/fr", "/de", "/it", "/ja"))
            return _routeLocalization.BuildHomePath;

        if (MatchesAny(relativePath, "/en/roadmap", "/pt/roadmap", "/zh/roadmap", "/es/roadmap", "/fr/roadmap", "/de/roadmap", "/it/roadmap", "/ja/roadmap"))
            return _routeLocalization.BuildRoadmapPath;

        if (MatchesAny(relativePath, "/en/faq", "/pt/faq", "/zh/faq", "/es/faq", "/fr/faq", "/de/faq", "/it/faq", "/ja/faq"))
            return _routeLocalization.BuildFaqPath;

        if (MatchesAny(relativePath, "/en/tv", "/pt/tv", "/zh/tv", "/es/tv", "/fr/tv", "/de/tv", "/it/tv", "/ja/tv"))
            return _routeLocalization.BuildTvPath;

        if (MatchesAny(relativePath, "/en/tv/broadcast", "/pt/tv/broadcast", "/zh/tv/broadcast", "/es/tv/broadcast", "/fr/tv/broadcast", "/de/tv/broadcast", "/it/tv/broadcast", "/ja/tv/broadcast"))
            return _routeLocalization.BuildTvBroadcastPath;

        if (MatchesAny(relativePath, "/stats", "/en/stats", "/pt/estatisticas", "/zh/stats", "/es/stats", "/fr/stats", "/de/stats", "/it/stats", "/ja/stats"))
            return _routeLocalization.BuildStatsPath;

        if (MatchesAny(relativePath, "/stats/matches", "/en/stats/matches", "/pt/estatisticas/partidas", "/zh/stats/matches", "/es/stats/matches", "/fr/stats/matches", "/de/stats/matches", "/it/stats/matches", "/ja/stats/matches"))
            return _routeLocalization.BuildStatsMatchesPath;

        if (MatchesAny(relativePath, "/stats/teams", "/pt/estatisticas/times", "/zh/stats/teams", "/es/stats/teams", "/fr/stats/teams", "/de/stats/teams", "/it/stats/teams", "/ja/stats/teams"))
            return _routeLocalization.BuildStatsTeamsPath;

        if (MatchesAny(relativePath, "/stats/rankings", "/en/stats/rankings", "/pt/estatisticas/rankings", "/zh/stats/rankings", "/es/stats/rankings", "/fr/stats/rankings", "/de/stats/rankings", "/it/stats/rankings", "/ja/stats/rankings"))
            return _routeLocalization.BuildStatsRankingsPath;

        if (MatchesAny(relativePath, "/stats/records", "/en/stats/records", "/pt/estatisticas/recordes", "/zh/stats/records", "/es/stats/records", "/fr/stats/records", "/de/stats/records", "/it/stats/records", "/ja/stats/records"))
            return _routeLocalization.BuildStatsRecordsPath;

        if (MatchesAny(relativePath, "/en/how-it-works", "/pt/como-funciona", "/zh/how-it-works", "/es/how-it-works", "/fr/how-it-works", "/de/how-it-works", "/it/how-it-works", "/ja/how-it-works"))
            return _routeLocalization.BuildHowItWorksPath;

        if (MatchesAny(relativePath, "/en/about", "/pt/about", "/zh/about", "/es/about", "/fr/about", "/de/about", "/it/about", "/ja/about"))
            return _routeLocalization.BuildAboutPath;

        if (MatchesAny(relativePath, "/en/scoring-rules", "/pt/scoring-rules", "/zh/scoring-rules", "/es/scoring-rules", "/fr/scoring-rules", "/de/scoring-rules", "/it/scoring-rules", "/ja/scoring-rules"))
            return _routeLocalization.BuildScoringRulesPath;

        if (MatchesAny(relativePath, "/en/risk-disclaimer", "/pt/risk-disclaimer", "/zh/risk-disclaimer", "/es/risk-disclaimer", "/fr/risk-disclaimer", "/de/risk-disclaimer", "/it/risk-disclaimer", "/ja/risk-disclaimer"))
            return _routeLocalization.BuildRiskDisclaimerPath;

        if (MatchesAny(relativePath, "/token", "/en/token", "/pt/token", "/zh/token", "/es/token", "/fr/token", "/de/token", "/it/token", "/ja/token"))
            return _routeLocalization.BuildTokenPath;

        return null;
    }

    private static bool MatchesAny(string relativePath, params string[] candidates)
        => candidates.Any(c => string.Equals(c, relativePath, StringComparison.OrdinalIgnoreCase));

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

        var path = relativePath.TrimEnd('/');
        const string teamsPrefix = "/stats/teams/";

        if (path.StartsWith(teamsPrefix, StringComparison.OrdinalIgnoreCase))
        {
            slug = path[teamsPrefix.Length..].Trim('/');
            return !string.IsNullOrWhiteSpace(slug);
        }

        var segments = path.Trim('/').Split('/', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        if (segments.Length >= 4
            && segments[1].Equals("stats", StringComparison.OrdinalIgnoreCase)
            && segments[2].Equals("teams", StringComparison.OrdinalIgnoreCase))
        {
            slug = segments[3];
            return !string.IsNullOrWhiteSpace(slug);
        }

        if (segments.Length >= 4
            && segments[1].Equals("estatisticas", StringComparison.OrdinalIgnoreCase)
            && segments[2].Equals("times", StringComparison.OrdinalIgnoreCase))
        {
            slug = segments[3];
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

    private IReadOnlyList<SitemapEntry> BuildConverterEntries(Uri baseUri, IReadOnlyList<StatsArenaTeamDto> statsTeams, DateTime statsLastModifiedUtc)
    {
        var symbols = BuildConverterSymbols(statsTeams);
        var cultures = AllRouteCultures;
        var entries = new List<SitemapEntry>(symbols.Count * Math.Max(0, symbols.Count - 1) * cultures.Count);

        for (var i = 0; i < symbols.Count; i++)
        {
            for (var j = 0; j < symbols.Count; j++)
            {
                if (i == j)
                    continue;

                var fromSymbol = symbols[i];
                var toSymbol = symbols[j];

                foreach (var culture in cultures)
                {
                    entries.Add(CreateLocalizedEntry(
                        baseUri,
                        culture,
                        BuildConverterPath(culture, fromSymbol, toSymbol),
                        statsLastModifiedUtc,
                        "hourly",
                        0.72m));
                }
            }
        }

        return entries;
    }

    private static IReadOnlyList<string> BuildConverterSymbols(IReadOnlyList<StatsArenaTeamDto> statsTeams)
    {
        var symbols = new List<string>(ConverterMaxSymbolLimit);
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        foreach (var team in statsTeams
            .OrderBy(team => team.Rank)
            .ThenBy(team => team.DisplaySymbol, StringComparer.OrdinalIgnoreCase)
            .ThenBy(team => team.Symbol, StringComparer.OrdinalIgnoreCase)
            .Take(ConverterTopSymbolLimit))
        {
            AddConverterSymbol(symbols, seen, team.DisplaySymbol);
            AddConverterSymbol(symbols, seen, team.Symbol);
        }

        foreach (var stableSymbol in ConverterStableSymbols)
            AddConverterSymbol(symbols, seen, stableSymbol);

        foreach (var seoSymbol in ConverterSeoSymbols)
            AddConverterSymbol(symbols, seen, seoSymbol);

        return symbols.Take(ConverterMaxSymbolLimit).ToArray();
    }

    private static void AddConverterSymbol(List<string> symbols, HashSet<string> seen, string? symbol)
    {
        var normalized = CleanStatsAssetSymbol(symbol);
        if (string.IsNullOrWhiteSpace(normalized) || normalized == "-" || !seen.Add(normalized))
            return;

        symbols.Add(normalized.ToLowerInvariant());
    }

    private static string BuildConverterPath(string culture, string fromSymbol, string toSymbol)
        => string.Equals(culture, AppCultureService.SecondaryRouteCulture, StringComparison.OrdinalIgnoreCase)
            ? $"/pt/stats/{fromSymbol}-para-{toSymbol}"
            : $"/{culture}/stats/{fromSymbol}-to-{toSymbol}";

    private static bool TryExtractConverterPair(string relativePath, out string fromSymbol, out string toSymbol)
    {
        fromSymbol = string.Empty;
        toSymbol = string.Empty;

        if (string.IsNullOrWhiteSpace(relativePath))
            return false;

        var path = relativePath.Split('?', '#')[0];
        var segments = path.Trim('/').Split('/', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        if (segments.Length != 3 || !segments[1].Equals("stats", StringComparison.OrdinalIgnoreCase))
            return false;

        var culture = segments[0];
        var separator = string.Equals(culture, AppCultureService.SecondaryRouteCulture, StringComparison.OrdinalIgnoreCase)
            ? "-para-"
            : "-to-";

        return TrySplitConverterPair(segments[2], separator, out fromSymbol, out toSymbol);
    }

    private static bool TrySplitConverterPair(string pair, string separator, out string fromSymbol, out string toSymbol)
    {
        fromSymbol = string.Empty;
        toSymbol = string.Empty;

        var parts = pair.Split(new[] { separator }, 2, StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries);
        if (parts.Length != 2)
            return false;

        fromSymbol = parts[0].Trim().ToLowerInvariant();
        toSymbol = parts[1].Trim().ToLowerInvariant();
        return !string.IsNullOrWhiteSpace(fromSymbol) && !string.IsNullOrWhiteSpace(toSymbol) && !string.Equals(fromSymbol, toSymbol, StringComparison.OrdinalIgnoreCase);
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
