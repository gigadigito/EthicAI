using DTOs;

namespace CriptoVersus.Web.Services;

public static class CandleBattleChartModelBuilder
{
    private const decimal WinnerEpsilon = 0.000001m;

    public static CandleBattleChartModel Build(
        IReadOnlyList<TvPriceChartPoint>? leftPoints,
        IReadOnlyList<TvPriceChartPoint>? rightPoints)
    {
        var left = NormalizePoints(leftPoints);
        var right = NormalizePoints(rightPoints);
        var paired = left
            .Join(right, item => item.Time, item => item.Time, (leftPoint, rightPoint) => new PairedPricePoint(leftPoint.Time, leftPoint.Value, rightPoint.Value))
            .OrderBy(item => item.Time)
            .ToArray();

        if (paired.Length < 2)
            return CandleBattleChartModel.Empty;

        var baselineLeft = paired[0].LeftValue;
        var baselineRight = paired[0].RightValue;
        var buckets = new List<CandleBattleChartBucket>(paired.Length - 1);

        for (var index = 1; index < paired.Length; index++)
        {
            var previous = paired[index - 1];
            var current = paired[index];
            var leftRaw = FromObservedPrices(previous.Time, current.Time, previous.LeftValue, current.LeftValue);
            var rightRaw = FromObservedPrices(previous.Time, current.Time, previous.RightValue, current.RightValue);
            var normalizedLeft = NormalizeOhlc(leftRaw, baselineLeft);
            var normalizedRight = NormalizeOhlc(rightRaw, baselineRight);
            var leftDelta = PercentChange(leftRaw.Open, leftRaw.Close);
            var rightDelta = PercentChange(rightRaw.Open, rightRaw.Close);
            var difference = leftDelta - rightDelta;
            var winner = Math.Abs(difference) <= WinnerEpsilon
                ? CandleBattleChartWinner.Tie
                : difference > 0m
                    ? CandleBattleChartWinner.Left
                    : CandleBattleChartWinner.Right;

            buckets.Add(new CandleBattleChartBucket(
                current.Time,
                normalizedLeft,
                normalizedRight,
                leftDelta,
                rightDelta,
                winner));
        }

        var domain = CalculateSharedDomain(
            buckets.Select(item => item.Left).Concat(buckets.Select(item => item.Right)));

        return new CandleBattleChartModel(buckets, baselineLeft, baselineRight, domain);
    }

    public static CandleBattleNormalizedOhlc NormalizeOhlc(CandleBattleOhlc candle, decimal baseline)
    {
        if (baseline <= 0m)
            throw new ArgumentOutOfRangeException(nameof(baseline), "The normalization baseline must be positive.");

        return new CandleBattleNormalizedOhlc(
            candle.OpenTime,
            candle.CloseTime,
            candle.Open / baseline,
            candle.High / baseline,
            candle.Low / baseline,
            candle.Close / baseline);
    }

    public static CandleBattleChartDomain CalculateSharedDomain(IEnumerable<CandleBattleNormalizedOhlc> candles)
    {
        var items = candles.ToArray();
        if (items.Length == 0)
            return CandleBattleChartDomain.Empty;

        var rawMinimum = items.Min(item => item.Low);
        var rawMaximum = items.Max(item => item.High);
        var range = rawMaximum - rawMinimum;
        var reference = Math.Max(Math.Abs(rawMinimum), Math.Abs(rawMaximum));
        var padding = range > 0m
            ? range * 0.08m
            : Math.Max(0.0025m, reference * 0.0025m);

        return new CandleBattleChartDomain(
            rawMinimum - padding,
            rawMaximum + padding,
            rawMinimum,
            rawMaximum);
    }

