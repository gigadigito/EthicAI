using DTOs;

namespace BLL.NFTFutebol;

public static class CandleBattlesResolver
{
    public const string Version = "strength-v1-b45-v25-r20-m10-h20";
    public const int HistoryLength = 20;
    public const long PeriodMs = 300_000;
    public static decimal Strength(CandleBattlesCandleDto candle, IReadOnlyList<CandleBattlesCandleDto> history)
        => CalculateStrength(candle, history, requireConfirmation: true);

    public static decimal PreviewStrength(CandleBattlesCandleDto candle, IReadOnlyList<CandleBattlesCandleDto> history)
        => CalculateStrength(candle, history, requireConfirmation: false);

    private static decimal CalculateStrength(CandleBattlesCandleDto candle, IReadOnlyList<CandleBattlesCandleDto> history, bool requireConfirmation)
    {
        if (!IsValid(candle) || (requireConfirmation && !candle.Confirmed) || history.Count != HistoryLength)
            throw new ArgumentException("A valid candle and twenty comparable prior candles are required.");
        for (var i = 0; i < history.Count; i++)
            if (!IsValid(history[i]) || !history[i].Confirmed || history[i].Symbol != candle.Symbol
                || history[i].OpenTime != candle.OpenTime - (HistoryLength - i) * PeriodMs)
                throw new ArgumentException("History must be complete, confirmed and contiguous.");
        decimal averageVolume = 0;
        for (var i = 0; i < history.Count; i++) averageVolume += (history[i].Volume!.Value - averageVolume) / (i + 1);
        var body = NormalizeRatio(Math.Abs(candle.Close - candle.Open), candle.Open, .02m);
        var amplitude = NormalizeRatio(candle.High - candle.Low, candle.Open, .04m);
        var volume = averageVolume > 0 ? NormalizeRatio(candle.Volume!.Value, averageVolume, 3m) : 0m;
        var momentum = NormalizeRatio(Math.Abs(candle.Close - history[^3].Close), history[^3].Close, .03m);
        return decimal.Round(body * .45m + volume * .25m + amplitude * .20m + momentum * .10m, 10);
    }
    private static decimal NormalizeRatio(decimal numerator, decimal denominator, decimal ceiling)
    {
        if (numerator <= 0m || denominator <= 0m) return 0m;
        // Saturate before division/multiplication so extreme valid decimal prices cannot overflow.
        if (ceiling < 1m)
        {
            var threshold = denominator * ceiling;
            return numerator >= threshold ? 100m : numerator / threshold * 100m;
        }
        return numerator / ceiling >= denominator ? 100m : numerator / denominator / ceiling * 100m;
    }
    public static bool IsValid(CandleBattlesCandleDto c) => c.OpenTime % PeriodMs == 0 && c.CloseTime == c.OpenTime + PeriodMs
        && c.UpdatedAt >= c.OpenTime && (!c.Confirmed || c.UpdatedAt >= c.CloseTime)
        && c.Open > 0 && c.Low > 0 && c.High >= Math.Max(c.Open, c.Close) && c.Low <= Math.Min(c.Open, c.Close) && c.Volume >= 0;
    public static CandleBattlesRoundDto Resolve(int matchId, CandleBattlesCandleDto left, CandleBattlesCandleDto right,
        IReadOnlyList<CandleBattlesCandleDto> leftHistory, IReadOnlyList<CandleBattlesCandleDto> rightHistory)
    {
        if (left.OpenTime != right.OpenTime || left.CloseTime != right.CloseTime)
            throw new ArgumentException("Both candles must share the same UTC interval.");
        var a = Strength(left, leftHistory);
        var b = Strength(right, rightHistory);
        return new($"{matchId}:5m:{left.OpenTime}", matchId, left, right,
            Math.Abs(a - b) <= .000001m ? "draw" : a > b ? "left" : "right", Version, a, b);
    }
}
