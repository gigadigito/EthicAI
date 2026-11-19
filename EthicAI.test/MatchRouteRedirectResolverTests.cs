using CriptoVersus.Web.Services;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;

namespace EthicAI.test;

public sealed class MatchRouteRedirectResolverTests
{
    private readonly AppCultureService _appCultureService = new();
    private readonly MatchRouteRedirectResolver _resolver = new();
    private readonly MatchSlugHelper _slugHelper = new();
    private readonly RouteLocalizationService _routeLocalization;

    public MatchRouteRedirectResolverTests()
    {
        _routeLocalization = new RouteLocalizationService(_appCultureService);
    }

    [Fact]
    public async Task LegacyUrlRedirectsToCanonicalRoute()
    {
        var redirect = await _resolver.ResolveRedirectPathAsync(
            "/match/adausdt-vs-bnbusdt/39",
            null,
            BuildHttpContext(),
            _appCultureService,
            new FakeLookupService("ada-vs-bnb"),
            _slugHelper,
            _routeLocalization);

        Assert.Equal("/en/match/39/ada-vs-bnb", redirect);
    }

    [Fact]
    public async Task InvalidSlugRedirectsToOfficialCanonicalSlug()
    {
        var redirect = await _resolver.ResolveRedirectPathAsync(
            "/match/39/ada-vs-bnbb",
            null,
            BuildHttpContext(),
            _appCultureService,
            new FakeLookupService("ada-vs-bnb"),
            _slugHelper,
            _routeLocalization);

        Assert.Equal("/en/match/39/ada-vs-bnb", redirect);
    }

    [Fact]
    public async Task UnicodeSlugRedirectsToEncodedCanonicalRoute()
    {
        var unicodeSlug = "币安人生-vs-ビットコイン";
        var encodedSlug = Uri.EscapeDataString(unicodeSlug);

        var redirect = await _resolver.ResolveRedirectPathAsync(
            $"/match/39/{unicodeSlug}",
            null,
            BuildHttpContext(),
            _appCultureService,
            new FakeLookupService(unicodeSlug),
            _slugHelper,
            _routeLocalization);

        Assert.Equal($"/en/match/39/{encodedSlug}", redirect);
    }

    [Fact]
    public async Task PortugueseRouteWithWrongSegmentRedirectsToLocalizedPath()
    {
        var redirect = await _resolver.ResolveRedirectPathAsync(
            "/pt/match/39/ada-vs-bnb",
            null,
            BuildHttpContext("/pt/match/39/ada-vs-bnb"),
            _appCultureService,
            new FakeLookupService("ada-vs-bnb"),
            _slugHelper,
            _routeLocalization);

        Assert.Equal("/pt/partida/39/ada-vs-bnb", redirect);
    }

    [Fact]
    public async Task WhaleOceanWrongSlugRedirectsToOfficialLocalizedPath()
    {
        var redirect = await _resolver.ResolveRedirectPathAsync(
            "/pt/tv/whale-ocean/39/ada-vs-bnb-old",
            null,
            BuildHttpContext("/pt/tv/whale-ocean/39/ada-vs-bnb-old"),
            _appCultureService,
            new FakeLookupService("ada-vs-bnb"),
            _slugHelper,
            _routeLocalization);

        Assert.Equal("/pt/tv/whale-ocean/39/ada-vs-bnb", redirect);
    }

    [Fact]
    public async Task CandleBattlesWrongSlugRedirectsToOfficialLocalizedPath()
    {
        var redirect = await _resolver.ResolveRedirectPathAsync(
            "/en/tv/candle/39/ada-vs-bnb-old",
            null,
            BuildHttpContext("/en/tv/candle/39/ada-vs-bnb-old"),
            _appCultureService,
            new FakeLookupService("ada-vs-bnb"),
            _slugHelper,
            _routeLocalization);

        Assert.Equal("/en/tv/candle/39/ada-vs-bnb", redirect);
    }

    [Fact]
    public async Task CulturelessLandingRedirectsToPreferredLocalizedLanding()
    {
        var redirect = await _resolver.ResolveRedirectPathAsync(
            "/landing",
            null,
            BuildHttpContext(),
            _appCultureService,
            new FakeLookupService("ada-vs-bnb"),
            _slugHelper,
            _routeLocalization);

        Assert.Equal("/en/landing", redirect);
    }

    [Theory]
    [InlineData("pt-BR", "/pt/landing")]
    [InlineData("en-US", "/en/landing")]
    public async Task RootRedirectsFirstTimeVisitorsToLocalizedLanding(string acceptLanguage, string expectedPath)
    {
        var context = BuildHttpContext();
        context.Request.Headers.AcceptLanguage = acceptLanguage;

        var redirect = await ResolveAsync(CreateLandingEntryResolver(), "/", context);

        Assert.Equal(expectedPath, redirect);
    }

    [Fact]
    public async Task RootRedirectsVisitorsWhoAlreadySawLandingToLocalizedHome()
    {
        var context = BuildHttpContext();
        context.Request.Headers.Cookie = $"{LandingEntryOptions.SeenCookieName}=1";

        var redirect = await ResolveAsync(CreateLandingEntryResolver(), "/", context);

        Assert.Equal("/en", redirect);
    }

