using BLL.NFTFutebol;
using DTOs;

namespace CriptoVersus.API.Tests;

public sealed class PriceCrossoverAnalyzerTests
{
    private static readonly DateTime Start = new(2026, 10, 17, 11, 0, 0, DateTimeKind.Utc);

    // ------------------------------------------------------------------
    // Regras de cruzamento
    // ------------------------------------------------------------------

    [Fact]
    public void Crossover_AssetAOverAssetB_Detected()
    {
        // A comeca empatado, cai para trás e depois ultrapassa B.
        var rows = new[]
        {
            Row(A, 0, 1.00m),
            Row(B, 0, 1.00m),
            Row(A, 1, 0.90m),
            Row(B, 1, 1.00m),
            Row(A, 2, 0.95m),
            Row(B, 2, 1.00m),
            Row(A, 3, 1.10m),
            Row(B, 3, 1.00m)
        };

        var outcome = Analyze(rows);

        // Semantica nao-estrita do gráfico: a saida do zero inicial tambem conta como cruzamento.
        Assert.Equal(2, outcome.CrossoverEvents.Count);

        var up = Assert.Single(outcome.CrossoverEvents, x => x.Direction == "up");
        Assert.Equal(1001, up.WinnerTeamId);
        Assert.True(up.PreviousLeadPercent < 0m);
        Assert.True(up.CurrentLeadPercent > 0m);

        Assert.Equal(1, outcome.AssetA.ChartRoundPoints);
        Assert.Equal(1, outcome.AssetB.ChartRoundPoints);
    }

    [Fact]
    public void Crossover_AssetBOverAssetA_Detected()
    {
        // A comeca empatado, sobe e depois e ultrapassado por B (que cai menos).
        var rows = new[]
        {
            Row(A, 0, 1.00m),
            Row(B, 0, 1.00m),
            Row(A, 1, 1.10m),
            Row(B, 1, 1.00m),
            Row(A, 2, 1.05m),
            Row(B, 2, 1.00m),
            Row(A, 3, 0.95m),
            Row(B, 3, 1.00m)
        };

        var outcome = Analyze(rows);

        Assert.Equal(2, outcome.CrossoverEvents.Count);

        var down = Assert.Single(outcome.CrossoverEvents, x => x.Direction == "down");
        Assert.Equal(1002, down.WinnerTeamId);
        Assert.True(down.PreviousLeadPercent > 0m);
        Assert.True(down.CurrentLeadPercent < 0m);

        Assert.Equal(1, outcome.AssetA.ChartRoundPoints);
        Assert.Equal(1, outcome.AssetB.ChartRoundPoints);
    }

    [Fact]
    public void Crossover_DepartureFromEqualBaseline_CountsAsCrossover()
    {
        // Comportamento fiel ao gráfico: a normalizacao comeca em 1.0 para os dois ativos,
        // entao a primeira saida do zero ja e contada como cruzamento.
        var rows = Linear(rowsA: [1.00m, 1.10m], rowsB: [1.00m, 1.00m]);

        var outcome = Analyze(rows);

        var cross = Assert.Single(outcome.CrossoverEvents);
        Assert.Equal("up", cross.Direction);
        Assert.Equal(0m, cross.PreviousLeadPercent);
    }

    [Fact]
    public void Crossover_EqualValues_ProduceNoEvent()
    {
        var rows = new[]
        {
            Row(A, 0, 1.00m),
            Row(B, 0, 1.00m),
            Row(A, 1, 1.00m),
            Row(B, 1, 1.00m),
            Row(A, 2, 1.00m),
            Row(B, 2, 1.00m)
        };

        var outcome = Analyze(rows);

        Assert.Empty(outcome.CrossoverEvents);
        Assert.Equal(0m, outcome.Comparative.MaxRelativeLeadPercent);
    }

    [Fact]
    public void Crossover_StableSeries_ProduceNoEvent()
    {
        // Os dois ativos andam juntos: a vantagem relativa permanece em zero.
        var rows = new List<PriceCrossoverSnapshotRow>();
        for (var i = 0; i < 10; i++)
        {
            rows.Add(Row(A, i, 1.00m + (i * 0.01m)));
            rows.Add(Row(B, i, 1.00m + (i * 0.01m)));
        }

        var outcome = Analyze(rows);

        Assert.Empty(outcome.CrossoverEvents);
        Assert.Equal(0, outcome.Comparative.TotalCrossovers);
        Assert.Equal(0m, outcome.Comparative.MaxRelativeLeadPercent);
    }

