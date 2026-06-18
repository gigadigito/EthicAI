using CriptoVersus.Web.Services;

namespace EthicAI.test;

public sealed class RouteLocalizationServiceTests
{
    private readonly RouteLocalizationService _service = new(new AppCultureService());

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
    public void BuildLocalizedPath_EncodesUnicodeSlugSegments()
    {
        var slug = "币安人生-vs-ビットコイン";
        var expected = $"/en/match/39/{Uri.EscapeDataString(slug)}";

        Assert.Equal(expected, _service.BuildLocalizedPath("en", 39, slug));
    }

    [Fact]
    public void BuildBestPath_WithoutCulture_FallsBackToCanonicalRoute()
    {
        Assert.Equal("/en/match/39/ada-vs-bnb", _service.BuildBestPath(null, 39, "ada-vs-bnb"));
    }

    [Fact]
    public void BuildTvPath_UsesLocalizedCulturePrefix()
    {
        Assert.Equal("/pt/tv", _service.BuildTvPath("pt"));
        Assert.Equal("/en/tv", _service.BuildTvPath("en"));
    }

    [Fact]
    public void BuildTvMatchPath_UsesLocalizedCulturePrefix()
    {
        Assert.Equal("/pt/tv/match/39/ada-vs-bnb", _service.BuildTvMatchPath("pt", 39, "ada-vs-bnb"));
        Assert.Equal("/en/tv/match/39/ada-vs-bnb", _service.BuildTvMatchPath("en", 39, "ada-vs-bnb"));
    }

    [Fact]
    public void BuildTvMatchPath_EncodesUnicodeSlugSegments()
    {
        var slug = "币安人生-vs-ビットコイン";
        var expected = $"/en/tv/match/39/{Uri.EscapeDataString(slug)}";

        Assert.Equal(expected, _service.BuildTvMatchPath("en", 39, slug));
    }

    [Fact]
    public void BuildTvBroadcastPath_UsesLocalizedCulturePrefix()
    {
        Assert.Equal("/pt/tv/broadcast", _service.BuildTvBroadcastPath("pt"));
        Assert.Equal("/en/tv/broadcast", _service.BuildTvBroadcastPath("en"));
    }
}
