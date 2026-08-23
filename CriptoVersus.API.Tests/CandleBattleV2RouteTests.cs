using CriptoVersus.Web.Services;

namespace CriptoVersus.API.Tests;

public sealed class CandleBattleV2RouteTests
{
    private readonly RouteLocalizationService _routes = new(new AppCultureService());

    [Fact]
    public void Route_UsesAllSupportedCulturePrefixes()
    {
        Assert.Equal("/pt/candle/33975/pengu-vs-xpl", _routes.BuildCandleBattleV2Path("pt", 33975, "pengu-vs-xpl"));
        Assert.Equal("/en/candle/33975/pengu-vs-xpl", _routes.BuildCandleBattleV2Path("en", 33975, "pengu-vs-xpl"));
        Assert.Equal("/zh/candle/33975/pengu-vs-xpl", _routes.BuildCandleBattleV2Path("zh", 33975, "pengu-vs-xpl"));
    }

    [Fact]
    public void CultureSwitcher_PreservesMatchAndSlug()
        => Assert.Equal(
            "/zh/candle/33975/pengu-vs-xpl",
            _routes.BuildLocalizedPathForCurrentPage("zh", "en/candle/33975/pengu-vs-xpl"));
}
