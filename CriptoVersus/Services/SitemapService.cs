using System.Net.Http.Json;
using System.Xml.Linq;
using DTOs;
using Microsoft.Extensions.Caching.Memory;

namespace CriptoVersus.Web.Services;

public sealed class SitemapService
{
    private const string SitemapCacheKey = "sitemap.xml::content";
    private const int SitemapCacheMinutes = 5;
    private const int RelevantWindowDays = 30;
    private static readonly XNamespace SitemapNamespace = "http://www.sitemaps.org/schemas/sitemap/0.9";

    private readonly IHttpClientFactory _httpClientFactory;
    private readonly IConfiguration _configuration;
    private readonly IMemoryCache _memoryCache;
    private readonly MatchSlugHelper _matchSlugHelper;
    private readonly RouteLocalizationService _routeLocalization;

    public SitemapService(
        IHttpClientFactory httpClientFactory,
        IConfiguration configuration,
        IMemoryCache memoryCache,
        MatchSlugHelper matchSlugHelper,
        RouteLocalizationService routeLocalization)
    {
        _httpClientFactory = httpClientFactory;
        _configuration = configuration;
        _memoryCache = memoryCache;
        _matchSlugHelper = matchSlugHelper;
        _routeLocalization = routeLocalization;
    }

    public async Task<string> GetSitemapXmlAsync(CancellationToken ct = default)
    {
        var cached = await _memoryCache.GetOrCreateAsync(SitemapCacheKey, async entry =>
        {
            entry.AbsoluteExpirationRelativeToNow = TimeSpan.FromMinutes(SitemapCacheMinutes);
            return await BuildSitemapXmlAsync(ct);
        });

        return cached ?? string.Empty;
    }

    public Task<string> GetRobotsTxtAsync(CancellationToken ct = default)
    {
        var baseUri = GetPublicBaseUri();
        var sitemapUri = new Uri(baseUri, "/sitemap.xml");
        var content = $"User-agent: *{Environment.NewLine}Allow: /{Environment.NewLine}Sitemap: {sitemapUri}";
        return Task.FromResult(content);
    }

    private async Task<string> BuildSitemapXmlAsync(CancellationToken ct)
    {
        var baseUri = GetPublicBaseUri();
        var now = DateTime.UtcNow;

        var entries = new List<SitemapEntry>
        {
            CreateEntry(baseUri, "/", now, "daily", "1.0"),
            CreateEntry(baseUri, "/roadmap", now, "weekly", "0.8"),
            CreateEntry(baseUri, "/tokenomics", now, "weekly", "0.8")
        };

        entries.AddRange(await GetMatchEntriesAsync(baseUri, ct));

        var urlElements = entries
            .Where(entry => entry.IsValid)
            .GroupBy(entry => entry.Location, StringComparer.OrdinalIgnoreCase)
            .Select(group => group.OrderByDescending(item => item.LastModifiedUtc).First())
            .OrderByDescending(entry => entry.Priority)
            .ThenBy(entry => entry.Location, StringComparer.OrdinalIgnoreCase)
            .Select(entry => new XElement(
                SitemapNamespace + "url",
                new XElement(SitemapNamespace + "loc", entry.Location),
                new XElement(SitemapNamespace + "lastmod", entry.LastModifiedUtc.ToString("yyyy-MM-dd")),
                new XElement(SitemapNamespace + "changefreq", entry.ChangeFrequency),
                new XElement(SitemapNamespace + "priority", entry.Priority.ToString("0.0", System.Globalization.CultureInfo.InvariantCulture))));

        var document = new XDocument(
            new XDeclaration("1.0", "UTF-8", null),
            new XElement(SitemapNamespace + "urlset", urlElements));

        return document.ToString(SaveOptions.DisableFormatting);
    }

    private async Task<IEnumerable<SitemapEntry>> GetMatchEntriesAsync(Uri baseUri, CancellationToken ct)
    {
        var client = _httpClientFactory.CreateClient("CriptoVersusApi");
        var matches = await client.GetFromJsonAsync<List<MatchDto>>("api/Matches?take=200", ct) ?? [];
        var cutoff = DateTime.UtcNow.AddDays(-RelevantWindowDays);

        return matches
            .Where(match => match.MatchId > 0)
            .Where(match => match.IsFinished || GetRelevantTimestampUtc(match) >= cutoff)
            .Select(match =>
            {
                var slug = _matchSlugHelper.BuildSlug(match.TeamA, match.TeamB);
                if (string.IsNullOrWhiteSpace(slug))
                    return SitemapEntry.Invalid;

                var path = _routeLocalization.BuildCanonicalPath(match.MatchId, slug);
                return CreateEntry(
                    baseUri,
                    path,
                    GetRelevantTimestampUtc(match),
                    match.IsFinished ? "never" : "weekly",
                    "0.7");
            })
            .Where(entry => entry.IsValid)
            .ToArray();
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

    private static SitemapEntry CreateEntry(Uri baseUri, string relativePath, DateTime lastModifiedUtc, string changeFrequency, string priorityText)
    {
        if (!relativePath.StartsWith('/'))
            relativePath = "/" + relativePath;

        if (!decimal.TryParse(priorityText, System.Globalization.NumberStyles.Number, System.Globalization.CultureInfo.InvariantCulture, out var priority))
            return SitemapEntry.Invalid;

        if (!Uri.TryCreate(baseUri, relativePath, out var fullUri))
            return SitemapEntry.Invalid;

        return new SitemapEntry(fullUri.AbsoluteUri, EnsureUtc(lastModifiedUtc), changeFrequency, priority, true);
    }

    private sealed record SitemapEntry(string Location, DateTime LastModifiedUtc, string ChangeFrequency, decimal Priority, bool IsValid)
    {
        public static SitemapEntry Invalid { get; } = new(string.Empty, DateTime.UtcNow, string.Empty, 0m, false);
    }
}
