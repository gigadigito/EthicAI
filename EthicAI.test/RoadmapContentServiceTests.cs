using CriptoVersus.Web.Services;
using Microsoft.Extensions.Configuration.Memory;

public sealed class RoadmapContentServiceTests
{
    private const string PublicBaseUrl = "https://criptoversus.com";

    [Fact]
    public void BuildPage_UsesCanonicalRoadmapUrl()
    {
        var service = CreateService();

        var page = service.BuildPage("pt");

        Assert.Equal("https://criptoversus.com/roadmap", page.CanonicalUrl);
    }

    [Fact]
    public void BuildPage_ExposesLocalizedAlternateLinks()
    {
        var service = CreateService();

        var page = service.BuildPage("pt");

        Assert.Contains(page.AlternateLinks, x => x.HrefLang == "pt-br" && x.Href == "https://criptoversus.com/pt/roadmap");
        Assert.Contains(page.AlternateLinks, x => x.HrefLang == "en" && x.Href == "https://criptoversus.com/en/roadmap");
    }

    [Fact]
    public void BuildPage_PopulatesSeoMetadata()
    {
        var service = CreateService();

        var page = service.BuildPage("pt");

        Assert.False(string.IsNullOrWhiteSpace(page.MetaDescription));
        Assert.Equal("Roadmap CriptoVersus", page.OpenGraph.Title);
        Assert.Equal(page.CanonicalUrl, page.OpenGraph.Url);
    }

    [Fact]
    public void BuildPage_ForEnglishRoute_ReturnsEnglishContent()
    {
        var service = CreateService();

        var page = service.BuildPage("en");

        Assert.Equal("en", page.Culture);
        Assert.Equal("CriptoVersus Roadmap", page.Hero.Title);
        Assert.Contains("Follow the platform evolution", page.Hero.Subtitle);
    }

    [Fact]
    public void NormalizeCulture_FallsBackToPortuguese()
    {
        var service = CreateService();

        Assert.Equal("pt", service.NormalizeCulture(null));
        Assert.Equal("pt", service.NormalizeCulture("es"));
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

    private static RoadmapContentService CreateService()
    {
        var data = new Dictionary<string, string?>
        {
            ["CriptoVersus:PublicBaseUrl"] = PublicBaseUrl
        };

        var configuration = new ConfigurationBuilder()
            .Add(new MemoryConfigurationSource { InitialData = data })
            .Build();

        return new RoadmapContentService(configuration);
    }
}
