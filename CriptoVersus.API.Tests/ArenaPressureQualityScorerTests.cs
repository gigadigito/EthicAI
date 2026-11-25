using CriptoVersus.API.Services;
using Microsoft.Extensions.Options;

namespace CriptoVersus.API.Tests;

public sealed class ArenaPressureQualityScorerTests
{
    private static readonly DateTime Start = new(2026, 11, 24, 12, 0, 0, DateTimeKind.Utc);

    [Fact]
    public void BrasiliaDay_UsesLocalCalendarBoundariesConvertedToUtc()
    {
        var (start, end) = ArenaPressureRankingService.BrasiliaDay(new DateTimeOffset(2026, 11, 24, 2, 30, 0, TimeSpan.Zero));
        Assert.Equal(new DateTime(2026, 11, 23, 3, 0, 0, DateTimeKind.Utc), start);
        Assert.Equal(new DateTime(2026, 11, 24, 3, 0, 0, DateTimeKind.Utc), end);
    }

    [Fact]
    public void StablePressure_HasNoMovementOrReversalScore()
    {
        var result = Score([45, 45, 45, 45, 45]);
        Assert.Equal(0, result.ScoreBreakdown.PressureMovement);
        Assert.Equal(0, result.ScoreBreakdown.PressureReversals);
        Assert.Equal(0, result.Metrics.LeadChanges);
    }

    [Fact]
    public void SmallNoiseAroundFifty_DoesNotCreateReversals()
    {
        var result = Score([49, 51, 49, 51, 50, 49]);
        Assert.Equal(0, result.Metrics.LeadChanges);
        Assert.Equal(0, result.ScoreBreakdown.PressureReversals);
    }

    [Fact]
    public void SustainedReversal_IsDetectedAndOutscoresStablePressure()
    {
        var reversed = Score([64, 63, 58, 51, 43, 39, 38]);
        var stable = Score([64, 64, 64, 64, 64, 64, 64]);
        Assert.Equal(1, reversed.Metrics.LeadChanges);
        Assert.True(reversed.ScoreBreakdown.PressureReversals > 0);
        Assert.True(reversed.QualityScore > stable.QualityScore);
    }

    [Fact]
    public void MultipleRealReversals_AreCountedAfterHysteresis()
    {
        var result = Score([62, 61, 42, 41, 59, 60, 40, 39]);
        Assert.Equal(3, result.Metrics.LeadChanges);
    }

    [Fact]
    public void RecoveryWithoutFinalVictory_EarnsMovementButNoFinalReversal()
    {
        var result = Score([35, 36, 48, 51, 53, 47, 44, 43]);
        Assert.True(result.ScoreBreakdown.PressureMovement > 0);
        Assert.Equal(0, result.Metrics.LeadChanges);
    }

    [Theory]
    [InlineData(3, 30)]
    [InlineData(8, 24.6)]
    [InlineData(15, 17.4)]
    [InlineData(40, 9)]
    public void TopGainerBands_AwardConfiguredRankBonus(int rank, decimal expected)
    {
        var gainers = new Dictionary<string, TopGainerEntry>(StringComparer.OrdinalIgnoreCase)
        {
            ["BTCUSDT"] = new("BTCUSDT", rank, 12.5m)
        };
        var result = Score([50, 50, 50, 50], gainers, marketAvailable: true);
        Assert.Equal(expected, result.ScoreBreakdown.TopGainers);
    }

    [Fact]
    public void DistinctBinanceSymbols_MatchOnlyExactNormalizedPair()
    {
        var gainers = new Dictionary<string, TopGainerEntry>(StringComparer.OrdinalIgnoreCase)
        {
            ["PAXGUSDT"] = new("PAXGUSDT", 2, 8m),
            ["ANTBUSDT"] = new("ANTBUSDT", 9, 7m)
        };
        var result = Score([50, 50, 50, 50], gainers, true, "PAXGUSDT", "ANTBUSDT");
        Assert.Equal(2, result.TopGainersMatches.Count);
        Assert.DoesNotContain(result.TopGainersMatches, x => x.Symbol == "OIL");
    }

    [Fact]
    public void BinanceFailure_NormalizesPartialScoreAndExplainsIt()
    {
        var result = Score([62, 61, 42, 41], marketAvailable: false);
        Assert.Equal(0, result.ScoreBreakdown.TopGainers);
        Assert.Contains(result.Reasons, x => x.Contains("unavailable", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public void InsufficientHistory_IsNotVideoEligible()
    {
        var result = Score([50, 55, 60]);
        Assert.False(result.VideoEligible);
    }

    [Fact]
    public void Score_IsBoundedAndDeterministic()
    {
        var samples = new[] { 65m, 60m, 40m, 35m, 58m, 62m };
        var first = Score(samples);
        var second = Score(samples);
        Assert.Equal(first.QualityScore, second.QualityScore);
        Assert.InRange(first.QualityScore, 0m, 100m);
    }

    private static DTOs.ArenaPressureRankedMatchDto Score(
        IEnumerable<decimal> values,
        IReadOnlyDictionary<string, TopGainerEntry>? gainers = null,
        bool marketAvailable = true,
        string left = "BTCUSDT",
        string right = "ETHUSDT")
    {
        var scorer = new ArenaPressureQualityScorer(Options.Create(new ArenaPressureRankingOptions()));
        var samples = values.Select((value, index) => new PressureSample(Start.AddMinutes(index), value)).ToArray();
        return scorer.Score(1, Start.AddHours(1), left, right, samples,
            gainers ?? new Dictionary<string, TopGainerEntry>(), marketAvailable);
    }
}
