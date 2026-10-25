using System.Net;
using System.Text;
using System.Text.Json;
using System.Xml.Linq;
using CriptoVersus.Web.Services;
using DTOs;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;

namespace EthicAI.test;

public sealed class SitemapXmlTests
{
    private static readonly XNamespace SitemapNs = "http://www.sitemaps.org/schemas/sitemap/0.9";
    private static readonly XNamespace XhtmlNs = "http://www.w3.org/1999/xhtml";

    private static readonly string[] Cultures = ["en", "pt", "zh", "es", "fr", "de", "it", "ja"];
    private static readonly string[] ExpectedHrefLangs = ["en-US", "pt-BR", "zh-CN", "es-ES", "fr-FR", "de-DE", "it-IT", "ja-JP"];
    private const string PublicBaseUrl = "https://www.criptoversus.com";

    [Fact]
    public async Task PagesSitemap_ContainsCandleBattlesForAllCultures()
    {
        var service = CreateService();
        var xml = await service.GetPagesSitemapXmlAsync();
        var locations = GetLocations(xml);

        foreach (var culture in Cultures)
        {
            Assert.Contains($"{PublicBaseUrl}/{culture}/games/candle-battles/demo", locations);
        }
    }

    [Fact]
    public async Task PagesSitemap_ContainsAllRegisteredStaticPages()
    {
        var service = CreateService();
        var xml = await service.GetPagesSitemapXmlAsync();
        var locations = GetLocations(xml);
        var routes = new RouteLocalizationService(new AppCultureService());

        foreach (var page in SitemapRouteCatalog.StaticPages)
        {
            if (!page.Localized)
            {
                Assert.Contains($"{PublicBaseUrl}{page.BuildPath(routes, "en")}", locations);
                continue;
            }

            foreach (var culture in Cultures)
                Assert.Contains($"{PublicBaseUrl}{page.BuildPath(routes, culture)}", locations);
        }
    }

    [Fact]
    public async Task PagesSitemap_ExcludesPrivateAndNoindexRoutes()
    {
        var service = CreateService();
        var xml = await service.GetPagesSitemapXmlAsync();
        var locations = GetLocations(xml);

        string[] forbidden =
        [
            "/admin", "/admin-sistema", "/admin-system", "/intranet", "minha-carteira", "my-wallet",
            "/social/", "/lab/", "/_diag", "/counter", "/weather",
            $"{PublicBaseUrl}/home", "/partida/", "/match/", "/candle/", "/tv/candle/", "/tv/match/"
        ];

        foreach (var location in locations)
        {
            foreach (var fragment in forbidden)
            {
                Assert.DoesNotContain(fragment, location, StringComparison.OrdinalIgnoreCase);
            }
        }
    }

    [Fact]
    public async Task PagesSitemap_HasUniqueCanonicalUrls()
    {
        var service = CreateService();
        var xml = await service.GetPagesSitemapXmlAsync();
        var locations = GetLocations(xml);

        Assert.Equal(locations.Count, locations.Distinct(StringComparer.OrdinalIgnoreCase).Count());
    }

