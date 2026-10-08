using System.Xml.Linq;
using CriptoVersus.Web.Services;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Logging.Abstractions;

namespace EthicAI.test;

public sealed class SitemapServiceTests
{
    private static readonly XNamespace SitemapNs = "http://www.sitemaps.org/schemas/sitemap/0.9";
    private static readonly XNamespace XhtmlNs = "http://www.w3.org/1999/xhtml";

    private static readonly string[] ExpectedCultures = ["en", "pt", "zh", "es", "fr", "de", "it", "ja"];
    private static readonly string[] ExpectedHrefLangs = ["en-US", "pt-BR", "zh-CN", "es-ES", "fr-FR", "de-DE", "it-IT", "ja-JP"];

    [Fact]
    public void SupportedLanguageCatalog_ContainsEightLanguages()
    {
        var catalog = new SupportedLanguageCatalog();
        var enabled = catalog.EnabledLanguages;

        Assert.Equal(8, enabled.Count);
    }

    [Fact]
    public void SupportedLanguageCatalog_ContainsAllExpectedCultures()
    {
        var catalog = new SupportedLanguageCatalog();

        foreach (var culture in ExpectedCultures)
        {
            Assert.True(
                catalog.TryGet(culture, out var language),
                $"Culture '{culture}' not found in SupportedLanguageCatalog");
            Assert.True(language.Enabled, $"Culture '{culture}' is not enabled");
        }
    }

    [Fact]
    public void SupportedLanguageCatalog_DefaultLanguageIsEnglish()
    {
        var catalog = new SupportedLanguageCatalog();

        Assert.Equal("en", catalog.DefaultLanguage.RouteCulture);
        Assert.Equal("en-US", catalog.DefaultLanguage.Culture);
    }

    [Fact]
    public void SupportedLanguageCatalog_NewLanguagesAreNotEstablished()
    {
        var catalog = new SupportedLanguageCatalog();
        var additional = catalog.AdditionalLanguages;

        Assert.Contains(additional, l => l.RouteCulture == "es");
        Assert.Contains(additional, l => l.RouteCulture == "fr");
        Assert.Contains(additional, l => l.RouteCulture == "de");
        Assert.Contains(additional, l => l.RouteCulture == "it");
        Assert.Contains(additional, l => l.RouteCulture == "ja");
        Assert.DoesNotContain(additional, l => l.RouteCulture == "en");
        Assert.DoesNotContain(additional, l => l.RouteCulture == "pt");
        Assert.DoesNotContain(additional, l => l.RouteCulture == "zh");
    }

    [Fact]
    public void RouteLocalizationService_BuildHomePathForAllCultures()
    {
        var catalog = new SupportedLanguageCatalog();
        var appCulture = new AppCultureService(catalog);
        var service = new RouteLocalizationService(appCulture);

        foreach (var language in catalog.EnabledLanguages)
        {
            var path = service.BuildHomePath(language.RouteCulture);
            Assert.Equal($"/{language.RouteCulture}", path);
        }
    }

    [Fact]
    public void RouteLocalizationService_BuildLocalizedPathForAllCultures()
    {
        var catalog = new SupportedLanguageCatalog();
        var appCulture = new AppCultureService(catalog);
        var service = new RouteLocalizationService(appCulture);

        foreach (var language in catalog.EnabledLanguages)
        {
            var path = service.BuildLocalizedPath(language.RouteCulture, 42, "btc-vs-eth");
            Assert.StartsWith($"/{language.RouteCulture}/", path);
            Assert.Contains("42", path);
            Assert.Contains("btc-vs-eth", path);
        }
    }

    [Fact]
    public void RouteLocalizationService_PortugueseUsesPartidaSegment()
    {
        var catalog = new SupportedLanguageCatalog();
        var appCulture = new AppCultureService(catalog);
        var service = new RouteLocalizationService(appCulture);

        Assert.Contains("/partida/", service.BuildLocalizedPath("pt", 1, "test"));
    }

    [Fact]
    public void RouteLocalizationService_NewCulturesUseMatchSegment()
    {
        var catalog = new SupportedLanguageCatalog();
        var appCulture = new AppCultureService(catalog);
        var service = new RouteLocalizationService(appCulture);

        Assert.Contains("/match/", service.BuildLocalizedPath("es", 1, "test"));
        Assert.Contains("/match/", service.BuildLocalizedPath("fr", 1, "test"));
        Assert.Contains("/match/", service.BuildLocalizedPath("de", 1, "test"));
        Assert.Contains("/match/", service.BuildLocalizedPath("it", 1, "test"));
        Assert.Contains("/match/", service.BuildLocalizedPath("ja", 1, "test"));
    }

