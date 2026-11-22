using CriptoVersus.Web.Services;

namespace EthicAI.test;

public sealed class ArenaPressurePageRoutingTests
{
    [Fact]
    public void CaptureAuthorizationState_UsesOneSharedPersistentKey()
    {
        Assert.Equal(
            "arena-pressure-authorized-video-capture",
            ArenaPressurePageRouting.AuthorizedCaptureStateKey);
    }

    [Theory]
    [InlineData("https://example.test/en/tv/pressure/46156/match?mode=videoCapture&speed=4", true)]
    [InlineData("https://example.test/en/tv/pressure/46156/match?mode=videoCapture", false)]
    [InlineData("https://example.test/en/tv/pressure/46156/match?mode=videoCapture&speed=1", false)]
    [InlineData("https://example.test/en/tv/pressure/46156/match?mode=VideoCapture&speed=4", false)]
    [InlineData("https://example.test/en/tv/pressure/46156/match", false)]
    [InlineData("https://example.test/en/tv/match/46156/match?mode=videoCapture&speed=4", false)]
    [InlineData("https://example.test/en/faq?mode=videoCapture&speed=4", false)]
    public void CaptureRequest_RequiresExactTechnicalQuery(string uri, bool expected)
    {
        Assert.Equal(expected, ArenaPressurePageRouting.IsVideoCaptureRequest(new Uri(uri)));
    }

    [Theory]
    [InlineData(true, null, true, true)]
    [InlineData(true, null, false, false)]
    [InlineData(true, true, false, true)]
    [InlineData(true, false, true, false)]
    [InlineData(false, true, true, false)]
    public void Authorization_IsFailClosedAcrossPrerenderAndInteractiveRender(
        bool requested,
        bool? persisted,
        bool requestAuthorized,
        bool expected)
    {
        Assert.Equal(expected, ArenaPressurePageRouting.ResolveAuthorizedVideoCapture(
            requested, persisted, requestAuthorized));
    }

    [Theory]
    [InlineData("/en/tv/pressure/46156/match", "/en/tv/pressure/46156/btc-vs-eth")]
    [InlineData("/pt/tv/pressure/46156/partida", "/pt/tv/pressure/46156/btc-vs-eth")]
    [InlineData("/ja/tv/pressure/46156/match", "/ja/tv/pressure/46156/btc-vs-eth")]
    public void AuthorizedCapture_DoesNotRedirectNonCanonicalLocalizedRoute(string current, string canonical)
    {
        Assert.False(ArenaPressurePageRouting.ShouldRedirectToCanonical(true, current, canonical));
    }

    [Fact]
    public void AuthorizedCapture_DoesNotRedirectCanonicalRoute()
    {
        const string canonical = "/en/tv/pressure/46156/btc-vs-eth";
        Assert.False(ArenaPressurePageRouting.ShouldRedirectToCanonical(true, canonical, canonical));
    }

    [Fact]
    public void PublicCanonicalRoute_DoesNotRedirect()
    {
        const string canonical = "/en/tv/pressure/46156/btc-vs-eth";
        Assert.False(ArenaPressurePageRouting.ShouldRedirectToCanonical(false, canonical, canonical));
    }

    [Theory]
    [InlineData("/en/tv/pressure/46156/match", "/en/tv/pressure/46156/btc-vs-eth")]
    [InlineData("/pt/tv/pressure/46156/match", "/pt/tv/pressure/46156/btc-vs-eth")]
    [InlineData("/zh/tv/pressure/46156/MATCH", "/zh/tv/pressure/46156/btc-vs-eth")]
    public void PublicNonCanonicalLocalizedRoute_Redirects(string current, string canonical)
    {
        Assert.True(ArenaPressurePageRouting.ShouldRedirectToCanonical(false, current, canonical));
    }

    [Fact]
    public void EquivalentEncodedPublicRoute_DoesNotRedirect()
    {
        Assert.False(ArenaPressurePageRouting.ShouldRedirectToCanonical(
            false,
            "/pt/tv/pressure/46156/ação-vs-btc",
            "/pt/tv/pressure/46156/a%C3%A7%C3%A3o-vs-btc"));
    }
}
