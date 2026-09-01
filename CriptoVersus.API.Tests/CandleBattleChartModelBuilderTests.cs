using CriptoVersus.Web.Services;
using DTOs;

namespace CriptoVersus.API.Tests;

public sealed class CandleBattleChartModelBuilderTests
{
    [Fact]
    public void NormalizeOhlc_UsesOneBaselineForEveryValue()
    {
        var normalized = CandleBattleChartModelBuilder.NormalizeOhlc(
            new CandleBattleOhlc(1, 2, 100m, 105m, 98m, 103m),
            100m);

        Assert.Equal(1.00m, normalized.Open);
        Assert.Equal(1.05m, normalized.High);
        Assert.Equal(0.98m, normalized.Low);
        Assert.Equal(1.03m, normalized.Close);
    }

    [Fact]
    public void CalculateSharedDomain_UsesExtremesFromBothAssets()
    {
        var domain = CandleBattleChartModelBuilder.CalculateSharedDomain(
        [
            N(1m, 1.04m, 0.98m, 1.02m),
            N(1m, 1.07m, 0.99m, 1.05m)
        ]);

        Assert.Equal(0.98m, domain.RawMinimum);
        Assert.Equal(1.07m, domain.RawMaximum);
        Assert.True(domain.Minimum < 0.98m);
        Assert.True(domain.Maximum > 1.07m);
    }

    [Fact]
    public void Build_PairsOnlyEqualTimestamps()
    {
        var result = CandleBattleChartModelBuilder.Build(
            [P(100, 10m), P(200, 11m), P(300, 12m)],
            [P(100, 20m), P(250, 21m), P(300, 22m)]);

        var bucket = Assert.Single(result.Buckets);
        Assert.Equal(300, bucket.Time);
        Assert.Equal(1.2m, bucket.Left.Close);
        Assert.Equal(1.1m, bucket.Right.Close);
    }

    [Fact]
    public void Build_PreservesWinnerRule()
    {
        var result = CandleBattleChartModelBuilder.Build(
            [P(100, 100m), P(200, 110m), P(300, 99m)],
            [P(100, 100m), P(200, 105m), P(300, 115.5m)]);

        Assert.Equal(CandleBattleChartWinner.Left, result.Buckets[0].Winner);
        Assert.Equal(CandleBattleChartWinner.Right, result.Buckets[1].Winner);
    }

    [Fact]
    public void Geometry_UsesHighLowForWickAndOpenCloseForBody()
    {
        var candle = N(1.00m, 1.05m, 0.98m, 1.03m);
        var domain = new CandleBattleChartDomain(0.95m, 1.08m, 0.98m, 1.05m);
        var geometry = CandleBattleChartModelBuilder.CreateGeometry(candle, domain, 50d, 8d, 10d, 310d);
        var openGeometry = CandleBattleChartModelBuilder.CreateGeometry(N(1m, 1m, 1m, 1m), domain, 50d, 8d, 10d, 310d);
        var closeGeometry = CandleBattleChartModelBuilder.CreateGeometry(N(1.03m, 1.03m, 1.03m, 1.03m), domain, 50d, 8d, 10d, 310d);

        Assert.True(geometry.HighY < geometry.BodyY);
        Assert.True(geometry.LowY > geometry.BodyY + geometry.BodyHeight);
        Assert.Equal(closeGeometry.BodyY, geometry.BodyY, 6);
        Assert.Equal(openGeometry.BodyY, geometry.BodyY + geometry.BodyHeight, 6);
    }

    [Fact]
    public void Geometry_BodyNeverAnchoredToPlotBottom()
    {
        var candle = N(1.00m, 1.00m, 1.00m, 1.02m);
        var domain = new CandleBattleChartDomain(0.98m, 1.04m, 0.99m, 1.03m);
        var plotBottom = 420d;
        var geometry = CandleBattleChartModelBuilder.CreateGeometry(candle, domain, 50d, 8d, 20d, plotBottom);

        Assert.NotEqual(plotBottom, geometry.BodyY);
        Assert.NotEqual(plotBottom, geometry.BodyY + geometry.BodyHeight);
        Assert.InRange(geometry.BodyY, 20d, plotBottom);
        Assert.InRange(geometry.BodyY + geometry.BodyHeight, 20d, plotBottom);
    }

