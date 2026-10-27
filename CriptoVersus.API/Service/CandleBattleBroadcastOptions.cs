namespace CriptoVersus.API.Services;

/// <summary>
/// Configuracao do diretor automatico de transmissao das Candle Battles na TV.
/// Valores fora de faixa sao normalizados por <see cref="Normalize"/> para limites seguros.
/// Nao contem segredos: a stream key do transmissor nunca pertence a esta configuracao.
/// </summary>
public sealed class CandleBattleBroadcastOptions
{
    public const string SectionName = "CandleBattleBroadcast";

    public bool Enabled { get; set; } = true;
    public bool PreferLive { get; set; } = true;
    public bool AllowReplayFallback { get; set; } = true;
    public bool AllowLiveInterruptReplay { get; set; } = true;
    public int MinimumLiveRemainingSeconds { get; set; } = 600;
    public int FinalResultDisplaySeconds { get; set; } = 10;
    public int SelectionCacheSeconds { get; set; } = 15;
    public int StatusPollingSeconds { get; set; } = 10;
    public int ReplayHistorySize { get; set; } = 20;
    public int ReplayDisplaySeconds { get; set; } = 240;
    public int ReplayMinimumDisplaySeconds { get; set; } = 120;
    public int ReplayLookbackHours { get; set; } = 24;
    public int MaxReplayCandidates { get; set; } = 25;
    public int MatchDurationMinutes { get; set; } = 90;
    public string? PublicBaseUrl { get; set; }
    public string PlaybackCulture { get; set; } = "pt";

    public int WeightBalance { get; set; } = 25;
    public int WeightVolatility { get; set; } = 20;
    public int WeightLeadAlternations { get; set; } = 20;
    public int WeightActivity { get; set; } = 15;
    public int WeightRemainingTime { get; set; } = 10;
    public int WeightAssetRecognition { get; set; } = 10;
    public decimal SignificantCandleMovementPercent { get; set; } = 3m;
    public int ComfortableRemainingSeconds { get; set; } = 1800;
    public int MaxExpectedLeadAlternations { get; set; } = 3;
    public int ActivityWindowMinutes { get; set; } = 20;
    public int RecentVolatilityRounds { get; set; } = 6;

    /// <summary>Limita os valores configurados a faixas seguras e deterministicas.</summary>
    public void Normalize()
    {
        MinimumLiveRemainingSeconds = Math.Clamp(MinimumLiveRemainingSeconds, 0, 86_400);
        FinalResultDisplaySeconds = Math.Clamp(FinalResultDisplaySeconds, 0, 300);
        SelectionCacheSeconds = Math.Clamp(SelectionCacheSeconds, 0, 600);
        StatusPollingSeconds = Math.Clamp(StatusPollingSeconds, 1, 300);
        ReplayHistorySize = Math.Clamp(ReplayHistorySize, 0, 200);
        ReplayDisplaySeconds = Math.Clamp(ReplayDisplaySeconds, 30, 7_200);
        ReplayMinimumDisplaySeconds = Math.Clamp(ReplayMinimumDisplaySeconds, 0, ReplayDisplaySeconds);
        ReplayLookbackHours = Math.Clamp(ReplayLookbackHours, 1, 24 * 30);
        MaxReplayCandidates = Math.Clamp(MaxReplayCandidates, 1, 200);
        MatchDurationMinutes = Math.Clamp(MatchDurationMinutes, 1, 24 * 60);
        WeightBalance = Math.Clamp(WeightBalance, 0, 1_000);
        WeightVolatility = Math.Clamp(WeightVolatility, 0, 1_000);
        WeightLeadAlternations = Math.Clamp(WeightLeadAlternations, 0, 1_000);
        WeightActivity = Math.Clamp(WeightActivity, 0, 1_000);
        WeightRemainingTime = Math.Clamp(WeightRemainingTime, 0, 1_000);
        WeightAssetRecognition = Math.Clamp(WeightAssetRecognition, 0, 1_000);
        SignificantCandleMovementPercent = Math.Clamp(SignificantCandleMovementPercent, .01m, 100m);
        ComfortableRemainingSeconds = Math.Clamp(ComfortableRemainingSeconds, 60, 86_400);
        MaxExpectedLeadAlternations = Math.Clamp(MaxExpectedLeadAlternations, 1, 50);
        ActivityWindowMinutes = Math.Clamp(ActivityWindowMinutes, 5, 240);
        RecentVolatilityRounds = Math.Clamp(RecentVolatilityRounds, 1, 100);
        PlaybackCulture = string.IsNullOrWhiteSpace(PlaybackCulture) ? "pt" : PlaybackCulture.Trim();
    }
}