    public static CandleBattleCandleGeometry CreateGeometry(
        CandleBattleNormalizedOhlc candle,
        CandleBattleChartDomain domain,
        double centerX,
        double bodyWidth,
        double chartTop,
        double chartBottom,
        double minimumBodyHeight = 2d)
    {
        var highY = MapY(candle.High, domain.Minimum, domain.Maximum, chartTop, chartBottom);
        var lowY = MapY(candle.Low, domain.Minimum, domain.Maximum, chartTop, chartBottom);
        var openY = MapY(candle.Open, domain.Minimum, domain.Maximum, chartTop, chartBottom);
        var closeY = MapY(candle.Close, domain.Minimum, domain.Maximum, chartTop, chartBottom);
        var bodyTop = Math.Min(openY, closeY);
        var bodyHeight = Math.Max(minimumBodyHeight, Math.Abs(closeY - openY));

        if (bodyHeight > Math.Abs(closeY - openY))
            bodyTop = ((openY + closeY) / 2d) - (bodyHeight / 2d);

        bodyTop = Math.Clamp(bodyTop, chartTop, chartBottom - bodyHeight);

        return new CandleBattleCandleGeometry(
            centerX,
            highY,
            lowY,
            centerX - (bodyWidth / 2d),
            bodyTop,
            bodyWidth,
            bodyHeight,
            candle.Close >= candle.Open);
    }

    private static CandleBattleOhlc FromObservedPrices(long openTime, long closeTime, decimal open, decimal close)
        => new(openTime, closeTime, open, Math.Max(open, close), Math.Min(open, close), close);

    private static IReadOnlyList<TvPriceChartPoint> NormalizePoints(IReadOnlyList<TvPriceChartPoint>? points)
        => points is null
            ? Array.Empty<TvPriceChartPoint>()
            : points
                .Where(item => item.Value > 0m)
                .GroupBy(item => item.Time)
                .Select(group => group.Last())
                .OrderBy(item => item.Time)
                .ToArray();

    private static decimal PercentChange(decimal previous, decimal current)
        => previous == 0m ? 0m : ((current - previous) / Math.Abs(previous)) * 100m;

    private static double MapY(decimal value, decimal minimum, decimal maximum, double top, double bottom)
    {
        var range = maximum - minimum;
        if (range <= 0m)
            return (top + bottom) / 2d;

        var ratio = Math.Clamp((double)((value - minimum) / range), 0d, 1d);
        return bottom - (ratio * (bottom - top));
    }

    private sealed record PairedPricePoint(long Time, decimal LeftValue, decimal RightValue);
}

public enum CandleBattleChartWinner
{
    Left,
    Right,
    Tie
}

public sealed record CandleBattleOhlc(long OpenTime, long CloseTime, decimal Open, decimal High, decimal Low, decimal Close);

public sealed record CandleBattleNormalizedOhlc(long OpenTime, long CloseTime, decimal Open, decimal High, decimal Low, decimal Close);

public sealed record CandleBattleChartDomain(decimal Minimum, decimal Maximum, decimal RawMinimum, decimal RawMaximum)
{
    public static CandleBattleChartDomain Empty { get; } = new(0.9975m, 1.0025m, 1m, 1m);
}

public sealed record CandleBattleChartBucket(
    long Time,
    CandleBattleNormalizedOhlc Left,
    CandleBattleNormalizedOhlc Right,
    decimal LeftDeltaPercent,
    decimal RightDeltaPercent,
    CandleBattleChartWinner Winner);

public sealed record CandleBattleChartModel(
    IReadOnlyList<CandleBattleChartBucket> Buckets,
    decimal LeftBaseline,
    decimal RightBaseline,
    CandleBattleChartDomain Domain)
{
    public static CandleBattleChartModel Empty { get; } = new(Array.Empty<CandleBattleChartBucket>(), 0m, 0m, CandleBattleChartDomain.Empty);
}

public sealed record CandleBattleCandleGeometry(
    double X,
    double HighY,
    double LowY,
    double BodyX,
    double BodyY,
    double BodyWidth,
    double BodyHeight,
    bool IsUp);
