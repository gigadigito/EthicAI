namespace DTOs;

/// <summary>
/// Contrato da funcionalidade social "Price Crossover Highlights".
///
/// IMPORTANTE sobre a origem dos dados:
/// - Blocos <see cref="PriceCrossoverSocialResponse.PriceCrossover"/>, <see cref="PriceCrossoverAssetStats.Crossovers"/>
///   e toda a <see cref="PriceCrossoverSocialResponse.Series"/> sao RECONSTRUIDOS pela API a partir de
///   <c>MatchMetricSnapshot.LastPrice</c>, com normalizacao por baseline fixo e pareamento por timestamp.
///   Sao a fonte para analise comparativa e para o futuro grafico social.
/// - Blocos <see cref="PriceCrossoverSocialResponse.Official"/> e <see cref="PriceCrossoverOfficialResult.WinnerTeamId"/>
///   vem EXCLUSIVAMENTE de dados persistidos (<c>Match.ScoreA/ScoreB/WinnerTeamId</c> e <c>MatchScoreEvent</c>).
///   Nunca sao recalculados.
/// - <see cref="PriceCrossoverAssetStats.ChartRoundPoints"/> e uma contagem VISUAL (nao oficial) equivalente a
///   "PONTOS DA RODADA" da tela de Match. Nao confundir com <see cref="PriceCrossoverOfficialResult.ScoreA"/>.
/// </summary>
public sealed class PriceCrossoverSocialResponse
{
    /// <summary>Identifica a categoria da publicacao social. Fixo em <c>price_crossover_highlight</c>.</summary>
    public string Category { get; init; } = PriceCrossoverCategories.PriceCrossoverHighlight;

    /// <summary>Indica se o workflow pode publicar esta partida. Nunca tem efeito colateral.</summary>
    public bool CanPost { get; init; }

    /// <summary>Motivo concreto quando <see cref="CanPost"/> e falso. Null quando publicavel.</summary>
    public string? SkipReason { get; init; }

    public int MatchId { get; init; }

    /// <summary>Status persistido da partida (<c>Pending</c>, <c>Ongoing</c>, <c>Completed</c>, <c>Cancelled</c>).</summary>
    public string Status { get; init; } = string.Empty;

    public DateTime? StartTimeUtc { get; init; }
    public DateTime? EndTimeUtc { get; init; }

    /// <summary>Derivada de EndTimeUtc - StartTimeUtc quando ambos existem. Null quando nao calculavel.</summary>
    public int? DurationMinutes { get; init; }

    /// <summary>Regra de pontuacao persistida em <c>Match.ScoringRuleType</c>.</summary>
    public string ScoringRuleType { get; init; } = string.Empty;

    public DateTime GeneratedAtUtc { get; init; }

    /// <summary>Resultado oficial, lido somente de dados persistidos.</summary>
    public PriceCrossoverOfficialResult Official { get; init; } = new();

    /// <summary>Asset A da partida (<c>Match.TeamA</c>).</summary>
    public PriceCrossoverAssetStats AssetA { get; init; } = new();

    /// <summary>Asset B da partida (<c>Match.TeamB</c>).</summary>
    public PriceCrossoverAssetStats AssetB { get; init; } = new();

    /// <summary>Metricas comparativas reconstruidas entre os dois ativos.</summary>
    public PriceCrossoverComparativeStats Comparative { get; init; } = new();

    /// <summary>Indice de interesse social, de 0 a 100.</summary>
    public int InterestScore { get; init; }

    /// <summary>Decomposicao do indice de interesse, para diagnostico.</summary>
    public PriceCrossoverInterestBreakdown InterestBreakdown { get; init; } = new();

    /// <summary>Qualidade e cobertura dos dados que sustentam a analise.</summary>
    public PriceCrossoverDataQuality DataQuality { get; init; } = new();

    /// <summary>Divergencias entre a reconstrucao da API e o que a tela de Match exibiria hoje.</summary>
    public PriceCrossoverChartDivergence ChartDivergence { get; init; } = new();

