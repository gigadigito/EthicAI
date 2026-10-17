using System.Globalization;
using DTOs;

namespace CriptoVersus.Web.Services;

/// <summary>Estado de captura da pagina social. O Browserless so captura em <see cref="Ready"/>.</summary>
public enum PriceCrossoverSocialCaptureState
{
    Loading = 0,
    Ready = 1,
    NotPublishable = 2,
    Error = 3
}

/// <summary>Dados de exibicao de um dos competidores.</summary>
public sealed record PriceCrossoverSocialCardAsset(
    int TeamId,
    string Symbol,
    string BaseAsset,
    string QuoteAsset,
    string DisplaySymbol,
    string LogoUrl,
    decimal? PerformancePercent,
    string PerformanceText,
    int OfficialScore,
    int ChartRoundPoints,
    int CrossoversWon,
    bool IsOfficialWinner);

/// <summary>
/// Ponto da serie historica ja normalizado pelo baseline fixo da API.
/// Nenhum valor e interpolado: pontos incompletos ficam fora da serie de desenho.
/// Os dois valores normalizados sao preservados separadamente, para desenhar as duas curvas.
/// </summary>
public sealed record PriceCrossoverSocialChartPoint(
    long TimeUnixSeconds,
    decimal NormalizedValueA,
    decimal NormalizedValueB,
    decimal RelativeLeadPercent,
    int SecondsFromPrevious);

/// <summary>Marcador de cruzamento. Posicao fornecida pela API, nunca recalculada no frontend.</summary>
public sealed record PriceCrossoverSocialChartMarker(
    long TimeUnixSeconds,
    decimal NormalizedValue,
    string Direction,
    bool IsRelevant,
    string WinnerSymbol,
    int WinnerTeamId);

/// <summary>Serie pronta para desenho: pontos temporais + marcadores posicionados.</summary>
public sealed record PriceCrossoverSocialChartSeries(
    IReadOnlyList<PriceCrossoverSocialChartPoint> Points,
    IReadOnlyList<PriceCrossoverSocialChartMarker> Markers,
    decimal MinNormalizedValue,
    decimal MaxNormalizedValue,
    decimal BaselinePriceA,
    decimal BaselinePriceB);

/// <summary>Modelo de apresentacao do card social, derivado exclusivamente de <see cref="PriceCrossoverSocialResponse"/>.</summary>
public sealed record PriceCrossoverSocialCardModel
{
    public required PriceCrossoverSocialCaptureState CaptureState { get; init; }
    public required string CaptureStateName { get; init; }

    /// <summary>True somente quando as 10 condicoes de prontidao estao satisfeitas.</summary>
    public required bool IsSocialReady { get; init; }

    public required bool CanPost { get; init; }
    public string? SkipReason { get; init; }

    public required int MatchId { get; init; }
    public required string StatusName { get; init; }
    public required bool IsFinished { get; init; }
    public DateTime? StartTimeUtc { get; init; }
    public DateTime? EndTimeUtc { get; init; }
    public int? DurationMinutes { get; init; }
    public required string MatchDateLabel { get; init; }
    public DateTime GeneratedAtUtc { get; init; }

    public required PriceCrossoverSocialCardAsset AssetA { get; init; }
    public required PriceCrossoverSocialCardAsset AssetB { get; init; }

    /// <summary>Vencedor OFICIAL. Nunca derivado de valorizacao percentual.</summary>
    public required string OfficialWinnerLabel { get; init; }
    public bool HasOfficialWinner { get; init; }
    public required string OfficialScoreText { get; init; }
    public string? EndReasonCode { get; init; }

    public decimal? PerformanceDifferencePercent { get; init; }
    public string? PerformanceDifferenceText { get; init; }
    public int TotalCrossovers { get; init; }
    public int RelevantCrossovers { get; init; }
    public int ChartRoundPointsA { get; init; }
    public int ChartRoundPointsB { get; init; }

    public bool HasComeback { get; init; }

    /// <summary>Serie para desenho. Vazia quando os dados nao permitem reconstruir o grafico.</summary>
    public required PriceCrossoverSocialChartSeries Chart { get; init; }

    public required PriceCrossoverSocialDataQualitySummary DataQuality { get; init; }
    public required PriceCrossoverSocialDivergenceSummary Divergence { get; init; }

    public string? PublicUrl { get; init; }
    public bool PublicUrlAvailable { get; init; }
}

public sealed record PriceCrossoverSocialDataQualitySummary(
    string Severity,
    bool IsSufficient,
    bool CanReconstructChart,
    int CompletePairs,
    int IncompletePairs,
    IReadOnlyList<string> Issues);

