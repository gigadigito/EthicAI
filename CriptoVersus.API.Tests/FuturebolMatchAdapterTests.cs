using CriptoVersus.Web.Services;
using DTOs;

namespace EthicAI.test;

public sealed class FuturebolMatchAdapterTests
{
    [Fact]
    public void Build_MapsCompleteLivePresentationState()
    {
        var observedUtc = new DateTime(2026, 8, 9, 12, 10, 30, DateTimeKind.Utc);
        var match = CreateMatch();
        var hot = new TvHotMatchDto
        {
            HasMatch = true,
            MatchId = match.MatchId,
            LeftName = "Bitcoin Masters",
            RightName = "Turtle Token",
            LeftLogoUrl = "/logos/bmt.png",
            RightLogoUrl = "/logos/tut.png"
        };
        var snapshots = new[]
        {
            new MatchMetricSnapshotDto { MatchMetricSnapshotId = 11, MatchId = 32061, TeamId = 10, TeamSymbol = "BMT", CapturedAtUtc = observedUtc.AddSeconds(-2), LastPrice = 12.5m, PercentageChange = 4m, QuoteVolume = 750m },
            new MatchMetricSnapshotDto { MatchMetricSnapshotId = 12, MatchId = 32061, TeamId = 20, TeamSymbol = "TUT", CapturedAtUtc = observedUtc.AddSeconds(-1), LastPrice = 2.5m, PercentageChange = -1m, QuoteVolume = 250m }
        };
        var events = new[]
        {
            new MatchScoreEventDto { MatchScoreEventId = 101, MatchId = 32061, TeamId = 10, TeamSymbol = "BMT", EventSequence = 6, Points = 2, EventType = "MULTI", EventTimeUtc = observedUtc.AddMinutes(-1) }
        };

        var state = new FuturebolMatchAdapter().Build(match, hot, snapshots, events, observedUtc);

        Assert.Equal(32061, state.MatchId);
        Assert.Equal((10, "BMT", "Bitcoin Masters", "/logos/bmt.png"), (state.HomeTeam.TeamId, state.HomeTeam.Symbol, state.HomeTeam.Name, state.HomeTeam.LogoUrl));
        Assert.Equal((20, "TUT", "Turtle Token", "/logos/tut.png"), (state.AwayTeam.TeamId, state.AwayTeam.Symbol, state.AwayTeam.Name, state.AwayTeam.LogoUrl));
        Assert.Equal(12.5, state.Market.Home.Price);
        Assert.Equal(2.5, state.Market.Away.Price);
        Assert.Equal(75, state.Market.Home.VolumeStrength);
        Assert.Equal(12, state.Market.Sequence);
        Assert.Equal(3, state.Official.HomeScore);
        Assert.Equal(1, state.Official.AwayScore);
        Assert.Equal(7, state.Official.Sequence);
        Assert.Equal("Ongoing", state.Official.Status);
        Assert.Equal(630, state.Official.ElapsedSeconds);
        Assert.Single(state.Official.ScoreEvents);
        Assert.Equal(2, state.Official.ScoreEvents[0].Points);
        Assert.Equal(20, state.Result.WinnerTeamId);
        Assert.Equal("TUT", state.Result.WinnerTeamSymbol);
        Assert.Equal("TIME", state.Result.EndReasonCode);
    }

    [Fact]
    public void Build_FinishedMatch_FreezesClockAtEndAndPreservesResult()
    {
        var match = CreateMatch();
        match.Status = "Completed";
        match.IsFinished = true;
        match.EndTime = new DateTime(2026, 8, 9, 12, 15, 0, DateTimeKind.Utc);
        match.WinnerTeamId = match.TeamAId;
        match.WinnerTeamSymbol = match.TeamA;
        match.EndReasonDetail = "Official close";

        var state = new FuturebolMatchAdapter().Build(
            match,
            null,
            Array.Empty<MatchMetricSnapshotDto>(),
            Array.Empty<MatchScoreEventDto>(),
            new DateTime(2026, 8, 9, 14, 0, 0, DateTimeKind.Utc));

        Assert.True(state.Official.IsFinished);
        Assert.True(state.Clock.IsFinished);
        Assert.Equal(900, state.Official.ElapsedSeconds);
        Assert.Equal(900, state.Clock.ElapsedSeconds);
        Assert.Equal(match.TeamAId, state.Result.WinnerTeamId);
        Assert.Equal("Official close", state.Result.EndReasonDetail);
    }

    private static MatchDto CreateMatch()
        => new()
        {
            MatchId = 32061,
            TeamAId = 10,
            TeamBId = 20,
            TeamA = "BMT",
            TeamB = "TUT",
            ScoreA = 3,
            ScoreB = 1,
            ScoreVersion = 7,
            Status = "Ongoing",
            StartTime = new DateTime(2026, 8, 9, 12, 0, 0, DateTimeKind.Utc),
            ElapsedMinutes = 9,
            RemainingMinutes = 80,
            WinnerTeamId = 20,
            WinnerTeamSymbol = "TUT",
            EndReasonCode = "TIME"
        };
}

