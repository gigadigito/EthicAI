using DTOs;

namespace BLL.NFTFutebol;

/// <summary>
/// Analise pura (sem EF Core, sem I/O, sem relogio) do confronto de preco entre dois ativos.
///
/// Esta classe REPRODUZ a regra visual do componente Price Battle da tela de Match
/// (<c>TvMatchPriceBattleChart.razor</c> / <c>TvBattleScoreEvaluator.EvaluatePriceBattle</c>):
/// - serie normalizada por um preco de referencia;
/// - vantagem relativa = normalizado(A) - normalizado(B);
/// - cruzamento = virada de sinal da vantagem relativa entre dois passos consecutivos,
///   com semantica nao-estrita (<c>prev &lt;= 0 &amp;&amp; curr &gt; 0</c> / <c>prev &gt;= 0 &amp;&amp; curr &lt; 0</c>).
///
/// Divergencias DELIBERADAS em relacao a tela, exigidas pelo contrato social:
/// 1. Baseline FIXO (primeiro par completo da partida) em vez da janela deslizante de 500 linhas.
///    Garante determinismo: a mesma partida produz sempre os mesmos numeros.
/// 2. Pareamento por TIMESTAMP em vez de por indice de array. Evita deslocamento de serie
///    quando um dos ativos tem menos observacoes.
/// 3. Usa apenas <c>LastPrice</c>, nunca <c>LastPrice ?? PercentageChange</c>, para nao misturar
///    unidades no mesmo eixo.
/// Todas essas divergencias sao reportadas em <see cref="PriceCrossoverChartDivergence"/>.
///
/// Esta classe NUNCA recalcula o placar oficial, o vencedor oficial ou os eventos oficiais.
/// Esses valores entram prontos em <see cref="PriceCrossoverAnalysisInput"/> e saem inalterados.
/// </summary>
public sealed class PriceCrossoverAnalyzer
{
    public PriceCrossoverAnalysisOutcome Analyze(PriceCrossoverAnalysisInput input)
    {
        ArgumentNullException.ThrowIfNull(input);
        ArgumentNullException.ThrowIfNull(input.Rows);

        var options = input.Options ?? PriceCrossoverAnalyzerOptions.Default;

        var pairs = PairSnapshots(input.Rows);
        var duplicateTimestamps = CountDuplicateTimestamps(input.Rows);

        var baseline = ResolveBaseline(pairs);
        var series = BuildSeries(pairs, baseline);
        var complete = series.Where(x => x.IsComplete).ToList();

        var crossovers = DetectCrossovers(complete, input, options);
        var leadStats = ComputeLeadStatistics(complete, crossovers, options);
        var dataQuality = BuildDataQuality(input, pairs, complete, duplicateTimestamps, options);
        var chartDivergence = BuildChartDivergence(input, baseline, crossovers, options);

        var assetA = BuildAssetStats(
            input.TeamAId,
            input.SymbolA,
            isSideA: true,
            complete,
            baseline.PriceA,
            input.OfficialScoreA,
            input.OfficialEvents,
            leadStats,
            crossovers,
            options);

        var assetB = BuildAssetStats(
            input.TeamBId,
            input.SymbolB,
            isSideA: false,
            complete,
            baseline.PriceB,
            input.OfficialScoreB,
            input.OfficialEvents,
            leadStats,
            crossovers,
            options);

        var comparative = BuildComparativeStats(
            complete, crossovers, leadStats, assetA, assetB, input, options);

        var interest = BuildInterestBreakdown(comparative, input, leadStats, options);
        comparative = CloneComparative(comparative, interest);

        var seriesInfo = BuildSeriesInfo(pairs, complete, baseline, series, options);

        return new PriceCrossoverAnalysisOutcome
        {
            AssetA = assetA,
            AssetB = assetB,
            Comparative = comparative,
            InterestScore = interest.TotalScore,
            InterestBreakdown = interest,
            DataQuality = dataQuality,
            ChartDivergence = chartDivergence,
            Series = seriesInfo.WasReducedForVisualization
                ? ReduceSeries(series, crossovers, options.MaxSeriesPoints)
                : series,
            SeriesInfo = seriesInfo,
            CrossoverEvents = crossovers,
            CompletePairCount = complete.Count
        };
    }

    // ------------------------------------------------------------------
    // Pareamento de snapshots
    // ------------------------------------------------------------------

    /// <summary>
    /// Agrupa linhas por <c>CapturedAtUtc</c> e mantem a maior linha por lado em cada instante.
    /// Mesma semantica de <c>MatchScoreRebuildService.PairSnapshots</c>: um instante sem os dois
    /// ativos e descartado (incompleto), para nunca comparar instantes diferentes.
    /// </summary>
    internal static List<PriceCrossoverPair> PairSnapshots(IReadOnlyList<PriceCrossoverSnapshotRow> rows)
    {
        var result = new List<PriceCrossoverPair>();
        if (rows.Count == 0)
            return result;

        foreach (var group in rows.GroupBy(x => x.CapturedAtUtc).OrderBy(x => x.Key))
        {
            var rowA = group.Where(x => x.Side == PriceCrossoverSide.A)
                .OrderByDescending(x => x.RowId)
                .FirstOrDefault();
            var rowB = group.Where(x => x.Side == PriceCrossoverSide.B)
                .OrderByDescending(x => x.RowId)
                .FirstOrDefault();

            if (rowA is null && rowB is null)
                continue;

            result.Add(new PriceCrossoverPair
            {
                CapturedAtUtc = group.Key,
                HasA = rowA is not null,
                HasB = rowB is not null,
                PriceA = rowA?.LastPrice,
                PriceB = rowB?.LastPrice,
                PercentageChangeA = rowA?.PercentageChange ?? 0m,
                PercentageChangeB = rowB?.PercentageChange ?? 0m
            });
        }

        return result;
    }

    private static int CountDuplicateTimestamps(IReadOnlyList<PriceCrossoverSnapshotRow> rows)
    {
        var duplicates = 0;
        foreach (var group in rows.GroupBy(x => new { x.CapturedAtUtc, x.Side }))
        {
            var extra = group.Count() - 1;
            if (extra > 0)
                duplicates += extra;
        }

        return duplicates;
    }

    // ------------------------------------------------------------------
    // Baseline fixo
    // ------------------------------------------------------------------

    private static PriceCrossoverBaseline ResolveBaseline(IReadOnlyList<PriceCrossoverPair> pairs)
    {
        foreach (var pair in pairs)
        {
            if (!pair.HasA || !pair.HasB)
                continue;

            if (pair.PriceA is not > 0m || pair.PriceB is not > 0m)
                continue;

            return new PriceCrossoverBaseline
            {
                PriceA = pair.PriceA!.Value,
                PriceB = pair.PriceB!.Value,
                TimestampUtc = pair.CapturedAtUtc
            };
        }

        return default;
    }

    private readonly record struct PriceCrossoverBaseline(
        decimal PriceA,
        decimal PriceB,
        DateTime TimestampUtc)
    {
        public bool IsValid => PriceA > 0m && PriceB > 0m;
    }

    // ------------------------------------------------------------------
    // Serie
    // ------------------------------------------------------------------

