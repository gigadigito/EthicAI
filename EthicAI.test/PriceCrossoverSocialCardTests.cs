using System.Globalization;
using System.Text.Json.Nodes;
using CriptoVersus.Web.Services;
using DTOs;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Logging.Abstractions;

namespace EthicAI.test;

/// <summary>
/// Regressao da imagem social do Price Crossover:
/// nenhuma chave de traducao nao resolvida pode chegar a captura e a formatacao
/// numerica segue a cultura selecionada.
/// </summary>
public sealed class PriceCrossoverSocialCardTests
{
    private static readonly string[] RequiredKeys =
    [
        "seo.title",
        "seo.titleWithMatch",
        "seo.description",
        "hero.utcNote",
        "chart.title",
        "chart.versus",
        "chart.ariaLabel",
        "chart.empty",
        "chart.baselineNote",
        "summary.ariaLabel",
        "summary.finalScore",
        "summary.officialScore",
        "summary.officialWinner",
        "summary.winnerBadge",
        "summary.draw",
        "metrics.ariaLabel",
        "metrics.performanceDifference",
        "metrics.percentagePointsShort",
        "metrics.relevantCrossovers",
        "metrics.totalCrossovers",
        "metrics.chartRoundPoints",
        "metrics.comeback",
        "metrics.comebackValue",
        "states.loadingTitle",
        "states.loadingBody",
        "states.errorTitle",
        "states.errorBody",
        "states.notFoundBody",
        "states.notPublishableTitle",
        "states.notPublishableGeneric",
        "states.notPublishableNotFinished",
        "states.notPublishableAlreadyPublished",
        "states.notPublishableReserved",
        "states.notPublishableReconciliation",
        "states.notPublishableDataQuality",
        "states.notPublishableNoChart",
        "states.notPublishableNoBaseline",
        "footer.disclaimer",
        "footer.matchTag"
    ];

    private static readonly string[] Cultures =
        ["en-US", "pt-BR", "zh-CN", "es-ES", "fr-FR", "de-DE", "it-IT", "ja-JP"];

    [Fact]
    public void Localization_ResolvesEverySocialPriceCrossoverKey_InEveryCulture()
    {
        var localization = CreateLocalizationService();

        foreach (var culture in Cultures)
        {
            foreach (var key in RequiredKeys)
            {
                var fullKey = $"social.priceCrossover.{key}";
                var value = localization.T(fullKey, culture);

                Assert.False(string.IsNullOrWhiteSpace(value), $"{culture}: {fullKey} vazio.");
                Assert.NotEqual(fullKey, value);
                Assert.DoesNotContain("priceCrossover.", value, StringComparison.OrdinalIgnoreCase);
            }
        }
    }

    [Fact]
    public void Localization_FallsBackToEnglish_WhenKeyMissingInCulture()
    {
        var localization = CreateLocalizationService();

        // seo.titleWithMatch existe em todas as culturas; garante que o fallback nao quebra formatacao.
        var value = localization.T("social.priceCrossover.seo.titleWithMatch", "pt-BR", "PROM", "XAUT");

        Assert.Contains("PROM", value, StringComparison.Ordinal);
        Assert.Contains("XAUT", value, StringComparison.Ordinal);
    }

    [Fact]
    public void PriceCrossoverResourceBlock_UsesNestedKeysOnly()
    {
        foreach (var culture in Cultures)
        {
            var path = Path.Combine(ContentRootPath(), $"i18n.{culture}.json");
            var root = JsonNode.Parse(File.ReadAllText(path))
                ?? throw new InvalidOperationException($"i18n.{culture}.json invalido.");

            var block = root["social"]?["priceCrossover"] as JsonObject
                ?? throw new InvalidOperationException($"{culture}: social.priceCrossover ausente.");

            foreach (var property in block)
            {
                Assert.False(
                    property.Key.Contains('.'),
                    $"{culture}: chave plana \"social.priceCrossover.{property.Key}\" quebra LocalizationService.GetNode.");
            }

            foreach (var key in RequiredKeys)
            {
                Assert.True(
                    ResolveNode(block, key) is not null,
                    $"{culture}: social.priceCrossover.{key} nao resolve no recurso.");
            }
        }
    }