    [Fact]
    public void Crossover_TinyOscillations_ProduceOneEventPerStep_NoDebounce()
    {
        // Regra atual NAO tem debounce. Encostar exatamente no zero nao conta como cruzamento
        // em nenhuma direcao, entao a oscilacao gera um evento a cada saida real do zero.
        var rows = new List<PriceCrossoverSnapshotRow>();
        var pricesA = new[] { 0.99m, 1.01m, 0.99m, 1.01m, 0.99m, 1.01m };

        for (var i = 0; i < pricesA.Length; i++)
        {
            rows.Add(Row(A, i, pricesA[i]));
            rows.Add(Row(B, i, 1.00m));
        }

        var outcome = Analyze(rows);

        Assert.Equal(3, outcome.CrossoverEvents.Count);
    }

    [Fact]
    public void Crossover_SmallOscillations_AreNotCountedAsRelevant()
    {
        // Oscilacoes de ~2pp nao devem inflar a pontuacao de interesse quando o limiar de
        // relevancia e superior. O indice de interesse nao premia oscilacao miuda.
        var rows = new List<PriceCrossoverSnapshotRow>();
        var pricesA = new[] { 0.99m, 1.01m, 0.99m, 1.01m, 0.99m, 1.01m };

        for (var i = 0; i < pricesA.Length; i++)
        {
            rows.Add(Row(A, i, pricesA[i]));
            rows.Add(Row(B, i, 1.00m));
        }

        var outcome = Analyze(
            rows,
            options: new PriceCrossoverAnalyzerOptions
            {
                MinCompletePairs = 2,
                RelevantSwingPercent = 3.0m
            });

        Assert.Equal(3, outcome.CrossoverEvents.Count);
        Assert.Equal(0, outcome.Comparative.RelevantCrossovers);
    }

    [Fact]
    public void Crossover_MissingData_DoesNotFabricateEvents()
    {
        // B some no meio da serie: o trecho incompleto e descartado do pareamento e
        // o resultado e identico ao da serie sem o ponto orfao.
        var withGap = new List<PriceCrossoverSnapshotRow>
        {
            Row(A, 0, 1.00m),
            Row(B, 0, 1.00m),
            Row(A, 1, 1.20m),
            Row(A, 2, 0.80m),
            Row(B, 2, 1.00m)
        };

        var withoutGap = new List<PriceCrossoverSnapshotRow>
        {
            Row(A, 0, 1.00m),
            Row(B, 0, 1.00m),
            Row(A, 2, 0.80m),
            Row(B, 2, 1.00m)
        };

        var outcomeWithGap = Analyze(withGap);
        var outcomeWithoutGap = Analyze(withoutGap);

        Assert.Equal(2, outcomeWithGap.DataQuality.CompletePairs);
        Assert.Equal(1, outcomeWithGap.DataQuality.IncompletePairs);
        Assert.Equal(outcomeWithoutGap.CrossoverEvents.Count, outcomeWithGap.CrossoverEvents.Count);
        Assert.Equal(outcomeWithoutGap.Comparative.TotalCrossovers, outcomeWithGap.Comparative.TotalCrossovers);
        Assert.Contains(outcomeWithGap.DataQuality.Issues, x => x.StartsWith("incomplete_pairs"));
    }

    [Fact]
    public void Crossover_DuplicateTimestamps_KeepHighestRowIdPerSide()
    {
        var rows = new List<PriceCrossoverSnapshotRow>
        {
            Row(A, 0, 1.00m, rowId: 10),
            Row(A, 0, 1.50m, rowId: 11),
            Row(B, 0, 1.00m, rowId: 12),
            Row(A, 1, 1.50m, rowId: 13),
            Row(B, 1, 1.00m, rowId: 14)
        };

        var outcome = Analyze(rows);

        Assert.Equal(1, outcome.DataQuality.DuplicateTimestamps);
        Assert.Equal(2, outcome.DataQuality.CompletePairs);
        // O primeiro preco de A vira 1.50 (maior RowId), portanto nao ha cruzamento.
        Assert.Empty(outcome.CrossoverEvents);
    }