    [Fact]
    public void Geometry_NormalCandle_BodyBetweenOpenAndClose()
    {
        var domain = new CandleBattleChartDomain(0.90m, 1.10m, 0.90m, 1.10m);
        var candle = N(1.02m, 1.05m, 0.98m, 1.04m);
        var geometry = CandleBattleChartModelBuilder.CreateGeometry(candle, domain, 50d, 8d, 20d, 420d);

        var openY = MapYManual(1.02m, 0.90m, 1.10m, 20d, 420d);
        var closeY = MapYManual(1.04m, 0.90m, 1.10m, 20d, 420d);
        var expectedBodyTop = Math.Min(openY, closeY);
        var expectedBodyHeight = Math.Abs(closeY - openY);

        Assert.Equal(expectedBodyTop, geometry.BodyY, 1);
        Assert.Equal(expectedBodyHeight, geometry.BodyHeight, 1);
        Assert.False(geometry.IsDoji);
        Assert.InRange(geometry.BodyY, 20d, 420d);
        Assert.InRange(geometry.BodyY + geometry.BodyHeight, 20d, 420d);
    }

    private static double MapYManual(decimal value, decimal minimum, decimal maximum, double top, double bottom)
    {
        var range = maximum - minimum;
        if (range <= 0m) return (top + bottom) / 2d;
        var ratio = (double)((value - minimum) / range);
        ratio = Math.Clamp(ratio, 0d, 1d);
        return bottom - (ratio * (bottom - top));
    }

    [Fact]
    public void Geometry_Doji_OpenEqualsClose_IsDojiWithZeroHeight()
    {
        var domain = new CandleBattleChartDomain(0.95m, 1.05m, 0.95m, 1.05m);
        var candle = N(1.00m, 1.00m, 1.00m, 1.00m);
        var geometry = CandleBattleChartModelBuilder.CreateGeometry(candle, domain, 50d, 8d, 20d, 420d);

        Assert.True(geometry.IsDoji);
        Assert.Equal(0d, geometry.BodyHeight, 6);
    }

    [Fact]
    public void Geometry_NearDoji_SmallDifference_IsDoji()
    {
        var domain = new CandleBattleChartDomain(0.90m, 1.10m, 0.90m, 1.10m);
        var candle = N(1.00m, 1.00m, 1.00m, 1.0005m);
        var geometry = CandleBattleChartModelBuilder.CreateGeometry(candle, domain, 50d, 8d, 20d, 420d);

        Assert.True(geometry.IsDoji);
        Assert.True(geometry.BodyHeight < 2.0);
    }

    [Fact]
    public void Geometry_LargerDifference_IsNotDoji()
    {
        var domain = new CandleBattleChartDomain(0.90m, 1.10m, 0.90m, 1.10m);
        var candle = N(1.00m, 1.02m, 0.98m, 1.03m);
        var geometry = CandleBattleChartModelBuilder.CreateGeometry(candle, domain, 50d, 8d, 20d, 420d);

        Assert.False(geometry.IsDoji);
        Assert.True(geometry.BodyHeight >= 2.0);
    }

    [Fact]
    public void Build_AppendsOneBucketWithoutChangingClosedHistory()
    {
        var initial = CandleBattleChartModelBuilder.Build(
            [P(100, 100m), P(200, 105m)],
            [P(100, 200m), P(200, 202m)]);
        var updated = CandleBattleChartModelBuilder.Build(
            [P(100, 100m), P(200, 105m), P(300, 106m)],
            [P(100, 200m), P(200, 202m), P(300, 201m)]);

        Assert.Equal(2, updated.Buckets.Count);
        Assert.Equal(initial.Buckets[0], updated.Buckets[0]);
        Assert.Equal(300, updated.Buckets[1].Time);
    }

    [Fact]
    public void Geometry_RemainsInsideResizedChartBounds()
    {
        var candle = N(1m, 1.04m, 0.98m, 1.02m);
        var domain = new CandleBattleChartDomain(0.97m, 1.05m, 0.98m, 1.04m);

        foreach (var bottom in new[] { 180d, 300d, 520d })
        {
            var geometry = CandleBattleChartModelBuilder.CreateGeometry(candle, domain, 50d, 8d, 10d, bottom);
            Assert.InRange(geometry.HighY, 10d, bottom);
            Assert.InRange(geometry.LowY, 10d, bottom);
            Assert.InRange(geometry.BodyY, 10d, bottom);
            Assert.InRange(geometry.BodyY + geometry.BodyHeight, 10d, bottom);
        }
    }

