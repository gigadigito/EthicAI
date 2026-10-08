using CriptoVersus.Web.Services;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.Configuration.Memory;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Logging.Abstractions;

public sealed class RoadmapContentServiceTests
{
    private const string PublicBaseUrl = "https://www.criptoversus.com";

    [Fact]
    public void BuildPage_UsesCanonicalRoadmapUrl()
    {
        var service = CreateService();

        var page = service.BuildPage("pt");

        Assert.Equal("https://www.criptoversus.com/pt/roadmap", page.CanonicalUrl);
    }

    [Fact]
    public void BuildPage_ExposesLocalizedAlternateLinks()
    {
        var service = CreateService();

        var page = service.BuildPage("pt");

        Assert.Contains(page.AlternateLinks, x => x.HrefLang == "pt-BR" && x.Href == "https://www.criptoversus.com/pt/roadmap");
        Assert.Contains(page.AlternateLinks, x => x.HrefLang == "en-US" && x.Href == "https://www.criptoversus.com/en/roadmap");
        Assert.Contains(page.AlternateLinks, x => x.HrefLang == "zh-CN" && x.Href == "https://www.criptoversus.com/zh/roadmap");
        Assert.Contains(page.AlternateLinks, x => x.HrefLang == "es-ES" && x.Href == "https://www.criptoversus.com/es/roadmap");
        Assert.Contains(page.AlternateLinks, x => x.HrefLang == "fr-FR" && x.Href == "https://www.criptoversus.com/fr/roadmap");
        Assert.Contains(page.AlternateLinks, x => x.HrefLang == "de-DE" && x.Href == "https://www.criptoversus.com/de/roadmap");
        Assert.Contains(page.AlternateLinks, x => x.HrefLang == "it-IT" && x.Href == "https://www.criptoversus.com/it/roadmap");
        Assert.Contains(page.AlternateLinks, x => x.HrefLang == "ja-JP" && x.Href == "https://www.criptoversus.com/ja/roadmap");
    }

    [Fact]
    public void BuildPage_PopulatesSeoMetadata()
    {
        var service = CreateService();

        var page = service.BuildPage("pt");

        Assert.False(string.IsNullOrWhiteSpace(page.MetaDescription));
        Assert.False(string.IsNullOrWhiteSpace(page.OpenGraph.Title));
        Assert.Equal(page.CanonicalUrl, page.OpenGraph.Url);
    }

    [Fact]
    public void BuildPage_ForEnglishRoute_ReturnsEnglishContent()
    {
        var service = CreateService();

        var page = service.BuildPage("en");

        Assert.Equal("en", page.Culture);
        Assert.Contains("Roadmap", page.Hero.Title);
        Assert.False(string.IsNullOrWhiteSpace(page.Hero.Subtitle));
    }

    [Fact]
    public void NormalizeCulture_FallsBackToEnglishForUnknown()
    {
        var service = CreateService();

        Assert.Equal("en", service.NormalizeCulture(null));
        Assert.Equal("en", service.NormalizeCulture("xx"));
    }

    [Fact]
    public void NormalizeCulture_RecognizesAllEightCultures()
    {
        var service = CreateService();

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
    public void BuildPage_DoesNotUseForbiddenFinancialPromises()
    {
        var service = CreateService();

        var page = service.BuildPage("pt");
        var allText = string.Join(" ",
            page.PageTitle,
            page.MetaDescription,
            page.Hero.Title,
            page.Hero.Subtitle,
            page.NoticeText,
            string.Join(" ", page.StatusCards.Select(x => $"{x.Title} {x.Description}")),
            string.Join(" ", page.Phases.Select(x => $"{x.Title} {x.Description} {string.Join(" ", x.Items)}")),
            string.Join(" ", page.Principles.Select(x => $"{x.Title} {x.Description}")));

        Assert.DoesNotContain("lucro garantido", allText, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("retorno garantido", allText, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("investimento seguro", allText, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("aposta garantida", allText, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void BuildPage_AllEightCulturesHaveOwnContent()
    {
        var service = CreateService();
        var cultures = new[] { "en", "pt", "zh", "es", "fr", "de", "it", "ja" };

        foreach (var culture in cultures)
        {
            var page = service.BuildPage(culture);
            Assert.Equal(culture, page.Culture);
            Assert.False(string.IsNullOrWhiteSpace(page.PageTitle), $"PageTitle empty for {culture}");
            Assert.False(string.IsNullOrWhiteSpace(page.MetaDescription), $"MetaDescription empty for {culture}");
            Assert.False(string.IsNullOrWhiteSpace(page.Hero.Title), $"Hero.Title empty for {culture}");
            Assert.NotEmpty(page.StatusCards);
            Assert.NotEmpty(page.Phases);
            Assert.NotEmpty(page.Principles);
            Assert.False(string.IsNullOrWhiteSpace(page.NoticeTitle), $"NoticeTitle empty for {culture}");
            Assert.False(string.IsNullOrWhiteSpace(page.NoticeText), $"NoticeText empty for {culture}");
        }
    }

    [Fact]
    public void BuildPage_NewCulturesHaveNativeContentNotEnglishFallback()
    {
        var service = CreateService();

        var enPage = service.BuildPage("en");
        var esPage = service.BuildPage("es");
        var frPage = service.BuildPage("fr");
        var dePage = service.BuildPage("de");
        var itPage = service.BuildPage("it");
        var jaPage = service.BuildPage("ja");

        Assert.NotEqual(enPage.PageTitle, esPage.PageTitle);
        Assert.NotEqual(enPage.PageTitle, frPage.PageTitle);
        Assert.NotEqual(enPage.Hero.Subtitle, esPage.Hero.Subtitle);
        Assert.NotEqual(enPage.Hero.Subtitle, frPage.Hero.Subtitle);
    }

    [Fact]
    public void BuildPage_PhasesPreservedAcrossAllCultures()
    {
        var service = CreateService();
        var cultures = new[] { "en", "pt", "zh", "es", "fr", "de", "it", "ja" };

        foreach (var culture in cultures)
        {
            var page = service.BuildPage(culture);
            var phases = page.Phases.OrderBy(p => p.SortOrder).ToList();

            Assert.Equal(7, phases.Count);
            Assert.Equal(1, phases[0].SortOrder);
            Assert.Equal(7, phases[6].SortOrder);
            Assert.Equal(RoadmapPhaseStatus.InProgress, phases[0].Status);
            Assert.Equal(RoadmapPhaseStatus.Future, phases[6].Status);
        }
    }

    private static RoadmapContentService CreateService()
    {
        var appCultureService = new AppCultureService();
        var data = new Dictionary<string, string?>
        {
            ["CriptoVersus:PublicBaseUrl"] = PublicBaseUrl
        };

        var configuration = new ConfigurationBuilder()
            .Add(new MemoryConfigurationSource { InitialData = data })
            .Build();

        var environment = new FakeWebHostEnvironment
        {
            ContentRootPath = "C:\\EthicAI\\EthicAI\\CriptoVersus",
            WebRootPath = "C:\\EthicAI\\EthicAI\\CriptoVersus\\wwwroot",
            EnvironmentName = "Production"
        };

        var catalog = new SupportedLanguageCatalog();
        var localization = new LocalizationService(environment, appCultureService, NullLogger<LocalizationService>.Instance);

        return new RoadmapContentService(configuration, new RouteLocalizationService(appCultureService), catalog, localization);
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