    /// <summary>Serie historica para reconstrucao do grafico Price Battle. Ordem temporal preservada.</summary>
    public IReadOnlyList<PriceCrossoverSeriesPoint> Series { get; init; } = [];

    /// <summary>Metadados da serie (baseline, modo de pareamento, reducao aplicada).</summary>
    public PriceCrossoverSeriesInfo SeriesInfo { get; init; } = new();

    /// <summary>Eventos de cruzamento reconstruidos, em ordem temporal.</summary>
    public IReadOnlyList<PriceCrossoverEvent> CrossoverEvents { get; init; } = [];

    /// <summary>Eventos oficiais persistidos em <c>MatchScoreEvent</c>, em ordem de <c>EventSequence</c>.</summary>
    public IReadOnlyList<PriceCrossoverOfficialEvent> OfficialEvents { get; init; } = [];

    /// <summary>Texto interpretavel para o workflow n8n. Sem IA externa; derivado de estatisticas confirmadas.</summary>
    public PriceCrossoverNarrative? Narrative { get; init; }

    /// <summary>True quando ja existe publicacao registrada para <c>price_crossover_highlight:{matchId}</c>.</summary>
    public bool AlreadyPublished { get; init; }

    /// <summary>Estado atual do controle de publicacao, quando existir.</summary>
    public PriceCrossoverPublicationState? Publication { get; init; }

    /// <summary>
    /// URL publica da pagina de captura. Previa de contrato: a pagina social ainda nao esta implementada,
    /// portanto <see cref="PublicUrlAvailable"/> e falso e este valor deve ser ignorado pelo workflow.
    /// </summary>
    public string? PublicUrl { get; init; }

    /// <summary>Indica se <see cref="PublicUrl"/> aponta para uma pagina realmente disponivel.</summary>
    public bool PublicUrlAvailable { get; init; }
}

public static class PriceCrossoverCategories
{
    public const string PriceCrossoverHighlight = "price_crossover_highlight";

    public static string BuildIdempotencyKey(int matchId)
        => $"{PriceCrossoverHighlight}:{matchId}";
}

public static class PriceCrossoverPublicationStatuses
{
    public const string Reserved = "reserved";
    public const string Publishing = "publishing";
    public const string Posted = "posted";
    public const string Failed = "failed";
    public const string ReconciliationRequired = "reconciliation_required";
}

/// <summary>Resultado oficial da partida. Leitura de dados persistidos, nunca recalculado.</summary>
public sealed class PriceCrossoverOfficialResult
{
    /// <summary>Placar oficial persistido em <c>Match.ScoreA</c>.</summary>
    public int ScoreA { get; init; }

    /// <summary>Placar oficial persistido em <c>Match.ScoreB</c>.</summary>
    public int ScoreB { get; init; }

    /// <summary><c>Match.WinnerTeamId</c>. Null em empate ou quando nao definido.</summary>
    public int? WinnerTeamId { get; init; }

    /// <summary>Simbolo do vencedor oficial. Null em empate ou quando nao definido.</summary>
    public string? WinnerSymbol { get; init; }

    /// <summary>True quando o vencedor oficial e diferente do ativo com maior variacao percentual.</summary>
    public bool WinnerDiffersFromBestPerformance { get; init; }

    /// <summary><c>Match.EndReasonCode</c> (ex.: <c>TIME_LIMIT</c>, <c>KO_A_OUT_OF_GAINERS</c>).</summary>
    public string? EndReasonCode { get; init; }

    /// <summary>Quantidade de eventos oficiais com <c>Points &gt; 0</c>.</summary>
    public int ScoringEventCount { get; init; }

    /// <summary>Regras de desempate/vitoria aplicadas pelo motor oficial. Documental.</summary>
    public string? Notes { get; init; }
}

/// <summary>Estatisticas de um dos competidores.</summary>
public sealed class PriceCrossoverAssetStats
{
    public int TeamId { get; init; }

    /// <summary>Simbolo completo negociado (ex.: <c>EPICUSDT</c>), derivado de <c>Currency.Symbol</c>.</summary>
    public string Symbol { get; init; } = string.Empty;