    private static List<PriceCrossoverSeriesPoint> BuildSeries(
        IReadOnlyList<PriceCrossoverPair> pairs,
        PriceCrossoverBaseline baseline)
    {
        var series = new List<PriceCrossoverSeriesPoint>(pairs.Count);

        foreach (var pair in pairs)
        {
            var hasPriceA = pair.PriceA is > 0m;
            var hasPriceB = pair.PriceB is > 0m;
            var isComplete = pair.HasA && pair.HasB && hasPriceA && hasPriceB && baseline.IsValid;

            PriceCrossoverSeriesSide? sideA = null;
            PriceCrossoverSeriesSide? sideB = null;
            decimal? lead = null;

            if (pair.HasA)
            {
                sideA = new PriceCrossoverSeriesSide
                {
                    Price = pair.PriceA,
                    NormalizedValue = hasPriceA && baseline.IsValid
                        ? decimal.Round(pair.PriceA!.Value / baseline.PriceA, 10, MidpointRounding.AwayFromZero)
                        : null,
                    PercentageChange = pair.PercentageChangeA
                };
            }

            if (pair.HasB)
            {
                sideB = new PriceCrossoverSeriesSide
                {
                    Price = pair.PriceB,
                    NormalizedValue = hasPriceB && baseline.IsValid
                        ? decimal.Round(pair.PriceB!.Value / baseline.PriceB, 10, MidpointRounding.AwayFromZero)
                        : null,
                    PercentageChange = pair.PercentageChangeB
                };
            }

            if (isComplete && sideA?.NormalizedValue is not null && sideB?.NormalizedValue is not null)
            {
                lead = decimal.Round(
                    (sideA.NormalizedValue.Value - sideB.NormalizedValue.Value) * 100m,
                    6,
                    MidpointRounding.AwayFromZero);
            }

            series.Add(new PriceCrossoverSeriesPoint
            {
                TimestampUtc = pair.CapturedAtUtc,
                IsComplete = isComplete,
                AssetA = sideA,
                AssetB = sideB,
                RelativeLeadPercent = lead
            });
        }

        return series;
    }

    // ------------------------------------------------------------------
    // Cruzamentos (regra visual do Price Battle)
    // ------------------------------------------------------------------

    private static List<PriceCrossoverEvent> DetectCrossovers(
        IReadOnlyList<PriceCrossoverSeriesPoint> complete,
        PriceCrossoverAnalysisInput input,
        PriceCrossoverAnalyzerOptions options)
    {
        var events = new List<PriceCrossoverEvent>();
        if (complete.Count < 2)
            return events;

        for (var index = 1; index < complete.Count; index++)
        {
            var previous = complete[index - 1];
            var current = complete[index];

            var previousLead = previous.RelativeLeadPercent ?? 0m;
            var currentLead = current.RelativeLeadPercent ?? 0m;

            string direction;
            int winnerTeamId;
            string winnerSymbol;

            if (previousLead <= 0m && currentLead > 0m)
            {
                direction = "up";
                winnerTeamId = input.TeamAId;
                winnerSymbol = input.SymbolA;
            }
            else if (previousLead >= 0m && currentLead < 0m)
            {
                direction = "down";
                winnerTeamId = input.TeamBId;
                winnerSymbol = input.SymbolB;
            }
            else
            {
                continue;
            }

            var swing = Math.Abs(previousLead) + Math.Abs(currentLead);

            var (crossTime, crossValue) = InterpolateCross(previous, current, previousLead, currentLead);

            events.Add(new PriceCrossoverEvent
            {
                Index = events.Count,
                TimestampUtc = current.TimestampUtc,
                WinnerTeamId = winnerTeamId,
                WinnerSymbol = winnerSymbol,
                Direction = direction,
                PreviousLeadPercent = previousLead,
                CurrentLeadPercent = currentLead,
                SwingPercent = decimal.Round(swing, 6, MidpointRounding.AwayFromZero),
                IsRelevant = swing >= options.RelevantSwingPercent,
                InterpolatedCrossTimeUtc = crossTime,
                InterpolatedNormalizedValue = crossValue,
                HasMatchingOfficialEvent = HasNearbyOfficialEvent(
                    input.OfficialEvents, winnerTeamId, crossTime)
            });
        }

        return events;
    }

    /// <summary>
    /// Estimativa visual do ponto de cruzamento. Usa a razao |prev| / (|prev| + |curr|),
    /// a mesma formula de <c>ResolveCrossInterpolation</c> na tela de Match, porem interpolando
    /// cada lado com seus proprios valores (a tela hoje usa os valores do lado esquerdo para os dois).
    /// </summary>
    private static (DateTime? Time, decimal? NormalizedValue) InterpolateCross(
        PriceCrossoverSeriesPoint previous,
        PriceCrossoverSeriesPoint current,
        decimal previousLead,
        decimal currentLead)
    {
        var denominator = Math.Abs(previousLead) + Math.Abs(currentLead);
        var ratio = denominator <= 0.0000001m ? 0.5m : Math.Abs(previousLead) / denominator;
        ratio = Math.Clamp(ratio, 0m, 1m);

        var elapsedTicks = current.TimestampUtc.Ticks - previous.TimestampUtc.Ticks;
        var crossTime = previous.TimestampUtc.AddTicks((long)(elapsedTicks * (double)ratio));

        var prevA = previous.AssetA?.NormalizedValue;
        var currA = current.AssetA?.NormalizedValue;
        var prevB = previous.AssetB?.NormalizedValue;
        var currB = current.AssetB?.NormalizedValue;

        if (prevA is null || currA is null || prevB is null || currB is null)
            return (crossTime, null);

        var a = prevA.Value + (currA.Value - prevA.Value) * ratio;
        var b = prevB.Value + (currB.Value - prevB.Value) * ratio;
        var mid = (a + b) / 2m;

        return (crossTime, decimal.Round(mid, 10, MidpointRounding.AwayFromZero));
    }

    private static bool HasNearbyOfficialEvent(
        IReadOnlyList<PriceCrossoverOfficialEvent> officialEvents,
        int winnerTeamId,
        DateTime? crossTime)
    {
        if (crossTime is null || officialEvents.Count == 0)
            return false;

        var tolerance = TimeSpan.FromSeconds(120);
        return officialEvents.Any(x =>
            x.TeamId == winnerTeamId
            && x.Points > 0
            && x.EventType.Contains("CROSSOVER", StringComparison.OrdinalIgnoreCase)
            && Math.Abs((x.EventTimeUtc - crossTime.Value).TotalSeconds) <= tolerance.TotalSeconds);
    }

    // ------------------------------------------------------------------
    // Estatisticas de lideranca e tempo em vantagem
    // ------------------------------------------------------------------

