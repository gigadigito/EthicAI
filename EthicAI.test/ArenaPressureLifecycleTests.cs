using CriptoVersus.Web.Services;
using DTOs;

public class ArenaPressureLifecycleTests
{
    private static readonly DateTimeOffset Now = new(2026, 11, 20, 12, 0, 0, TimeSpan.Zero);

    [Fact]
    public void CountdownUsesOfficialDeadlineAndClampsAtZero()
    {
        Assert.Equal("90:00", ArenaPressureLifecycle.Clock(Now.AddMinutes(90).UtcDateTime, Now));
        Assert.Equal("00:00", ArenaPressureLifecycle.Clock(Now.AddSeconds(-1).UtcDateTime, Now));
    }

    [Fact]
    public void CountdownFollowsConfiguredMatchDuration()
    {
        var start = Now.UtcDateTime;
        Assert.Equal("45:00", ArenaPressureLifecycle.Clock(start.AddMinutes(45), Now));
        Assert.Equal("05:00", ArenaPressureLifecycle.Clock(start.AddMinutes(45), Now.AddMinutes(40)));
        Assert.Equal("00:30", ArenaPressureLifecycle.Clock(start.AddMinutes(45), Now.AddMinutes(44).AddSeconds(30)));
    }

    [Fact]
    public void LifecycleWaitsForConfirmedEnd()
    {
        var match = new MatchDto { Status = "Ongoing", ScheduledEndTimeUtc = Now.UtcDateTime };
        Assert.Equal("processing", ArenaPressureLifecycle.State(match, Now));
        match.Status = "Completed";
        match.EndTime = Now.UtcDateTime;
        Assert.Equal("finished", ArenaPressureLifecycle.State(match, Now));
        match.Status = "Cancelled";
        Assert.Equal("cancelled", ArenaPressureLifecycle.State(match, Now));
    }

    [Fact]
    public void PendingMatchStaysWaiting()
    {
        var match = new MatchDto { Status = "Pending", StartTime = Now.AddMinutes(5).UtcDateTime };
        Assert.Equal("pending", ArenaPressureLifecycle.State(match, Now));
    }

    [Fact]
    public void OngoingMatchIsLiveBeforeTheProjectedDeadline()
    {
        var match = new MatchDto
        {
            Status = "Ongoing",
            StartTime = Now.UtcDateTime,
            ScheduledEndTimeUtc = Now.AddMinutes(90).UtcDateTime
        };
        Assert.Equal("live", ArenaPressureLifecycle.State(match, Now));
        Assert.Equal("live", ArenaPressureLifecycle.State(match, Now.AddMinutes(89)));
        Assert.Equal("processing", ArenaPressureLifecycle.State(match, Now.AddMinutes(90)));
    }

    [Theory]
    [InlineData("")]
    [InlineData("SomethingElse")]
    public void UnknownStatusNeverClaimsLiveOrFinished(string status)
    {
        var match = new MatchDto { Status = status, ScheduledEndTimeUtc = Now.AddMinutes(30).UtcDateTime };
        Assert.Equal("pending", ArenaPressureLifecycle.State(match, Now));
        match.ScheduledEndTimeUtc = Now.AddMinutes(-30).UtcDateTime;
        Assert.Equal("pending", ArenaPressureLifecycle.State(match, Now));
    }

    [Theory]
    [InlineData(1, "leftVictory")]
    [InlineData(2, "rightVictory")]
    [InlineData(null, "draw")]
    public void ResultUsesOfficialWinner(int? winner, string expected)
    {
        var match = new MatchDto { Status = "Completed", TeamAId = 1, TeamBId = 2, WinnerTeamId = winner };
        Assert.Equal(expected, ArenaPressureLifecycle.Result(match));
    }

    [Fact]
    public void FinishedWithoutConfirmedOutcomeIsResultPending()
    {
        var match = new MatchDto
        {
            Status = "Completed",
            EndTime = Now.UtcDateTime,
            TeamAId = 1,
            TeamBId = 2,
            WinnerTeamId = null,
            ScoreA = 2,
            ScoreB = 1
        };
        Assert.Equal("finished", ArenaPressureLifecycle.State(match, Now));
        Assert.Equal("resultPending", ArenaPressureLifecycle.Result(match));
    }

    [Fact]
    public void ResultIsNeverInventedBeforeCompletion()
    {
        var match = new MatchDto { Status = "Ongoing", TeamAId = 1, TeamBId = 2, WinnerTeamId = 1 };
        Assert.Equal("resultPending", ArenaPressureLifecycle.Result(match));
    }