    /// <summary>Ativo base (ex.: <c>EPIC</c>), derivado da remocao do sufixo de cotacao.</summary>
    public string BaseAsset { get; init; } = string.Empty;

    /// <summary>Ativo de cotacao (ex.: <c>USDT</c>).</summary>
    public string QuoteAsset { get; init; } = string.Empty;

    /// <summary>Primeiro <c>LastPrice</c> valido do par completo da partida. Baseline da normalizacao.</summary>
    public decimal? InitialPrice { get; init; }

    /// <summary>Ultimo <c>LastPrice</c> valido do par completo da partida.</summary>
    public decimal? FinalPrice { get; init; }

    /// <summary>Variação percentual (FinalPrice / InitialPrice - 1) * 100. Null quando inicial invalido.</summary>
    public decimal? PerformancePercent { get; init; }

    /// <summary>Maior valorizacao relativa observada, em percentual sobre o baseline. 0 quando sem dados.</summary>
    public decimal MaxRelativeGainPercent { get; init; }

    /// <summary>Maior desvalorizacao relativa observada, em percentual sobre o baseline. 0 quando sem dados.</summary>
    public decimal MaxRelativeLossPercent { get; init; }

    /// <summary>Placar oficial do time (<c>Match.ScoreA</c> ou <c>Match.ScoreB</c>).</summary>
    public int OfficialScore { get; init; }

    /// <summary>
    /// Contagem VISUAL equivalente a "PONTOS DA RODADA" da tela de Match: quantidade de cruzamentos
    /// de desempenho relativo favoraveis a este ativo. Nao e o placar oficial.
    /// </summary>
    public int ChartRoundPoints { get; init; }

    /// <summary>Quantidade de observacoes (linhas de <c>MatchMetricSnapshot</c>) efetivamente usadas.</summary>
    public int ObservationCount { get; init; }

    /// <summary>Quantidade de snapshots deste ativo que possuem <c>LastPrice</c> valido.</summary>
    public int PricedObservationCount { get; init; }

    /// <summary>Cruzamentos de desempenho relativo favoraveis a este ativo.</summary>
    public int CrossoversWon { get; init; }

    /// <summary>Cruzamentos de desempenho relativo favoraveis ao adversario.</summary>
    public int CrossoversLost { get; init; }

    /// <summary>Tempo total em vantagem relativa, em segundos. Null quando nao calculavel.</summary>
    public int? TimeInLeadSeconds { get; init; }

    /// <summary>Fracao do tempo comparavel em vantagem relativa, de 0 a 1. Null quando nao calculavel.</summary>
    public decimal? TimeInLeadRatio { get; init; }

    /// <summary>Cruzamentos oficiais persistidos em <c>MatchScoreEvent</c> atribuidos a este time.</summary>
    public int OfficialEventsWon { get; init; }

    /// <summary>Blocos especificos de cruzamento deste ativo.</summary>
    public PriceCrossoverAssetCrossovers Crossovers { get; init; } = new();
}

/// <summary>Detalhamento dos cruzamentos por ativo.</summary>
public sealed class PriceCrossoverAssetCrossovers
{
    /// <summary>Cruzamentos em que este ativo ultrapassou o adversario na vantagem relativa.</summary>
    public int Favorable { get; init; }

    /// <summary>Cruzamentos em que o adversario ultrapassou este ativo.</summary>
    public int Unfavorable { get; init; }

    /// <summary>Magnitude media da virada, em pontos percentuais de vantagem relativa.</summary>
    public decimal AverageSwingPercent { get; init; }

    /// <summary>Maior magnitude de virada observada, em pontos percentuais.</summary>
    public decimal MaxSwingPercent { get; init; }
}

/// <summary>Metricas comparativas entre Asset A e Asset B.</summary>
public sealed class PriceCrossoverComparativeStats
{
    /// <summary>Diferenca de desempenho em pontos percentuais (PerformancePercent(A) - PerformancePercent(B)).</summary>
    public decimal? PerformanceDifferencePercent { get; init; }