    private static PriceCrossoverLeadStats ComputeLeadStatistics(
        IReadOnlyList<PriceCrossoverSeriesPoint> complete,
        IReadOnlyList<PriceCrossoverEvent> crossovers,
        PriceCrossoverAnalyzerOptions options)
    {
        if (complete.Count == 0)
            return new PriceCrossoverLeadStats();

        decimal maxLeadA = 0m;
        decimal maxLeadB = 0m;
        decimal maxLeadAny = 0m;
        decimal closestGap = decimal.MaxValue;
        DateTime? closestMoment = null;
        decimal leadSum = 0m;
        var balancedCount = 0;
        var leadValues = new List<decimal>(complete.Count);

        var timeASeconds = 0d;
        var timeBSeconds = 0d;
        var timeTieSeconds = 0d;

        for (var index = 0; index < complete.Count; index++)
        {
            var point = complete[index];
            var lead = point.RelativeLeadPercent ?? 0m;
            leadValues.Add(lead);
            leadSum += lead;

            if (lead > maxLeadA) maxLeadA = lead;
            if (lead < -maxLeadB) maxLeadB = -lead;
            var abs = Math.Abs(lead);
            if (abs > maxLeadAny) maxLeadAny = abs;

            var gap = Math.Abs(lead);
            if (gap < closestGap)
            {
                closestGap = gap;
                closestMoment = point.TimestampUtc;
            }

            if (gap <= options.BalancedGapPercent)
                balancedCount++;

            // Atribui o intervalo [t_i, t_{i+1}) ao lider registrado em t_i.
            if (index < complete.Count - 1)
            {
                var seconds = (complete[index + 1].TimestampUtc - point.TimestampUtc).TotalSeconds;
                if (seconds > 0)
                {
                    if (lead > 0m) timeASeconds += seconds;
                    else if (lead < 0m) timeBSeconds += seconds;
                    else timeTieSeconds += seconds;
                }
            }
        }

        var comparableSeconds = (complete[^1].TimestampUtc - complete[0].TimestampUtc).TotalSeconds;
        if (comparableSeconds <= 0)
            comparableSeconds = 0;

        var resampled = ResampleLead(leadValues, complete, options.IntensitySampleSeconds);
        var (intensity, volatility) = ComputeMovementStatistics(resampled, comparableSeconds);

        var leadAlternated = crossovers.Count > 0;

        return new PriceCrossoverLeadStats
        {
            MaxLeadPercentA = maxLeadA,
            MaxLeadPercentB = maxLeadB,
            MaxLeadPercentAny = maxLeadAny,
            ClosestGapPercent = closestGap == decimal.MaxValue ? 0m : closestGap,
            ClosestMomentUtc = closestMoment,
            BalancedCount = balancedCount,
            BalancedRatio = complete.Count == 0 ? 0m : decimal.Round((decimal)balancedCount / complete.Count, 6, MidpointRounding.AwayFromZero),
            ComparableSeconds = comparableSeconds,
            TimeInLeadSecondsA = (int)Math.Round(timeASeconds, MidpointRounding.AwayFromZero),
            TimeInLeadSecondsB = (int)Math.Round(timeBSeconds, MidpointRounding.AwayFromZero),
            TimeInLeadSecondsTie = (int)Math.Round(timeTieSeconds, MidpointRounding.AwayFromZero),
            TimeInLeadRatioA = comparableSeconds <= 0 ? 0m : decimal.Round((decimal)(timeASeconds / comparableSeconds), 6, MidpointRounding.AwayFromZero),
            TimeInLeadRatioB = comparableSeconds <= 0 ? 0m : decimal.Round((decimal)(timeBSeconds / comparableSeconds), 6, MidpointRounding.AwayFromZero),
            LeadValues = leadValues,
            LeadAlternated = leadAlternated,
            MovementIntensityPercentPerHour = intensity,
            RelativeVolatilityPercent = volatility
        };
    }

    /// <summary>
    /// Reamostra a vantagem relativa em uma grade de cadencia fixa (last-observation-carried-forward).
    /// Isso torna a intensidade dos movimentos comparavel entre partidas com quantidades diferentes
    /// de observacoes, atendendo ao requisito de nao favorecer quem recebe mais atualizacoes.
    /// </summary>
    private static List<decimal> ResampleLead(
        IReadOnlyList<decimal> leadValues,
        IReadOnlyList<PriceCrossoverSeriesPoint> complete,
        int sampleSeconds)
    {
        var grid = new List<decimal>();
        if (complete.Count == 0 || sampleSeconds <= 0)
            return grid;

        var start = complete[0].TimestampUtc;
        var end = complete[^1].TimestampUtc;
        if (end <= start)
            return leadValues.Count > 0 ? [leadValues[0]] : grid;

        var step = TimeSpan.FromSeconds(sampleSeconds);
        var cursorIndex = 0;
        for (var t = start; t <= end; t += step)
        {
            while (cursorIndex + 1 < complete.Count && complete[cursorIndex + 1].TimestampUtc <= t)
                cursorIndex++;

            grid.Add(leadValues[cursorIndex]);
        }

        return grid;
    }

    private static (decimal IntensityPercentPerHour, decimal VolatilityPercent) ComputeMovementStatistics(
        IReadOnlyList<decimal> grid,
        double comparableSeconds)
    {
        if (grid.Count == 0)
            return (0m, 0m);

        decimal totalVariation = 0m;
        for (var i = 1; i < grid.Count; i++)
            totalVariation += Math.Abs(grid[i] - grid[i - 1]);

        var mean = grid.Average();
        var deviationSum = grid.Sum(x => Math.Abs(x - mean));
        var volatility = decimal.Round(deviationSum / grid.Count, 6, MidpointRounding.AwayFromZero);

        if (comparableSeconds <= 0)
            return (0m, volatility);

        var hours = (decimal)(comparableSeconds / 3600d);
        if (hours <= 0m)
            return (0m, volatility);

        var intensity = decimal.Round(totalVariation / hours, 6, MidpointRounding.AwayFromZero);
        return (intensity, volatility);
    }

    private sealed class PriceCrossoverLeadStats
    {
        public decimal MaxLeadPercentA { get; init; }
        public decimal MaxLeadPercentB { get; init; }
        public decimal MaxLeadPercentAny { get; init; }
        public decimal ClosestGapPercent { get; init; }
        public DateTime? ClosestMomentUtc { get; init; }
        public int BalancedCount { get; init; }
        public decimal BalancedRatio { get; init; }
        public double ComparableSeconds { get; init; }
        public int TimeInLeadSecondsA { get; init; }
        public int TimeInLeadSecondsB { get; init; }
        public int TimeInLeadSecondsTie { get; init; }
        public decimal TimeInLeadRatioA { get; init; }
        public decimal TimeInLeadRatioB { get; init; }
        public IReadOnlyList<decimal> LeadValues { get; init; } = [];
        public bool LeadAlternated { get; init; }
        public decimal MovementIntensityPercentPerHour { get; init; }
        public decimal RelativeVolatilityPercent { get; init; }
    }

    // ------------------------------------------------------------------
    // Estatisticas por ativo
    // ------------------------------------------------------------------