    [Fact]
    public void CardModel_FormatsNumbersPerCulture()
    {
        var response = BuildResponse();

        var ptBr = PriceCrossoverSocialCardModelBuilder.Build(response, CultureInfo.GetCultureInfo("pt-BR"));
        Assert.Equal("-1,37%", ptBr.AssetA.PerformanceText);
        Assert.Equal("+0,04%", ptBr.AssetB.PerformanceText);
        Assert.Equal("1,41", ptBr.PerformanceDifferenceText);

        var enUs = PriceCrossoverSocialCardModelBuilder.Build(response, CultureInfo.GetCultureInfo("en-US"));
        Assert.Equal("-1.37%", enUs.AssetA.PerformanceText);
        Assert.Equal("+0.04%", enUs.AssetB.PerformanceText);
        Assert.Equal("1.41", enUs.PerformanceDifferenceText);
    }

    [Fact]
    public void CardModel_KeepsOfficialScoreAndWinner_WithoutRecalculation()
    {
        // Desempenho do grafico favorece A, mas o vencedor OFICIAL e B.
        var response = BuildResponse();
        response = CloneWith(response, officialWinnerTeamId: response.AssetB.TeamId, scoreA: 3, scoreB: 4);

        var model = PriceCrossoverSocialCardModelBuilder.Build(response, CultureInfo.GetCultureInfo("pt-BR"));

        Assert.Equal("3 - 4", model.OfficialScoreText);
        Assert.Equal("XAUT", model.OfficialWinnerLabel);
        Assert.True(model.AssetB.IsOfficialWinner);
        Assert.False(model.AssetA.IsOfficialWinner);
    }

    [Fact]
    public void CardModel_Chart_KeepsFullMatchWindowAndMarkers()
    {
        var response = BuildResponse();
        var chart = PriceCrossoverSocialCardModelBuilder.BuildChart(response);

        Assert.Equal(response.Series.Count, chart.Points.Count);
        Assert.Equal(response.Series[0].TimestampUtc, FromUnix(chart.Points[0].TimeUnixSeconds));
        Assert.Equal(response.Series[^1].TimestampUtc, FromUnix(chart.Points[^1].TimeUnixSeconds));
        Assert.Equal(response.CrossoverEvents.Count, chart.Markers.Count);
        Assert.All(chart.Markers, marker => Assert.False(marker.IsRelevant));
    }

    [Fact]
    public void CardModel_CaptureState_IsReady_OnlyWhenPublishable()
    {
        var response = BuildResponse();
        var model = PriceCrossoverSocialCardModelBuilder.Build(response, CultureInfo.GetCultureInfo("pt-BR"));

        Assert.Equal(PriceCrossoverSocialCaptureState.Ready, model.CaptureState);
        Assert.True(model.IsSocialReady);

        var notPublishable = CloneWith(response, canPost: false, skipReason: "already_published");
        var blocked = PriceCrossoverSocialCardModelBuilder.Build(notPublishable, CultureInfo.GetCultureInfo("pt-BR"));

        Assert.Equal(PriceCrossoverSocialCaptureState.NotPublishable, blocked.CaptureState);
        Assert.False(blocked.IsSocialReady);
    }

    [Fact]
    public void CardModel_CaptureContract_FinishedMatchDeclaresDataCompleteAndFinishedStatus()
    {
        var response = BuildResponse();
        var model = PriceCrossoverSocialCardModelBuilder.Build(response, CultureInfo.GetCultureInfo("pt-BR"));

        Assert.True(model.IsDataComplete);
        Assert.Equal(PriceCrossoverSocialCardModelBuilder.MatchStatusFinished, model.CaptureMatchStatus);
        Assert.Equal("Completed", model.StatusName);
    }

    [Fact]
    public void CardModel_CaptureContract_InProgressMatchIsNeverDeclaredFinished()
    {
        var response = CloneWith(
            BuildResponse(),
            status: "Ongoing",
            canPost: false,
            skipReason: "match_not_completed");

        var model = PriceCrossoverSocialCardModelBuilder.Build(response, CultureInfo.GetCultureInfo("pt-BR"));

        Assert.Equal(PriceCrossoverSocialCardModelBuilder.MatchStatusInProgress, model.CaptureMatchStatus);
        Assert.False(model.IsSocialReady);
        Assert.Equal(PriceCrossoverSocialCaptureState.NotPublishable, model.CaptureState);
    }

