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
    private const int SitemapProtocolUrlLimit = 50_000;
    private static readonly string[] StatsVisualSuffixes = ["USDT", "USDC", "BUSD", "FDUSD", "BTC", "ETH"];
    private static readonly string[] ConverterStableSymbols = ["USDT", "USDC", "BUSD", "FDUSD"];
    private static readonly string[] ConverterSeoSymbols = ["ZEC", "XLM"];
    private const string IndexCacheKey = "sitemap::index";
    private const string PagesCacheKey = "sitemap::pages";
    private const string MatchesCacheKey = "sitemap::matches";

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

    public async Task<string> GetMatchSitemapXmlAsync(string culture, int page = 1, CancellationToken ct = default)
    {
        var normalizedCulture = _routeLocalization.NormalizeCulture(culture);
        var normalizedPage = Math.Max(1, page);
        var cacheKey = $"sitemap::matches::{normalizedCulture}::{normalizedPage}";
        return await GetCachedXmlAsync(cacheKey, () => BuildMatchSitemapXmlAsync(normalizedCulture, normalizedPage, ct));
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

    private async Task<string> BuildSitemapIndexXmlAsync(CancellationToken ct)
    {
        var baseUri = GetPublicBaseUri();
        var now = DateTime.UtcNow;
        var matchSitemapPages = Math.Max(1, (int)Math.Ceiling(
            (await GetRelevantMatchesAsync(ct)).Count / (double)MatchesPerSitemap));

        var paths = new List<string> { "/sitemap-pages.xml" };
        foreach (var culture in AllRouteCultures)
        {
            paths.Add($"/sitemap-matches-{culture}.xml");
            for (var page = 2; page <= matchSitemapPages; page++)
                paths.Add($"/sitemap-matches-{culture}-{page}.xml");
        }

        var elements = paths
            .Select(path => new XElement(
                SitemapNamespace + "sitemap",
                new XElement(SitemapNamespace + "loc", new Uri(baseUri, path).AbsoluteUri),
                new XElement(SitemapNamespace + "lastmod", FormatSitemapUtc(now))));

        var document = new XDocument(
            new XDeclaration("1.0", "UTF-8", null),
            new XElement(SitemapNamespace + "sitemapindex", elements));

        return document.ToString(SaveOptions.DisableFormatting);
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

        foreach (var page in SitemapRouteCatalog.StaticPages)
        {
            var lastModifiedUtc = page.UseStatsLastModified ? statsLastModifiedUtc : now;

            if (!page.Localized)
            {
                entries.Add(CreateAbsoluteEntry(
                    new Uri(baseUri, page.BuildPath(_routeLocalization, DefaultRouteCulture)).AbsoluteUri,
                    lastModifiedUtc,
                    page.ChangeFrequency,
                    page.Priority));
                continue;
            }

            foreach (var culture in cultures)
            {
                var isDefault = string.Equals(culture, DefaultRouteCulture, StringComparison.OrdinalIgnoreCase);
                var priority = !isDefault && page.NonDefaultCulturePriority.HasValue
                    ? page.NonDefaultCulturePriority.Value
                    : page.Priority;

                entries.Add(CreateLocalizedEntry(
                    baseUri,
                    culture,
                    page.BuildPath(_routeLocalization, culture),
                    lastModifiedUtc,
                    page.ChangeFrequency,
                    priority,
                    targetCulture => page.BuildPath(_routeLocalization, targetCulture)));
            }
        }

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
                    0.65m,
                    targetCulture => _routeLocalization.BuildStatsTeamDetailPath(targetCulture, slug)));
            }
        }

        entries.AddRange(BuildConverterEntries(baseUri, statsTeams, statsLastModifiedUtc));

        return BuildUrlSet(entries);
    }

    private async Task<string> BuildMatchSitemapXmlAsync(string culture, int page, CancellationToken ct)
    {
        var baseUri = GetPublicBaseUri();
        var entries = new List<SitemapEntry>();

        foreach (var match in (await GetRelevantMatchesAsync(ct))
            .Skip((page - 1) * MatchesPerSitemap)
            .Take(MatchesPerSitemap))
        {
            var slug = _matchSlugHelper.BuildSlug(match.TeamA, match.TeamB);
            if (string.IsNullOrWhiteSpace(slug))
                continue;

            foreach (var family in SitemapRouteCatalog.MatchFamilies)
            {
                entries.Add(CreateLocalizedEntry(
                    baseUri,
                    culture,
                    family.BuildPath(_routeLocalization, culture, match.MatchId, slug),
                    GetRelevantTimestampUtc(match),
                    match.IsFinished ? family.FinishedChangeFrequency : family.OngoingChangeFrequency,
                    match.IsFinished ? family.FinishedPriority : family.OngoingPriority,
                    targetCulture => family.BuildPath(_routeLocalization, targetCulture, match.MatchId, slug)));
            }
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
        var matches = await _memoryCache.GetOrCreateAsync(MatchesCacheKey, async entry =>
        {
            entry.AbsoluteExpirationRelativeToNow = TimeSpan.FromMinutes(SitemapCacheMinutes);
            return await FetchRelevantMatchesAsync(ct);
        });

        return matches ?? [];
    }

    private async Task<IReadOnlyList<MatchDto>> FetchRelevantMatchesAsync(CancellationToken ct)
    {
        var client = _httpClientFactory.CreateClient("CriptoVersusApi");
        var pageSize = Math.Clamp(_options.ApiTake, 1, 200);
        var matches = new List<MatchDto>();
        var seenMatchIds = new HashSet<int>();
        var skip = 0;

        while (true)
        {
            var page = await client.GetFromJsonAsync<List<MatchDto>>(
                $"api/Matches?take={pageSize}&skip={skip}", ct) ?? [];

            var discoveredNewMatch = false;
            foreach (var match in page)
            {
                matches.Add(match);
                if (match.MatchId > 0 && seenMatchIds.Add(match.MatchId))
                    discoveredNewMatch = true;
            }

            if (page.Count < pageSize || !discoveredNewMatch)
                break;

            skip += page.Count;
        }

        DateTime? cutoff = _options.RecentMatchWindowDays > 0
            ? DateTime.UtcNow.AddDays(-_options.RecentMatchWindowDays)
            : null;

        var indexableMatches = matches
            .Where(match => match.MatchId > 0)
            .Where(match => IsIndexableMatch(match, cutoff))
            .OrderByDescending(GetRelevantTimestampUtc)
            .ToArray();

        if (_options.MaxMatchEntriesPerCulture > 0)
            indexableMatches = indexableMatches.Take(_options.MaxMatchEntriesPerCulture).ToArray();

        return indexableMatches
            .GroupBy(match => match.MatchId)
            .Select(group => group.First())
            .OrderByDescending(GetRelevantTimestampUtc)
            .ToArray();
    }

    private int MatchesPerSitemap
    {
        get
        {
            var maxUrls = Math.Clamp(_options.MaxUrlsPerMatchSitemap, 1, SitemapProtocolUrlLimit);
            return Math.Max(1, maxUrls / SitemapRouteCatalog.MatchFamilies.Count);
        }
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

    private bool IsIndexableMatch(MatchDto match, DateTime? cutoffUtc)
    {
        if (IsOngoing(match.Status))
            return _options.IncludeOngoingMatches;

        if (IsPending(match.Status))
            return _options.IncludePendingMatches && IsInsideRecentWindow(match, cutoffUtc);

        if (match.IsFinished || IsCompleted(match.Status))
            return _options.IncludeFinishedMatches && IsInsideRecentWindow(match, cutoffUtc);

        return IsInsideRecentWindow(match, cutoffUtc);
    }

    private static bool IsInsideRecentWindow(MatchDto match, DateTime? cutoffUtc)
        => !cutoffUtc.HasValue || GetRelevantTimestampUtc(match) >= cutoffUtc.Value;

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
        decimal priority,
        Func<string?, string> alternatePathBuilder)
    {
        if (!relativePath.StartsWith('/'))
            relativePath = "/" + relativePath;

        if (!Uri.TryCreate(baseUri, relativePath, out var fullUri))
            return SitemapEntry.Invalid;

        var alternates = new List<SitemapAlternate>();
        foreach (var alternateCulture in AllRouteCultures)
        {
            var alternatePath = alternatePathBuilder(alternateCulture);
            if (!alternatePath.StartsWith('/'))
                alternatePath = "/" + alternatePath;

            if (Uri.TryCreate(baseUri, alternatePath, out var alternateUri))
                alternates.Add(new SitemapAlternate(_routeLocalization.GetHrefLang(alternateCulture), alternateUri.AbsoluteUri));
        }

        var xDefaultPath = alternatePathBuilder(DefaultRouteCulture);
        if (!xDefaultPath.StartsWith('/'))
            xDefaultPath = "/" + xDefaultPath;

        var xDefaultHref = Uri.TryCreate(baseUri, xDefaultPath, out var xDefaultUri)
            ? xDefaultUri.AbsoluteUri
            : string.Empty;

        return new SitemapEntry(
            fullUri.AbsoluteUri,
            EnsureUtc(lastModifiedUtc),
            changeFrequency,
            priority,
            alternates,
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
                        RouteLocalizationService.BuildConverterPath(culture, fromSymbol, toSymbol),
                        statsLastModifiedUtc,
                        "hourly",
                        0.72m,
                        targetCulture => RouteLocalizationService.BuildConverterPath(targetCulture!, fromSymbol, toSymbol)));
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