    [Theory]
    [InlineData("en")]
    [InlineData("pt")]
    [InlineData("zh")]
    [InlineData("es")]
    [InlineData("ja")]
    public async Task AllSitemaps_DeclareConsistentHrefLangClusters(string culture)
    {
        var service = CreateService();
        var pagesXml = await service.GetPagesSitemapXmlAsync();
        var matchesXml = await service.GetMatchSitemapXmlAsync(culture);

        foreach (var xml in new[] { pagesXml, matchesXml })
        {
            var document = XDocument.Parse(xml);
            var localizedUrls = document.Root!
                .Elements(SitemapNs + "url")
                .Where(url => url.Element(SitemapNs + "loc")!.Value.StartsWith(PublicBaseUrl, StringComparison.OrdinalIgnoreCase)
                    && !url.Element(SitemapNs + "loc")!.Value.StartsWith("https://mcp.", StringComparison.OrdinalIgnoreCase))
                .ToArray();

            Assert.NotEmpty(localizedUrls);

            foreach (var url in localizedUrls)
            {
                var alternates = url.Elements(XhtmlNs + "link")
                    .Where(link => (string?)link.Attribute("rel") == "alternate"
                        && (string?)link.Attribute("hreflang") != "x-default")
                    .ToArray();

                if (alternates.Length == 0)
                    continue;

                var hrefLangs = alternates.Select(link => (string)link.Attribute("hreflang")!).ToArray();
                foreach (var expected in ExpectedHrefLangs)
                    Assert.Contains(expected, hrefLangs);

                var hrefs = alternates.Select(link => (string)link.Attribute("href")!).ToArray();
                Assert.Equal(hrefs.Length, hrefs.Distinct(StringComparer.OrdinalIgnoreCase).Count());

                var xDefault = url.Elements(XhtmlNs + "link")
                    .FirstOrDefault(link => (string?)link.Attribute("hreflang") == "x-default");
                Assert.NotNull(xDefault);
                Assert.Contains((string)xDefault!.Attribute("href")!, hrefs);
            }
        }
    }

    [Theory]
    [InlineData("en")]
    [InlineData("pt")]
    [InlineData("zh")]
    [InlineData("es")]
    [InlineData("fr")]
    [InlineData("de")]
    [InlineData("it")]
    [InlineData("ja")]
    public async Task MatchSitemaps_ContainMatchTvAndCandleBattleUrls(string culture)
    {
        var service = CreateService();
        var xml = await service.GetMatchSitemapXmlAsync(culture);
        var locations = GetLocations(xml);
        var routes = new RouteLocalizationService(new AppCultureService());
        const int matchId = 42;
        const string slug = "btc-vs-eth";

        Assert.Contains($"{PublicBaseUrl}{routes.BuildLocalizedPath(culture, matchId, slug)}", locations);
        Assert.Contains($"{PublicBaseUrl}{routes.BuildTvMatchPath(culture, matchId, slug)}", locations);
        Assert.Contains($"{PublicBaseUrl}{routes.BuildCandleBattlesPath(culture, matchId, slug)}", locations);
        Assert.Contains($"{PublicBaseUrl}{routes.BuildCandleBattleV2Path(culture, matchId, slug)}", locations);
    }

    [Fact]
    public async Task MatchSitemaps_IncludeCandleBattlesFromEveryApiPage()
    {
        var service = CreateService(new SitemapOptions
        {
            ApiTake = 2,
            MaxUrlsPerMatchSitemap = 8
        });
        var xml = await service.GetMatchSitemapXmlAsync("en", page: 2);
        var locations = GetLocations(xml);

        Assert.Contains($"{PublicBaseUrl}/en/tv/candle/42222/bmt-vs-anime", locations);

        var indexLocations = XDocument.Parse(await service.GetSitemapIndexXmlAsync())
            .Root!
            .Elements(SitemapNs + "sitemap")
            .Select(sitemap => sitemap.Element(SitemapNs + "loc")!.Value)
            .ToArray();
        Assert.Contains($"{PublicBaseUrl}/sitemap-matches-en-2.xml", indexLocations);
    }

    [Fact]
    public async Task MatchSitemaps_StopPagingWhenApiIgnoresSkip()
    {
        var service = CreateService(new SitemapOptions { ApiTake = 2 }, new StickyPageApiHandler());

        var xmlTask = service.GetMatchSitemapXmlAsync("en");
        var completed = await Task.WhenAny(xmlTask, Task.Delay(TimeSpan.FromSeconds(10)));
        Assert.Same(xmlTask, completed);

        var locations = GetLocations(await xmlTask);
        Assert.Contains($"{PublicBaseUrl}/en/tv/candle/42/btc-vs-eth", locations);
        Assert.Equal(locations.Count, locations.Distinct(StringComparer.OrdinalIgnoreCase).Count());
    }