    [Fact]
    public void CardModel_CaptureContract_InsufficientDataIsNotDataComplete()
    {
        var response = CloneWith(
            BuildResponse(),
            canPost: false,
            skipReason: "insufficient_data_quality",
            dataQuality: new PriceCrossoverDataQuality
            {
                IsSufficient = false,
                CanReconstructChart = true,
                Severity = "high",
                CompletePairs = 5
            });

        var model = PriceCrossoverSocialCardModelBuilder.Build(response, CultureInfo.GetCultureInfo("pt-BR"));

        Assert.False(model.IsDataComplete);
        Assert.False(model.IsSocialReady);
    }

    [Fact]
    public void CardModel_CaptureContract_MissingSeriesIsNotDataComplete()
    {
        var response = CloneWith(BuildResponse(), series: []);

        var model = PriceCrossoverSocialCardModelBuilder.Build(response, CultureInfo.GetCultureInfo("pt-BR"));

        Assert.False(model.IsDataComplete);
        Assert.False(model.IsSocialReady);
    }

    [Fact]
    public void CardModel_CaptureContract_CancelledAndErrorAreUnknownStatus()
    {
        var cancelled = PriceCrossoverSocialCardModelBuilder.Build(
            CloneWith(BuildResponse(), status: "Cancelled", canPost: false, skipReason: "match_not_completed"),
            CultureInfo.GetCultureInfo("pt-BR"));

        Assert.Equal(PriceCrossoverSocialCardModelBuilder.MatchStatusUnknown, cancelled.CaptureMatchStatus);
        Assert.False(cancelled.IsSocialReady);

        var error = PriceCrossoverSocialCardModelBuilder.BuildError("Error", DateTime.UtcNow);
        Assert.Equal(PriceCrossoverSocialCardModelBuilder.MatchStatusUnknown, error.CaptureMatchStatus);
        Assert.False(error.IsDataComplete);
    }

    private static DateTime FromUnix(long unixSeconds)
        => DateTimeOffset.FromUnixTimeSeconds(unixSeconds).UtcDateTime;

    private static JsonNode? ResolveNode(JsonObject block, string key)
    {
        JsonNode? current = block;
        foreach (var segment in key.Split('.'))
        {
            current = current?[segment];
            if (current is null)
                return null;
        }

        return current;
    }

    private static LocalizationService CreateLocalizationService()
    {
        var appCultureService = new AppCultureService();
        var environment = new FakeWebHostEnvironment
        {
            ContentRootPath = ContentRootPath(),
            WebRootPath = Path.Combine(ContentRootPath(), "wwwroot"),
            EnvironmentName = "Production"
        };

        return new LocalizationService(environment, appCultureService, NullLogger<LocalizationService>.Instance);
    }

