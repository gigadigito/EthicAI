using CriptoVersus.Web.Services;
using DTOs;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Logging.Abstractions;

namespace EthicAI.test;

public sealed class MatchSeoServiceTests
{
    [Fact]
    public void BuildCanonicalUrl_UsesGlobalCanonicalRoute()
    {
        var service = CreateService();

        var canonical = service.BuildCanonicalUrl("en", 39, "ada-vs-bnb");

        Assert.Equal("https://seudominio.com/en/match/39/ada-vs-bnb", canonical);
    }

    [Fact]
    public void BuildCanonicalUrl_EncodesUnicodeSlugSegments()
    {
        var service = CreateService();
        var slug = "币安人生-vs-ビットコイン";

        var canonical = service.BuildCanonicalUrl("en", 39, slug);

        Assert.Equal($"https://seudominio.com/en/match/39/{Uri.EscapeDataString(slug)}", canonical);
    }

    [Fact]
    public void BuildAlternateLinks_ReturnsAllEightCulturesWithCorrectHreflangUrls()
    {
        var service = CreateService();

        var links = service.BuildAlternateLinks(39, "ada-vs-bnb");

        Assert.Equal(8, links.Count);
        Assert.Contains(links, l => l.HrefLang == "en-US" && l.Href == "https://seudominio.com/en/match/39/ada-vs-bnb");
        Assert.Contains(links, l => l.HrefLang == "pt-BR" && l.Href == "https://seudominio.com/pt/partida/39/ada-vs-bnb");
        Assert.Contains(links, l => l.HrefLang == "zh-CN" && l.Href == "https://seudominio.com/zh/match/39/ada-vs-bnb");
        Assert.Contains(links, l => l.HrefLang == "es-ES" && l.Href == "https://seudominio.com/es/match/39/ada-vs-bnb");
        Assert.Contains(links, l => l.HrefLang == "fr-FR" && l.Href == "https://seudominio.com/fr/match/39/ada-vs-bnb");
        Assert.Contains(links, l => l.HrefLang == "de-DE" && l.Href == "https://seudominio.com/de/match/39/ada-vs-bnb");
        Assert.Contains(links, l => l.HrefLang == "it-IT" && l.Href == "https://seudominio.com/it/match/39/ada-vs-bnb");
        Assert.Contains(links, l => l.HrefLang == "ja-JP" && l.Href == "https://seudominio.com/ja/match/39/ada-vs-bnb");
    }

    [Fact]
    public void BuildAlternateLinks_EncodesUnicodeSlugSegments()
    {
        var service = CreateService();
        var slug = "币安人生-vs-ビットコイン";

        var links = service.BuildAlternateLinks(39, slug);

        Assert.Equal(8, links.Count);
        Assert.Contains(links, l => l.HrefLang == "en-US" && l.Href == $"https://seudominio.com/en/match/39/{Uri.EscapeDataString(slug)}");
        Assert.Contains(links, l => l.HrefLang == "pt-BR" && l.Href == $"https://seudominio.com/pt/partida/39/{Uri.EscapeDataString(slug)}");
        Assert.Contains(links, l => l.HrefLang == "es-ES" && l.Href == $"https://seudominio.com/es/match/39/{Uri.EscapeDataString(slug)}");
    }

    [Fact]
    public void BuildMetadata_UsesMatchTeamsAndId()
    {
        var service = CreateService();
        var match = new MatchDto
        {
            MatchId = 39,
            TeamA = "ADAUSDT",
            TeamB = "BNBUSDT"
        };

        Assert.Contains("ADA vs BNB", service.BuildTitle(match, "pt"));
        Assert.Contains("CriptoVersus", service.BuildTitle(match, "pt"));
        Assert.Contains("ADA vs BNB", service.BuildDescription(match, "pt"));
    }

    [Fact]
    public void BuildDescription_ForCompletedMatch_GeneratesResultCopyWithLocalizedDate()
    {
        var service = CreateService();
        var match = new MatchDto
        {
            MatchId = 39,
            TeamA = "LUMIAUSDT",
            TeamB = "UTKUSDT",
            Status = "Completed",
            EndTime = new DateTime(2026, 05, 01, 15, 30, 00, DateTimeKind.Utc)
        };

        var description = service.BuildDescription(match, "pt");

        Assert.Contains("CriptoVersus", description);
        Assert.False(string.IsNullOrWhiteSpace(description));
    }

    [Fact]
    public void BuildDescription_ForOngoingMatch_GeneratesLiveCopy()
    {
        var service = CreateService();
        var match = new MatchDto
        {
            TeamA = "ADAUSDT",
            TeamB = "BNBUSDT",
            Status = "Ongoing"
        };

        var description = service.BuildDescription(match, "pt");

        Assert.Contains("CriptoVersus", description);
        Assert.False(string.IsNullOrWhiteSpace(description));
    }

    [Fact]
    public void BuildDescription_ForPendingMatch_GeneratesUpcomingCopy()
    {
        var service = CreateService();
        var match = new MatchDto
        {
            TeamA = "ADAUSDT",
            TeamB = "BNBUSDT",
            Status = "Pending"
        };

        var description = service.BuildDescription(match, "pt");

        Assert.Contains("CriptoVersus", description);
        Assert.False(string.IsNullOrWhiteSpace(description));
    }

    [Fact]
    public void BuildDescription_NeverReturnsEmptyString()
    {
        var service = CreateService();
        var match = new MatchDto
        {
            TeamA = "ADAUSDT",
            TeamB = "BNBUSDT",
            Status = "Unknown"
        };

        var description = service.BuildDescription(match, "pt");

        Assert.False(string.IsNullOrWhiteSpace(description));
    }

    [Fact]
    public void BuildMetadata_ProvidesCanonicalAndSocialMetadata()
    {
        var service = CreateService();
        var match = new MatchDto
        {
            MatchId = 39,
            TeamA = "ADAUSDT",
            TeamB = "BNBUSDT",
            Status = "Completed",
            EndTime = new DateTime(2026, 05, 01, 15, 30, 00, DateTimeKind.Utc)
        };

        var metadata = service.BuildMetadata(match, "ada-vs-bnb", "pt");

        Assert.Equal("https://seudominio.com/pt/partida/39/ada-vs-bnb", metadata.CanonicalUrl);
        Assert.Contains("ADA vs BNB", metadata.OpenGraphTitle);
        Assert.Equal(metadata.Description, metadata.OpenGraphDescription);
        Assert.Equal(metadata.CanonicalUrl, metadata.OpenGraphUrl);
        Assert.Equal("summary_large_image", metadata.TwitterCard);
    }

    private static MatchSeoService CreateService()
    {
        var appCultureService = new AppCultureService();
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["CriptoVersus:PublicBaseUrl"] = "https://seudominio.com",
                ["CriptoVersus:Seo:TimeZones:Pt"] = "E. South America Standard Time",
                ["CriptoVersus:Seo:TimeZones:En"] = "UTC"
            })
            .Build();

        var environment = new FakeWebHostEnvironment
        {
            ContentRootPath = "C:\\EthicAI\\EthicAI\\CriptoVersus",
            WebRootPath = "C:\\EthicAI\\EthicAI\\CriptoVersus\\wwwroot",
            EnvironmentName = "Production"
        };

        var localization = new LocalizationService(environment, appCultureService, NullLogger<LocalizationService>.Instance);
        var languages = new SupportedLanguageCatalog();
        return new MatchSeoService(
            appCultureService,
            configuration,
            localization,
            new MatchSlugHelper(),
            new RouteLocalizationService(appCultureService),
            languages);
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
}
