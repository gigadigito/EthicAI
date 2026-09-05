using DTOs;
using CriptoVersus.Web.Services;

public sealed class TvBattleScoreEvaluatorTests
{
    [Fact]
    public void CandleBattle_AllLeftWins()
    {
        var result = TvBattleScoreEvaluator.EvaluateCandleBattle(P(100, 110, 121), P(100, 105, 110));
        Assert.Equal(2, result.LeftWins); Assert.Equal(0, result.RightWins); Assert.Equal(0, result.Draws); Assert.Equal(2, result.TotalEvaluatedCandles);
    }

    [Fact]
    public void CandleBattle_AllRightWins_AndDrawsAreNeutral()
    {
        var result = TvBattleScoreEvaluator.EvaluateCandleBattle(P(100, 105, 110, 120), P(100, 110, 121, 132));
        Assert.Equal(0, result.LeftWins); Assert.Equal(2, result.RightWins); Assert.Equal(1, result.Draws);
        Assert.Equal(result.LeftWins + result.RightWins + result.Draws, result.TotalEvaluatedCandles);
    }

    [Fact]
    public void CandleBattle_EmptyAndNewPointsRecalculate()
    {
        Assert.Equal(CandleBattleScore.Empty, TvBattleScoreEvaluator.EvaluateCandleBattle([], []));
        var first = TvBattleScoreEvaluator.EvaluateCandleBattle(P(100, 110), P(100, 105));
        var updated = TvBattleScoreEvaluator.EvaluateCandleBattle(P(100, 110, 100), P(100, 105, 110));
        Assert.Equal(1, first.LeftWins); Assert.Equal(1, updated.LeftWins); Assert.Equal(1, updated.RightWins);
    }

    [Fact]
    public void PriceBattle_UsesOnlyRelativePriceCrossovers_NotMatchScore()
    {
        var result = TvBattleScoreEvaluator.EvaluatePriceBattle(P(100, 110, 90, 120), P(100, 90, 110, 80));
        Assert.Equal(1, result.LeftWins); Assert.Equal(1, result.RightWins); Assert.Equal(2, result.TotalPoints);
    }

    [Fact]
    public void IndependentScoresCanCoexist()
    {
        var candle = TvBattleScoreEvaluator.EvaluateCandleBattle(P(100, 110, 121), P(100, 105, 110));
        var price = TvBattleScoreEvaluator.EvaluatePriceBattle(P(100, 90, 120), P(100, 110, 80));
        Assert.Equal((2, 0), (candle.LeftWins, candle.RightWins));
        Assert.Equal((1, 1), (price.LeftWins, price.RightWins));
    }

    [Fact]
    public void CandleBattle_100Confrontos_ReturnsAllResults()
    {
        var leftValues = Enumerable.Range(0, 101).Select(i => 100m + (i * 0.5m)).ToArray();
        var rightValues = Enumerable.Range(0, 101).Select(i => 100m - (i * 0.3m)).ToArray();

        var result = TvBattleScoreEvaluator.EvaluateCandleBattle(
            P(leftValues),
            P(rightValues));

        Assert.Equal(100, result.TotalEvaluatedCandles);
        Assert.Equal(100, result.LeftWins);
        Assert.Equal(0, result.RightWins);
    }

    [Fact]
    public void CandleBattle_ScoreIndependentFromMatchScore()
    {
        var leftPoints = P(100, 105, 103, 110, 108, 115, 112, 120, 118, 125);
        var rightPoints = P(100, 98, 102, 95, 100, 92, 97, 90, 95, 88);

        var candleScore = TvBattleScoreEvaluator.EvaluateCandleBattle(leftPoints, rightPoints);

        const int matchScoreA = 3;
        const int matchScoreB = 2;

        Assert.NotEqual(matchScoreA, candleScore.LeftWins);
        Assert.NotEqual(matchScoreB, candleScore.RightWins);
        Assert.Equal(9, candleScore.LeftWins);
        Assert.Equal(0, candleScore.RightWins);
    }

    [Fact]
    public void CandleBattle_IdempotentAcrossRecomputation()
    {
        var leftPoints = P(100, 110, 105, 115, 108, 120);
        var rightPoints = P(100, 95, 102, 90, 98, 85);

        var first = TvBattleScoreEvaluator.EvaluateCandleBattle(leftPoints, rightPoints);
        var second = TvBattleScoreEvaluator.EvaluateCandleBattle(leftPoints, rightPoints);
        var third = TvBattleScoreEvaluator.EvaluateCandleBattle(leftPoints, rightPoints);

        Assert.Equal((first.LeftWins, first.RightWins, first.Draws),
                     (second.LeftWins, second.RightWins, second.Draws));
        Assert.Equal((first.LeftWins, first.RightWins, first.Draws),
                     (third.LeftWins, third.RightWins, third.Draws));
    }

    [Fact]
    public void CandleBattle_57Left_43Right_TotalExactly100()
    {
        var leftValues = new decimal[101];
        var rightValues = new decimal[101];
        leftValues[0] = 100m;
        rightValues[0] = 100m;

        for (var i = 1; i <= 100; i++)
        {
            leftValues[i] = leftValues[i - 1] + (i % 3 == 0 ? 1.5m : 0.8m);
            rightValues[i] = rightValues[i - 1] + (i % 5 == 0 ? 0.3m : 0.1m);
        }

        var result = TvBattleScoreEvaluator.EvaluateCandleBattle(
            leftValues.Select((v, i) => new TvPriceChartPoint(i + 1, v)).ToArray(),
            rightValues.Select((v, i) => new TvPriceChartPoint(i + 1, v)).ToArray());

        Assert.Equal(100, result.TotalEvaluatedCandles);
        Assert.Equal(result.LeftWins + result.RightWins + result.Draws, result.TotalEvaluatedCandles);
    }

    private static IReadOnlyList<TvPriceChartPoint> P(params decimal[] values)
        => values.Select((value, index) => new TvPriceChartPoint(index + 1, value)).ToArray();
}