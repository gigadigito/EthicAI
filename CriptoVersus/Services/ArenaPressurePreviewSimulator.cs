namespace CriptoVersus.Web.Services;

/// <summary>Local, deterministic input stream for the production Arena Pressure renderer.</summary>
public sealed class ArenaPressurePreviewSimulator
{
    public DateTimeOffset NowUtc { get; private set; } = new(2026, 11, 20, 12, 0, 0, TimeSpan.Zero);
    public DateTimeOffset StartUtc { get; private set; } = new(2026, 11, 20, 12, 0, 0, TimeSpan.Zero);
    public int DurationMinutes { get; private set; } = 90;
    public string MatchStatus { get; private set; } = "Ongoing";
    public DateTimeOffset? EndUtc { get; private set; }
    public int? WinnerSide { get; private set; }
    public int ScoreA { get; private set; }
    public int ScoreB { get; private set; }
    public void SetDuration(int minutes) => DurationMinutes = Math.Clamp(minutes, 1, 1440);
    public void Advance(TimeSpan amount) { if (amount > TimeSpan.Zero) NowUtc += amount; }
    public void Start() { MatchStatus = "Ongoing"; StartUtc = NowUtc; EndUtc = null; WinnerSide = null; }
    public void Finish(int? winnerSide)
    {
        MatchStatus = "Completed"; EndUtc = NowUtc; WinnerSide = winnerSide;
        ScoreA = winnerSide == 0 ? 1 : 0; ScoreB = winnerSide == 1 ? 1 : 0;
    }
    public void Cancel() { MatchStatus = "Cancelled"; EndUtc = NowUtc; WinnerSide = null; }
    public void Pending() { MatchStatus = "Pending"; StartUtc = NowUtc.AddMinutes(1); EndUtc = null; WinnerSide = null; }
    public void ResetLifecycle() { NowUtc = new DateTimeOffset(2026, 11, 20, 12, 0, 0, TimeSpan.Zero); StartUtc = NowUtc; DurationMinutes = 90; MatchStatus = "Ongoing"; EndUtc = null; WinnerSide = null; ScoreA = ScoreB = 0; }
    public const int TickMilliseconds = 250;
    private uint _random;
    public int Seed { get; private set; } = 20261120;
    public int Tick { get; private set; }
    public int Buy { get; private set; } = 50;
    public int Sell { get; private set; } = 50;
    public int Intensity { get; set; } = 50;
    public int Volatility { get; set; } = 50;
    public string Scenario { get; private set; } = "Equilibrado";
    public int LeftPercent => Buy + Sell == 0 ? 50 : Math.Clamp((int)Math.Round(100d * Buy / (Buy + Sell)), 0, 100);
    public int RightPercent => 100 - LeftPercent;

    public ArenaPressurePreviewSimulator() => Reset(Seed, Scenario);

    public void Reset(int seed, string scenario)
    {
        Seed = seed;
        _random = unchecked((uint)seed) ^ 0x9e3779b9u;
        Tick = 0;
        Scenario = scenario;
        Buy = scenario is "BUY dominante" or "Reversão BUY → SELL" ? 80 : scenario is "SELL dominante" or "Reversão SELL → BUY" ? 20 : 50;
        Sell = 100 - Buy;
    }

    public void SetPressure(int buy, int sell)
    {
        Buy = Math.Clamp(buy, 0, 100);
        Sell = Math.Clamp(sell, 0, 100);
    }

    public void Order(bool buy, int quantity = 12)
    {
        SetPressure(Buy + (buy ? quantity : -quantity), Sell + (buy ? -quantity : quantity));
    }

    public void TickOnce()
    {
        Tick++;
        var random = NextRandom();
        var amplitude = Math.Max(1, Intensity * Volatility / 300);
        var noise = (int)Math.Round((random * 2 - 1) * amplitude);
        var target = Scenario switch
        {
            "BUY dominante" => 82,
            "SELL dominante" => 18,
            "Alta volatilidade" => Tick % 12 < 6 ? 85 : 15,
            "Baixa atividade" => 50,
            "Reversão BUY → SELL" => Math.Max(12, 82 - Tick * 2),
            "Reversão SELL → BUY" => Math.Min(88, 18 + Tick * 2),
            "Extremos" => Tick % 16 < 8 ? 100 : 0,
            _ => 50
        };
        var step = Scenario == "Baixa atividade" ? (Tick % 4 == 0 ? 1 : 0) : Math.Max(1, Intensity / 12);
        var next = Buy + Math.Clamp(target - Buy, -step, step) + noise;
        SetPressure(next, 100 - next);
    }

    private double NextRandom()
    {
        _random ^= _random << 13;
        _random ^= _random >> 17;
        _random ^= _random << 5;
        return _random / (double)uint.MaxValue;
    }
}
