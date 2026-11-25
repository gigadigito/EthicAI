using DTOs;
using Microsoft.Extensions.Options;

namespace CriptoVersus.API.Services;

public readonly record struct PressureSample(DateTime AtUtc, decimal LeftPercent);

public sealed record TopGainerEntry(string Symbol, int Rank, decimal PriceChangePercent24h);

public sealed class ArenaPressureQualityScorer(IOptions<ArenaPressureRankingOptions> configured)
{
    private readonly ArenaPressureRankingOptions _options = configured.Value;

    public ArenaPressureRankedMatchDto Score(
        int matchId, DateTime endTimeUtc, string leftSymbol, string rightSymbol,
        IReadOnlyList<PressureSample> samples, IReadOnlyDictionary<string, TopGainerEntry> gainers,
        bool marketAvailable)
    {
        var ordered = samples.OrderBy(x => x.AtUtc).ToArray();
        var metrics = Analyze(ordered);
        var movement01 = Math.Clamp(
            (metrics.MaxPressureSwing / 30m * .45m) +
            (Math.Min(metrics.TotalVariation, 80m) / 80m * .35m) +
            (Math.Min(metrics.SignificantMovementCount, 8) / 8m * .20m) -
            (metrics.StaleRatio * .25m), 0m, 1m);

        var reversals01 = Math.Clamp(
            (Math.Min(metrics.LeadChanges, 3) / 3m * .55m) +
            (metrics.FinalReversal ? .30m : 0m) +
            (metrics.LateReversal ? .15m : 0m), 0m, 1m);

        var matched = new[] { NormalizeSymbol(leftSymbol), NormalizeSymbol(rightSymbol) }
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Where(gainers.ContainsKey)
            .Select(x => gainers[x])
            .OrderBy(x => x.Rank)
            .ToArray();
        var gainers01 = matched.Length == 0 ? 0m : matched.Max(x => RankScore(x.Rank));

        var movement = Round(movement01 * _options.MovementWeight);
        var reversals = Round(reversals01 * _options.ReversalWeight);
        var top = marketAvailable ? Round(gainers01 * _options.TopGainersWeight) : 0m;
        var availableWeight = _options.MovementWeight + _options.ReversalWeight + (marketAvailable ? _options.TopGainersWeight : 0);
        var score = availableWeight == 0 ? 0m : Round((movement + reversals + top) * 100m / availableWeight);

        var reasons = new List<string>();
        if (metrics.LeadChanges > 0) reasons.Add($"{metrics.LeadChanges} sustained pressure reversal(s)");
        if (metrics.FinalReversal) reasons.Add("The initial trailing side held the lead at the finish");
        if (movement01 >= .55m) reasons.Add("Expressive pressure movement across the match");
        foreach (var item in matched) reasons.Add($"{item.Symbol} is Top {item.Rank} in the current Binance 24h snapshot");
        if (!marketAvailable) reasons.Add("Binance Top Gainers unavailable; score normalized over pressure criteria only");

        return new ArenaPressureRankedMatchDto
        {
            MatchId = matchId,
            Status = "Completed",
            EndTimeUtc = endTimeUtc,
            LeftSymbol = leftSymbol,
            RightSymbol = rightSymbol,
            HistoricalDurationSeconds = ordered.Length < 2 ? 0 : (ordered[^1].AtUtc - ordered[0].AtUtc).TotalSeconds,
            QualityScore = score,
            ScoreBreakdown = new() { PressureMovement = movement, PressureReversals = reversals, TopGainers = top },
            Metrics = new()
            {
                LeadChanges = metrics.LeadChanges,
                SignificantMovementCount = metrics.SignificantMovementCount,
                MaxPressureSwing = Round(metrics.MaxPressureSwing),
                TotalVariation = Round(metrics.TotalVariation),
                StaleRatio = Round(metrics.StaleRatio)
            },
            TopGainersMatches = matched.Select(x => new TopGainerMatchDto { Symbol = x.Symbol, Rank = x.Rank, PriceChangePercent24h = x.PriceChangePercent24h }).ToList(),
            Reasons = reasons,
            VideoEligible = ordered.Length >= _options.MinimumHistorySamples
        };
    }

    private Analysis Analyze(IReadOnlyList<PressureSample> samples)
    {
        if (samples.Count == 0) return new();
        var min = samples.Min(x => x.LeftPercent);
        var max = samples.Max(x => x.LeftPercent);
        decimal variation = 0, stale = 0;
        var significant = 0;
        for (var i = 1; i < samples.Count; i++)
        {
            var delta = Math.Abs(samples[i].LeftPercent - samples[i - 1].LeftPercent);
            if (delta >= _options.NoiseFloor) variation += delta;
            if (delta >= _options.SignificantMovementThreshold) significant++;
            if (delta < _options.NoiseFloor) stale++;
        }

        var states = samples.Select(x => x.LeftPercent >= 50m + _options.LeadershipMargin ? 1 : x.LeftPercent <= 50m - _options.LeadershipMargin ? -1 : 0).ToArray();
        var sustained = new List<(int State, int Index)>();
        for (var i = 0; i < states.Length;)
        {
            var j = i + 1;
            while (j < states.Length && states[j] == states[i]) j++;
            if (states[i] != 0 && j - i >= _options.MinimumSustainedSamples) sustained.Add((states[i], i));
            i = j;
        }
        var changes = 0;
        for (var i = 1; i < sustained.Count; i++) if (sustained[i].State != sustained[i - 1].State) changes++;
        var finalReversal = sustained.Count >= 2 && sustained[0].State != sustained[^1].State;
        var late = finalReversal && sustained[^1].Index >= samples.Count * .7;
        return new(max - min, variation, significant, changes, samples.Count <= 1 ? 1 : stale / (samples.Count - 1), finalReversal, late);
    }

    public static string NormalizeSymbol(string symbol) => (symbol ?? string.Empty).Trim().ToUpperInvariant();
    private static decimal RankScore(int rank) => rank switch { <= 5 => 1m, <= 10 => .82m, <= 20 => .58m, <= 50 => .30m, _ => 0m };
    private static decimal Round(decimal value) => Math.Round(value, 2, MidpointRounding.AwayFromZero);
    private sealed record Analysis(decimal MaxPressureSwing = 0, decimal TotalVariation = 0, int SignificantMovementCount = 0, int LeadChanges = 0, decimal StaleRatio = 1, bool FinalReversal = false, bool LateReversal = false);
}