    [Fact]
    public void Crossover_TemporallyMisalignedSeries_ArePairedByTimestampNotIndex()
    {
        // A tem uma observacao extra no instante 1. Pareamento por indice deslocaria a serie;
        // pareamento por timestamp descarta o instante incompleto e mantem a semantica correta.
        var rows = new List<PriceCrossoverSnapshotRow>
        {
            Row(A, 0, 1.00m),
            Row(B, 0, 1.00m),
            Row(A, 1, 1.50m),
            Row(A, 2, 1.00m),
            Row(B, 2, 1.00m),
            Row(A, 3, 1.00m),
            Row(B, 3, 1.00m)
        };

        var outcome = Analyze(rows);

        Assert.Equal(3, outcome.DataQuality.CompletePairs);
        Assert.Equal(1, outcome.DataQuality.IncompletePairs);
        // Nenhuma virada real: A nunca fica abaixo nem acima de forma sustentada.
        Assert.Empty(outcome.CrossoverEvents);
        Assert.Equal("timestamp", outcome.ChartDivergence.ApiPairingMode);
    }

    [Fact]
    public void Crossover_VisualOnly_DoesNotChangeOfficialScore()
    {
        var rows = new List<PriceCrossoverSnapshotRow>();
        for (var i = 0; i < 6; i++)
        {
            rows.Add(Row(A, i, i % 2 == 0 ? 0.90m : 1.10m));
            rows.Add(Row(B, i, 1.00m));
        }

        var outcome = Analyze(rows, officialScoreA: 7, officialScoreB: 3);

        Assert.True(outcome.CrossoverEvents.Count > 0);
        Assert.Equal(7, outcome.AssetA.OfficialScore);
        Assert.Equal(3, outcome.AssetB.OfficialScore);
        Assert.NotEqual(outcome.AssetA.OfficialScore, outcome.AssetA.ChartRoundPoints);
    }

    // ------------------------------------------------------------------
    // Estatisticas
    // ------------------------------------------------------------------

    [Fact]
    public void Stats_PositiveVariation()
    {
        var outcome = Analyze(Linear(rowsA: [1.00m, 1.10m], rowsB: [1.00m, 1.00m]));

        Assert.Equal(10m, outcome.AssetA.PerformancePercent);
        Assert.Equal(0m, outcome.AssetB.PerformancePercent);
    }

    [Fact]
    public void Stats_NegativeVariation()
    {
        var outcome = Analyze(Linear(rowsA: [1.00m, 0.90m], rowsB: [1.00m, 1.00m]));

        Assert.Equal(-10m, outcome.AssetA.PerformancePercent);
    }

    [Fact]
    public void Stats_ZeroVariation()
    {
        var outcome = Analyze(Linear(rowsA: [1.00m, 1.00m], rowsB: [1.00m, 1.00m]));

        Assert.Equal(0m, outcome.AssetA.PerformancePercent);
        Assert.Equal(0m, outcome.Comparative.PerformanceDifferencePercent);
    }

    [Fact]
    public void Stats_InvalidFirstPairPrice_FallsBackToFirstValidPair()
    {
        // Preco inicial invalido e pulado: o baseline vira o primeiro par COMPLETO valido.
        var rows = new List<PriceCrossoverSnapshotRow>
        {
            Row(A, 0, 0m),
            Row(B, 0, 0m),
            Row(A, 1, 1.00m),
            Row(B, 1, 1.00m)
        };

        var outcome = Analyze(rows);

        Assert.Equal(1.00m, outcome.AssetA.InitialPrice);
        Assert.Equal(0m, outcome.AssetA.PerformancePercent);
        Assert.Equal(1, outcome.DataQuality.CompletePairs);
    }

    [Fact]
    public void Stats_NoValidPriceAtAll_ProducesNoAnalysis()
    {
        var rows = new List<PriceCrossoverSnapshotRow>
        {
            Row(A, 0, 0m),
            Row(B, 0, 0m),
            Row(A, 1, -1m),
            Row(B, 1, 0m)
        };

        var outcome = Analyze(rows);

        Assert.Null(outcome.AssetA.InitialPrice);
        Assert.Null(outcome.AssetA.PerformancePercent);
        Assert.Equal("high", outcome.DataQuality.Severity);
        Assert.False(outcome.DataQuality.IsSufficient);
        Assert.Contains(outcome.DataQuality.Issues, x => x == "no_valid_price_asset_a");
        Assert.Contains(outcome.DataQuality.Issues, x => x == "no_valid_price_asset_b");
    }

