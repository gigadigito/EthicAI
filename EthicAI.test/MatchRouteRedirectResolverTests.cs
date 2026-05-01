using CriptoVersus.Web.Services;

namespace EthicAI.test;

public sealed class MatchRouteRedirectResolverTests
{
    private readonly MatchRouteRedirectResolver _resolver = new();
    private readonly MatchSlugHelper _slugHelper = new();
    private readonly RouteLocalizationService _routeLocalization = new();

    [Fact]
    public async Task LegacyUrlRedirectsToCanonicalRoute()
    {
        var redirect = await _resolver.ResolveRedirectPathAsync(
            "/match/adausdt-vs-bnbusdt/39",
            null,
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
}