    private static PriceCrossoverAssetStats BuildAssetStats(
        int teamId,
        string symbol,
        bool isSideA,
        IReadOnlyList<PriceCrossoverSeriesPoint> complete,
        decimal baselinePrice,
        int officialScore,
        IReadOnlyList<PriceCrossoverOfficialEvent> officialEvents,
        PriceCrossoverLeadStats leadStats,
        IReadOnlyList<PriceCrossoverEvent> crossovers,
        PriceCrossoverAnalyzerOptions options)
    {
        var (baseAsset, quoteAsset) = SplitSymbol(symbol);

        decimal? initialPrice = null;
        decimal? finalPrice = null;
        decimal? performance = null;
        decimal maxGain = 0m;
        decimal maxLoss = 0m;
        var pricedCount = 0;

        if (baselinePrice > 0m)
        {
            initialPrice = baselinePrice;

            foreach (var point in complete)
            {
                var price = isSideA ? point.AssetA?.Price : point.AssetB?.Price;
                if (price is not > 0m)
                    continue;

                pricedCount++;
                finalPrice = price;

                var change = (price!.Value / baselinePrice - 1m) * 100m;
                if (change > maxGain) maxGain = change;
                if (change < maxLoss) maxLoss = change;
            }

            if (finalPrice is > 0m)
            {
                performance = decimal.Round(
                    (finalPrice.Value / baselinePrice - 1m) * 100m,
                    6,
                    MidpointRounding.AwayFromZero);
            }
        }

        var favorable = crossovers.Count(x => x.WinnerTeamId == teamId);
        var unfavorable = crossovers.Count(x => x.WinnerTeamId != teamId);

        decimal swingSum = 0m;
        decimal swingMax = 0m;
        var swingCount = 0;
        foreach (var cross in crossovers.Where(x => x.WinnerTeamId == teamId))
        {
            swingSum += cross.SwingPercent;
            if (cross.SwingPercent > swingMax) swingMax = cross.SwingPercent;
            swingCount++;
        }

        var officialEventsWon = officialEvents.Count(x => x.Points > 0 && x.TeamId == teamId);

        return new PriceCrossoverAssetStats
        {
            TeamId = teamId,
            Symbol = symbol,
            BaseAsset = baseAsset,
            QuoteAsset = quoteAsset,
            InitialPrice = initialPrice,
            FinalPrice = finalPrice,
            PerformancePercent = performance,
            MaxRelativeGainPercent = decimal.Round(maxGain, 6, MidpointRounding.AwayFromZero),
            MaxRelativeLossPercent = decimal.Round(maxLoss, 6, MidpointRounding.AwayFromZero),
            OfficialScore = officialScore,
            ChartRoundPoints = favorable,
            ObservationCount = complete.Count,
            PricedObservationCount = pricedCount,
            CrossoversWon = favorable,
            CrossoversLost = unfavorable,
            TimeInLeadSeconds = isSideA ? leadStats.TimeInLeadSecondsA : leadStats.TimeInLeadSecondsB,
            TimeInLeadRatio = isSideA ? leadStats.TimeInLeadRatioA : leadStats.TimeInLeadRatioB,
            OfficialEventsWon = officialEventsWon,
            Crossovers = new PriceCrossoverAssetCrossovers
            {
                Favorable = favorable,
                Unfavorable = unfavorable,
                AverageSwingPercent = swingCount == 0
                    ? 0m
                    : decimal.Round(swingSum / swingCount, 6, MidpointRounding.AwayFromZero),
                MaxSwingPercent = decimal.Round(swingMax, 6, MidpointRounding.AwayFromZero)
            }
        };
    }

    /// <summary>
    /// Separa <c>EPICUSDT</c> em <c>EPIC</c> + <c>USDT</c>. Reconhece os sufixos de cotacao mais
    /// comuns; quando nao reconhece, usa os ultimos 4 caracteres como cotacao e o restante como base.
    /// </summary>
    internal static (string BaseAsset, string QuoteAsset) SplitSymbol(string symbol)
    {
        var value = (symbol ?? string.Empty).Trim().ToUpperInvariant();
        if (value.Length == 0)
            return (string.Empty, string.Empty);

        string[] quotes = ["USDT", "USDC", "FDUSD", "TUSD", "BUSD", "DAI", "EUR", "TRY", "BRL", "BTC", "ETH", "BNB"];
        foreach (var quote in quotes)
        {
            if (value.Length > quote.Length && value.EndsWith(quote, StringComparison.Ordinal))
                return (value[..^quote.Length], quote);
        }

        if (value.Length <= 4)
            return (value, string.Empty);

        return (value[..^4], value[^4..]);
    }

    // ------------------------------------------------------------------
    // Metricas comparativas
    // ------------------------------------------------------------------

    private static PriceCrossoverComparativeStats BuildComparativeStats(
        IReadOnlyList<PriceCrossoverSeriesPoint> complete,
        IReadOnlyList<PriceCrossoverEvent> crossovers,
        PriceCrossoverLeadStats leadStats,
        PriceCrossoverAssetStats assetA,
        PriceCrossoverAssetStats assetB,
        PriceCrossoverAnalysisInput input,
        PriceCrossoverAnalyzerOptions options)
    {
        decimal? perfDiff = null;
        if (assetA.PerformancePercent is not null && assetB.PerformancePercent is not null)
        {
            perfDiff = decimal.Round(
                assetA.PerformancePercent.Value - assetB.PerformancePercent.Value,
                6,
                MidpointRounding.AwayFromZero);
        }

        var relevant = crossovers.Count(x => x.IsRelevant);
        var officialLeadChanges = ComputeOfficialLeadChanges(input.OfficialEvents, input.TeamAId, input.TeamBId);

        var hasComeback = DetectComeback(input, leadStats, crossovers);

        return new PriceCrossoverComparativeStats
        {
            PerformanceDifferencePercent = perfDiff,
            TotalCrossovers = crossovers.Count,
            RelevantCrossovers = relevant,
            OfficialLeadChanges = officialLeadChanges,
            MaxRelativeLeadPercent = leadStats.MaxLeadPercentAny,
            MaxLeadPercentAssetA = leadStats.MaxLeadPercentA,
            MaxLeadPercentAssetB = leadStats.MaxLeadPercentB,
            ClosestMomentUtc = leadStats.ClosestMomentUtc,
            ClosestGapPercent = leadStats.ClosestGapPercent,
            BalancedObservationCount = leadStats.BalancedCount,
            BalancedRatio = leadStats.BalancedRatio,
            MovementIntensityPercentPerHour = leadStats.MovementIntensityPercentPerHour,
            RelativeVolatilityPercent = leadStats.RelativeVolatilityPercent,
            HasComeback = hasComeback,
            LeadAlternated = leadStats.LeadAlternated,
            Competitiveness = ComputeCompetitiveness(
                input.OfficialScoreA,
                input.OfficialScoreB,
                assetA.ChartRoundPoints,
                assetB.ChartRoundPoints,
                perfDiff,
                leadStats.BalancedRatio),
            InterestScore = 0
        };
    }

    private static PriceCrossoverComparativeStats CloneComparative(
        PriceCrossoverComparativeStats source,
        PriceCrossoverInterestBreakdown interest)
        => new()
        {
            PerformanceDifferencePercent = source.PerformanceDifferencePercent,
            TotalCrossovers = source.TotalCrossovers,
            RelevantCrossovers = source.RelevantCrossovers,
            OfficialLeadChanges = source.OfficialLeadChanges,
            MaxRelativeLeadPercent = source.MaxRelativeLeadPercent,
            MaxLeadPercentAssetA = source.MaxLeadPercentAssetA,
            MaxLeadPercentAssetB = source.MaxLeadPercentAssetB,
            ClosestMomentUtc = source.ClosestMomentUtc,
            ClosestGapPercent = source.ClosestGapPercent,
            BalancedObservationCount = source.BalancedObservationCount,
            BalancedRatio = source.BalancedRatio,
            MovementIntensityPercentPerHour = source.MovementIntensityPercentPerHour,
            RelativeVolatilityPercent = source.RelativeVolatilityPercent,
            HasComeback = source.HasComeback,
            LeadAlternated = source.LeadAlternated,
            Competitiveness = source.Competitiveness,
            InterestScore = interest.TotalScore
        };

