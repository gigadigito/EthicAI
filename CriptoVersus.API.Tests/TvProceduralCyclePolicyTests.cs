using CriptoVersus.Web.Services;
using DTOs;

namespace CriptoVersus.API.Tests;

public sealed class TvProceduralCyclePolicyTests
{
    [Fact]
    public void FindNextMatch_SkipsFinishedMatchAndSelectsFollowingLiveMatch()
    {
        var candidates = new[]
        {
            Match(1, "Completed", isFinished: true),
            Match(2, "Ongoing")
        };

        var selected = TvProceduralCyclePolicy.FindNextMatch(candidates);

        Assert.NotNull(selected);
        Assert.Equal(2, selected.MatchId);
    }

    [Fact]
    public void FindNextMatch_SupportsThreeConsecutiveMatchWaitingCycles()
    {
        var feeds = new[]
        {
            new[] { Match(1, "Ongoing") },
            new[] { Match(1, "Completed", isFinished: true) },
            new[] { Match(1, "Completed", isFinished: true), Match(2, "Ongoing") },
            new[] { Match(1, "Completed", isFinished: true), Match(2, "Completed", isFinished: true) },
            new[] { Match(1, "Completed", isFinished: true), Match(2, "Completed", isFinished: true), Match(3, "Ongoing") },
            new[] { Match(1, "Completed", isFinished: true), Match(2, "Completed", isFinished: true), Match(3, "Completed", isFinished: true) }
        };

        var observedMatchIds = feeds
            .Select(feed => TvProceduralCyclePolicy.FindNextMatch(feed)?.MatchId)
            .ToArray();

        Assert.Equal(new int?[] { 1, null, 2, null, 3, null }, observedMatchIds);
    }

    [Fact]
    public void FindNextMatch_EndedFixedRouteSelectsDifferentAvailableMatch()
    {
        var candidates = new[]
        {
            Match(41, "Ongoing"),
            Match(42, "Ongoing")
        };

        var selected = TvProceduralCyclePolicy.FindNextMatch(candidates, excludedMatchId: 41);

        Assert.NotNull(selected);
        Assert.Equal(42, selected.MatchId);
    }

    [Fact]
    public void FindNextMatch_EndedFixedRouteReturnsNullWhenNoAlternativeExists()
    {
        var candidates = new[]
        {
            Match(41, "Completed", isFinished: true),
            Match(42, "Settled", isFinished: true)
        };

        var selected = TvProceduralCyclePolicy.FindNextMatch(candidates, excludedMatchId: 41);

        Assert.Null(selected);
    }

    [Fact]
    public void FindNextMatch_IgnoresInvalidCandidateIdentifiers()
    {
        var candidates = new[]
        {
            Match(0, "Ongoing"),
            Match(7, "Ongoing")
        };

        var selected = TvProceduralCyclePolicy.FindNextMatch(candidates);

        Assert.NotNull(selected);
        Assert.Equal(7, selected.MatchId);
    }

    [Theory]
    [InlineData("en", "/en/tv/match/42/coin-a-vs-coin-b", "/en/stats/matches", "/en/tv", "/en")]
    [InlineData("pt", "/pt/tv/match/42/coin-a-vs-coin-b", "/pt/estatisticas/partidas", "/pt/tv", "/pt")]
    [InlineData("zh", "/zh/tv/match/42/coin-a-vs-coin-b", "/zh/stats/matches", "/zh/tv", "/zh")]
    public void TvMatchActions_PreserveConfiguredCulture(
        string culture,
        string expectedNext,
        string expectedMatches,
        string expectedTv,
        string expectedHome)
    {
        var routes = new RouteLocalizationService(new AppCultureService());

        Assert.Equal(expectedNext, routes.BuildTvMatchPath(culture, 42, "coin-a-vs-coin-b"));
        Assert.Equal(expectedMatches, routes.BuildStatsMatchesPath(culture));
        Assert.Equal(expectedTv, routes.BuildTvPath(culture));
        Assert.Equal(expectedHome, routes.BuildHomePath(culture));
    }

    [Fact]
    public void LegacyTvMatchUrl_CanNavigateInternallyToLocalizedRoute()
    {
        var routes = new RouteLocalizationService(new AppCultureService());

        var localized = routes.BuildLocalizedPathForCurrentPage("pt", "tv/match/41/old-slug");

        Assert.Equal("/pt/tv/match/41/old-slug", localized);
    }

    [Theory]
    [InlineData("Completed")]
    [InlineData("Cancelled")]
    [InlineData("Finished")]
    [InlineData("Settled")]
    public void IsTerminal_RecognizesEveryTvTerminalStatus(string status)
    {
        Assert.True(TvProceduralCyclePolicy.IsTerminal(false, status));
    }

    private static HotMatchDto Match(int matchId, string status, bool isFinished = false)
        => new()
        {
            MatchId = matchId,
            HomeSymbol = $"HOME{matchId}",
            AwaySymbol = $"AWAY{matchId}",
            Status = status,
            IsFinished = isFinished
        };
}
