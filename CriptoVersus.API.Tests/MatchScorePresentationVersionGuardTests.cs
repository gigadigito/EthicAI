using CriptoVersus.Web.Services;

namespace CriptoVersus.API.Tests;

public sealed class MatchScorePresentationVersionGuardTests
{
    [Theory]
    [InlineData(12, 11, true)]
    [InlineData(11, 11, true)]
    [InlineData(10, 11, false)]
    public void ShouldApply_UsesMonotonicOrdering(int incomingVersion, int currentVersion, bool expected)
    {
        Assert.Equal(expected, MatchScorePresentationVersionGuard.ShouldApply(incomingVersion, currentVersion));
    }

    [Fact]
    public void ShouldApply_NullableOverload_AllowsMissingVersions()
    {
        Assert.True(MatchScorePresentationVersionGuard.ShouldApply(null, 11));
        Assert.True(MatchScorePresentationVersionGuard.ShouldApply(11, null));
        Assert.True(MatchScorePresentationVersionGuard.ShouldApply(null, null));
    }
}