    /// <summary>
    /// Conta quantas vezes a lideranca do PLACAR OFICIAL muda de lado, percorrendo
    /// <c>MatchScoreEvent</c> em ordem de <c>EventSequence</c>. Nunca recalcula os pontos.
    /// Empates zera a memoria de lideranca (nao contam como mudanca).
    /// </summary>
    internal static int ComputeOfficialLeadChanges(
        IReadOnlyList<PriceCrossoverOfficialEvent> officialEvents,
        int teamAId,
        int teamBId)
    {
        if (officialEvents.Count == 0)
            return 0;

        var scoreA = 0;
        var scoreB = 0;
        int? leader = null;
        var changes = 0;

        foreach (var scoreEvent in officialEvents.OrderBy(x => x.EventSequence))
        {
            if (scoreEvent.Points <= 0)
                continue;

            if (scoreEvent.TeamId == teamAId)
                scoreA += scoreEvent.Points;
            else if (scoreEvent.TeamId == teamBId)
                scoreB += scoreEvent.Points;
            else
                continue;

            int? current = scoreA > scoreB ? teamAId : scoreB > scoreA ? teamBId : null;

            if (current is not null && leader is not null && current != leader)
                changes++;

            leader = current;
        }

        return changes;
    }

    private static bool DetectComeback(
        PriceCrossoverAnalysisInput input,
        PriceCrossoverLeadStats leadStats,
        IReadOnlyList<PriceCrossoverEvent> crossovers)
    {
        if (input.OfficialWinnerTeamId is null)
            return false;

        if (crossovers.Count == 0)
            return false;

        var winnerIsA = input.OfficialWinnerTeamId.Value == input.TeamAId;
        if (!winnerIsA && input.OfficialWinnerTeamId.Value != input.TeamBId)
            return false;

        // O vencedor precisa ter ficado para tras em algum momento...
        var trailed = leadStats.LeadValues.Any(lead => winnerIsA ? lead < 0m : lead > 0m);
        if (!trailed)
            return false;

        // ...e ter assumido a lideranca relativa depois de ter ficado para tras.
        var lastTrailIndex = -1;
        for (var i = 0; i < leadStats.LeadValues.Count; i++)
        {
            var lead = leadStats.LeadValues[i];
            if (winnerIsA ? lead < 0m : lead > 0m)
                lastTrailIndex = i;
        }

        if (lastTrailIndex < 0)
            return false;

        for (var i = lastTrailIndex + 1; i < leadStats.LeadValues.Count; i++)
        {
            var lead = leadStats.LeadValues[i];
            if (winnerIsA ? lead > 0m : lead < 0m)
                return true;
        }

        return false;
    }

    private static int ComputeCompetitiveness(
        int officialScoreA,
        int officialScoreB,
        int chartPointsA,
        int chartPointsB,
        decimal? performanceDifferencePercent,
        decimal balancedRatio)
    {
        var officialGap = Math.Abs(officialScoreA - officialScoreB);
        var chartGap = Math.Abs(chartPointsA - chartPointsB);
        var perfGap = Math.Abs(performanceDifferencePercent ?? 0m);

        var officialComponent = Math.Clamp(100 - officialGap * 20, 0, 100);
        var chartComponent = Math.Clamp(100 - chartGap * 15, 0, 100);
        var perfComponent = Math.Clamp(100 - (int)Math.Round(perfGap * 4m, MidpointRounding.AwayFromZero), 0, 100);
        var balancedComponent = Math.Clamp((int)Math.Round(balancedRatio * 100m, MidpointRounding.AwayFromZero), 0, 100);

        var weighted =
            officialComponent * 0.35d
            + chartComponent * 0.20d
            + perfComponent * 0.20d
            + balancedComponent * 0.25d;

        return Math.Clamp((int)Math.Round(weighted, MidpointRounding.AwayFromZero), 0, 100);
    }

    // ------------------------------------------------------------------
    // Indice de interesse
    // ------------------------------------------------------------------

    private static PriceCrossoverInterestBreakdown BuildInterestBreakdown(
        PriceCrossoverComparativeStats comparative,
        PriceCrossoverAnalysisInput input,
        PriceCrossoverLeadStats leadStats,
        PriceCrossoverAnalyzerOptions options)
    {
        // Taxas por hora usam o span OBSERVAVEL dos dados, nao a duracao nominal da partida.
        // Assim partidas com quantidades diferentes de observacoes sao comparaveis.
        var observedHours = leadStats.ComparableSeconds > 0
            ? (decimal)(leadStats.ComparableSeconds / 3600d)
            : 0m;

        if (observedHours <= 0m && input.StartTimeUtc is not null && input.EndTimeUtc is not null)
        {
            observedHours = Math.Max(
                (decimal)(input.EndTimeUtc.Value - input.StartTimeUtc.Value).TotalSeconds,
                0m) / 3600m;
        }

        var hours = observedHours;

        // Cruzamentos relevantes por hora: normalizado por tempo, nunca por contagem de amostras.
        var crossRate = hours > 0m ? comparative.RelevantCrossovers / hours : 0m;
        var crossComponent = (int)Math.Round(
            Math.Clamp(crossRate / options.MaxRelevantCrossoversPerHour, 0m, 1m) * 80m,
            MidpointRounding.AwayFromZero);
        var comebackComponent = comparative.HasComeback ? 20 : 0;
        var crossoversScore = Math.Clamp(crossComponent + comebackComponent, 0, 100);

        var competitivenessScore = Math.Clamp(comparative.Competitiveness, 0, 100);

        var gap = Math.Abs(comparative.PerformanceDifferencePercent ?? 0m);
        var spreadScore = Math.Clamp(
            100 - (int)Math.Round(Math.Abs(gap - options.IdealPerformanceGapPercent) * 4m, MidpointRounding.AwayFromZero),
            0,
            100);

        var intensityComponent = Math.Clamp(
            (int)Math.Round(
                comparative.MovementIntensityPercentPerHour / options.MaxMovementIntensityPercentPerHour * 100m,
                MidpointRounding.AwayFromZero),
            0,
            100);
        var volatilityComponent = Math.Clamp(
            (int)Math.Round(
                comparative.RelativeVolatilityPercent / options.MaxRelativeVolatilityPercent * 100m,
                MidpointRounding.AwayFromZero),
            0,
            100);
        var intensityScore = Math.Clamp(
            (int)Math.Round(intensityComponent * 0.6d + volatilityComponent * 0.4d, MidpointRounding.AwayFromZero),
            0,
            100);

        var officialEventsCount = input.OfficialEvents.Count(x => x.Points > 0);
        var eventsRate = hours > 0m ? officialEventsCount / hours : 0m;
        var eventsComponent = (int)Math.Round(
            Math.Clamp(eventsRate / options.MaxOfficialEventsPerHour, 0m, 1m) * 80m,
            MidpointRounding.AwayFromZero);
        var endReasonBonus = IsRemarkableEndReason(input.EndReasonCode) ? 20 : 0;
        var eventsScore = Math.Clamp(eventsComponent + endReasonBonus, 0, 100);

        var weights = new[]
        {
            (Score: crossoversScore, Weight: options.WeightCrossoversAndComeback),
            (Score: competitivenessScore, Weight: options.WeightCompetitiveness),
            (Score: spreadScore, Weight: options.WeightPerformanceSpread),
            (Score: intensityScore, Weight: options.WeightMovementIntensity),
            (Score: eventsScore, Weight: options.WeightRemarkableEvents)
        };

        var totalWeight = weights.Sum(x => x.Weight);
        if (totalWeight <= 0)
            totalWeight = 1;

        var weighted = weights.Sum(x => (double)x.Score * x.Weight);
        var total = Math.Clamp((int)Math.Round(weighted / totalWeight, MidpointRounding.AwayFromZero), 0, 100);

        return new PriceCrossoverInterestBreakdown
        {
            CrossoversAndComebackScore = crossoversScore,
            CompetitivenessScore = competitivenessScore,
            PerformanceSpreadScore = spreadScore,
            MovementIntensityScore = intensityScore,
            RemarkableEventsScore = eventsScore,
            WeightCrossoversAndComeback = options.WeightCrossoversAndComeback,
            WeightCompetitiveness = options.WeightCompetitiveness,
            WeightPerformanceSpread = options.WeightPerformanceSpread,
            WeightMovementIntensity = options.WeightMovementIntensity,
            WeightRemarkableEvents = options.WeightRemarkableEvents,
            TotalScore = total,
            Reasons = BuildInterestReasons(comparative, crossoversScore, competitivenessScore, spreadScore, intensityScore, eventsScore)
        };
    }