    [Fact]
    public void Stats_PerformanceDifferenceInPercentagePoints()
    {
        var outcome = Analyze(Linear(rowsA: [1.00m, 1.09m], rowsB: [1.00m, 0.98m]));

        Assert.Equal(9m, outcome.AssetA.PerformancePercent);
        Assert.Equal(-2m, outcome.AssetB.PerformancePercent);
        Assert.Equal(11m, outcome.Comparative.PerformanceDifferencePercent);
    }

    [Fact]
    public void Stats_VolatilityIsMeasured()
    {
        var flat = Analyze(Linear(rowsA: [1.00m, 1.00m, 1.00m, 1.00m], rowsB: [1.00m, 1.00m, 1.00m, 1.00m]));
        var swinging = Analyze(Linear(rowsA: [1.00m, 1.30m, 0.70m, 1.00m], rowsB: [1.00m, 1.00m, 1.00m, 1.00m]));

        Assert.True(swinging.Comparative.RelativeVolatilityPercent > flat.Comparative.RelativeVolatilityPercent);
    }

    [Fact]
    public void Stats_IncompleteData_FlaggedAndBlocksPublication()
    {
        var rows = new List<PriceCrossoverSnapshotRow>
        {
            Row(A, 0, 1.00m),
            Row(B, 0, 1.00m)
        };

        var outcome = Analyze(rows);

        Assert.False(outcome.DataQuality.IsSufficient);
        Assert.Contains(outcome.DataQuality.Issues, x => x.StartsWith("insufficient_complete_pairs"));
    }

    [Fact]
    public void Stats_OfficialWinnerCanDifferFromBestPerformance()
    {
        // A valoriza mais, mas o vencedor oficial e B (placar 0 x 3).
        var rows = Linear(rowsA: [1.00m, 1.20m], rowsB: [1.00m, 0.90m]);
        var outcome = Analyze(rows, officialScoreA: 0, officialScoreB: 3, winnerTeamId: 1002);

        Assert.Equal(20m, outcome.AssetA.PerformancePercent);
        Assert.Equal(-10m, outcome.AssetB.PerformancePercent);
        Assert.Equal(0, outcome.AssetA.OfficialScore);
        Assert.Equal(3, outcome.AssetB.OfficialScore);
    }

    [Fact]
    public void Stats_ReadOnlyFromOfficialEvents_NeverRecalculated()
    {
        // Eventos entram prontos. A analise apenas contabiliza; nunca recalcula pontos.
        var official = new[]
        {
            new PriceCrossoverOfficialEvent
            {
                EventSequence = 1,
                TeamId = 1002,
                Points = 2,
                EventType = "PERCENT_THRESHOLD_REACHED",
                EventTimeUtc = Start
            },
            new PriceCrossoverOfficialEvent
            {
                EventSequence = 2,
                TeamId = 1001,
                Points = 3,
                EventType = "PERCENTAGE_CROSSOVER_UP",
                EventTimeUtc = Start.AddMinutes(30)
            }
        };

        var outcome = Analyze(Linear(rowsA: [1.00m, 1.10m], rowsB: [1.00m, 1.00m]), officialEvents: official);

        Assert.Equal(1, outcome.AssetA.OfficialEventsWon);
        Assert.Equal(1, outcome.AssetB.OfficialEventsWon);
        // Placar oficial passa de 0x2 para 3x2: uma mudanca de lideranca.
        Assert.Equal(1, outcome.Comparative.OfficialLeadChanges);
    }

    // ------------------------------------------------------------------
    // Simetria A/B
    // ------------------------------------------------------------------

    [Fact]
    public void Symmetry_SwappingAssetsMirrorsResults()
    {
        var rows = Linear(rowsA: [1.00m, 1.10m, 1.20m], rowsB: [1.00m, 1.05m, 1.02m]);
        var direct = Analyze(rows);

        var swappedRows = rows
            .Select(r => new PriceCrossoverSnapshotRow
            {
                RowId = r.RowId,
                Side = r.Side == PriceCrossoverSide.A ? PriceCrossoverSide.B : PriceCrossoverSide.A,
                CapturedAtUtc = r.CapturedAtUtc,
                LastPrice = r.LastPrice,
                PercentageChange = r.PercentageChange
            })
            .ToList();

        var swapped = Analyze(
            swappedRows,
            teamAId: 1002,
            teamBId: 1001,
            symbolA: "EIGENUSDT",
            symbolB: "EPICUSDT");

        Assert.Equal(direct.Comparative.TotalCrossovers, swapped.Comparative.TotalCrossovers);
        Assert.Equal(
            direct.Comparative.PerformanceDifferencePercent * -1,
            swapped.Comparative.PerformanceDifferencePercent);
        Assert.Equal(direct.InterestScore, swapped.InterestScore);
    }