    /// <summary>Numero total de cruzamentos reconstruidos validos.</summary>
    public int TotalCrossovers { get; init; }

    /// <summary>Numero de cruzamentos considerados relevantes (swing minimo configuravel).</summary>
    public int RelevantCrossovers { get; init; }

    /// <summary>Numero de mudancas de lideranca no PLACAR OFICIAL, derivado da sequencia de <c>MatchScoreEvent</c>.</summary>
    public int OfficialLeadChanges { get; init; }

    /// <summary>Maior vantagem relativa observada (do lider sobre o outro), em pontos percentuais.</summary>
    public decimal MaxRelativeLeadPercent { get; init; }

    /// <summary>Maior vantagem relativa observada a favor de Asset A, em pontos percentuais. 0 se nunca liderou.</summary>
    public decimal MaxLeadPercentAssetA { get; init; }

    /// <summary>Maior vantagem relativa observada a favor de Asset B, em pontos percentuais. 0 se nunca liderou.</summary>
    public decimal MaxLeadPercentAssetB { get; init; }

    /// <summary>Momento (ISO-8601 UTC) de maior equilibrio relativo entre os ativos.</summary>
    public DateTime? ClosestMomentUtc { get; init; }

    /// <summary>Menor diferenca absoluta de desempenho relativo observada, em pontos percentuais.</summary>
    public decimal ClosestGapPercent { get; init; }

    /// <summary>Quantidade de observacoes em que a diferenca relativa ficou abaixo do limiar de equilibrio.</summary>
    public int BalancedObservationCount { get; init; }

    /// <summary>Fracao do tempo comparavel em disputa equilibrada, de 0 a 1.</summary>
    public decimal BalancedRatio { get; init; }

    /// <summary>Intensidade media dos movimentos, em pontos percentuais por hora de vantagem relativa.</summary>
    public decimal MovementIntensityPercentPerHour { get; init; }

    /// <summary>Volatilidade media da vantagem relativa (desvio medio absoluto), em pontos percentuais.</summary>
    public decimal RelativeVolatilityPercent { get; init; }

    /// <summary>True quando houve reversao efetiva de lideranca de desempenho relativo seguida de vitoria oficial.</summary>
    public bool HasComeback { get; init; }

    /// <summary>Indica se a lideranca relativa alternou ao menos uma vez.</summary>
    public bool LeadAlternated { get; init; }

    /// <summary>Competitividade estimada, de 0 a 100. Quanto maior, mais equilibrada a disputa.</summary>
    public int Competitiveness { get; init; }

    /// <summary>Indice de interesse social, de 0 a 100.</summary>
    public int InterestScore { get; init; }
}

/// <summary>Decomposicao do indice de interesse, para diagnostico e ajuste de pesos.</summary>
public sealed class PriceCrossoverInterestBreakdown
{
    public int CrossoversAndComebackScore { get; init; }
    public int CompetitivenessScore { get; init; }
    public int PerformanceSpreadScore { get; init; }
    public int MovementIntensityScore { get; init; }
    public int RemarkableEventsScore { get; init; }

    public int WeightCrossoversAndComeback { get; init; } = PriceCrossoverDefaultWeights.CrossoversAndComeback;
    public int WeightCompetitiveness { get; init; } = PriceCrossoverDefaultWeights.Competitiveness;
    public int WeightPerformanceSpread { get; init; } = PriceCrossoverDefaultWeights.PerformanceSpread;
    public int WeightMovementIntensity { get; init; } = PriceCrossoverDefaultWeights.MovementIntensity;
    public int WeightRemarkableEvents { get; init; } = PriceCrossoverDefaultWeights.RemarkableEvents;

    /// <summary>Contribuicao final ja ponderada, em pontos sobre 100.</summary>
    public int TotalScore { get; init; }

    /// <summary>Motivos legiveis que mais contribuiram (ou reduziram) o indice.</summary>
    public IReadOnlyList<string> Reasons { get; init; } = [];
}

