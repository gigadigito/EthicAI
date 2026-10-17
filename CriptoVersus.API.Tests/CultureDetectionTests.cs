using System.Text.Json;
using CriptoVersus.Web.Services;
using Microsoft.AspNetCore.Http;
using Microsoft.Net.Http.Headers;

namespace CriptoVersus.API.Tests;

public sealed class CultureDetectionTests
{
    private readonly SupportedLanguageCatalog _catalog = new();
    private readonly AppCultureService _appCulture;
    private readonly RouteLocalizationService _routes;
    private readonly MatchRouteRedirectResolver _resolver = new();
    private readonly MatchSlugHelper _slugHelper = new();

    public CultureDetectionTests()
    {
        _appCulture = new AppCultureService(_catalog);
        _routes = new RouteLocalizationService(_appCulture);
    }

    private DefaultHttpContext BuildContext(
        string path = "/",
        string? acceptLanguage = null,
        string? cultureCookie = null,
        string? country = null)
    {
        var context = new DefaultHttpContext();
        context.Request.Path = path;

        if (!string.IsNullOrWhiteSpace(acceptLanguage))
            context.Request.Headers[HeaderNames.AcceptLanguage] = acceptLanguage;

        if (!string.IsNullOrWhiteSpace(cultureCookie))
            context.Request.Headers["Cookie"] = $"{AppCultureService.PreferenceCookieName}={cultureCookie}";

        if (!string.IsNullOrWhiteSpace(country))
            context.Request.Headers[AppCultureService.CountryHeaderName] = country;

        return context;
    }

    [Theory]
    [InlineData("pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7", "pt")]
    [InlineData("pt-BR", "pt")]
    [InlineData("pt", "pt")]
    [InlineData("pt-PT", "pt")]
    [InlineData("de-DE,de;q=0.9", "de")]
    [InlineData("fr-FR", "fr")]
    [InlineData("es-MX,es;q=0.9", "es")]
    [InlineData("es-ES", "es")]
    [InlineData("it-IT", "it")]
    [InlineData("ja-JP", "ja")]
    [InlineData("en-US,en;q=0.9", "en")]
    [InlineData("xx-YY,xx;q=0.9", "en")]
    public void DetectPreferredRouteCulture_MatchesBrowserLanguage(string acceptLanguage, string expected)
    {
        var result = _appCulture.DetectPreferredRouteCulture(BuildContext(acceptLanguage: acceptLanguage));
        Assert.Equal(expected, result);
    }

    [Fact]
    public void DetectPreferredRouteCulture_PrefersFirstBrowserLanguage()
    {
        var result = _appCulture.DetectPreferredRouteCulture(
            BuildContext(acceptLanguage: "pt-BR,en-US;q=0.9,en;q=0.8"));

        Assert.Equal("pt", result);
    }

    [Fact]
    public void DetectPreferredRouteCulture_HonoursQualityValuesRegardlessOfHeaderOrder()
    {
        var result = _appCulture.DetectPreferredRouteCulture(
            BuildContext(acceptLanguage: "en;q=0.5,pt-BR;q=0.9,de;q=0.8"));

        Assert.Equal("pt", result);
    }

    [Fact]
    public void DetectPreferredRouteCulture_IgnoresZeroQualityLanguages()
    {
        var result = _appCulture.DetectPreferredRouteCulture(
            BuildContext(acceptLanguage: "de;q=0,pt-BR;q=0.8"));

        Assert.Equal("pt", result);
    }

    [Fact]
    public void DetectPreferredRouteCulture_ManualChoiceWinsOverBrowserLanguage()
    {
        var result = _appCulture.DetectPreferredRouteCulture(
            BuildContext(acceptLanguage: "pt-BR,pt;q=0.9", cultureCookie: "de"));

        Assert.Equal("de", result);
    }

    [Fact]
    public void DetectPreferredRouteCulture_ExplicitUrlWinsOverPersistedPreference()
    {
        var result = _appCulture.DetectPreferredRouteCulture(
            BuildContext(path: "/pt/partida/12/ada-vs-bnb", acceptLanguage: "de-DE", cultureCookie: "de"));

        Assert.Equal("pt", result);
    }

    [Fact]
    public void DetectPreferredRouteCulture_FallsBackToCountryWhenBrowserLanguageIsUnusable()
    {
        var result = _appCulture.DetectPreferredRouteCulture(
            BuildContext(acceptLanguage: "xx-YY", country: "BR"));

        Assert.Equal("pt", result);
    }

    [Fact]
    public void DetectPreferredRouteCulture_CountryFallbackSupportsMajorRegions()
    {
        Assert.Equal("pt", _appCulture.DetectPreferredRouteCulture(BuildContext(country: "PT")));
        Assert.Equal("de", _appCulture.DetectPreferredRouteCulture(BuildContext(country: "DE")));
        Assert.Equal("fr", _appCulture.DetectPreferredRouteCulture(BuildContext(country: "FR")));
        Assert.Equal("es", _appCulture.DetectPreferredRouteCulture(BuildContext(country: "MX")));
        Assert.Equal("ja", _appCulture.DetectPreferredRouteCulture(BuildContext(country: "JP")));
        Assert.Equal("en", _appCulture.DetectPreferredRouteCulture(BuildContext(country: "US")));
    }