    private static IReadOnlyList<string> BuildInterestReasons(
        PriceCrossoverComparativeStats comparative,
        int crossoversScore,
        int competitivenessScore,
        int spreadScore,
        int intensityScore,
        int eventsScore)
    {
        var reasons = new List<string>();

        if (comparative.HasComeback)
            reasons.Add("comeback");
        if (comparative.RelevantCrossovers >= 3)
            reasons.Add("multiple_relevant_crossovers");
        if (competitivenessScore >= 70)
            reasons.Add("balanced_match");
        if (spreadScore >= 70)
            reasons.Add("clear_performance_gap");
        if (intensityScore >= 70)
            reasons.Add("intense_movements");
        if (eventsScore >= 70)
            reasons.Add("remarkable_official_events");
        if (comparative.LeadAlternated && comparative.RelevantCrossovers >= 2)
            reasons.Add("lead_alternation");
        if (crossoversScore < 30)
            reasons.Add("few_relevant_crossovers");
        if (competitivenessScore < 30)
            reasons.Add("one_sided_score");

        return reasons;
    }

    private static bool IsRemarkableEndReason(string? endReasonCode)
    {
        if (string.IsNullOrWhiteSpace(endReasonCode))
            return false;

        return endReasonCode.Contains("KO_", StringComparison.OrdinalIgnoreCase)
            || endReasonCode.Contains("_WO", StringComparison.OrdinalIgnoreCase)
            || endReasonCode.StartsWith("BOTH_OUT", StringComparison.OrdinalIgnoreCase);
    }

    // ------------------------------------------------------------------
    // Qualidade de dados
    // ------------------------------------------------------------------

    private static PriceCrossoverDataQuality BuildDataQuality(
        PriceCrossoverAnalysisInput input,
        IReadOnlyList<PriceCrossoverPair> pairs,
        IReadOnlyList<PriceCrossoverSeriesPoint> complete,
        int duplicateTimestamps,
        PriceCrossoverAnalyzerOptions options)
    {
        var totalRows = input.Rows.Count;
        var completePairs = complete.Count;
        var incompletePairs = pairs.Count(x => !x.HasA || !x.HasB);

        var missingA = pairs.Count(x => x.HasA && x.PriceA is not > 0m);
        var missingB = pairs.Count(x => x.HasB && x.PriceB is not > 0m);

        var countA = pairs.Count(x => x.HasA);
        var countB = pairs.Count(x => x.HasB);
        var samplingRatio = countB == 0 ? (countA == 0 ? 1m : 10m) : decimal.Round((decimal)countA / countB, 6, MidpointRounding.AwayFromZero);

        var medianInterval = ComputeMedianIntervalSeconds(complete);
        var spanSeconds = complete.Count < 2
            ? 0
            : (int)Math.Round((complete[^1].TimestampUtc - complete[0].TimestampUtc).TotalSeconds, MidpointRounding.AwayFromZero);

        var issues = new List<string>();

        if (completePairs < options.MinCompletePairs)
            issues.Add($"insufficient_complete_pairs:{completePairs}<{options.MinCompletePairs}");

        if (countA == 0)
            issues.Add("no_observations_asset_a");

        if (countB == 0)
            issues.Add("no_observations_asset_b");

        if (countA > 0 && pairs.Where(x => x.HasA).All(x => x.PriceA is not > 0m))
            issues.Add("no_valid_price_asset_a");

        if (countB > 0 && pairs.Where(x => x.HasB).All(x => x.PriceB is not > 0m))
            issues.Add("no_valid_price_asset_b");

        if (incompletePairs > 0)
            issues.Add($"incomplete_pairs:{incompletePairs}");

        if (duplicateTimestamps > 0)
            issues.Add($"duplicate_timestamps:{duplicateTimestamps}");

        if (missingA > 0)
            issues.Add($"missing_prices_asset_a:{missingA}");

        if (missingB > 0)
            issues.Add($"missing_prices_asset_b:{missingB}");

        if (countA > 0 && countB > 0
            && (samplingRatio < options.MinSamplingRatio || samplingRatio > options.MaxSamplingRatio))
            issues.Add($"sampling_imbalance:{samplingRatio}");

        var hasHigh =
            completePairs < options.MinCompletePairs
            || (countA > 0 && pairs.Where(x => x.HasA).All(x => x.PriceA is not > 0m))
            || (countB > 0 && pairs.Where(x => x.HasB).All(x => x.PriceB is not > 0m))
            || (countA > 0 && countB > 0 && (samplingRatio < options.MinSamplingRatio || samplingRatio > options.MaxSamplingRatio))
            || spanSeconds <= 0;

        var hasWarning = issues.Count > 0;

        var severity = hasHigh ? "high" : hasWarning ? "warning" : "ok";
        var isSufficient = !hasHigh;
        var canReconstruct = completePairs >= 2 && hasHigh == false;

        return new PriceCrossoverDataQuality
        {
            IsSufficient = isSufficient,
            CanReconstructChart = canReconstruct,
            Severity = severity,
            TotalSnapshotRows = totalRows,
            CompletePairs = completePairs,
            IncompletePairs = incompletePairs,
            DuplicateTimestamps = duplicateTimestamps,
            MissingPricesAssetA = missingA,
            MissingPricesAssetB = missingB,
            SamplingRatio = samplingRatio,
            MedianPairIntervalSeconds = medianInterval,
            ComparableSpanSeconds = spanSeconds,
            Issues = issues
        };
    }

    private static int ComputeMedianIntervalSeconds(IReadOnlyList<PriceCrossoverSeriesPoint> complete)
    {
        if (complete.Count < 2)
            return 0;

        var intervals = new List<int>(complete.Count - 1);
        for (var i = 1; i < complete.Count; i++)
        {
            var seconds = (int)Math.Round(
                (complete[i].TimestampUtc - complete[i - 1].TimestampUtc).TotalSeconds,
                MidpointRounding.AwayFromZero);
            if (seconds > 0)
                intervals.Add(seconds);
        }

        if (intervals.Count == 0)
            return 0;

        intervals.Sort();
        return intervals[intervals.Count / 2];
    }