    [Fact]
    public async Task MatchSitemaps_PreserveFinishedAndOngoingMatchSemantics()
    {
        var service = CreateService();
        var xml = await service.GetMatchSitemapXmlAsync("en");
        var document = XDocument.Parse(xml);

        var finished = document.Root!.Elements(SitemapNs + "url")
            .First(url => url.Element(SitemapNs + "loc")!.Value.EndsWith("/en/match/42/btc-vs-eth", StringComparison.OrdinalIgnoreCase));
        Assert.Equal("monthly", finished.Element(SitemapNs + "changefreq")!.Value);
        Assert.Equal("0.60", finished.Element(SitemapNs + "priority")!.Value);

        var ongoing = document.Root.Elements(SitemapNs + "url")
            .First(url => url.Element(SitemapNs + "loc")!.Value.EndsWith("/en/match/43/sol-vs-xrp", StringComparison.OrdinalIgnoreCase));
        Assert.Equal("daily", ongoing.Element(SitemapNs + "changefreq")!.Value);
        Assert.Equal("0.70", ongoing.Element(SitemapNs + "priority")!.Value);
    }

    [Fact]
    public async Task MatchSitemap_CandleBattleAlternatesStayInTheCandleFamily()
    {
        var service = CreateService();
        var xml = await service.GetMatchSitemapXmlAsync("en");
        var document = XDocument.Parse(xml);

        var candleUrl = document.Root!.Elements(SitemapNs + "url")
            .First(url => url.Element(SitemapNs + "loc")!.Value.EndsWith("/en/candle/42/btc-vs-eth", StringComparison.OrdinalIgnoreCase));

        var hrefs = candleUrl.Elements(XhtmlNs + "link")
            .Where(link => (string?)link.Attribute("rel") == "alternate"
                && (string?)link.Attribute("hreflang") != "x-default")
            .Select(link => (string)link.Attribute("href")!)
            .ToArray();

        Assert.Equal(8, hrefs.Count(href => href.Contains("/candle/42/btc-vs-eth", StringComparison.OrdinalIgnoreCase)));
        Assert.All(hrefs, href => Assert.DoesNotContain("/match/", href, StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public async Task SitemapIndex_ListsPagesAndPerCultureMatchSitemaps()
    {
        var service = CreateService();
        var xml = await service.GetSitemapIndexXmlAsync();
        var document = XDocument.Parse(xml);

        Assert.Equal(SitemapNs + "sitemapindex", document.Root!.Name);

        var locations = document.Root.Elements(SitemapNs + "sitemap")
            .Select(sitemap => sitemap.Element(SitemapNs + "loc")!.Value)
            .ToArray();

        Assert.Contains($"{PublicBaseUrl}/sitemap-pages.xml", locations);
        foreach (var culture in Cultures)
            Assert.Contains($"{PublicBaseUrl}/sitemap-matches-{culture}.xml", locations);

        Assert.Equal(1 + Cultures.Length, locations.Length);
    }

    [Theory]
    [InlineData("en")]
    [InlineData("pt")]
    [InlineData("ja")]
    public async Task AllSitemaps_AreValidSitemapXmlWithoutEnvironmentUrls(string culture)
    {
        var service = CreateService();
        var documents = new[]
        {
            XDocument.Parse(await service.GetSitemapIndexXmlAsync()),
            XDocument.Parse(await service.GetPagesSitemapXmlAsync()),
            XDocument.Parse(await service.GetMatchSitemapXmlAsync(culture))
        };

        foreach (var document in documents)
        {
            var locations = document.Root!
                .Elements()
                .Select(element => element.Element(SitemapNs + "loc")!.Value)
                .ToArray();

            Assert.NotEmpty(locations);
            foreach (var location in locations)
            {
                Assert.True(Uri.TryCreate(location, UriKind.Absolute, out var uri), $"URL invalida: {location}");
                Assert.Equal("https", uri.Scheme);
                Assert.Contains(uri.Host, new[] { "www.criptoversus.com", "mcp.criptoversus.com" });
                Assert.DoesNotContain("localhost", location, StringComparison.OrdinalIgnoreCase);
                Assert.DoesNotContain("127.0.0.1", location);
            }

            foreach (var lastmod in document.Root.Descendants(SitemapNs + "lastmod"))
                Assert.Matches(@"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$", lastmod.Value);
        }
    }

    [Fact]
    public async Task AllSitemapUrls_AreServedByExistingRazorRoutes()
    {
        var service = CreateService();
        var templates = RazorRouteScanner.GetPageRouteTemplates();
        var templateRegexes = templates.Select(SitemapRouteAuditor.TemplateToRegex).ToArray();

        var locations = GetLocations(await service.GetPagesSitemapXmlAsync())
            .Concat(GetLocations(await service.GetMatchSitemapXmlAsync("en")))
            .Concat(GetLocations(await service.GetMatchSitemapXmlAsync("pt")))
            .Where(location => location.StartsWith(PublicBaseUrl, StringComparison.OrdinalIgnoreCase))
            .ToArray();

        Assert.NotEmpty(locations);

        foreach (var location in locations)
        {
            var path = new Uri(location).AbsolutePath;
            Assert.True(
                templateRegexes.Any(regex => regex.IsMatch(path)),
                $"URL do sitemap sem pagina correspondente: {location}");
        }
    }

    [Fact]
    public async Task RobotsTxt_PointsToSitemapIndex()
    {
        var service = CreateService();
        var robots = await service.GetRobotsTxtAsync();

        Assert.Contains($"{PublicBaseUrl}/sitemap.xml", robots);
        Assert.Contains("User-agent: *", robots);
        Assert.Contains("Allow: /", robots);
    }

    [Fact]
    public async Task SitemapHttpResults_HeadReturnsEmptyBodyWithContentLength()
    {
        var service = CreateService();
        var context = CreateHttpContext("HEAD");

        var result = await SitemapHttpResults.WriteXmlAsync(context, token => service.GetPagesSitemapXmlAsync(token), CancellationToken.None);
        await result.ExecuteAsync(context);

        Assert.Equal(SitemapHttpResults.XmlContentType, context.Response.ContentType);
        Assert.True(context.Response.ContentLength > 0);
        Assert.Equal(0, context.Response.Body.Length);
    }

    [Fact]
    public async Task SitemapHttpResults_GetReturnsXmlBody()
    {
        var service = CreateService();
        var context = CreateHttpContext("GET");

        var result = await SitemapHttpResults.WriteXmlAsync(context, token => service.GetPagesSitemapXmlAsync(token), CancellationToken.None);
        await result.ExecuteAsync(context);

        context.Response.Body.Position = 0;
        using var reader = new StreamReader(context.Response.Body, Encoding.UTF8);
        var body = await reader.ReadToEndAsync();

        Assert.Equal(SitemapHttpResults.XmlContentType, context.Response.ContentType);
        Assert.Equal(Encoding.UTF8.GetByteCount(body), context.Response.ContentLength);
        Assert.Contains("urlset", body);
    }

    private static DefaultHttpContext CreateHttpContext(string method)
    {
        var context = new DefaultHttpContext();
        context.Request.Method = method;
        context.Response.Body = new MemoryStream();
        context.RequestServices = new ServiceCollection().AddLogging().BuildServiceProvider();
        return context;
    }

    private static IReadOnlyList<string> GetLocations(string xml)
        => XDocument.Parse(xml).Root!
            .Descendants(SitemapNs + "loc")
            .Select(loc => loc.Value)
            .ToArray();

    private static SitemapService CreateService(SitemapOptions? sitemapOptions = null, HttpMessageHandler? apiHandler = null)
    {
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["CriptoVersus:PublicBaseUrl"] = PublicBaseUrl
            })
            .Build();

        var languages = new SupportedLanguageCatalog();
        var appCulture = new AppCultureService(languages);
        var routes = new RouteLocalizationService(appCulture);

        return new SitemapService(
            new FakeHttpClientFactory(apiHandler ?? new FakeApiHandler()),
            configuration,
            new MemoryCache(new MemoryCacheOptions()),
            new MatchSlugHelper(),
            routes,
            languages,
            Options.Create(sitemapOptions ?? new SitemapOptions { ApiTake = 2 }));
    }

    private sealed class FakeHttpClientFactory : IHttpClientFactory
    {
        private readonly HttpMessageHandler _handler;

        public FakeHttpClientFactory(HttpMessageHandler handler) => _handler = handler;

        public HttpClient CreateClient(string name) => new(_handler, disposeHandler: false)
        {
            BaseAddress = new Uri("https://api.test.local")
        };
    }

    private sealed class FakeApiHandler : HttpMessageHandler
    {
        private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            var path = request.RequestUri!.AbsolutePath;
            object payload;

            if (path.Contains("api/stats/teams", StringComparison.OrdinalIgnoreCase))
            {
                payload = new PagedResultDto<StatsArenaTeamDto>
                {
                    Items =
                    [
                        new StatsArenaTeamDto { TeamId = 1, Symbol = "BTCUSDT", DisplaySymbol = "BTC", Rank = 1, LastMatchUtc = DateTime.UtcNow.AddHours(-2) },
                        new StatsArenaTeamDto { TeamId = 2, Symbol = "ETHUSDT", DisplaySymbol = "ETH", Rank = 2, LastMatchUtc = DateTime.UtcNow.AddHours(-3) }
                    ],
                    Page = 1,
                    PageSize = 100,
                    TotalItems = 2,
                    TotalPages = 1
                };
            }
            else if (path.Contains("api/Matches", StringComparison.OrdinalIgnoreCase)
                && request.RequestUri.Query.Contains("skip=2", StringComparison.OrdinalIgnoreCase))
            {
                payload = new List<MatchDto>
                {
                    new()
                    {
                        MatchId = 42222,
                        TeamA = "BMT",
                        TeamB = "ANIME",
                        Status = "Completed",
                        IsFinished = true,
                        EndTime = DateTime.UtcNow.AddYears(-1)
                    }
                };
            }
            else
            {
                payload = new List<MatchDto>
                {
                    new()
                    {
                        MatchId = 42,
                        TeamA = "BTC",
                        TeamB = "ETH",
                        Status = "Completed",
                        IsFinished = true,
                        EndTime = DateTime.UtcNow.AddDays(-1)
                    },
                    new()
                    {
                        MatchId = 43,
                        TeamA = "SOL",
                        TeamB = "XRP",
                        Status = "Ongoing",
                        IsFinished = false,
                        StartTime = DateTime.UtcNow.AddMinutes(-10)
                    }
                };
            }

            var json = JsonSerializer.Serialize(payload, payload.GetType(), JsonOptions);
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(json, Encoding.UTF8, "application/json")
            });
        }
    }

    private sealed class StickyPageApiHandler : HttpMessageHandler
    {
        private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            object payload = new List<MatchDto>
            {
                new()
                {
                    MatchId = 42,
                    TeamA = "BTC",
                    TeamB = "ETH",
                    Status = "Completed",
                    IsFinished = true,
                    EndTime = DateTime.UtcNow.AddDays(-1)
                },
                new()
                {
                    MatchId = 43,
                    TeamA = "SOL",
                    TeamB = "XRP",
                    Status = "Ongoing",
                    IsFinished = false,
                    StartTime = DateTime.UtcNow.AddMinutes(-10)
                }
            };

            var json = JsonSerializer.Serialize(payload, payload.GetType(), JsonOptions);
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(json, Encoding.UTF8, "application/json")
            });
        }
    }
}