public sealed record PriceCrossoverSocialDivergenceSummary(
    bool MatchesScreenChart,
    IReadOnlyList<string> Differences);

/// <summary>
/// Construtor puro do modelo de apresentacao. Sem I/O, sem relogio, sem EF Core.
/// Deterministico: a mesma resposta da API produz sempre o mesmo modelo.
/// </summary>
public static class PriceCrossoverSocialCardModelBuilder
{
    public const string StateLoading = "loading";
    public const string StateReady = "ready";
    public const string StateNotPublishable = "not_publishable";
    public const string StateError = "error";

    public static PriceCrossoverSocialCardModel BuildError(string statusName, DateTime generatedAtUtc)
        => new()
        {
            CaptureState = PriceCrossoverSocialCaptureState.Error,
            CaptureStateName = StateError,
            IsSocialReady = false,
            CanPost = false,
            MatchId = 0,
            StatusName = statusName,
            IsFinished = false,
            MatchDateLabel = string.Empty,
            GeneratedAtUtc = generatedAtUtc,
            AssetA = EmptyAsset,
            AssetB = EmptyAsset,
            OfficialWinnerLabel = string.Empty,
            OfficialScoreText = string.Empty,
            Chart = EmptyChart,
            DataQuality = new PriceCrossoverSocialDataQualitySummary("high", false, false, 0, 0, []),
            Divergence = new PriceCrossoverSocialDivergenceSummary(false, [])
        };

    private static PriceCrossoverSocialCardAsset EmptyAsset { get; } =
        new(0, string.Empty, string.Empty, string.Empty, string.Empty, string.Empty, null, string.Empty, 0, 0, 0, false);

    private static PriceCrossoverSocialChartSeries EmptyChart { get; } =
        new([], [], 1m, 1m, 0m, 0m);

    public static PriceCrossoverSocialCardModel Build(
        PriceCrossoverSocialResponse response,
        CultureInfo culture,
        Func<string, string>? logoUrlFactory = null)
    {
        ArgumentNullException.ThrowIfNull(response);
        ArgumentNullException.ThrowIfNull(culture);

        var assetA = BuildAsset(response.AssetA, response.Official.WinnerTeamId, culture, logoUrlFactory);
        var assetB = BuildAsset(response.AssetB, response.Official.WinnerTeamId, culture, logoUrlFactory);

        var chart = BuildChart(response);

        var quality = new PriceCrossoverSocialDataQualitySummary(
            response.DataQuality.Severity,
            response.DataQuality.IsSufficient,
            response.DataQuality.CanReconstructChart,
            response.DataQuality.CompletePairs,
            response.DataQuality.IncompletePairs,
            response.DataQuality.Issues ?? []);

        var divergence = new PriceCrossoverSocialDivergenceSummary(
            response.ChartDivergence.MatchesScreenChart,
            response.ChartDivergence.Differences ?? []);

        var isFinished = string.Equals(response.Status, "Completed", StringComparison.OrdinalIgnoreCase);

        var model = new PriceCrossoverSocialCardModel
        {
            CaptureState = PriceCrossoverSocialCaptureState.Ready,
            CaptureStateName = StateReady,
            IsSocialReady = false,
            CanPost = response.CanPost,
            SkipReason = response.SkipReason,
            MatchId = response.MatchId,
            StatusName = response.Status,
            IsFinished = isFinished,
            StartTimeUtc = response.StartTimeUtc,
            EndTimeUtc = response.EndTimeUtc,
            DurationMinutes = response.DurationMinutes,
            MatchDateLabel = FormatMatchDate(response.EndTimeUtc ?? response.StartTimeUtc, culture),
            GeneratedAtUtc = response.GeneratedAtUtc,
            AssetA = assetA,
            AssetB = assetB,
            OfficialWinnerLabel = ResolveWinnerLabel(response, assetA, assetB),
            HasOfficialWinner = response.Official.WinnerTeamId is not null,
            OfficialScoreText = $"{response.Official.ScoreA} - {response.Official.ScoreB}",
            EndReasonCode = response.Official.EndReasonCode,
            PerformanceDifferencePercent = response.Comparative.PerformanceDifferencePercent,
            PerformanceDifferenceText = FormatPercentPoints(
                response.Comparative.PerformanceDifferencePercent, culture),
            TotalCrossovers = response.Comparative.TotalCrossovers,
            RelevantCrossovers = response.Comparative.RelevantCrossovers,
            ChartRoundPointsA = response.AssetA.ChartRoundPoints,
            ChartRoundPointsB = response.AssetB.ChartRoundPoints,
            HasComeback = response.Comparative.HasComeback,
            Chart = chart,
            DataQuality = quality,
            Divergence = divergence,
            PublicUrl = response.PublicUrl,
            PublicUrlAvailable = response.PublicUrlAvailable
        };

        return model with
        {
            CaptureState = ResolveCaptureState(response, chart, isFinished),
            CaptureStateName = ResolveCaptureStateName(response, chart, isFinished),
            IsSocialReady = IsSocialReady(response, chart, isFinished)
        };
    }

