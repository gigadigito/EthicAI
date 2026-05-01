using CriptoVersus.Web.Services;
using DTOs;
using Microsoft.Extensions.Configuration;

namespace EthicAI.test;

public sealed class MatchSeoServiceTests
{
    [Fact]
    public void BuildCanonicalUrl_UsesGlobalCanonicalRoute()
    {
        var service = CreateService();

        var canonical = service.BuildCanonicalUrl(39, "ada-vs-bnb");

        Assert.Equal("https://seudominio.com/match/39/ada-vs-bnb", canonical);
    }

    [Fact]
    public void BuildAlternateLinks_ReturnsPtAndEnHreflangUrls()
    {
        var service = CreateService();

        var links = service.BuildAlternateLinks(39, "ada-vs-bnb");

        Assert.Collection(
            links,
            pt =>
            {
                Assert.Equal("pt-br", pt.HrefLang);
                Assert.Equal("https://seudominio.com/pt/partida/39/ada-vs-bnb", pt.Href);
            },
            en =>
            {
                Assert.Equal("en", en.HrefLang);
                Assert.Equal("https://seudominio.com/en/match/39/ada-vs-bnb", en.Href);
            });
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

        Assert.Equal("ADA vs BNB - Resultado da Partida #39 | CriptoVersus", service.BuildTitle(match));
        Assert.Contains("ADA vs BNB", service.BuildDescription(match));
    }

    private static MatchSeoService CreateService()
    {
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["CriptoVersus:PublicBaseUrl"] = "https://seudominio.com"
            })
            .Build();

        return new MatchSeoService(configuration, new MatchSlugHelper(), new RouteLocalizationService());
    }
}
