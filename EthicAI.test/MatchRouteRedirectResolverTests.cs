using CriptoVersus.Web.Services;
using Microsoft.AspNetCore.Http;

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

        Assert.Equal("/match/39/ada-vs-bnb", redirect);
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

        Assert.Equal("/match/39/ada-vs-bnb", redirect);
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
}