    [Fact]
    public void ScheduledAndEffectiveEndDatesAreUtc()
    {
        var start = new DateTime(2026, 11, 20, 12, 0, 0, DateTimeKind.Unspecified);
        var scheduled = start.AddMinutes(90);
        var projected = ArenaPressureLifecycle.Utc(scheduled);
        Assert.Equal(DateTimeKind.Utc, projected.Kind);
        Assert.Equal(new DateTimeOffset(2026, 11, 20, 13, 30, 0, TimeSpan.Zero), projected);
        Assert.Equal("90:00", ArenaPressureLifecycle.Clock(scheduled, Now));
    }

    [Fact]
    public void LateUpdatesKeepTheFinishedState()
    {
        var match = new MatchDto
        {
            Status = "Completed",
            StartTime = Now.AddMinutes(-90).UtcDateTime,
            ScheduledEndTimeUtc = Now.UtcDateTime,
            EndTime = Now.UtcDateTime,
            TeamAId = 1,
            TeamBId = 2,
            WinnerTeamId = 1
        };
        foreach (var later in new[] { Now.AddSeconds(1), Now.AddMinutes(5), Now.AddHours(3) })
        {
            Assert.Equal("finished", ArenaPressureLifecycle.State(match, later));
            Assert.Equal("leftVictory", ArenaPressureLifecycle.Result(match));
            Assert.Equal("00:00", ArenaPressureLifecycle.Clock(match.ScheduledEndTimeUtc, later));
        }
    }

    [Fact]
    public void SandboxClockIsDeterministic()
    {
        var simulation = new ArenaPressurePreviewSimulator();
        simulation.Advance(TimeSpan.FromSeconds(10));
        Assert.Equal(new DateTimeOffset(2026, 11, 20, 12, 0, 10, TimeSpan.Zero), simulation.NowUtc);
        simulation.Finish(1);
        Assert.Equal(simulation.NowUtc, simulation.EndUtc);
        simulation.ResetLifecycle();
        Assert.Equal("Ongoing", simulation.MatchStatus);
        Assert.Null(simulation.EndUtc);
    }

    [Fact]
    public void SandboxInitialStateAndPauseRespectSimulatedTime()
    {
        var simulation = new ArenaPressurePreviewSimulator();
        Assert.Equal(simulation.StartUtc, simulation.NowUtc);
        Assert.Equal(90, simulation.DurationMinutes);
        Assert.Equal("Ongoing", simulation.MatchStatus);
        Assert.Equal(50, simulation.LeftPercent);
        Assert.Equal(simulation.StartUtc.AddMinutes(90), simulation.NowUtc.AddMinutes(simulation.DurationMinutes));

        var before = simulation.NowUtc;
        simulation.TickOnce();
        Assert.Equal(before, simulation.NowUtc);

        simulation.Advance(TimeSpan.FromMilliseconds(ArenaPressurePreviewSimulator.TickMilliseconds));
        Assert.Equal(before.AddMilliseconds(ArenaPressurePreviewSimulator.TickMilliseconds), simulation.NowUtc);
    }

    [Fact]
    public void SandboxOutcomeScenariosMatchTheOfficialResultRules()
    {
        var simulation = new ArenaPressurePreviewSimulator();
        var match = () => new MatchDto
        {
            Status = simulation.MatchStatus,
            StartTime = simulation.StartUtc.UtcDateTime,
            ScheduledEndTimeUtc = simulation.StartUtc.AddMinutes(simulation.DurationMinutes).UtcDateTime,
            EndTime = simulation.EndUtc?.UtcDateTime,
            TeamAId = 1,
            TeamBId = 2,
            WinnerTeamId = simulation.WinnerSide switch { 0 => 1, 1 => 2, _ => null },
            ScoreA = simulation.ScoreA,
            ScoreB = simulation.ScoreB
        };

        simulation.Finish(0);
        Assert.Equal("finished", ArenaPressureLifecycle.State(match(), simulation.NowUtc));
        Assert.Equal("leftVictory", ArenaPressureLifecycle.Result(match()));

        simulation.Finish(1);
        Assert.Equal("rightVictory", ArenaPressureLifecycle.Result(match()));

        simulation.Finish(null);
        Assert.Equal("draw", ArenaPressureLifecycle.Result(match()));

        simulation.Cancel();
        Assert.Equal("cancelled", ArenaPressureLifecycle.State(match(), simulation.NowUtc));

        simulation.Pending();
        Assert.Equal("pending", ArenaPressureLifecycle.State(match(), simulation.NowUtc));
    }
}