    // ------------------------------------------------------------------
    // Divergencia com a tela
    // ------------------------------------------------------------------

    [Fact]
    public void Divergence_ReportsScreenBaselineAndPairing()
    {
        var rows = Linear(rowsA: [1.00m, 1.10m, 1.20m], rowsB: [1.00m, 1.05m, 1.02m]);
        var outcome = Analyze(rows);

        Assert.Equal("timestamp", outcome.ChartDivergence.ApiPairingMode);
        Assert.Equal("index", outcome.ChartDivergence.ScreenPairingMode);
        Assert.True(outcome.ChartDivergence.ScreenWindowCoversFullMatch);
        Assert.Equal(outcome.ChartDivergence.ApiCrossoverCount, outcome.ChartDivergence.ScreenCrossoverCount);
    }

    [Fact]
    public void Divergence_DetectsUnitMixingOnScreen()
    {
        var rows = new List<PriceCrossoverSnapshotRow>
        {
            Row(A, 0, 1.00m),
            Row(B, 0, 1.00m),
            new() { RowId = 3, Side = PriceCrossoverSide.A, CapturedAtUtc = Start.AddSeconds(30), LastPrice = null, PercentageChange = 5m },
            Row(B, 1, 1.00m),
            Row(A, 2, 1.10m),
            Row(B, 2, 1.00m)
        };

        var outcome = Analyze(rows);

        Assert.True(outcome.ChartDivergence.ScreenUnitMixingCount > 0);
        Assert.False(outcome.ChartDivergence.MatchesScreenChart);
        Assert.Contains(outcome.ChartDivergence.Differences, x => x.StartsWith("screen_mixes_price_and_percentage"));
    }

    // ------------------------------------------------------------------
    // Série
    // ------------------------------------------------------------------

    [Fact]
    public void Series_PreservesTemporalOrderAndMarksIncomplete()
    {
        var rows = new List<PriceCrossoverSnapshotRow>
        {
            Row(A, 0, 1.00m),
            Row(B, 0, 1.00m),
            Row(A, 1, 1.10m),
            Row(B, 2, 1.00m),
            Row(A, 2, 1.20m)
        };

        var outcome = Analyze(rows);

        Assert.Equal(3, outcome.Series.Count);
        Assert.Equal(Start, outcome.Series[0].TimestampUtc);
        Assert.True(outcome.Series[0].IsComplete);
        Assert.False(outcome.Series[1].IsComplete);
        Assert.Null(outcome.Series[1].AssetB);
        Assert.True(outcome.Series[2].IsComplete);
    }

    [Fact]
    public void Series_ReductionNeverUsedForMetrics()
    {
        var rows = new List<PriceCrossoverSnapshotRow>();
        for (var i = 0; i < 50; i++)
        {
            rows.Add(Row(A, i, 1.00m + (i % 5) * 0.02m));
            rows.Add(Row(B, i, 1.00m));
        }

        var options = new PriceCrossoverAnalyzerOptions { MaxSeriesPoints = 10 };
        var outcome = Analyze(rows, options: options);

        Assert.True(outcome.SeriesInfo.WasReducedForVisualization);
        Assert.Equal(50, outcome.SeriesInfo.FullPointCount);
        Assert.True(outcome.Series.Count < 50);
        // Metricas continuam calculadas sobre a serie completa.
        Assert.Equal(50, outcome.DataQuality.CompletePairs);
    }

    // ------------------------------------------------------------------
    // Cross-check contra a tela de Match
    // ------------------------------------------------------------------

    [Fact]
    public void CrossCheck_ChartRoundPoints_MatchTvBattleScoreEvaluator()
    {
        // A analise social precisa reproduzir o "PONTOS DA RODADA" que a tela de Match mostra
        // para os mesmos pontos. Este teste ancora a API no componente real do frontend.
        var pricesA = new[] { 1.00m, 0.90m, 0.95m, 1.10m, 1.05m, 1.20m, 1.15m };
        var pricesB = new[] { 1.00m, 1.00m, 1.00m, 1.00m, 1.00m, 1.00m, 1.00m };

        var outcome = Analyze(Linear(rowsA: pricesA, rowsB: pricesB));
        var screenScore = ScreenScore(pricesA, pricesB);

        Assert.Equal(screenScore.LeftWins, outcome.AssetA.ChartRoundPoints);
        Assert.Equal(screenScore.RightWins, outcome.AssetB.ChartRoundPoints);
        Assert.Equal(screenScore.TotalPoints, outcome.Comparative.TotalCrossovers);
    }