public static class PriceCrossoverDefaultWeights
{
    public const int CrossoversAndComeback = 30;
    public const int Competitiveness = 25;
    public const int PerformanceSpread = 20;
    public const int MovementIntensity = 15;
    public const int RemarkableEvents = 10;
}

/// <summary>Qualidade e cobertura dos dados que sustentam a analise.</summary>
public sealed class PriceCrossoverDataQuality
{
    /// <summary>True quando os dados permitem publicacao confiavel.</summary>
    public bool IsSufficient { get; init; }

    /// <summary>True quando a serie historica permite reconstruir o grafico.</summary>
    public bool CanReconstructChart { get; init; }

    /// <summary>Nivel geral: <c>ok</c>, <c>warning</c> ou <c>high</c>.</summary>
    public string Severity { get; init; } = "ok";

    /// <summary>Quantidade total de linhas de snapshot lidas.</summary>
    public int TotalSnapshotRows { get; init; }

    /// <summary>Quantidade de pares completos (A e B no mesmo timestamp).</summary>
    public int CompletePairs { get; init; }

    /// <summary>Timestamps em que apenas um dos ativos tinha observacao.</summary>
    public int IncompletePairs { get; init; }

    /// <summary>Timestamps duplicados na serie.</summary>
    public int DuplicateTimestamps { get; init; }

    /// <summary>Observacoes de Asset A com <c>LastPrice</c> nulo ou nao positivo.</summary>
    public int MissingPricesAssetA { get; init; }

    /// <summary>Observacoes de Asset B com <c>LastPrice</c> nulo ou nao positivo.</summary>
    public int MissingPricesAssetB { get; init; }

    /// <summary>Razao entre a quantidade de observacoes de A e B. 1.0 indica simetria perfeita.</summary>
    public decimal SamplingRatio { get; init; }

    /// <summary>Intervalo mediano entre pares consecutivos, em segundos.</summary>
    public int MedianPairIntervalSeconds { get; init; }

    /// <summary>Duracao coberta pela serie comparavel, em segundos.</summary>
    public int ComparableSpanSeconds { get; init; }

    /// <summary>Motivos concretos de rejeicao ou alerta.</summary>
    public IReadOnlyList<string> Issues { get; init; } = [];
}

/// <summary>
/// Divergencias entre a reconstrucao da API e o que a tela de Match exibiria hoje.
/// Serve de base para que o grafico social reproduza fielmente o confronto no futuro.
/// </summary>
public sealed class PriceCrossoverChartDivergence
{
    /// <summary>True quando a reconstrucao da API coincide com o comportamento atual do grafico.</summary>
    public bool MatchesScreenChart { get; init; }

    /// <summary>Baseline usado pela API (primeiro par completo da partida).</summary>
    public decimal? ApiBaselinePriceA { get; init; }
    public decimal? ApiBaselinePriceB { get; init; }

    /// <summary>
    /// Baseline que a tela de Match usaria: primeiro ponto da janela deslizante de 500 linhas.
    /// Pode diferir da API quando a partida tem mais linhas do que a janela.
    /// </summary>
    public decimal? ScreenBaselinePriceA { get; init; }
    public decimal? ScreenBaselinePriceB { get; init; }

    /// <summary>True quando a janela do grafico cobre a partida inteira (baselines coincidem).</summary>
    public bool ScreenWindowCoversFullMatch { get; init; }

    /// <summary>Modo de pareamento usado pela API (sempre <c>timestamp</c>).</summary>
    public string ApiPairingMode { get; init; } = "timestamp";

    /// <summary>Modo de pareamento que a tela usaria (<c>index</c>).</summary>
    public string ScreenPairingMode { get; init; } = "index";

    /// <summary>Quantidade de pares que a pareamento por indice da tela desalinharia em relacao ao timestamp.</summary>
    public int ScreenIndexMisalignmentCount { get; init; }

    /// <summary>Quantidade de pontos da serie da tela que misturam <c>LastPrice ?? PercentageChange</c>.</summary>
    public int ScreenUnitMixingCount { get; init; }