    /// <summary>
    /// Estado de captura. <c>not_publishable</c> e retornado mesmo com grafico valido quando a API
    /// indica que a partida nao pode ser publicada: nunca mascarar um problema de integridade
    /// exibindo um grafico aparentemente publicavel.
    /// </summary>
    public static PriceCrossoverSocialCaptureState ResolveCaptureState(
        PriceCrossoverSocialResponse? response,
        PriceCrossoverSocialChartSeries chart,
        bool isFinished)
    {
        if (response is null)
            return PriceCrossoverSocialCaptureState.Error;

        if (!isFinished || !response.CanPost)
            return PriceCrossoverSocialCaptureState.NotPublishable;

        if (chart.Points.Count < 2)
            return PriceCrossoverSocialCaptureState.NotPublishable;

        return PriceCrossoverSocialCaptureState.Ready;
    }

    public static string ResolveCaptureStateName(
        PriceCrossoverSocialResponse? response,
        PriceCrossoverSocialChartSeries chart,
        bool isFinished)
        => ResolveCaptureState(response, chart, isFinished) switch
        {
            PriceCrossoverSocialCaptureState.Ready => StateReady,
            PriceCrossoverSocialCaptureState.NotPublishable => StateNotPublishable,
            PriceCrossoverSocialCaptureState.Error => StateError,
            _ => StateLoading
        };

    /// <summary>
    /// As 10 condicoes de prontidao para captura. Nenhuma e resolvida por timeout fixo.
    /// As condicoes de renderizacao (canvas, fontes, imagens, layout) sao verificadas em
    /// <c>priceCrossoverSocialCard.mjs</c> e refletidas em <c>data-render-complete</c>.
    /// </summary>
    public static bool IsSocialReady(
        PriceCrossoverSocialResponse? response,
        PriceCrossoverSocialChartSeries chart,
        bool isFinished)
    {
        if (response is null)
            return false;

        // 1. API retornou dados validos.
        // 10. Qualidade dos dados permite publicacao.
        if (!response.CanPost)
            return false;

        // 3. Partida encerrada com resultado consolidado.
        if (!isFinished)
            return false;

        // 2. Series historicas carregadas.
        if (chart.Points.Count < 2)
            return false;

        // 4. Ambos os ativos identificados.
        if (string.IsNullOrWhiteSpace(response.AssetA.Symbol) || string.IsNullOrWhiteSpace(response.AssetB.Symbol))
            return false;

        // 5. Placar oficial disponivel (ScoreA/ScoreB sempre presentes; WinnerTeamId pode ser nulo em empate).
        // 6-9. Icones, fontes, layout e animacoes: verificados pelo modulo JS.
        return true;
    }

    private static PriceCrossoverSocialCardAsset BuildAsset(
        PriceCrossoverAssetStats stats,
        int? winnerTeamId,
        CultureInfo culture,
        Func<string, string>? logoUrlFactory)
    {
        var displaySymbol = string.IsNullOrWhiteSpace(stats.BaseAsset) ? stats.Symbol : stats.BaseAsset;
        var logoUrl = logoUrlFactory?.Invoke(stats.Symbol) ?? string.Empty;

        return new PriceCrossoverSocialCardAsset(
            stats.TeamId,
            stats.Symbol,
            stats.BaseAsset,
            stats.QuoteAsset,
            displaySymbol,
            logoUrl,
            stats.PerformancePercent,
            FormatSignedPercent(stats.PerformancePercent, culture),
            stats.OfficialScore,
            stats.ChartRoundPoints,
            stats.CrossoversWon,
            winnerTeamId is not null && winnerTeamId.Value == stats.TeamId);
    }

