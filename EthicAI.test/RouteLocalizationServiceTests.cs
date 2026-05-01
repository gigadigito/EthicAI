using CriptoVersus.Web.Services;

namespace EthicAI.test;

public sealed class RouteLocalizationServiceTests
{
    private readonly RouteLocalizationService _service = new();

    [Fact]
    public void BuildLocalizedPath_ForPortugueseRoute_UsesPartidaSegment()
    {
        Assert.Equal("/pt/partida/39/ada-vs-bnb", _service.BuildLocalizedPath("pt", 39, "ada-vs-bnb"));
    }

    [Fact]
    public void BuildLocalizedPath_ForEnglishRoute_UsesMatchSegment()
    {
        Assert.Equal("/en/match/39/ada-vs-bnb", _service.BuildLocalizedPath("en", 39, "ada-vs-bnb"));
    }

    [Fact]
    public void BuildBestPath_WithoutCulture_FallsBackToCanonicalRoute()
    {
        Assert.Equal("/match/39/ada-vs-bnb", _service.BuildBestPath(null, 39, "ada-vs-bnb"));
    }
}