    [Fact]
    public void WinnerEpsilon_BelowEpsilon_IsTie()
    {
        // PercentChange formula: ((close - open) / |open|) * 100
        // leftDelta =  ((1000.000005 - 1000) / 1000) * 100 = 0.0000005%
        // rightDelta = 0
        // difference = 0.0000005 < 0.000001 (epsilon) → Tie
        var result = CandleBattleChartModelBuilder.Build(
            [P(100, 1000m), P(200, 1000.000005m)],
            [P(100, 1000m), P(200, 1000m)]);

        Assert.Single(result.Buckets);
        Assert.Equal(CandleBattleChartWinner.Tie, result.Buckets[0].Winner);
    }

    [Fact]
    public void WinnerEpsilon_EqualToEpsilon_IsTie()
    {
        // leftDelta = ((1000.00001 - 1000) / 1000) * 100 = 0.000001%
        // difference = 0.000001 == 0.000001 (epsilon) → Tie (uses <=)
        var result = CandleBattleChartModelBuilder.Build(
            [P(100, 1000m), P(200, 1000.00001m)],
            [P(100, 1000m), P(200, 1000m)]);

        Assert.Single(result.Buckets);
        Assert.Equal(CandleBattleChartWinner.Tie, result.Buckets[0].Winner);
    }

    [Fact]
    public void WinnerEpsilon_AboveEpsilon_ProducesWinner()
    {
        // leftDelta = ((1000.00002 - 1000) / 1000) * 100 = 0.000002%
        // difference = 0.000002 > 0.000001 (epsilon) → Left wins
        var result = CandleBattleChartModelBuilder.Build(
            [P(100, 1000m), P(200, 1000.00002m)],
            [P(100, 1000m), P(200, 1000m)]);

        Assert.Single(result.Buckets);
        Assert.Equal(CandleBattleChartWinner.Left, result.Buckets[0].Winner);
    }

    [Fact]
    public void OfficialScore_IndependentFromChartBuckets()
    {
        var leftPoints = new[] { P(100, 100m), P(200, 105m), P(300, 110m) };
        var rightPoints = new[] { P(100, 200m), P(200, 195m), P(300, 190m) };

        var model = CandleBattleChartModelBuilder.Build(leftPoints, rightPoints);

        var leftWinsFromChart = model.Buckets.Count(b => b.Winner == CandleBattleChartWinner.Left);
        var rightWinsFromChart = model.Buckets.Count(b => b.Winner == CandleBattleChartWinner.Right);

        Assert.Equal(2, leftWinsFromChart);
        Assert.Equal(0, rightWinsFromChart);

        const int officialScoreA = 5;
        const int officialScoreB = 7;

        Assert.NotEqual(officialScoreA, leftWinsFromChart);
        Assert.NotEqual(officialScoreB, rightWinsFromChart);
    }

    [Fact]
    public void Geometry_ScaledPlotHeight_MaintainsNormalizedPosition()
    {
        // Regression: candles must fill vertical area proportionally regardless of LogicalHeight.
        // Before fix, chartBottom was fixed at 292 and viewBox grew, leaving empty space.
        var candle = N(1.02m, 1.05m, 0.98m, 1.04m);
        var domain = new CandleBattleChartDomain(0.95m, 1.08m, 0.98m, 1.05m);
        const double plotTop = 14d;
        const double smallBottom = 292d;
        const double largeBottom = 600d;

        var small = CandleBattleChartModelBuilder.CreateGeometry(candle, domain, 50d, 8d, plotTop, smallBottom);
        var large = CandleBattleChartModelBuilder.CreateGeometry(candle, domain, 50d, 8d, plotTop, largeBottom);

        // Normalized position inside plot must be identical: (y - top)/(bottom - top)
        var smallPlotH = smallBottom - plotTop;
        var largePlotH = largeBottom - plotTop;

        Assert.Equal((small.BodyY - plotTop) / smallPlotH, (large.BodyY - plotTop) / largePlotH, 5);
        Assert.Equal(small.BodyHeight / smallPlotH, large.BodyHeight / largePlotH, 5);
        Assert.Equal((small.HighY - plotTop) / smallPlotH, (large.HighY - plotTop) / largePlotH, 5);
        Assert.Equal((small.LowY - plotTop) / smallPlotH, (large.LowY - plotTop) / largePlotH, 5);

        // Also verify absolute Y scales with plot height (larger plot => larger absolute positions)
        Assert.True(large.BodyY > small.BodyY);
        Assert.True(large.BodyHeight > small.BodyHeight);
    }

    private static TvPriceChartPoint P(long time, decimal value) => new(time, value);

    private static CandleBattleNormalizedOhlc N(decimal open, decimal high, decimal low, decimal close)
        => new(1, 2, open, high, low, close);
}
