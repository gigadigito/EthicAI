using CriptoVersus.Web.Services;

namespace CriptoVersus.API.Tests;

public sealed class MatchRouteCultureTests
{
    private readonly AppCultureService _appCulture = new();
    private readonly RouteLocalizationService _routes;

    public MatchRouteCultureTests()
    {
        _routes = new RouteLocalizationService(_appCulture);
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
    public void BuildBestPath_WithExplicitCulture_UsesCorrectCulture(string culture)
    {
        var result = _routes.BuildBestPath(culture, 123, "ada-vs-bnb");
        Assert.StartsWith($"/{culture}/", result);
        Assert.Contains("/123/", result);
        Assert.EndsWith("/ada-vs-bnb", result);
    }

    [Fact]
    public void BuildBestPath_WithNullCulture_DefaultsToEnglish()
    {
        var result = _routes.BuildBestPath(null, 123, "ada-vs-bnb");
        Assert.StartsWith("/en/", result);
    }

    [Theory]
    [InlineData("en", "/en/match/123/ada-vs-bnb")]
    [InlineData("pt", "/pt/partida/123/ada-vs-bnb")]
    [InlineData("zh", "/zh/match/123/ada-vs-bnb")]
    [InlineData("es", "/es/match/123/ada-vs-bnb")]
    [InlineData("fr", "/fr/match/123/ada-vs-bnb")]
    [InlineData("de", "/de/match/123/ada-vs-bnb")]
    [InlineData("it", "/it/match/123/ada-vs-bnb")]
    [InlineData("ja", "/ja/match/123/ada-vs-bnb")]
    public void BuildLocalizedPath_ProducesCorrectSegment(string culture, string expected)
    {
        var result = _routes.BuildLocalizedPath(culture, 123, "ada-vs-bnb");
        Assert.Equal(expected, result);
    }

    [Theory]
    [InlineData("fr", "/pt/partida/123/ada-vs-bnb", "/fr/match/123/ada-vs-bnb")]
    [InlineData("es", "/en/match/123/ada-vs-bnb", "/es/match/123/ada-vs-bnb")]
    [InlineData("de", "/zh/match/123/ada-vs-bnb", "/de/match/123/ada-vs-bnb")]
    [InlineData("it", "/fr/match/123/ada-vs-bnb", "/it/match/123/ada-vs-bnb")]
    [InlineData("ja", "/es/match/123/ada-vs-bnb", "/ja/match/123/ada-vs-bnb")]
    [InlineData("pt", "/en/match/123/ada-vs-bnb", "/pt/partida/123/ada-vs-bnb")]
    [InlineData("en", "/pt/partida/123/ada-vs-bnb", "/en/match/123/ada-vs-bnb")]
    [InlineData("zh", "/fr/match/123/ada-vs-bnb", "/zh/match/123/ada-vs-bnb")]
    public void BuildLocalizedPathForCurrentPage_MatchRoute_PreservesIdAndSlug(
        string targetCulture, string currentPath, string expected)
    {
        var result = _routes.BuildLocalizedPathForCurrentPage(targetCulture, currentPath);
        Assert.Equal(expected, result);
    }

    [Theory]
    [InlineData("fr", "/es/tv", "/fr/tv")]
    [InlineData("es", "/en/tv/broadcast", "/es/tv/broadcast")]
    [InlineData("de", "/pt/tv", "/de/tv")]
    [InlineData("it", "/zh/tv/broadcast", "/it/tv/broadcast")]
    [InlineData("ja", "/fr/tv", "/ja/tv")]
    public void BuildLocalizedPathForCurrentPage_TvHub_PreservesPath(
        string targetCulture, string currentPath, string expected)
    {
        var result = _routes.BuildLocalizedPathForCurrentPage(targetCulture, currentPath);
        Assert.Equal(expected, result);
    }

    [Theory]
    [InlineData("fr", "/en/tv/match/123/ada-vs-bnb", "/fr/tv/match/123/ada-vs-bnb")]
    [InlineData("es", "/pt/tv/match/456/xpl-vs-bnb", "/es/tv/match/456/xpl-vs-bnb")]
    public void BuildLocalizedPathForCurrentPage_TvMatch_PreservesIdAndSlug(
        string targetCulture, string currentPath, string expected)
    {
        var result = _routes.BuildLocalizedPathForCurrentPage(targetCulture, currentPath);
        Assert.Equal(expected, result);
    }

    [Theory]
    [InlineData("/en/match/123/ada-vs-bnb", "en")]
    [InlineData("/pt/partida/123/ada-vs-bnb", "pt")]
    [InlineData("/fr/match/123/ada-vs-bnb", "fr")]
    [InlineData("/es/match/123/ada-vs-bnb", "es")]
    [InlineData("/de/match/123/ada-vs-bnb", "de")]
    [InlineData("/it/match/123/ada-vs-bnb", "it")]
    [InlineData("/ja/match/123/ada-vs-bnb", "ja")]
    [InlineData("/zh/match/123/ada-vs-bnb", "zh")]
    public void GetCurrentRouteCulture_DerivesCultureFromPath(string relativePath, string expectedCulture)
    {
        // Simulate NavigationManager by building a full URI
        var nav = new TestNavigationManager($"https://localhost{relativePath}");
        var result = _appCulture.GetCurrentRouteCulture(nav);
        Assert.Equal(expectedCulture, result);
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
    public void NormalizeRouteCulture_AcceptsAllSupportedCultures(string culture)
    {
        var result = _appCulture.NormalizeRouteCulture(culture);
        Assert.Equal(culture, result);
    }

    [Fact]
    public void NormalizeRouteCulture_NullDefaultsToEnglish()
    {
        var result = _appCulture.NormalizeRouteCulture(null);
        Assert.Equal("en", result);
    }
}

internal sealed class TestNavigationManager : Microsoft.AspNetCore.Components.NavigationManager
{
    public TestNavigationManager(string uri)
    {
        Initialize("https://localhost/", uri);
    }

    protected override void NavigateToCore(string uri, Microsoft.AspNetCore.Components.NavigationOptions options)
    {
        // No-op for testing
    }
}