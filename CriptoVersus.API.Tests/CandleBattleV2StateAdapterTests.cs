using CriptoVersus.Web.Services;
using DTOs;

namespace CriptoVersus.API.Tests;

public sealed class CandleBattleV2StateAdapterTests
{
    [Fact]
    public void Bootstrap_RestoresOfficialScoreWithoutAnimations()
    {
        var state = new CandleBattleV2StateAdapter();
        state.Bootstrap(Match(23, 17), [Event(100, 1, 10)]);
        Assert.Equal((23, 17), (state.DisplayScoreLeft, state.DisplayScoreRight));
        Assert.Equal(0, state.PendingAnimationCount);
    }

    [Fact]
    public void LiveOfficialEvent_AddsExactlyOnePoint()
    {
        var state = new CandleBattleV2StateAdapter();
        state.Bootstrap(Match(5, 3), []);
        Assert.Equal(1, state.MergeLive(Match(6, 3), [Event(123, 1, 10)]));
        Assert.True(state.TryStartNext(out var animation));
        Assert.Equal(CandleBattleV2Side.Left, animation!.Winner);
        state.CompleteActive();
        Assert.Equal((6, 3), (state.DisplayScoreLeft, state.DisplayScoreRight));
    }

    [Fact]
    public void DuplicateEvent_IsIgnoredAcrossRefreshAndReconnect()
    {
        var state = new CandleBattleV2StateAdapter();
        var scoreEvent = Event(123, 1, 10);
        state.Bootstrap(Match(5, 3), []);
        Assert.Equal(1, state.MergeLive(Match(6, 3), [scoreEvent]));
        Assert.Equal(0, state.MergeLive(Match(6, 3), [scoreEvent]));
        Assert.True(state.TryStartNext(out _));
        state.CompleteActive();
        state.Reconcile(Match(6, 3), [scoreEvent]);
        Assert.Equal(0, state.MergeLive(Match(6, 3), [scoreEvent]));
        Assert.Equal((6, 3), (state.DisplayScoreLeft, state.DisplayScoreRight));
    }

    [Fact]
    public void LiveRightEvent_QueuesOneBattleAndOneBlock()
    {
        var state = new CandleBattleV2StateAdapter();
        state.Bootstrap(Match(23, 17), []);
        Assert.Equal(1, state.MergeLive(Match(23, 18), [Event(124, 1, 20)]));
        Assert.True(state.TryStartNext(out var animation));
        Assert.Equal(CandleBattleV2Side.Right, animation!.Winner);
        state.CompleteActive();
        Assert.Equal((23, 18), (state.DisplayScoreLeft, state.DisplayScoreRight));
    }

    [Fact]
    public void ThreeRapidEvents_ArePlayedOnceInOfficialSequence()
    {
        var state = new CandleBattleV2StateAdapter();
        state.Bootstrap(Match(10, 10), []);
        var events = new[]
        {
            Event(203, 3, 20),
            Event(201, 1, 10),
            Event(202, 2, 20)
        };

        Assert.Equal(3, state.MergeLive(Match(11, 12), events));

        var winners = new List<CandleBattleV2Side>();
        while (state.TryStartNext(out var animation))
        {
            winners.Add(animation!.Winner);
            state.CompleteActive();
        }

        Assert.Equal(
            [CandleBattleV2Side.Left, CandleBattleV2Side.Right, CandleBattleV2Side.Right],
            winners);
        Assert.Equal((11, 12), (state.DisplayScoreLeft, state.DisplayScoreRight));
        Assert.Equal(0, state.MergeLive(Match(11, 12), events));
    }

    [Fact]
    public void NonCandleBattleScoreEvent_IsNotTurnedIntoABattle()
    {
        var state = new CandleBattleV2StateAdapter();
        state.Bootstrap(Match(5, 3), []);
        var scoreEvent = Event(301, 1, 10);
        scoreEvent.EventType = "PERCENT_THRESHOLD";

        Assert.Equal(0, state.MergeLive(Match(6, 3), [scoreEvent]));
        Assert.False(state.TryStartNext(out _));
        Assert.Equal((6, 3), (state.DisplayScoreLeft, state.DisplayScoreRight));
    }

    [Fact]
    public void TieOrZeroPointEvent_DoesNotGenerateBlock()
    {
        var state = new CandleBattleV2StateAdapter();
        state.Bootstrap(Match(4, 4), []);
        var tie = Event(125, 1, 10);
        tie.Points = 0;
        Assert.Equal(0, state.MergeLive(Match(4, 4), [tie]));
        Assert.False(state.TryStartNext(out _));
        Assert.Equal((4, 4), (state.DisplayScoreLeft, state.DisplayScoreRight));
    }

    [Fact]
    public void FinishedMatch_ReconcilesButDoesNotAnimateLateEvents()
    {
        var state = new CandleBattleV2StateAdapter();
        state.Bootstrap(Match(5, 3), []);
        var finished = Match(6, 3) with { IsFinished = true, Status = "Completed" };
        Assert.Equal(0, state.MergeLive(finished, [Event(126, 1, 10)]));
        Assert.True(state.IsFinished);
        Assert.False(state.TryStartNext(out _));
        Assert.Equal((6, 3), (state.DisplayScoreLeft, state.DisplayScoreRight));
    }

    private static CandleBattleV2OfficialState Match(int left, int right) => new(10, 20, left, right, "Ongoing", false, null);

    private static MatchScoreEventDto Event(long id, int sequence, int teamId) => new()
    {
        MatchScoreEventId = id,
        MatchId = 33975,
        EventSequence = sequence,
        TeamId = teamId,
        EventType = "CANDLE_BATTLE_DOMINANCE",
        ReasonCode = "CANDLE_BATTLE_DOMINANCE",
        RuleType = "CandleBattleDominance",
        Points = 1,
        TeamPercentageChange = 1.25m,
        OpponentPercentageChange = .4m,
        EventTimeUtc = DateTime.UtcNow
    };
}
