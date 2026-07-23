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

    private static IReadOnlyList<TvPriceChartPoint> P(params decimal[] values)
        => values.Select((value, index) => new TvPriceChartPoint(index + 1, value)).ToArray();
}