    // ------------------------------------------------------------------
    // Divergencias em relacao a tela de Match
    // ------------------------------------------------------------------

    private static PriceCrossoverChartDivergence BuildChartDivergence(
        PriceCrossoverAnalysisInput input,
        PriceCrossoverBaseline baseline,
        IReadOnlyList<PriceCrossoverEvent> crossovers,
        PriceCrossoverAnalyzerOptions options)
    {
        var differences = new List<string>();

        var screenRows = input.ScreenWindowRows.Count > 0
            ? input.ScreenWindowRows
            : input.Rows;

        var screenA = screenRows
            .Where(x => x.Side == PriceCrossoverSide.A)
            .OrderBy(x => x.CapturedAtUtc)
            .ThenBy(x => x.RowId)
            .ToList();
        var screenB = screenRows
            .Where(x => x.Side == PriceCrossoverSide.B)
            .OrderBy(x => x.CapturedAtUtc)
            .ThenBy(x => x.RowId)
            .ToList();

        var screenWindowCoversFullMatch = screenRows.Count <= options.ScreenWindowRows;

        decimal? screenBaselineA = screenA.FirstOrDefault(x => x.LastPrice is > 0m)?.LastPrice;
        decimal? screenBaselineB = screenB.FirstOrDefault(x => x.LastPrice is > 0m)?.LastPrice;

        if (screenBaselineA != baseline.PriceA || screenBaselineB != baseline.PriceB)
        {
            differences.Add("baseline_differs_from_screen_window");
        }

        if (!screenWindowCoversFullMatch)
            differences.Add("screen_window_truncates_match_history");

        // Pareamento por indice da tela: desalinhamento quando os timestamps das duas listas diferem.
        var indexMisalignment = 0;
        var indexCount = Math.Min(screenA.Count, screenB.Count);
        for (var i = 0; i < indexCount; i++)
        {
            if (screenA[i].CapturedAtUtc != screenB[i].CapturedAtUtc)
                indexMisalignment++;
        }

        if (screenA.Count != screenB.Count)
            indexMisalignment += Math.Abs(screenA.Count - screenB.Count);

        if (indexMisalignment > 0)
            differences.Add($"screen_index_pairing_misaligned:{indexMisalignment}");

        // Mistura de unidades: pontos sem LastPrice na tela viram PercentageChange.
        var unitMixing = screenA.Count(x => x.LastPrice is not > 0m) + screenB.Count(x => x.LastPrice is not > 0m);
        if (unitMixing > 0)
            differences.Add($"screen_mixes_price_and_percentage:{unitMixing}");

        var screenCrossoverCount = CountScreenCrossovers(screenA, screenB);

        if (screenCrossoverCount != crossovers.Count)
            differences.Add($"crossover_count_differs:api={crossovers.Count},screen={screenCrossoverCount}");

        return new PriceCrossoverChartDivergence
        {
            MatchesScreenChart = differences.Count == 0,
            ApiBaselinePriceA = baseline.IsValid ? baseline.PriceA : null,
            ApiBaselinePriceB = baseline.IsValid ? baseline.PriceB : null,
            ScreenBaselinePriceA = screenBaselineA,
            ScreenBaselinePriceB = screenBaselineB,
            ScreenWindowCoversFullMatch = screenWindowCoversFullMatch,
            ApiPairingMode = "timestamp",
            ScreenPairingMode = "index",
            ScreenIndexMisalignmentCount = indexMisalignment,
            ScreenUnitMixingCount = unitMixing,
            ApiCrossoverCount = crossovers.Count,
            ScreenCrossoverCount = screenCrossoverCount,
            Differences = differences
        };
    }

    /// <summary>
    /// Reproduz literalmente o algoritmo da tela: normaliza cada lado pelo primeiro valor positivo
    /// da janela e compara por INDICE de array com semantica nao-estrita. Serve apenas para
    /// medir divergencia; nunca alimenta placar, vencedor ou metricas oficiais.
    /// </summary>
    private static int CountScreenCrossovers(
        IReadOnlyList<PriceCrossoverSnapshotRow> screenA,
        IReadOnlyList<PriceCrossoverSnapshotRow> screenB)
    {
        var valuesA = screenA
            .Select(x => x.LastPrice is > 0m ? x.LastPrice!.Value : x.PercentageChange)
            .Where(x => x > 0m)
            .ToList();
        var valuesB = screenB
            .Select(x => x.LastPrice is > 0m ? x.LastPrice!.Value : x.PercentageChange)
            .Where(x => x > 0m)
            .ToList();

        if (valuesA.Count == 0 || valuesB.Count == 0)
            return 0;

        var baseA = valuesA[0];
        var baseB = valuesB[0];
        if (baseA <= 0m || baseB <= 0m)
            return 0;

        var count = Math.Min(valuesA.Count, valuesB.Count);
        var crossings = 0;

        for (var i = 1; i < count; i++)
        {
            var previousGap = valuesA[i - 1] / baseA - valuesB[i - 1] / baseB;
            var currentGap = valuesA[i] / baseA - valuesB[i] / baseB;

            if (previousGap <= 0m && currentGap > 0m)
                crossings++;
            else if (previousGap >= 0m && currentGap < 0m)
                crossings++;
        }

        return crossings;
    }

    // ------------------------------------------------------------------
    // Serie: metadados e reducao visual
    // ------------------------------------------------------------------

    private static PriceCrossoverSeriesInfo BuildSeriesInfo(
        IReadOnlyList<PriceCrossoverPair> pairs,
        IReadOnlyList<PriceCrossoverSeriesPoint> complete,
        PriceCrossoverBaseline baseline,
        List<PriceCrossoverSeriesPoint> series,
        PriceCrossoverAnalyzerOptions options)
    {
        var missingNotes = new List<string>();

        if (pairs.Count != complete.Count)
            missingNotes.Add($"incomplete_points_excluded_from_metrics:{pairs.Count - complete.Count}");

        if (pairs.Count > 0 && pairs.Count(x => !x.HasA || !x.HasB) > 0)
            missingNotes.Add($"pairs_missing_one_side:{pairs.Count(x => !x.HasA || !x.HasB)}");

        if (pairs.Any(x => x.HasA && x.PriceA is not > 0m))
            missingNotes.Add("asset_a_has_non_positive_prices");

        if (pairs.Any(x => x.HasB && x.PriceB is not > 0m))
            missingNotes.Add("asset_b_has_non_positive_prices");

        var wasReduced = series.Count > options.MaxSeriesPoints;

        return new PriceCrossoverSeriesInfo
        {
            BaselinePriceA = baseline.IsValid ? baseline.PriceA : null,
            BaselinePriceB = baseline.IsValid ? baseline.PriceB : null,
            BaselineTimestampUtc = baseline.IsValid ? baseline.TimestampUtc : null,
            BaselineSource = "first_complete_pair",
            PairingMode = "timestamp",
            PointCount = series.Count,
            CompletePointCount = complete.Count,
            WasReducedForVisualization = wasReduced,
            FullPointCount = series.Count,
            MissingDataNotes = missingNotes
        };
    }

