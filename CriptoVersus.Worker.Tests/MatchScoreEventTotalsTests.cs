using BLL.NFTFutebol;
using DAL.NftFutebol;
using Xunit;

namespace CriptoVersus.Worker.Tests;

public sealed class MatchScoreEventTotalsTests
{
    [Fact]
    public void EmptyHistoryProducesZeroZero()
    {
        var totals = MatchScoreEventTotals.FromEvents([], teamAId: 10);

        Assert.Equal(0, totals.TeamAPoints);
        Assert.Equal(0, totals.TeamBPoints);
        Assert.Equal(0, totals.TotalPoints);
        Assert.Equal(0, totals.ScoringEventCount);
    }

    [Fact]
    public void SixBySevenHistorySumsThirteenPoints()
    {
        var events = Enumerable.Range(1, 13)
            .Select(index => new MatchScoreEvent
            {
                MatchScoreEventId = index,
                MatchId = 29675,
                TeamId = index <= 6 ? 10 : 20,
                Points = 1,
                EventSequence = index,
                EventTimeUtc = new DateTime(2026, 06, 13, 12, 4, 0, DateTimeKind.Utc)
            });

        var totals = MatchScoreEventTotals.FromEvents(events, teamAId: 10);

        Assert.Equal(6, totals.TeamAPoints);
        Assert.Equal(7, totals.TeamBPoints);
        Assert.Equal(13, totals.TotalPoints);
        Assert.Equal(13, totals.ScoringEventCount);
    }

    [Fact]
    public void SameTimestampDifferentIdsRemainDistinctAndPlusTwoCountsAsTwoPoints()
    {
        var timestamp = new DateTime(2026, 06, 13, 12, 4, 0, DateTimeKind.Utc);
        var events = new[]
        {
            new MatchScoreEvent { MatchScoreEventId = 101, TeamId = 10, Points = 2, EventTimeUtc = timestamp },
            new MatchScoreEvent { MatchScoreEventId = 102, TeamId = 10, Points = 1, EventTimeUtc = timestamp },
            new MatchScoreEvent { MatchScoreEventId = 103, TeamId = 20, Points = 1, EventTimeUtc = timestamp }
        };

        var totals = MatchScoreEventTotals.FromEvents(events, teamAId: 10);

        Assert.Equal(3, totals.TeamAPoints);
        Assert.Equal(1, totals.TeamBPoints);
        Assert.Equal(4, totals.TotalPoints);
        Assert.Equal(3, totals.ScoringEventCount);
    }
}