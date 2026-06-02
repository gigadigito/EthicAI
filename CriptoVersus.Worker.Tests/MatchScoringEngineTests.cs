using BLL.NFTFutebol;
using DAL.NftFutebol;

namespace CriptoVersus.Worker.Tests;

public sealed class MatchScoringEngineTests
{
    private readonly MatchScoringEngine _engine = new();

    [Fact]
    public void PercentThreshold_DoesNotAwardCrossover_WhenLinesOnlyTouch()
    {
        var result = _engine.Evaluate(BuildContext(
            ruleType: MatchScoringRuleType.PercentageCrossover,
            currentTeamAPct: 1.0m,
            currentTeamBPct: 1.0m,
            previousTeamAPct: 0.5m,
            previousTeamBPct: 1.5m));

        Assert.Equal(0, result.ScoreA);
        Assert.Equal(0, result.ScoreB);
        Assert.Empty(result.Events);
    }

    [Fact]
    public void PercentThreshold_AwardsCrossover_WhenTeamAReallyCrossesUp()
    {
        var result = _engine.Evaluate(BuildContext(
            ruleType: MatchScoringRuleType.PercentageCrossover,
            currentTeamAPct: 1.1m,
            currentTeamBPct: 1.0m,
            previousTeamAPct: 0.5m,
            previousTeamBPct: 1.5m));

        Assert.Equal(1, result.ScoreA);
        Assert.Equal(0, result.ScoreB);
        var scoreEvent = Assert.Single(result.Events);
        Assert.Equal(MatchScoringRuleType.PercentageCrossover, scoreEvent.RuleType);
        Assert.Equal(1, scoreEvent.TeamId);
    }

    [Fact]
    public void VolumeCrossover_DoesNotAwardCrossover_WhenLinesOnlyTouch()
    {
        var result = _engine.Evaluate(BuildContext(
            ruleType: MatchScoringRuleType.VolumeCrossover,
            currentTeamAQuoteVolume: 100m,
            currentTeamBQuoteVolume: 100m,
            previousTeamAQuoteVolume: 90m,
            previousTeamBQuoteVolume: 110m));

        Assert.Equal(0, result.ScoreA);
        Assert.Equal(0, result.ScoreB);
        Assert.Empty(result.Events);
    }

    private static MatchScoringContext BuildContext(
        MatchScoringRuleType ruleType,
        decimal currentTeamAPct = 0m,
        decimal currentTeamBPct = 0m,
        decimal previousTeamAPct = 0m,
        decimal previousTeamBPct = 0m,
        decimal currentTeamAQuoteVolume = 0m,
        decimal currentTeamBQuoteVolume = 0m,
        decimal previousTeamAQuoteVolume = 0m,
        decimal previousTeamBQuoteVolume = 0m)
    {
        return new MatchScoringContext
        {
            RuleType = ruleType,
            CurrentScoreA = 0,
            CurrentScoreB = 0,
            TeamA = new TeamMetricPoint
            {
                TeamId = 1,
                Symbol = "CHIPUSDT",
                PercentageChange = currentTeamAPct,
                QuoteVolume = currentTeamAQuoteVolume
            },
            TeamB = new TeamMetricPoint
            {
                TeamId = 2,
                Symbol = "FETUSDT",
                PercentageChange = currentTeamBPct,
                QuoteVolume = currentTeamBQuoteVolume
            },
            PreviousTeamA = new TeamMetricPoint
            {
                TeamId = 1,
                Symbol = "CHIPUSDT",
                PercentageChange = previousTeamAPct,
                QuoteVolume = previousTeamAQuoteVolume
            },
            PreviousTeamB = new TeamMetricPoint
            {
                TeamId = 2,
                Symbol = "FETUSDT",
                PercentageChange = previousTeamBPct,
                QuoteVolume = previousTeamBQuoteVolume
            },
            State = new MatchScoreState
            {
                MatchId = 18022,
                CreatedAtUtc = DateTime.UtcNow,
                UpdatedAtUtc = DateTime.UtcNow
            },
            EvaluatedAtUtc = DateTime.UtcNow,
            PercentThresholds = [2m, 8m, 16m]
        };
    }
}