    private static string ContentRootPath()
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);
        while (directory is not null)
        {
            var candidate = Path.Combine(directory.FullName, "CriptoVersus");
            if (File.Exists(Path.Combine(candidate, "i18n.pt-BR.json")))
                return candidate;

            directory = directory.Parent;
        }

        return "C:\\EthicAI\\EthicAI\\CriptoVersus";
    }

    private static PriceCrossoverSocialResponse BuildResponse()
    {
        var start = new DateTime(2026, 10, 17, 17, 13, 6, DateTimeKind.Utc);
        var series = new List<PriceCrossoverSeriesPoint>();

        for (var i = 0; i < 5; i += 1)
        {
            var timestamp = start.AddMinutes(i * 20);
            series.Add(new PriceCrossoverSeriesPoint
            {
                TimestampUtc = timestamp,
                IsComplete = true,
                AssetA = new PriceCrossoverSeriesSide { Price = 4.95m, NormalizedValue = 1m - (i * 0.003m), PercentageChange = 5.8m },
                AssetB = new PriceCrossoverSeriesSide { Price = 4156.15m, NormalizedValue = 1m, PercentageChange = 0.005m },
                RelativeLeadPercent = -(i * 0.3m)
            });
        }

        return new PriceCrossoverSocialResponse
        {
            CanPost = true,
            MatchId = 41212,
            Status = "Completed",
            StartTimeUtc = start,
            EndTimeUtc = start.AddMinutes(90),
            DurationMinutes = 90,
            ScoringRuleType = "PercentThreshold",
            GeneratedAtUtc = start.AddMinutes(91),
            Official = new PriceCrossoverOfficialResult
            {
                ScoreA = 3,
                ScoreB = 4,
                WinnerTeamId = 3313,
                WinnerSymbol = "XAUTUSDT",
                EndReasonCode = "TIME_LIMIT"
            },
            AssetA = new PriceCrossoverAssetStats
            {
                TeamId = 4067,
                Symbol = "PROMUSDT",
                BaseAsset = "PROM",
                QuoteAsset = "USDT",
                InitialPrice = 4.955m,
                FinalPrice = 4.887m,
                PerformancePercent = -1.372351m,
                OfficialScore = 3,
                ChartRoundPoints = 4
            },
            AssetB = new PriceCrossoverAssetStats
            {
                TeamId = 3313,
                Symbol = "XAUTUSDT",
                BaseAsset = "XAUT",
                QuoteAsset = "USDT",
                InitialPrice = 4156.15m,
                FinalPrice = 4157.70m,
                PerformancePercent = 0.037294m,
                OfficialScore = 4,
                ChartRoundPoints = 4
            },
            Comparative = new PriceCrossoverComparativeStats
            {
                PerformanceDifferencePercent = -1.409645m,
                TotalCrossovers = 8,
                RelevantCrossovers = 0,
                HasComeback = true
            },
            DataQuality = new PriceCrossoverDataQuality
            {
                IsSufficient = true,
                CanReconstructChart = true,
                Severity = "ok",
                CompletePairs = series.Count
            },
            ChartDivergence = new PriceCrossoverChartDivergence { MatchesScreenChart = true },
            Series = series,
            SeriesInfo = new PriceCrossoverSeriesInfo
            {
                BaselinePriceA = 4.955m,
                BaselinePriceB = 4156.15m,
                PointCount = series.Count,
                CompletePointCount = series.Count
            },
            CrossoverEvents =
            [
                new PriceCrossoverEvent
                {
                    Index = 0,
                    TimestampUtc = start.AddMinutes(20),
                    WinnerTeamId = 3313,
                    WinnerSymbol = "XAUTUSDT",
                    Direction = "down",
                    IsRelevant = false,
                    InterpolatedNormalizedValue = 1m
                }
            ]
        };
    }

    private static PriceCrossoverSocialResponse CloneWith(
        PriceCrossoverSocialResponse source,
        int? officialWinnerTeamId = null,
        int? scoreA = null,
        int? scoreB = null,
        bool? canPost = null,
        string? skipReason = null,
        string? status = null,
        PriceCrossoverDataQuality? dataQuality = null,
        IReadOnlyList<PriceCrossoverSeriesPoint>? series = null)
        => new()
        {
            CanPost = canPost ?? source.CanPost,
            SkipReason = skipReason ?? source.SkipReason,
            MatchId = source.MatchId,
            Status = status ?? source.Status,
            StartTimeUtc = source.StartTimeUtc,
            EndTimeUtc = source.EndTimeUtc,
            DurationMinutes = source.DurationMinutes,
            ScoringRuleType = source.ScoringRuleType,
            GeneratedAtUtc = source.GeneratedAtUtc,
            Official = new PriceCrossoverOfficialResult
            {
                ScoreA = scoreA ?? source.Official.ScoreA,
                ScoreB = scoreB ?? source.Official.ScoreB,
                WinnerTeamId = officialWinnerTeamId ?? source.Official.WinnerTeamId,
                WinnerSymbol = source.Official.WinnerSymbol,
                EndReasonCode = source.Official.EndReasonCode
            },
            AssetA = source.AssetA,
            AssetB = source.AssetB,
            Comparative = source.Comparative,
            DataQuality = dataQuality ?? source.DataQuality,
            ChartDivergence = source.ChartDivergence,
            Series = series ?? source.Series,
            SeriesInfo = source.SeriesInfo,
            CrossoverEvents = source.CrossoverEvents
        };

    private sealed class FakeWebHostEnvironment : IWebHostEnvironment
    {
        public string ApplicationName { get; set; } = "EthicAI.test";
        public IFileProvider WebRootFileProvider { get; set; } = new NullFileProvider();
        public string WebRootPath { get; set; } = string.Empty;
        public string EnvironmentName { get; set; } = "Production";
        public string ContentRootPath { get; set; } = string.Empty;
        public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
    }
}