    /// <summary>Cruzamentos reconstruidos pela API.</summary>
    public int ApiCrossoverCount { get; init; }

    /// <summary>
    /// Cruzamentos que <c>TvBattleScoreEvaluator.EvaluatePriceBattle</c> produziria sobre a mesma serie.
    /// Deve coincidir com <see cref="ApiCrossoverCount"/> quando nao ha divergencia.
    /// </summary>
    public int ScreenCrossoverCount { get; init; }

    /// <summary>Motivos concretos de divergencia.</summary>
    public IReadOnlyList<string> Differences { get; init; } = [];
}

/// <summary>Ponto da serie historica para reconstrucao do grafico Price Battle.</summary>
public sealed class PriceCrossoverSeriesPoint
{
    public DateTime TimestampUtc { get; init; }

    /// <summary>True quando A e B tem observacao valida neste timestamp. False indica dado ausente.</summary>
    public bool IsComplete { get; init; }

    public PriceCrossoverSeriesSide? AssetA { get; init; }
    public PriceCrossoverSeriesSide? AssetB { get; init; }

    /// <summary>Vantagem relativa (normalizedA - normalizedB) em pontos percentuais sobre o baseline.</summary>
    public decimal? RelativeLeadPercent { get; init; }

    /// <summary>Indice do evento de cruzamento ocorrido neste ponto, quando houver.</summary>
    public int? CrossoverEventIndex { get; init; }
}

public sealed class PriceCrossoverSeriesSide
{
    /// <summary>Preco observado. Nunca interpolado. Null quando ausente.</summary>
    public decimal? Price { get; init; }

    /// <summary>Valor normalizado (Price / BaselinePrice). Null quando ausente.</summary>
    public decimal? NormalizedValue { get; init; }

    /// <summary>Variação percentual do snapshot (ticker 24h). Apenas informativa, nao entra na normalizacao.</summary>
    public decimal? PercentageChange { get; init; }
}

/// <summary>Metadados da serie historica.</summary>
public sealed class PriceCrossoverSeriesInfo
{
    /// <summary>Preco de referencia usado na normalizacao.</summary>
    public decimal? BaselinePriceA { get; init; }
    public decimal? BaselinePriceB { get; init; }

    /// <summary>Timestamp do par usado como baseline.</summary>
    public DateTime? BaselineTimestampUtc { get; init; }

    /// <summary>
    /// Origem do baseline. Sempre <c>first_complete_pair</c> nesta implementacao:
    /// baseline fixo e deterministico, independente do horario da consulta.
    /// </summary>
    public string BaselineSource { get; init; } = "first_complete_pair";

    /// <summary>Modo de pareamento das duas series. Sempre <c>timestamp</c>.</summary>
    public string PairingMode { get; init; } = "timestamp";

    /// <summary>Quantidade de pontos retornados em <see cref="PriceCrossoverSocialResponse.Series"/>.</summary>
    public int PointCount { get; init; }

    /// <summary>Quantidade de pontos completos (A e B validos) usados nos calculos.</summary>
    public int CompletePointCount { get; init; }

    /// <summary>True quando a serie foi reduzida para visualizacao. Metricas usam a serie completa.</summary>
    public bool WasReducedForVisualization { get; init; }

    /// <summary>Quantidade de pontos antes da reducao visual.</summary>
    public int FullPointCount { get; init; }

    /// <summary>Observacoes explicitas sobre dados ausentes ao longo da serie.</summary>
    public IReadOnlyList<string> MissingDataNotes { get; init; } = [];
}

/// <summary>Evento de cruzamento reconstruido pela API.</summary>
public sealed class PriceCrossoverEvent
{
    /// <summary>Indice sequencial do cruzamento, iniciando em 0, em ordem temporal.</summary>
    public int Index { get; init; }

    /// <summary>Instante em que o cruzamento foi detectado (timestamp do par posterior a virada).</summary>
    public DateTime TimestampUtc { get; init; }

    /// <summary>TeamId do ativo que passou a liderar o desempenho relativo.</summary>
    public int WinnerTeamId { get; init; }