    /// <summary>
    /// Monta a serie de desenho a partir de <see cref="PriceCrossoverSocialResponse.Series"/>.
    /// Somente pontos completos entram; a normalizacao ja vem pronta da API (baseline fixo).
    /// A coordenada X e TEMPORAL, corrigindo o pareamento por indice da tela de Match.
    /// </summary>
    public static PriceCrossoverSocialChartSeries BuildChart(PriceCrossoverSocialResponse response)
    {
        var points = new List<PriceCrossoverSocialChartPoint>();
        long previousTime = 0;

        foreach (var point in response.Series)
        {
            if (!point.IsComplete
                || point.AssetA?.NormalizedValue is not decimal normA
                || point.AssetB?.NormalizedValue is not decimal normB)
            {
                continue;
            }

            var time = ToUnixSeconds(point.TimestampUtc);
            var secondsFromPrevious = points.Count == 0
                ? 0
                : (int)Math.Clamp(time - previousTime, 0, int.MaxValue);

            points.Add(new PriceCrossoverSocialChartPoint(
                time,
                decimal.Round(normA, 10, MidpointRounding.AwayFromZero),
                decimal.Round(normB, 10, MidpointRounding.AwayFromZero),
                point.RelativeLeadPercent ?? 0m,
                secondsFromPrevious));

            previousTime = time;
        }

        var markers = new List<PriceCrossoverSocialChartMarker>();
        decimal min = points.Count == 0 ? 1m : decimal.MaxValue;
        decimal max = points.Count == 0 ? 1m : decimal.MinValue;

        foreach (var point in points)
        {
            foreach (var value in new[] { point.NormalizedValueA, point.NormalizedValueB })
            {
                if (value < min) min = value;
                if (value > max) max = value;
            }
        }

        foreach (var crossEvent in response.CrossoverEvents)
        {
            var time = ToUnixSeconds(crossEvent.TimestampUtc);
            var value = crossEvent.InterpolatedNormalizedValue
                ?? ResolveMarkerValue(points, time, response);

            if (value < min) min = value;
            if (value > max) max = value;

            markers.Add(new PriceCrossoverSocialChartMarker(
                time,
                value,
                crossEvent.Direction,
                crossEvent.IsRelevant,
                crossEvent.WinnerSymbol,
                crossEvent.WinnerTeamId));
        }

        if (points.Count == 0)
        {
            min = 1m;
            max = 1m;
        }

        return new PriceCrossoverSocialChartSeries(
            points,
            markers,
            decimal.Round(min, 10, MidpointRounding.AwayFromZero),
            decimal.Round(max, 10, MidpointRounding.AwayFromZero),
            response.SeriesInfo.BaselinePriceA ?? 0m,
            response.SeriesInfo.BaselinePriceB ?? 0m);
    }

    private static decimal ResolveMarkerValue(
        IReadOnlyList<PriceCrossoverSocialChartPoint> points,
        long time,
        PriceCrossoverSocialResponse response)
    {
        var match = points.FirstOrDefault(p => p.TimeUnixSeconds == time);
        if (match is not null)
            return (match.NormalizedValueA + match.NormalizedValueB) / 2m;

        var lead = response.CrossoverEvents
            .FirstOrDefault(x => ToUnixSeconds(x.TimestampUtc) == time)?
            .CurrentLeadPercent ?? 0m;

        return 1m + (lead / 100m);
    }

    private static string ResolveWinnerLabel(
        PriceCrossoverSocialResponse response,
        PriceCrossoverSocialCardAsset assetA,
        PriceCrossoverSocialCardAsset assetB)
    {
        if (response.Official.WinnerTeamId is null)
            return string.Empty;

        return response.Official.WinnerTeamId == response.AssetA.TeamId
            ? assetA.DisplaySymbol
            : assetB.DisplaySymbol;
    }

    internal static long ToUnixSeconds(DateTime value)
    {
        var utc = value.Kind == DateTimeKind.Utc ? value : DateTime.SpecifyKind(value, DateTimeKind.Utc);
        return new DateTimeOffset(utc).ToUnixTimeSeconds();
    }

    internal static string FormatSignedPercent(decimal? value, CultureInfo culture)
    {
        if (value is not decimal number)
            return "--";

        var sign = number > 0 ? "+" : string.Empty;
        return sign + number.ToString("0.0", culture) + "%";
    }

    internal static string? FormatPercentPoints(decimal? value, CultureInfo culture)
    {
        if (value is not decimal number)
            return null;

        return Math.Abs(number).ToString("0.0", culture);
    }

    internal static string FormatMatchDate(DateTime? value, CultureInfo culture)
    {
        if (value is not DateTime date)
            return string.Empty;

        var utc = date.Kind == DateTimeKind.Utc ? date : DateTime.SpecifyKind(date, DateTimeKind.Utc);
        return utc.ToString("yyyy-MM-dd HH:mm", CultureInfo.InvariantCulture) + " UTC";
    }
}