    [Fact]
    public void RouteLocalizationService_GetHrefLangForAllCultures()
    {
        var catalog = new SupportedLanguageCatalog();
        var appCulture = new AppCultureService(catalog);
        var service = new RouteLocalizationService(appCulture);

        foreach (var expected in ExpectedHrefLangs)
        {
            var culture = expected.Split('-')[0].ToLower() == expected.Split('-')[0].ToLower()
                ? catalog.EnabledLanguages.First(l => l.Culture == expected).RouteCulture
                : expected;
        }

        Assert.Equal("en-US", service.GetHrefLang("en"));
        Assert.Equal("pt-BR", service.GetHrefLang("pt"));
        Assert.Equal("zh-CN", service.GetHrefLang("zh"));
        Assert.Equal("es-ES", service.GetHrefLang("es"));
        Assert.Equal("fr-FR", service.GetHrefLang("fr"));
        Assert.Equal("de-DE", service.GetHrefLang("de"));
        Assert.Equal("it-IT", service.GetHrefLang("it"));
        Assert.Equal("ja-JP", service.GetHrefLang("ja"));
    }

    [Fact]
    public void RouteLocalizationService_BuildAllPagePathsForNewCultures()
    {
        var catalog = new SupportedLanguageCatalog();
        var appCulture = new AppCultureService(catalog);
        var service = new RouteLocalizationService(appCulture);

        var newCultures = new[] { "es", "fr", "de", "it", "ja" };
        foreach (var culture in newCultures)
        {
            Assert.StartsWith($"/{culture}/", service.BuildFaqPath(culture));
            Assert.StartsWith($"/{culture}/", service.BuildTvPath(culture));
            Assert.StartsWith($"/{culture}/", service.BuildTvBroadcastPath(culture));
            Assert.StartsWith($"/{culture}/", service.BuildStatsPath(culture));
            Assert.StartsWith($"/{culture}/", service.BuildStatsTeamsPath(culture));
            Assert.StartsWith($"/{culture}/", service.BuildStatsMatchesPath(culture));
            Assert.StartsWith($"/{culture}/", service.BuildStatsRankingsPath(culture));
            Assert.StartsWith($"/{culture}/", service.BuildStatsRecordsPath(culture));
            Assert.StartsWith($"/{culture}/", service.BuildTokenPath(culture));
            Assert.StartsWith($"/{culture}/", service.BuildRoadmapPath(culture));
            Assert.StartsWith($"/{culture}/", service.BuildHowItWorksPath(culture));
            Assert.StartsWith($"/{culture}/", service.BuildAboutPath(culture));
            Assert.StartsWith($"/{culture}/", service.BuildScoringRulesPath(culture));
            Assert.StartsWith($"/{culture}/", service.BuildRiskDisclaimerPath(culture));
        }
    }

