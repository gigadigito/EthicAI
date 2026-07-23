using DTOs;
namespace CriptoVersus.Web.Services;
public static class TvBattleScoreEvaluator
{
    public static CandleBattleScore EvaluateCandleBattle(IReadOnlyList<TvPriceChartPoint>? leftPoints, IReadOnlyList<TvPriceChartPoint>? rightPoints)
    {
        var left = Normalize(leftPoints); var right = Normalize(rightPoints); var count = Math.Min(left.Count, right.Count);
        if (count < 2) return CandleBattleScore.Empty;
        var points = new List<CandleBattlePoint>(count - 1);
        for (var index = 1; index < count; index++)
        {
            var leftDelta = PercentChange(left[index - 1].Value, left[index].Value); var rightDelta = PercentChange(right[index - 1].Value, right[index].Value); var difference = leftDelta - rightDelta;
            var winner = Math.Abs(difference) <= 0.00000001m ? BattleWinner.Draw : difference > 0m ? BattleWinner.Left : BattleWinner.Right;
            points.Add(new CandleBattlePoint(index, leftDelta, rightDelta, winner));
        }
        return new CandleBattleScore(points, points.Count(x => x.Winner == BattleWinner.Left), points.Count(x => x.Winner == BattleWinner.Right), points.Count(x => x.Winner == BattleWinner.Draw));
    }
    public static PriceBattleScore EvaluatePriceBattle(IReadOnlyList<TvPriceChartPoint>? leftPoints, IReadOnlyList<TvPriceChartPoint>? rightPoints)
    {
        var left = NormalizeRelative(leftPoints); var right = NormalizeRelative(rightPoints); var count = Math.Min(left.Count, right.Count);
        if (count < 2) return PriceBattleScore.Empty;
        var leftWins = 0; var rightWins = 0;
        for (var index = 1; index < count; index++) { var previousGap = left[index - 1] - right[index - 1]; var currentGap = left[index] - right[index]; if (previousGap <= 0d && currentGap > 0d) leftWins++; else if (previousGap >= 0d && currentGap < 0d) rightWins++; }
        return new PriceBattleScore(leftWins, rightWins, leftWins + rightWins);
    }
    private static IReadOnlyList<TvPriceChartPoint> Normalize(IReadOnlyList<TvPriceChartPoint>? points) => points is null ? Array.Empty<TvPriceChartPoint>() : points.Where(x => x.Value > 0m).OrderBy(x => x.Time).ToArray();
    private static IReadOnlyList<double> NormalizeRelative(IReadOnlyList<TvPriceChartPoint>? points) { var valid = Normalize(points); if (valid.Count == 0) return Array.Empty<double>(); var baseValue = (double)valid[0].Value; return baseValue <= 0d ? Array.Empty<double>() : valid.Select(x => (double)x.Value / baseValue).ToArray(); }
    private static decimal PercentChange(decimal previous, decimal current) => previous == 0m ? 0m : ((current - previous) / previous) * 100m;
}
public enum BattleWinner { Draw, Left, Right }
public sealed record CandleBattlePoint(int Index, decimal LeftDeltaPercent, decimal RightDeltaPercent, BattleWinner Winner);
public sealed record CandleBattleScore(IReadOnlyList<CandleBattlePoint> Points, int LeftWins, int RightWins, int Draws) { public static CandleBattleScore Empty { get; } = new(Array.Empty<CandleBattlePoint>(), 0, 0, 0); public int TotalEvaluatedCandles => Points.Count; }
public sealed record PriceBattleScore(int LeftWins, int RightWins, int TotalPoints) { public static PriceBattleScore Empty { get; } = new(0, 0, 0); }