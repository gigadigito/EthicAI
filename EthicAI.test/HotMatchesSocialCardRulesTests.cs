using CriptoVersus.Web.Services;
using DTOs;

namespace EthicAI.test;

public sealed class HotMatchesSocialCardRulesTests
{
    [Fact]
    public void RankCandidates_ReturnsTopFiveByHotScoreAndStatusPriority()
    {
        var now = new DateTime(2026, 07, 10, 12, 0, 0, DateTimeKind.Utc);
        var matches = new[]
        {
            BuildMatch(1, 95, "Ongoing", now.AddHours(-2)),
            BuildMatch(2, 94, "Closing", now.AddHours(-1)),
            BuildMatch(3, 94, "Finished", now.AddHours(-3), now.AddMinutes(-30)),
            BuildMatch(4, 88, "Ongoing", now.AddHours(-6)),
            BuildMatch(5, 80, "Scheduled", now.AddHours(-4)),
            BuildMatch(6, 70, "Ongoing", now.AddHours(-8)),
            BuildMatch(7, 99, "Cancelled", now.AddHours(-1))
        };

        var ranked = HotMatchesSocialCardRules.RankCandidates(matches, 24, 5, now);

        Assert.Equal(5, ranked.Count);
        Assert.Equal(1, ranked[0].MatchId);
        Assert.Equal(2, ranked[1].MatchId);
        Assert.Equal(3, ranked[2].MatchId);
        Assert.Equal(4, ranked[3].MatchId);
        Assert.Equal(5, ranked[4].MatchId);
    }

    [Fact]
    public void RankCandidates_ExcludesCancelledAndFutureMatches()
    {
        var now = new DateTime(2026, 07, 10, 12, 0, 0, DateTimeKind.Utc);
        var matches = new[]
        {
            BuildMatch(1, 90, "Ongoing", now.AddHours(-1)),
            BuildMatch(2, 91, "Cancelled", now.AddHours(-1)),
            BuildMatch(3, 92, "Scheduled", now.AddHours(3))
        };

        var ranked = HotMatchesSocialCardRules.RankCandidates(matches, 24, 5, now);

        Assert.Single(ranked);
        Assert.Equal(1, ranked[0].MatchId);
    }

    [Fact]
    public void RankCandidates_ReturnsOnlyAvailableMatchesWhenLessThanFiveExist()
    {
        var now = new DateTime(2026, 07, 10, 12, 0, 0, DateTimeKind.Utc);
        var matches = new[]
        {
            BuildMatch(1, 75, "Ongoing", now.AddHours(-1)),
            BuildMatch(2, 68, "Finished", now.AddHours(-2), now.AddMinutes(-15)),
            BuildMatch(3, 63, "Closing", now.AddHours(-3))
        };

        var ranked = HotMatchesSocialCardRules.RankCandidates(matches, 24, 5, now);

        Assert.Equal(3, ranked.Count);
    }

    [Theory]
    [InlineData(10, "cold")]
    [InlineData(40, "warm")]
    [InlineData(60, "hot")]
    [InlineData(85, "explosive")]
    [InlineData(97, "historic")]
    public void GetTemperatureKey_MapsHotScoreBands(int hotScore, string expected)
    {
        Assert.Equal(expected, HotMatchesSocialCardRules.GetTemperatureKey(hotScore));
    }

    [Theory]
    [InlineData(0, "tied")]
    [InlineData(1, "veryClose")]
    [InlineData(2, "close")]
    [InlineData(3, "clearLead")]
    public void GetBalanceKey_MapsScoreDifferenceBands(int diff, string expected)
    {
        Assert.Equal(expected, HotMatchesSocialCardRules.GetBalanceKey(diff));
    }

    [Theory]
    [InlineData("Ongoing", "live")]
    [InlineData("Closing", "closing")]
    [InlineData("Finished", "final")]
    [InlineData("Completed", "final")]
    [InlineData("Pending", "scheduled")]
    public void GetStatusKey_MapsKnownStatuses(string status, string expected)
    {
        Assert.Equal(expected, HotMatchesSocialCardRules.GetStatusKey(status));
    }

    private static HotMatchDto BuildMatch(int matchId, int hotScore, string status, DateTime startTimeUtc, DateTime? endTimeUtc = null)
        => new()
        {
            MatchId = matchId,
            HomeSymbol = "AAA",
            AwaySymbol = "BBB",
            HomeScore = 2,
            AwayScore = 1,
            HotScore = hotScore,
            Status = status,
            LastGoalAt = startTimeUtc.AddMinutes(8),
            MatchSnapshot = new MatchDto
            {
                MatchId = matchId,
                TeamA = "AAA",
                TeamB = "BBB",
                ScoreA = 2,
                ScoreB = 1,
                Status = status,
                StartTime = startTimeUtc,
                EndTime = endTimeUtc,
                ElapsedMinutes = 45,
                RemainingMinutes = 45,
                IsFinished = string.Equals(status, "Finished", StringComparison.OrdinalIgnoreCase)
            }
        };
}
