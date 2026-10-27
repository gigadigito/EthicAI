namespace CriptoVersus.API.Services;

/// <summary>
/// Metricas observadas de uma Candle Battle em andamento, derivadas apenas de dados persistidos
/// (rounds arcade confirmados) e de metadados reais da partida. Campos nulos indicam ausencia de
/// dados confiaveis; nesse caso o peso do criterio e redistribuido entre os criterios disponiveis.
/// </summary>
public readonly record struct CandleBattleLiveMetrics(
    int ScoreA,
    int ScoreB,
    int ConfirmedRounds,
    decimal? RecentMovementPercent,
    int? LeadAlternations,
    decimal? RecentActivityRatio,
    int RemainingSeconds,
    bool PopularAssetA,
    bool PopularAssetB);

public sealed record CandleBattleBroadcastInterestResult(
    int Score,
    IReadOnlyList<string> Reasons,
    IReadOnlyList<string> AvailableCriteria,
    IReadOnlyList<string> MissingCriteria);

/// <summary>
/// Pontuacao de interesse (0..100) para escolha de uma Candle Battle LIVE.
/// Calculo puro e deterministico: mesmas entradas produzem sempre o mesmo resultado.
/// Os pesos vem de <see cref="CandleBattleBroadcastOptions"/> e criterios sem dados reais
/// tem o peso redistribuido, sem fabricar valores.
/// </summary>
public static class CandleBattleBroadcastInterest
{
    public const string CriterionBalance = "balance";
    public const string CriterionVolatility = "volatility";
    public const string CriterionLeadAlternations = "lead_alternations";
    public const string CriterionActivity = "activity";
    public const string CriterionRemainingTime = "remaining_time";
    public const string CriterionAssetRecognition = "asset_recognition";

    public const string ReasonBalancedScore = "balanced_score";
    public const string ReasonHighVolatility = "high_volatility";
    public const string ReasonLeadAlternations = "lead_alternations";
    public const string ReasonRecentActivity = "recent_activity";
    public const string ReasonLongRemaining = "long_remaining";
    public const string ReasonPopularAssets = "popular_assets";

    public static CandleBattleBroadcastInterestResult Calculate(in CandleBattleLiveMetrics metrics,
        CandleBattleBroadcastOptions options)
    {
        var decided = metrics.ScoreA + metrics.ScoreB;
        decimal? balance = decided <= 0
            ? null
            : 1m - (decimal)Math.Abs(metrics.ScoreA - metrics.ScoreB) / decided;
        var volatility = metrics.RecentMovementPercent is { } movement
            ? Math.Min(1m, movement / Math.Max(.01m, options.SignificantCandleMovementPercent))
            : (decimal?)null;
        var alternations = metrics.LeadAlternations is { } flips
            ? Math.Min(1m, (decimal)flips / Math.Max(1, options.MaxExpectedLeadAlternations))
            : (decimal?)null;
        var activity = metrics.RecentActivityRatio is { } ratio
            ? Math.Clamp(ratio, 0m, 1m)
            : (decimal?)null;
        var remaining = Math.Min(1m,
            (decimal)metrics.RemainingSeconds / Math.Max(60, options.ComfortableRemainingSeconds));
        var popularity = (metrics.PopularAssetA ? .5m : 0m) + (metrics.PopularAssetB ? .5m : 0m);

        var parts = new List<(string Criterion, decimal? Value, int Weight)>
        {
            (CriterionBalance, balance, options.WeightBalance),
            (CriterionVolatility, volatility, options.WeightVolatility),
            (CriterionLeadAlternations, alternations, options.WeightLeadAlternations),
            (CriterionActivity, activity, options.WeightActivity),
            (CriterionRemainingTime, remaining, options.WeightRemainingTime),
            (CriterionAssetRecognition, popularity, options.WeightAssetRecognition)
        };

        var available = new List<string>();
        var missing = new List<string>();
        var weighted = 0m;
        var totalWeight = 0;
        foreach (var part in parts)
        {
            if (part.Value is not { } value)
            {
                missing.Add(part.Criterion);
                continue;
            }

            available.Add(part.Criterion);
            weighted += value * part.Weight;
            totalWeight += part.Weight;
        }

        var score = totalWeight <= 0
            ? 0
            : (int)Math.Clamp(Math.Round(weighted / totalWeight * 100m, MidpointRounding.AwayFromZero), 0m, 100m);

        var reasons = new List<string>();
        if (balance >= .75m) reasons.Add(ReasonBalancedScore);
        if (metrics.RecentMovementPercent >= options.SignificantCandleMovementPercent) reasons.Add(ReasonHighVolatility);
        if (metrics.LeadAlternations >= 1) reasons.Add(ReasonLeadAlternations);
        if (activity >= .5m) reasons.Add(ReasonRecentActivity);
        if (metrics.RemainingSeconds >= options.ComfortableRemainingSeconds) reasons.Add(ReasonLongRemaining);
        if (metrics.PopularAssetA || metrics.PopularAssetB) reasons.Add(ReasonPopularAssets);

        return new CandleBattleBroadcastInterestResult(score, reasons, available, missing);
    }
}