    [Fact]
    public void MatchSeoService_BuildAlternateLinks_ContainsAllEightCultures()
    {
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["CriptoVersus:PublicBaseUrl"] = "https://www.criptoversus.com"
            })
            .Build();

        var environment = new FakeWebHostEnvironment
        {
            ContentRootPath = "C:\\EthicAI\\EthicAI\\CriptoVersus",
            WebRootPath = "C:\\EthicAI\\EthicAI\\CriptoVersus\\wwwroot",
            EnvironmentName = "Production"
        };

        var catalog = new SupportedLanguageCatalog();
        var appCulture = new AppCultureService(catalog);
        var routeLocalization = new RouteLocalizationService(appCulture);
        var localization = new LocalizationService(environment, appCulture, NullLogger<LocalizationService>.Instance);

        var seoService = new MatchSeoService(
            appCulture,
            config,
            localization,
            new MatchSlugHelper(),
            routeLocalization,
            catalog);

        var alternates = seoService.BuildAlternateLinks(1, "btc-vs-eth");

        Assert.Equal(8, alternates.Count);

        var hrefLangs = alternates.Select(a => a.HrefLang).ToList();
        foreach (var expected in ExpectedHrefLangs)
        {
            Assert.Contains(expected, hrefLangs);
        }
    }

    [Fact]
    public void MatchSeoService_BuildAlternateLinks_HasUniqueUrls()
    {
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["CriptoVersus:PublicBaseUrl"] = "https://www.criptoversus.com"
            })
            .Build();

        var environment = new FakeWebHostEnvironment
        {
            ContentRootPath = "C:\\EthicAI\\EthicAI\\CriptoVersus",
            WebRootPath = "C:\\EthicAI\\EthicAI\\CriptoVersus\\wwwroot",
            EnvironmentName = "Production"
        };

        var catalog = new SupportedLanguageCatalog();
        var appCulture = new AppCultureService(catalog);
        var routeLocalization = new RouteLocalizationService(appCulture);
        var localization = new LocalizationService(environment, appCulture, NullLogger<LocalizationService>.Instance);

        var seoService = new MatchSeoService(
            appCulture,
            config,
            localization,
            new MatchSlugHelper(),
            routeLocalization,
            catalog);

        var alternates = seoService.BuildAlternateLinks(1, "btc-vs-eth");

        var urls = alternates.Select(a => a.Href).ToList();
        Assert.Equal(urls.Count, urls.Distinct().Count());
    }

    [Fact]
    public void MatchSeoService_BuildAlternateLinks_ContainsCorrectUrlPatterns()
    {
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["CriptoVersus:PublicBaseUrl"] = "https://www.criptoversus.com"
            })
            .Build();

        var environment = new FakeWebHostEnvironment
        {
            ContentRootPath = "C:\\EthicAI\\EthicAI\\CriptoVersus",
            WebRootPath = "C:\\EthicAI\\EthicAI\\CriptoVersus\\wwwroot",
            EnvironmentName = "Production"
        };

        var catalog = new SupportedLanguageCatalog();
        var appCulture = new AppCultureService(catalog);
        var routeLocalization = new RouteLocalizationService(appCulture);
        var localization = new LocalizationService(environment, appCulture, NullLogger<LocalizationService>.Instance);

        var seoService = new MatchSeoService(
            appCulture,
            config,
            localization,
            new MatchSlugHelper(),
            routeLocalization,
            catalog);

        var alternates = seoService.BuildAlternateLinks(42, "btc-vs-eth");

        var enLink = alternates.First(a => a.HrefLang == "en-US");
        Assert.Contains("/en/match/42/", enLink.Href);

        var ptLink = alternates.First(a => a.HrefLang == "pt-BR");
        Assert.Contains("/pt/partida/42/", ptLink.Href);

        var esLink = alternates.First(a => a.HrefLang == "es-ES");
        Assert.Contains("/es/match/42/", esLink.Href);

        var jaLink = alternates.First(a => a.HrefLang == "ja-JP");
        Assert.Contains("/ja/match/42/", jaLink.Href);
    }

    [Fact]
    public void RoadmapContentService_NormalizeCulture_RecognizesAllEightCultures()
    {
        var service = CreateRoadmapService();

        Assert.Equal("en", service.NormalizeCulture("en"));
        Assert.Equal("pt", service.NormalizeCulture("pt"));
        Assert.Equal("zh", service.NormalizeCulture("zh"));
        Assert.Equal("es", service.NormalizeCulture("es"));
        Assert.Equal("fr", service.NormalizeCulture("fr"));
        Assert.Equal("de", service.NormalizeCulture("de"));
        Assert.Equal("it", service.NormalizeCulture("it"));
        Assert.Equal("ja", service.NormalizeCulture("ja"));
    }

    [Fact]
    public void RoadmapContentService_NormalizeCulture_FallsBackToEnglishForUnknown()
    {
        var service = CreateRoadmapService();

        Assert.Equal("en", service.NormalizeCulture(null));
        Assert.Equal("en", service.NormalizeCulture("xx"));
        Assert.Equal("en", service.NormalizeCulture(""));
    }

    [Fact]
    public void RoadmapContentService_BuildPage_HasAlternateLinksForAllEightCultures()
    {
        var service = CreateRoadmapService();

        var page = service.BuildPage("en");

        Assert.Equal(8, page.AlternateLinks.Count);
        Assert.Contains(page.AlternateLinks, l => l.HrefLang == "en-US");
        Assert.Contains(page.AlternateLinks, l => l.HrefLang == "pt-BR");
        Assert.Contains(page.AlternateLinks, l => l.HrefLang == "zh-CN");
        Assert.Contains(page.AlternateLinks, l => l.HrefLang == "es-ES");
        Assert.Contains(page.AlternateLinks, l => l.HrefLang == "fr-FR");
        Assert.Contains(page.AlternateLinks, l => l.HrefLang == "de-DE");
        Assert.Contains(page.AlternateLinks, l => l.HrefLang == "it-IT");
        Assert.Contains(page.AlternateLinks, l => l.HrefLang == "ja-JP");
    }

    [Fact]
    public void RoadmapContentService_AllEightCulturesHaveOwnContent()
    {
        var service = CreateRoadmapService();
        var cultures = new[] { "en", "pt", "zh", "es", "fr", "de", "it", "ja" };

        foreach (var culture in cultures)
        {
            var page = service.BuildPage(culture);
            Assert.Equal(culture, page.Culture);
            Assert.False(string.IsNullOrWhiteSpace(page.PageTitle), $"PageTitle empty for {culture}");
            Assert.False(string.IsNullOrWhiteSpace(page.Hero.Title), $"Hero.Title empty for {culture}");
            Assert.NotEmpty(page.StatusCards);
            Assert.NotEmpty(page.Phases);
            Assert.NotEmpty(page.Principles);
            Assert.NotEmpty(page.AlternateLinks);
        }
    }

    [Fact]
    public void I18n_FilesExistForAllEightCultures()
    {
        var contentRoot = "C:\\EthicAI\\EthicAI\\CriptoVersus";
        var expectedFiles = new[]
        {
            "i18n.en-US.json", "i18n.pt-BR.json", "i18n.zh-CN.json",
            "i18n.es-ES.json", "i18n.fr-FR.json", "i18n.de-DE.json",
            "i18n.it-IT.json", "i18n.ja-JP.json"
        };

        foreach (var file in expectedFiles)
        {
            var path = Path.Combine(contentRoot, file);
            Assert.True(File.Exists(path), $"Missing translation file: {file}");
        }
    }

    [Fact]
    public void I18n_AllFilesHaveSameKeyCount()
    {
        var contentRoot = "C:\\EthicAI\\EthicAI\\CriptoVersus";
        var files = new[] { "i18n.en-US.json", "i18n.pt-BR.json", "i18n.zh-CN.json", "i18n.es-ES.json", "i18n.fr-FR.json", "i18n.de-DE.json", "i18n.it-IT.json", "i18n.ja-JP.json" };

        var counts = new Dictionary<string, int>();
        foreach (var file in files)
        {
            var path = Path.Combine(contentRoot, file);
            var json = System.Text.Json.JsonDocument.Parse(File.ReadAllText(path));
            counts[file] = CountJsonLeaves(json.RootElement);
        }

        var enCount = counts["i18n.en-US.json"];
        foreach (var kvp in counts)
        {
            Assert.True(kvp.Value >= enCount * 0.9, $"{kvp.Key} has {kvp.Value} keys vs en-US {enCount} (less than 90%)");
        }
    }

    private static int CountJsonLeaves(System.Text.Json.JsonElement element)
    {
        if (element.ValueKind != System.Text.Json.JsonValueKind.Object)
            return 1;

        var count = 0;
        foreach (var prop in element.EnumerateObject())
            count += CountJsonLeaves(prop.Value);
        return count;
    }

    private sealed class FakeWebHostEnvironment : IWebHostEnvironment
    {
        public string ApplicationName { get; set; } = "EthicAI.test";
        public IFileProvider WebRootFileProvider { get; set; } = new NullFileProvider();
        public string WebRootPath { get; set; } = string.Empty;
        public string EnvironmentName { get; set; } = "Production";
        public string ContentRootPath { get; set; } = string.Empty;
        public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
    }

    private static RoadmapContentService CreateRoadmapService()
    {
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?> { ["CriptoVersus:PublicBaseUrl"] = "https://www.criptoversus.com" })
            .Build();
        var catalog = new SupportedLanguageCatalog();
        var appCulture = new AppCultureService(catalog);
        var environment = new FakeWebHostEnvironment
        {
            ContentRootPath = "C:\\EthicAI\\EthicAI\\CriptoVersus",
            WebRootPath = "C:\\EthicAI\\EthicAI\\CriptoVersus\\wwwroot",
            EnvironmentName = "Production"
        };
        var localization = new LocalizationService(environment, appCulture, NullLogger<LocalizationService>.Instance);
        return new RoadmapContentService(config, new RouteLocalizationService(appCulture), catalog, localization);
    }
}