    /// <summary>Simbolo do ativo que passou a liderar.</summary>
    public string WinnerSymbol { get; init; } = string.Empty;

    /// <summary>Direcao da virada: <c>up</c> quando o ativo A ultrapassa B, <c>down</c> quando B ultrapassa A.</summary>
    public string Direction { get; init; } = string.Empty;

    /// <summary>Vantagem relativa imediatamente antes da virada, em pontos percentuais.</summary>
    public decimal PreviousLeadPercent { get; init; }

    /// <summary>Vantagem relativa imediatamente depois da virada, em pontos percentuais.</summary>
    public decimal CurrentLeadPercent { get; init; }

    /// <summary>Magnitude da virada: |previous| + |current|, em pontos percentuais.</summary>
    public decimal SwingPercent { get; init; }

    /// <summary>True quando a magnitude da virada atinge o limiar de relevancia configurado.</summary>
    public bool IsRelevant { get; init; }

    /// <summary>Instante interpolado em que as curvas se cruzaram (estimativa visual).</summary>
    public DateTime? InterpolatedCrossTimeUtc { get; init; }

    /// <summary>Valor normalizado no ponto de cruzamento estimado (estimativa visual).</summary>
    public decimal? InterpolatedNormalizedValue { get; init; }

    /// <summary>True quando existe <c>MatchScoreEvent</c> oficial proximo deste cruzamento.</summary>
    public bool HasMatchingOfficialEvent { get; init; }
}

/// <summary>Evento oficial persistido em <c>MatchScoreEvent</c>. Leitura, nunca recalculado.</summary>
public sealed class PriceCrossoverOfficialEvent
{
    public long MatchScoreEventId { get; init; }
    public int EventSequence { get; init; }
    public int TeamId { get; init; }
    public string TeamSymbol { get; init; } = string.Empty;
    public string RuleType { get; init; } = string.Empty;
    public string EventType { get; init; } = string.Empty;
    public string? ReasonCode { get; init; }
    public int Points { get; init; }
    public decimal? TeamPercentageChange { get; init; }
    public decimal? OpponentPercentageChange { get; init; }
    public decimal? MetricDelta { get; init; }
    public DateTime EventTimeUtc { get; init; }
    public string Description { get; init; } = string.Empty;
}

/// <summary>Texto interpretavel para o workflow n8n. Deterministico e baseado em estatisticas confirmadas.</summary>
public sealed class PriceCrossoverNarrative
{
    public string Language { get; init; } = "pt-BR";
    public string Headline { get; init; } = string.Empty;
    public string Summary { get; init; } = string.Empty;
    public IReadOnlyList<string> Highlights { get; init; } = [];

    /// <summary>
    /// Texto pronto para publicacao, ja com aviso de que o conteudo nao constitui recomendacao financeira.
    /// Dentro do limite de caracteres configurado. O workflow deve usa-lo diretamente.
    /// </summary>
    public string SuggestedPostText { get; init; } = string.Empty;

    /// <summary>Identifica o padrao narrativo aplicado (ex.: <c>dominant_win</c>, <c>comeback</c>, <c>balanced</c>).</summary>
    public string Pattern { get; init; } = string.Empty;

    /// <summary>Hashtags sugeridas, sem o caractere <c>#</c>.</summary>
    public IReadOnlyList<string> Hashtags { get; init; } = [];

    /// <summary>Quantidade de caracteres de <see cref="SuggestedPostText"/>.</summary>
    public int CharacterCount { get; init; }

    /// <summary>Limite de caracteres configurado no momento da geracao.</summary>
    public int MaxCharacters { get; init; }

    /// <summary>True quando o texto foi truncado para respeitar o limite.</summary>
    public bool WasTruncated { get; init; }
}