    [Fact]
    public async Task RootPreservesCampaignQueryWhenRedirectingToLanding()
    {
        var redirect = await ResolveAsync(
            CreateLandingEntryResolver(),
            "/",
            BuildHttpContext(),
            "?utm_source=campaign&utm_medium=email");

        Assert.Equal("/en/landing?utm_source=campaign&utm_medium=email", redirect);
    }

    [Fact]
    public async Task RootSkipsLandingWhenEntryStrategyIsDisabled()
    {
        var resolver = new MatchRouteRedirectResolver(Options.Create(new LandingEntryOptions
        {
            Enabled = false,
            ShowToFirstTimeVisitors = true
        }));

        var redirect = await ResolveAsync(resolver, "/", BuildHttpContext());

        Assert.Equal("/en", redirect);
    }

    [Fact]
    public async Task LocalizedHomeNeverRedirectsToLanding()
    {
        var redirect = await ResolveAsync(CreateLandingEntryResolver(), "/pt", BuildHttpContext("/pt"));

        Assert.Null(redirect);
    }

    [Fact]
    public async Task LocalizedMatchRouteNeverRedirectsToLanding()
    {
        const string path = "/pt/partida/39/ada-vs-bnb";

        var redirect = await ResolveAsync(CreateLandingEntryResolver(), path, BuildHttpContext(path));

        Assert.Null(redirect);
    }

    [Fact]
    public async Task RootLandingRedirectIsTemporaryPrivateAndMarksThePresentationAsSeen()
    {
        var context = BuildHttpContext();
        var options = Options.Create(new LandingEntryOptions
        {
            Enabled = true,
            ShowToFirstTimeVisitors = true,
            SeenCookieDays = 30
        });
        var middleware = new MatchRouteRedirectMiddleware(
            _ => Task.CompletedTask,
            new MatchRouteRedirectResolver(options),
            NullLogger<MatchRouteRedirectMiddleware>.Instance,
            options);

        await middleware.InvokeAsync(
            context,
            _appCultureService,
            new FakeLookupService("ada-vs-bnb"),
            _slugHelper,
            _routeLocalization);

        Assert.Equal(StatusCodes.Status302Found, context.Response.StatusCode);
        Assert.Equal("/en/landing", context.Response.Headers.Location);
        Assert.Equal("private, no-store", context.Response.Headers.CacheControl);
        Assert.Contains(LandingEntryOptions.SeenCookieName, context.Response.Headers.SetCookie.ToString(), StringComparison.Ordinal);
    }

    [Fact]
    public async Task LocalizedLandingRoutesReachTheIndependentLandingComponent()
    {
        foreach (var culture in new[] { "en", "pt", "zh", "es", "fr", "de", "it", "ja", "hi" })
        {
            var redirect = await _resolver.ResolveRedirectPathAsync(
                $"/{culture}/landing",
                null,
                BuildHttpContext($"/{culture}/landing"),
                _appCultureService,
                new FakeLookupService("ada-vs-bnb"),
                _slugHelper,
                _routeLocalization);

            Assert.Null(redirect);
        }
    }

    [Fact]
    public async Task CulturelessLandingRedirectPreservesQueryString()
    {
        var redirect = await _resolver.ResolveRedirectPathAsync(
            "/landing",
            "?utm_source=share",
            BuildHttpContext("/landing"),
            _appCultureService,
            new FakeLookupService("ada-vs-bnb"),
            _slugHelper,
            _routeLocalization);

        Assert.Equal("/en/landing?utm_source=share", redirect);
    }

    [Fact]
    public async Task UnsupportedCultureLandingFallsThroughToComponentFallback()
    {
        var redirect = await _resolver.ResolveRedirectPathAsync(
            "/xx/landing",
            null,
            BuildHttpContext("/xx/landing"),
            _appCultureService,
            new FakeLookupService("ada-vs-bnb"),
            _slugHelper,
            _routeLocalization);

        Assert.Null(redirect);
    }

    private sealed class FakeLookupService : IMatchRouteLookupService
    {
        private readonly string _slug;

        public FakeLookupService(string slug)
        {
            _slug = slug;
        }

        public Task<MatchRouteInfo?> GetMatchRouteAsync(int matchId, CancellationToken cancellationToken = default)
            => Task.FromResult<MatchRouteInfo?>(new MatchRouteInfo(matchId, _slug));
    }

    private static DefaultHttpContext BuildHttpContext(string path = "/")
    {
        var context = new DefaultHttpContext();
        context.Request.Path = path;
        return context;
    }

    private MatchRouteRedirectResolver CreateLandingEntryResolver()
        => new(Options.Create(new LandingEntryOptions
        {
            Enabled = true,
            ShowToFirstTimeVisitors = true,
            SeenCookieDays = 30
        }));

    private Task<string?> ResolveAsync(
        MatchRouteRedirectResolver resolver,
        string path,
        HttpContext context,
        string? queryString = null)
        => resolver.ResolveRedirectPathAsync(
            path,
            queryString,
            context,
            _appCultureService,
            new FakeLookupService("ada-vs-bnb"),
            _slugHelper,
            _routeLocalization);
}