    [Fact]
    public void DetectPreferredRouteCulture_UnknownLanguageAndRegionFallsBackToEnglish()
    {
        var result = _appCulture.DetectPreferredRouteCulture(
            BuildContext(acceptLanguage: "xx-YY", country: "XX"));

        Assert.Equal("en", result);
    }

    [Fact]
    public void DetectPreferredRouteCulture_WithoutAnySignalFallsBackToEnglish()
    {
        Assert.Equal("en", _appCulture.DetectPreferredRouteCulture(BuildContext()));
    }

    [Theory]
    [InlineData("pt-BR", "pt")]
    [InlineData("pt", "pt")]
    [InlineData("pt-PT", "pt")]
    [InlineData("es-MX", "es")]
    [InlineData("de", "de")]
    [InlineData("de-AT", "de")]
    [InlineData("zh-TW", "zh")]
    [InlineData("xx-YY", null)]
    public void MatchLanguageTag_UsesSupportedVariants(string tag, string? expected)
    {
        Assert.Equal(expected, _appCulture.MatchLanguageTag(tag));
    }

    [Fact]
    public void ResolveBrowserCulture_PreservesNavigatorLanguagesOrder()
    {
        Assert.Equal("pt", _appCulture.ResolveBrowserCulture(["pt-BR", "en-US"]));
        Assert.Equal("en", _appCulture.ResolveBrowserCulture(["en-US", "pt-BR"]));
        Assert.Equal("de", _appCulture.ResolveBrowserCulture(["xx", "de-DE"]));
        Assert.Null(_appCulture.ResolveBrowserCulture(["xx", "yy"]));
    }

    [Fact]
    public void DefaultLanguage_IsExplicitEnglishNotFirstCatalogEntry()
    {
        Assert.Equal("en-US", _catalog.DefaultLanguage.Culture);
        Assert.Equal("en", _appCulture.NormalizeRouteCulture(null));
        Assert.Equal("en", _appCulture.NormalizeRouteCulture("not-a-language"));
        Assert.Equal("en-US", _appCulture.ToCultureCode(null));
    }

    [Fact]
    public void ResolveNavigationCulture_RouteCultureWinsOverDetection()
    {
        var navigation = new TestNavigationManager("https://localhost/pt/tv");

        var result = _appCulture.ResolveNavigationCulture(
            navigation,
            BuildContext(path: "/pt/tv", acceptLanguage: "de-DE"));

        Assert.Equal("pt", result);
    }

    [Fact]
    public void ResolveNavigationCulture_FallsBackToDetectionWithoutRouteCulture()
    {
        var navigation = new TestNavigationManager("https://localhost/tv");

        var result = _appCulture.ResolveNavigationCulture(
            navigation,
            BuildContext(path: "/tv", acceptLanguage: "fr-FR"));

        Assert.Equal("fr", result);
    }

    [Theory]
    [InlineData("/", "pt-BR,pt;q=0.9", "/pt")]
    [InlineData("/", "de-DE,de;q=0.9", "/de")]
    [InlineData("/", "es-MX,es;q=0.9", "/es")]
    [InlineData("/", "xx-YY", "/en")]
    public async Task RootRedirect_CarriesDetectedCulture(string path, string acceptLanguage, string expected)
    {
        var redirect = await _resolver.ResolveRedirectPathAsync(
            path,
            null,
            BuildContext(path: path, acceptLanguage: acceptLanguage),
            _appCulture,
            new NoMatchLookupService(),
            _slugHelper,
            _routes);

        Assert.Equal(expected, redirect);
    }

    [Fact]
    public async Task RootRedirect_UsesPersistedPreferenceOverBrowserLanguage()
    {
        var redirect = await _resolver.ResolveRedirectPathAsync(
            "/",
            null,
            BuildContext(acceptLanguage: "pt-BR,pt;q=0.9", cultureCookie: "de"),
            _appCulture,
            new NoMatchLookupService(),
            _slugHelper,
            _routes);

        Assert.Equal("/de", redirect);
    }

    [Fact]
    public async Task ExplicitCultureUrl_IsNotRedirected()
    {
        var redirect = await _resolver.ResolveRedirectPathAsync(
            "/pt",
            null,
            BuildContext(path: "/pt", acceptLanguage: "de-DE"),
            _appCulture,
            new NoMatchLookupService(),
            _slugHelper,
            _routes);

        Assert.Null(redirect);
    }

    [Fact]
    public void SupportedLanguagesJson_ExposesCatalogForBrowserDetection()
    {
        var payload = _appCulture.SupportedLanguages
            .Select(language => new
            {
                route = language.RouteCulture,
                culture = language.Culture,
                aliases = language.Aliases
            })
            .ToArray();

        var json = JsonSerializer.Serialize(payload);
        Assert.Contains("\"route\":\"pt\"", json);
        Assert.Contains("\"culture\":\"pt-BR\"", json);
        Assert.Contains("\"route\":\"de\"", json);
    }

    private sealed class NoMatchLookupService : IMatchRouteLookupService
    {
        public Task<MatchRouteInfo?> GetMatchRouteAsync(int matchId, CancellationToken cancellationToken = default)
            => Task.FromResult<MatchRouteInfo?>(null);
    }
}
