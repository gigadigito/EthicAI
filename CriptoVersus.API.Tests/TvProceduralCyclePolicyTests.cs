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