/// <summary>Candidato a destaque, com indice de interesse e motivos de selecao ou rejeicao.</summary>
public sealed class PriceCrossoverCandidateDto
{
    public int MatchId { get; init; }
    public string Status { get; init; } = string.Empty;
    public DateTime? EndTimeUtc { get; init; }
    public string AssetASymbol { get; init; } = string.Empty;
    public string AssetBSymbol { get; init; } = string.Empty;
    public int ScoreA { get; init; }
    public int ScoreB { get; init; }
    public int? WinnerTeamId { get; init; }
    public int InterestScore { get; init; }
    public int TotalCrossovers { get; init; }
    public int RelevantCrossovers { get; init; }
    public bool HasComeback { get; init; }
    public int Competitiveness { get; init; }
    public decimal? PerformanceDifferencePercent { get; init; }

    /// <summary>True quando o candidato passou em todos os criterios de elegibilidade.</summary>
    public bool IsEligible { get; init; }

    /// <summary>True quando este e o candidato selecionado como destaque.</summary>
    public bool IsSelected { get; init; }

    /// <summary>Motivos de rejeicao quando <see cref="IsEligible"/> e falso.</summary>
    public IReadOnlyList<string> RejectionReasons { get; init; } = [];

    /// <summary>Resumo do porque o candidato pontuou como pontuou.</summary>
    public IReadOnlyList<string> SelectionReasons { get; init; } = [];
}

public sealed class PriceCrossoverCandidatesResponse
{
    public DateTime GeneratedAtUtc { get; init; }
    public int LookbackHours { get; init; }
    public int MatchesScanned { get; init; }
    public int EligibleCount { get; init; }
    public int? SelectedMatchId { get; init; }
    public IReadOnlyList<PriceCrossoverCandidateDto> Candidates { get; init; } = [];
}

public sealed class PriceCrossoverHighlightResponse
{
    /// <summary>Destaque selecionado. Null quando nao ha partida elegivel.</summary>
    public PriceCrossoverSocialResponse? Highlight { get; init; }

    /// <summary>True quando existe destaque publicavel.</summary>
    public bool HasHighlight { get; init; }

    /// <summary>Motivo quando nao ha destaque (ex.: <c>no_eligible_match</c>, <c>all_candidates_unreliable</c>).</summary>
    public string? SkipReason { get; init; }

    public DateTime GeneratedAtUtc { get; init; }
    public int LookbackHours { get; init; }
    public int MatchesScanned { get; init; }
    public int EligibleCount { get; init; }

    /// <summary>Resumo dos candidatos avaliados, sem dados pesados de serie.</summary>
    public IReadOnlyList<PriceCrossoverCandidateDto> Candidates { get; init; } = [];
}

/// <summary>Estado do controle de publicacao de uma partida.</summary>
public sealed class PriceCrossoverPublicationState
{
    public long Id { get; init; }
    public int MatchId { get; init; }
    public string Category { get; init; } = string.Empty;
    public string Status { get; init; } = string.Empty;
    public string? IdempotencyKey { get; init; }
    public DateTime? ReservedAtUtc { get; init; }
    public DateTime? LeaseExpiresAtUtc { get; init; }
    public DateTime? PostedAtUtc { get; init; }
    public string? ExternalPostId { get; init; }
    public string? ExternalPostUrl { get; init; }
    public string? LastError { get; init; }
    public bool IsLeaseExpired { get; init; }
}

public sealed class PriceCrossoverReserveRequest
{
    /// <summary>Identifica quem esta reservando (ex.: nome do workflow n8n). Opcional.</summary>
    public string? Owner { get; init; }

    /// <summary>Duracao do lease em segundos. Usa o padrao configurado quando ausente ou invalido.</summary>
    public int? LeaseSeconds { get; init; }
}

public sealed class PriceCrossoverConfirmRequest
{
    /// <summary>Resultado da publicacao: <c>posted</c>, <c>failed</c> ou <c>unknown</c>.</summary>
    public string Outcome { get; init; } = string.Empty;

    public string? ExternalPostId { get; init; }
    public string? ExternalPostUrl { get; init; }
    public string? Error { get; init; }
}

public sealed class PriceCrossoverPublicationResult
{
    public bool Success { get; init; }
    public string Result { get; init; } = string.Empty;
    public string? Error { get; init; }
    public PriceCrossoverPublicationState? Publication { get; init; }
}
