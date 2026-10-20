namespace CriptoVersus.API.Services;

/// <summary>
/// Configuracao da funcionalidade social Price Crossover Highlights.
/// Pesos do indice de interesse somam 100 e permanecem em 30/25/20/15/10 por padrao.
/// </summary>
public sealed class PriceCrossoverOptions
{
    public const string SectionName = "PriceCrossover";

    public bool Enabled { get; set; } = true;

    public int DefaultLookbackHours { get; set; } = 6;
    public int MinLookbackHours { get; set; } = 1;
    public int MaxLookbackHours { get; set; } = 48;

    /// <summary>Limite de partidas analisadas em detalhe por consulta, para evitar trabalho excessivo.</summary>
    public int MaxCandidates { get; set; } = 25;

    /// <summary>Limite de pontos retornados na serie historica.</summary>
    public int MaxSeriesPoints { get; set; } = 360;

    /// <summary>Limite de caracteres do <c>suggestedPostText</c>.</summary>
    public int NarrativeMaxCharacters { get; set; } = 280;

    /// <summary>Plataforma usada no controle de publicacao desta categoria.</summary>
    public string Platform { get; set; } = "binance_square";

    /// <summary>Duracao padrao do lease de reserva, em segundos.</summary>
    public int ReservationLeaseSeconds { get; set; } = 900;

    /// <summary>
    /// Origem publica usada em <c>publicUrl</c> da pagina de captura social.
    /// Opcional: quando vazio, a API resolve <c>CriptoVersus:PublicBaseUrl</c> e
    /// <c>SocialAutomation:PublicBaseUrl</c>, nesta ordem, e por fim
    /// <see cref="PriceCrossoverSocialPublicUrl.DefaultPublicBaseUrl"/>.
    /// Precisa ser uma URL absoluta http(s); valor invalido mantem
    /// <c>publicUrlAvailable=false</c> em vez de inventar uma origem.
    /// </summary>
    public string? PublicBaseUrl { get; set; }

    // ---- Regras de analise (espelham o Price Battle da tela de Match) ----

    /// <summary>Swing minimo, em pontos percentuais, para um cruzamento ser considerado relevante.</summary>
    public decimal RelevantSwingPercent { get; set; } = 1.0m;

    /// <summary>Limiar de vantagem relativa, em pontos percentuais, considerado disputa equilibrada.</summary>
    public decimal BalancedGapPercent { get; set; } = 2.0m;

    public int MinCompletePairs { get; set; } = 10;

    public int ScreenWindowRows { get; set; } = 500;

    public int IntensitySampleSeconds { get; set; } = 60;

    // ---- Pesos do indice de interesse ----

    public int WeightCrossoversAndComeback { get; set; } = DTOs.PriceCrossoverDefaultWeights.CrossoversAndComeback;
    public int WeightCompetitiveness { get; set; } = DTOs.PriceCrossoverDefaultWeights.Competitiveness;
    public int WeightPerformanceSpread { get; set; } = DTOs.PriceCrossoverDefaultWeights.PerformanceSpread;
    public int WeightMovementIntensity { get; set; } = DTOs.PriceCrossoverDefaultWeights.MovementIntensity;
    public int WeightRemarkableEvents { get; set; } = DTOs.PriceCrossoverDefaultWeights.RemarkableEvents;

    public decimal IdealPerformanceGapPercent { get; set; } = 12m;
    public decimal MaxRelevantCrossoversPerHour { get; set; } = 4m;
    public decimal MaxMovementIntensityPercentPerHour { get; set; } = 20m;
    public decimal MaxRelativeVolatilityPercent { get; set; } = 4m;
    public decimal MaxOfficialEventsPerHour { get; set; } = 5m;
    public decimal MinSamplingRatio { get; set; } = 0.6m;
    public decimal MaxSamplingRatio { get; set; } = 1.67m;
}