    /// <summary>
    /// Reducao EXCLUSIVAMENTE visual. Preserva sempre o primeiro ponto, o ultimo ponto completo
    /// e todo ponto que contenha um cruzamento. Nunca usada para recalcular metricas ou cruzamentos.
    /// </summary>
    private static IReadOnlyList<PriceCrossoverSeriesPoint> ReduceSeries(
        IReadOnlyList<PriceCrossoverSeriesPoint> series,
        IReadOnlyList<PriceCrossoverEvent> crossovers,
        int maxPoints)
    {
        if (series.Count <= maxPoints || maxPoints <= 0)
            return series;

        var mustKeep = new HashSet<int>();
        mustKeep.Add(0);
        mustKeep.Add(series.Count - 1);

        var crossTimes = new HashSet<DateTime>(crossovers.Select(x => x.TimestampUtc));
        for (var i = 0; i < series.Count; i++)
        {
            if (crossTimes.Contains(series[i].TimestampUtc))
                mustKeep.Add(i);
        }

        var stride = (int)Math.Ceiling(series.Count / (double)maxPoints);
        if (stride < 1)
            stride = 1;

        var reduced = new List<PriceCrossoverSeriesPoint>(maxPoints + mustKeep.Count);
        for (var i = 0; i < series.Count; i += stride)
        {
            if (mustKeep.Contains(i) || reduced.Count < maxPoints)
                reduced.Add(series[i]);
        }

        foreach (var index in mustKeep.OrderBy(x => x))
        {
            if (!reduced.Any(x => x.TimestampUtc == series[index].TimestampUtc))
                reduced.Add(series[index]);
        }

        return reduced
            .OrderBy(x => x.TimestampUtc)
            .ToList();
    }
}

// ======================================================================
// Tipos de entrada/saida do analisador (puros, sem EF Core)
// ======================================================================

public enum PriceCrossoverSide
{
    A = 0,
    B = 1
}

/// <summary>Uma linha de <c>MatchMetricSnapshot</c> normalizada para analise pura.</summary>
public sealed class PriceCrossoverSnapshotRow
{
    /// <summary><c>MatchMetricSnapshotId</c>. Usado apenas para desempate quando ha timestamp duplicado.</summary>
    public required long RowId { get; init; }

    public required PriceCrossoverSide Side { get; init; }

    public required DateTime CapturedAtUtc { get; init; }

    public decimal? LastPrice { get; init; }

    public decimal PercentageChange { get; init; }
}

public sealed class PriceCrossoverPair
{
    public required DateTime CapturedAtUtc { get; init; }
    public required bool HasA { get; init; }
    public required bool HasB { get; init; }
    public decimal? PriceA { get; init; }
    public decimal? PriceB { get; init; }
    public decimal PercentageChangeA { get; init; }
    public decimal PercentageChangeB { get; init; }
}

public sealed class PriceCrossoverAnalysisInput
{
    public required int MatchId { get; init; }
    public required int TeamAId { get; init; }
    public required int TeamBId { get; init; }
    public required string SymbolA { get; init; }
    public required string SymbolB { get; init; }

    /// <summary>Linhas de <c>MatchMetricSnapshot</c> da partida inteira.</summary>
    public required IReadOnlyList<PriceCrossoverSnapshotRow> Rows { get; init; }

    /// <summary>
    /// Linhas que a tela de Match buscaria (janela de 500 linhas, dois ativos misturados).
    /// Usada apenas para medir divergencia. Quando vazia, usa <see cref="Rows"/>.
    /// </summary>
    public IReadOnlyList<PriceCrossoverSnapshotRow> ScreenWindowRows { get; init; } = [];

    /// <summary>Placar oficial persistido em <c>Match.ScoreA</c>.</summary>
    public required int OfficialScoreA { get; init; }

    /// <summary>Placar oficial persistido em <c>Match.ScoreB</c>.</summary>
    public required int OfficialScoreB { get; init; }

    /// <summary><c>Match.WinnerTeamId</c>. Nunca inferido.</summary>
    public int? OfficialWinnerTeamId { get; init; }

    public string? EndReasonCode { get; init; }
    public DateTime? StartTimeUtc { get; init; }
    public DateTime? EndTimeUtc { get; init; }

    /// <summary>Eventos oficiais persistidos. Entram prontos; nao sao recalculados.</summary>
    public IReadOnlyList<PriceCrossoverOfficialEvent> OfficialEvents { get; init; } = [];

    public PriceCrossoverAnalyzerOptions? Options { get; init; }
}

public sealed class PriceCrossoverAnalysisOutcome
{
    public required PriceCrossoverAssetStats AssetA { get; init; }
    public required PriceCrossoverAssetStats AssetB { get; init; }
    public required PriceCrossoverComparativeStats Comparative { get; init; }
    public required int InterestScore { get; init; }
    public required PriceCrossoverInterestBreakdown InterestBreakdown { get; init; }
    public required PriceCrossoverDataQuality DataQuality { get; init; }
    public required PriceCrossoverChartDivergence ChartDivergence { get; init; }
    public required IReadOnlyList<PriceCrossoverSeriesPoint> Series { get; init; }
    public required PriceCrossoverSeriesInfo SeriesInfo { get; init; }
    public required IReadOnlyList<PriceCrossoverEvent> CrossoverEvents { get; init; }
    public required int CompletePairCount { get; init; }
}

public sealed class PriceCrossoverAnalyzerOptions
{
    /// <summary>Swing minimo (pontos percentuais) para um cruzamento ser considerado relevante.</summary>
    public decimal RelevantSwingPercent { get; init; } = 1.0m;

    /// <summary>Limiar de vantagem relativa (pontos percentuais) considerado "equilibrado".</summary>
    public decimal BalancedGapPercent { get; init; } = 2.0m;

    public int MinCompletePairs { get; init; } = 10;

    /// <summary>Tamanho da janela que a tela de Match usa (500 linhas de <c>MatchMetricSnapshot</c>).</summary>
    public int ScreenWindowRows { get; init; } = 500;

    public int MaxSeriesPoints { get; init; } = 360;

    /// <summary>Cadencia de reamostragem, em segundos, para medir intensidade de forma independente do numero de atualizacoes.</summary>
    public int IntensitySampleSeconds { get; init; } = 60;

    public int MedianGapMultiplier { get; init; } = 3;

    // Pesos do indice de interesse (soma = 100).
    public int WeightCrossoversAndComeback { get; init; } = PriceCrossoverDefaultWeights.CrossoversAndComeback;
    public int WeightCompetitiveness { get; init; } = PriceCrossoverDefaultWeights.Competitiveness;
    public int WeightPerformanceSpread { get; init; } = PriceCrossoverDefaultWeights.PerformanceSpread;
    public int WeightMovementIntensity { get; init; } = PriceCrossoverDefaultWeights.MovementIntensity;
    public int WeightRemarkableEvents { get; init; } = PriceCrossoverDefaultWeights.RemarkableEvents;

    public decimal IdealPerformanceGapPercent { get; init; } = 12m;
    public decimal MaxRelevantCrossoversPerHour { get; init; } = 4m;
    public decimal MaxMovementIntensityPercentPerHour { get; init; } = 20m;
    public decimal MaxRelativeVolatilityPercent { get; init; } = 4m;
    public decimal MaxOfficialEventsPerHour { get; init; } = 5m;
    public decimal MinSamplingRatio { get; init; } = 0.6m;
    public decimal MaxSamplingRatio { get; init; } = 1.67m;

    public static PriceCrossoverAnalyzerOptions Default { get; } = new();
}