    [Fact]
    public void CrossCheck_ChartRoundPoints_MatchesScreenOnRandomishSeries()
    {
        var pricesA = new[] { 0.98m, 1.02m, 0.97m, 1.03m, 0.99m, 1.05m, 0.96m, 1.01m };
        var pricesB = new[] { 1.00m, 1.01m, 0.99m, 1.00m, 1.02m, 0.98m, 1.00m, 1.01m };

        var outcome = Analyze(Linear(rowsA: pricesA, rowsB: pricesB));
        var screenScore = ScreenScore(pricesA, pricesB);

        Assert.Equal(screenScore.LeftWins, outcome.AssetA.ChartRoundPoints);
        Assert.Equal(screenScore.RightWins, outcome.AssetB.ChartRoundPoints);
        Assert.Equal(screenScore.TotalPoints, outcome.Comparative.TotalCrossovers);
    }

    private static CriptoVersus.Web.Services.PriceBattleScore ScreenScore(
        decimal[] pricesA,
        decimal[] pricesB)
    {
        static long UnixSeconds(int index)
            => new DateTimeOffset(Start.AddSeconds(index * 30)).ToUnixTimeSeconds();

        var leftPoints = pricesA
            .Select((price, index) => new TvPriceChartPoint(UnixSeconds(index), price))
            .ToList();
        var rightPoints = pricesB
            .Select((price, index) => new TvPriceChartPoint(UnixSeconds(index), price))
            .ToList();

        return CriptoVersus.Web.Services.TvBattleScoreEvaluator.EvaluatePriceBattle(leftPoints, rightPoints);
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    private const PriceCrossoverSide A = PriceCrossoverSide.A;
    private const PriceCrossoverSide B = PriceCrossoverSide.B;

    private static PriceCrossoverSnapshotRow Row(
        PriceCrossoverSide s,
        int step,
        decimal price,
        long rowId = 0)
        => new()
        {
            RowId = rowId == 0 ? (step * 10L) + (s == PriceCrossoverSide.A ? 1L : 2L) : rowId,
            Side = s,
            CapturedAtUtc = Start.AddSeconds(step * 30),
            LastPrice = price,
            PercentageChange = 0m
        };

    private static List<PriceCrossoverSnapshotRow> Linear(decimal[] rowsA, decimal[] rowsB)
    {
        var rows = new List<PriceCrossoverSnapshotRow>();
        for (var i = 0; i < rowsA.Length; i++)
            rows.Add(Row(A, i, rowsA[i]));
        for (var i = 0; i < rowsB.Length; i++)
            rows.Add(Row(B, i, rowsB[i]));
        return rows;
    }

    private static PriceCrossoverAnalysisOutcome Analyze(
        IReadOnlyList<PriceCrossoverSnapshotRow> rows,
        int officialScoreA = 0,
        int officialScoreB = 0,
        int? winnerTeamId = null,
        int teamAId = 1001,
        int teamBId = 1002,
        string symbolA = "EPICUSDT",
        string symbolB = "EIGENUSDT",
        IReadOnlyList<PriceCrossoverOfficialEvent>? officialEvents = null,
        PriceCrossoverAnalyzerOptions? options = null)
    {
        var analyzer = new PriceCrossoverAnalyzer();

        return analyzer.Analyze(new PriceCrossoverAnalysisInput
        {
            MatchId = 1,
            TeamAId = teamAId,
            TeamBId = teamBId,
            SymbolA = symbolA,
            SymbolB = symbolB,
            Rows = rows,
            OfficialScoreA = officialScoreA,
            OfficialScoreB = officialScoreB,
            OfficialWinnerTeamId = winnerTeamId,
            EndReasonCode = "TIME_LIMIT",
            StartTimeUtc = Start,
            EndTimeUtc = Start.AddMinutes(90),
            OfficialEvents = officialEvents ?? [],
            Options = options ?? new PriceCrossoverAnalyzerOptions { MinCompletePairs = 2 }
        });
    }
}
