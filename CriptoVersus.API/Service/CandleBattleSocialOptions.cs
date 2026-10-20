namespace CriptoVersus.API.Services;

public sealed class CandleBattleSocialOptions
{
    public const string SectionName = "CandleBattleSocial";
    public bool Enabled { get; set; } = true;
    public int DefaultLookbackHours { get; set; } = 6;
    public int MaxLookbackHours { get; set; } = 48;
    public int MaxCandidates { get; set; } = 25;
    public int MaxSamePairCandidates { get; set; } = 1;
    public string Platform { get; set; } = "binance_square";
    public int ReservationLeaseSeconds { get; set; } = 900;
    public string? PublicBaseUrl { get; set; }
    public int WeightComeback { get; set; } = 25;
    public int WeightBalance { get; set; } = 25;
    public int WeightDecisiveWin { get; set; } = 20;
    public int WeightPerformanceSpread { get; set; } = 15;
    public int WeightCandleMovement { get; set; } = 15;
    public decimal SignificantPerformanceSpreadPercent { get; set; } = 5m;
    public decimal SignificantCandleMovementPercent { get; set; } = 3m;
}
