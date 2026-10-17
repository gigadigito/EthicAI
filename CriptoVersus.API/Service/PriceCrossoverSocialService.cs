using BLL.NFTFutebol;
using DAL.NftFutebol;
using DTOs;
using EthicAI.EntityModel;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace CriptoVersus.API.Services;

public interface IPriceCrossoverSocialService
{
    Task<PriceCrossoverSocialResponse?> GetByMatchIdAsync(
        int matchId,
        string language,
        bool includeSeries,
        CancellationToken ct);

    Task<PriceCrossoverSocialResponse> BuildResponseAsync(
        Match match,
        string language,
        bool includeSeries,
        CancellationToken ct);

    Task<IReadOnlyList<PriceCrossoverSnapshotRow>> LoadRowsAsync(int matchId, int teamAId, int teamBId, CancellationToken ct);
    Task<IReadOnlyList<PriceCrossoverOfficialEvent>> LoadOfficialEventsAsync(int matchId, CancellationToken ct);

    /// <summary>Montagem pura da resposta, sem I/O. Usado pelo seletor e pelos testes.</summary>
    Task<PriceCrossoverSocialResponse> BuildResponseCoreAsync(
        Match match,
        IReadOnlyList<PriceCrossoverSnapshotRow> rows,
        IReadOnlyList<PriceCrossoverOfficialEvent> officialEvents,
        string language,
        bool includeSeries,
        CancellationToken ct);
}

/// <summary>
/// Monta a resposta social do Price Crossover a partir de dados persistidos.
///
/// NUNCA consulta a Binance para reconstruir resultado historico. Toda a serie vem de
/// <c>MatchMetricSnapshot</c>; todo o resultado oficial vem de <c>Match</c> e <c>MatchScoreEvent</c>.
/// </summary>
public sealed class PriceCrossoverSocialService : IPriceCrossoverSocialService
{
    private readonly EthicAIDbContext _db;
    private readonly PriceCrossoverAnalyzer _analyzer;
    private readonly IPriceCrossoverSocialNarrativeService _narrativeService;
    private readonly IPriceCrossoverPublicationService _publicationService;
    private readonly PriceCrossoverOptions _options;

    public PriceCrossoverSocialService(
        EthicAIDbContext db,
        PriceCrossoverAnalyzer analyzer,
        IPriceCrossoverSocialNarrativeService narrativeService,
        IPriceCrossoverPublicationService publicationService,
        IOptions<PriceCrossoverOptions> options)
    {
        _db = db;
        _analyzer = analyzer;
        _narrativeService = narrativeService;
        _publicationService = publicationService;
        _options = options.Value;
    }

    public async Task<PriceCrossoverSocialResponse?> GetByMatchIdAsync(
        int matchId,
        string language,
        bool includeSeries,
        CancellationToken ct)
    {
        var match = await _db.Match
            .AsNoTracking()
            .Include(x => x.TeamA).ThenInclude(t => t.Currency)
            .Include(x => x.TeamB).ThenInclude(t => t.Currency)
            .Include(x => x.WinnerTeam).ThenInclude(t => t!.Currency)
            .FirstOrDefaultAsync(x => x.MatchId == matchId, ct);

        return match is null
            ? null
            : await BuildResponseAsync(match, language, includeSeries, ct);
    }

    public async Task<PriceCrossoverSocialResponse> BuildResponseAsync(
        Match match,
        string language,
        bool includeSeries,
        CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(match);

        var rows = await LoadRowsAsync(match.MatchId, match.TeamAId, match.TeamBId, ct);
        var officialEvents = await LoadOfficialEventsAsync(match.MatchId, ct);

        return await BuildResponseCoreAsync(match, rows, officialEvents, language, includeSeries, ct);
    }

    /// <summary>
    /// Caminho puro de montagem, sem I/O. Usado pelo seletor de destaque e pelos testes.
    /// </summary>
    public async Task<PriceCrossoverSocialResponse> BuildResponseCoreAsync(
        Match match,
        IReadOnlyList<PriceCrossoverSnapshotRow> rows,
        IReadOnlyList<PriceCrossoverOfficialEvent> officialEvents,
        string language,
        bool includeSeries,
        CancellationToken ct)
    {
        var symbolA = match.TeamA?.Currency?.Symbol ?? string.Empty;
        var symbolB = match.TeamB?.Currency?.Symbol ?? string.Empty;

        // Espelha MatchesController.GetMetricSnapshots: as 500 linhas MAIS RECENTES no total,
        // sem distincao de time. E exatamente o que a tela de Match buscaria.
        var screenWindow = rows
            .OrderByDescending(x => x.CapturedAtUtc)
            .ThenByDescending(x => x.RowId)
            .Take(_options.ScreenWindowRows)
            .ToList();

        var input = new PriceCrossoverAnalysisInput
        {
            MatchId = match.MatchId,
            TeamAId = match.TeamAId,
            TeamBId = match.TeamBId,
            SymbolA = symbolA,
            SymbolB = symbolB,
            Rows = rows,
            ScreenWindowRows = screenWindow,
            OfficialScoreA = match.ScoreA,
            OfficialScoreB = match.ScoreB,
            OfficialWinnerTeamId = match.WinnerTeamId,
            EndReasonCode = match.EndReasonCode,
            StartTimeUtc = match.StartTime,
            EndTimeUtc = match.EndTime,
            OfficialEvents = officialEvents,
            Options = BuildAnalyzerOptions()
        };

        var outcome = _analyzer.Analyze(input);

        var winnerSymbol = ResolveWinnerSymbol(match, symbolA, symbolB);
        var bestPerfIsA = (outcome.AssetA.PerformancePercent ?? decimal.MinValue)
            >= (outcome.AssetB.PerformancePercent ?? decimal.MinValue);
        var winnerDiffersFromBestPerformance = match.WinnerTeamId is not null
            && ((match.WinnerTeamId == match.TeamAId) != bestPerfIsA);

        var publication = await _publicationService.GetStateAsync(match.MatchId, ct);

        var (canPost, skipReason) = EvaluateEligibility(match, outcome, publication);

        var status = match.Status.ToString();
        var durationMinutes = match.StartTime is not null && match.EndTime is not null
            ? (int)Math.Round((match.EndTime.Value - match.StartTime.Value).TotalMinutes, MidpointRounding.AwayFromZero)
            : (int?)null;

        var response = new PriceCrossoverSocialResponse
        {
            Category = PriceCrossoverCategories.PriceCrossoverHighlight,
            CanPost = canPost,
            SkipReason = skipReason,
            MatchId = match.MatchId,
            Status = status,
            StartTimeUtc = match.StartTime,
            EndTimeUtc = match.EndTime,
            DurationMinutes = durationMinutes,
            ScoringRuleType = match.ScoringRuleType.ToString(),
            GeneratedAtUtc = DateTime.UtcNow,
            Official = new PriceCrossoverOfficialResult
            {
                ScoreA = match.ScoreA,
                ScoreB = match.ScoreB,
                WinnerTeamId = match.WinnerTeamId,
                WinnerSymbol = winnerSymbol,
                WinnerDiffersFromBestPerformance = winnerDiffersFromBestPerformance,
                EndReasonCode = match.EndReasonCode,
                ScoringEventCount = officialEvents.Count(x => x.Points > 0),
                Notes = "Resultado oficial lido de Match.ScoreA/ScoreB/WinnerTeamId/EndReasonCode. Nunca recalculado."
            },
            AssetA = outcome.AssetA,
            AssetB = outcome.AssetB,
            Comparative = outcome.Comparative,
            InterestScore = outcome.InterestScore,
            InterestBreakdown = outcome.InterestBreakdown,
            DataQuality = outcome.DataQuality,
            ChartDivergence = outcome.ChartDivergence,
            Series = includeSeries ? outcome.Series : [],
            SeriesInfo = outcome.SeriesInfo,
            CrossoverEvents = outcome.CrossoverEvents,
            OfficialEvents = officialEvents,
            AlreadyPublished = publication?.Status == PriceCrossoverPublicationStatuses.Posted,
            Publication = publication,
            PublicUrl = null,
            PublicUrlAvailable = false
        };

        var narrative = _narrativeService.Build(response, language, _options.NarrativeMaxCharacters);

        return new PriceCrossoverSocialResponse
        {
            Category = response.Category,
            CanPost = response.CanPost,
            SkipReason = response.SkipReason,
            MatchId = response.MatchId,
            Status = response.Status,
            StartTimeUtc = response.StartTimeUtc,
            EndTimeUtc = response.EndTimeUtc,
            DurationMinutes = response.DurationMinutes,
            ScoringRuleType = response.ScoringRuleType,
            GeneratedAtUtc = response.GeneratedAtUtc,
            Official = response.Official,
            AssetA = response.AssetA,
            AssetB = response.AssetB,
            Comparative = response.Comparative,
            InterestScore = response.InterestScore,
            InterestBreakdown = response.InterestBreakdown,
            DataQuality = response.DataQuality,
            ChartDivergence = response.ChartDivergence,
            Series = response.Series,
            SeriesInfo = response.SeriesInfo,
            CrossoverEvents = response.CrossoverEvents,
            OfficialEvents = response.OfficialEvents,
            Narrative = narrative,
            AlreadyPublished = response.AlreadyPublished,
            Publication = response.Publication,
            PublicUrl = response.PublicUrl,
            PublicUrlAvailable = response.PublicUrlAvailable
        };
    }

    public async Task<IReadOnlyList<PriceCrossoverSnapshotRow>> LoadRowsAsync(
        int matchId,
        int teamAId,
        int teamBId,
        CancellationToken ct)
    {
        var snapshots = await _db.Set<MatchMetricSnapshot>()
            .AsNoTracking()
            .Where(x => x.MatchId == matchId)
            .OrderBy(x => x.CapturedAtUtc)
            .ThenBy(x => x.MatchMetricSnapshotId)
            .ToListAsync(ct);

        var rows = new List<PriceCrossoverSnapshotRow>(snapshots.Count);

        foreach (var snapshot in snapshots)
        {
            PriceCrossoverSide side;
            if (snapshot.TeamId == teamAId)
                side = PriceCrossoverSide.A;
            else if (snapshot.TeamId == teamBId)
                side = PriceCrossoverSide.B;
            else
                continue;

            rows.Add(new PriceCrossoverSnapshotRow
            {
                RowId = snapshot.MatchMetricSnapshotId,
                Side = side,
                CapturedAtUtc = snapshot.CapturedAtUtc,
                LastPrice = snapshot.LastPrice,
                PercentageChange = snapshot.PercentageChange
            });
        }

        return rows;
    }

    public async Task<IReadOnlyList<PriceCrossoverOfficialEvent>> LoadOfficialEventsAsync(
        int matchId,
        CancellationToken ct)
    {
        var events = await _db.Set<MatchScoreEvent>()
            .AsNoTracking()
            .Where(x => x.MatchId == matchId)
            .OrderBy(x => x.EventSequence)
            .ThenBy(x => x.MatchScoreEventId)
            .ToListAsync(ct);

        return events
            .Select(x => new PriceCrossoverOfficialEvent
            {
                MatchScoreEventId = x.MatchScoreEventId,
                EventSequence = x.EventSequence,
                TeamId = x.TeamId,
                TeamSymbol = string.Empty,
                RuleType = x.RuleType.ToString(),
                EventType = x.EventType,
                ReasonCode = x.ReasonCode,
                Points = x.Points,
                TeamPercentageChange = x.TeamPercentageChange,
                OpponentPercentageChange = x.OpponentPercentageChange,
                MetricDelta = x.MetricDelta,
                EventTimeUtc = x.EventTimeUtc,
                Description = x.Description
            })
            .ToList();
    }

    private PriceCrossoverAnalyzerOptions BuildAnalyzerOptions()
        => new()
        {
            RelevantSwingPercent = _options.RelevantSwingPercent,
            BalancedGapPercent = _options.BalancedGapPercent,
            MinCompletePairs = _options.MinCompletePairs,
            ScreenWindowRows = _options.ScreenWindowRows,
            MaxSeriesPoints = _options.MaxSeriesPoints,
            IntensitySampleSeconds = _options.IntensitySampleSeconds,
            WeightCrossoversAndComeback = _options.WeightCrossoversAndComeback,
            WeightCompetitiveness = _options.WeightCompetitiveness,
            WeightPerformanceSpread = _options.WeightPerformanceSpread,
            WeightMovementIntensity = _options.WeightMovementIntensity,
            WeightRemarkableEvents = _options.WeightRemarkableEvents,
            IdealPerformanceGapPercent = _options.IdealPerformanceGapPercent,
            MaxRelevantCrossoversPerHour = _options.MaxRelevantCrossoversPerHour,
            MaxMovementIntensityPercentPerHour = _options.MaxMovementIntensityPercentPerHour,
            MaxRelativeVolatilityPercent = _options.MaxRelativeVolatilityPercent,
            MaxOfficialEventsPerHour = _options.MaxOfficialEventsPerHour,
            MinSamplingRatio = _options.MinSamplingRatio,
            MaxSamplingRatio = _options.MaxSamplingRatio
        };

    private static string? ResolveWinnerSymbol(Match match, string symbolA, string symbolB)
    {
        if (match.WinnerTeamId is null)
            return null;

        return match.WinnerTeamId == match.TeamAId
            ? (string.IsNullOrWhiteSpace(symbolA) ? match.WinnerTeam?.Currency?.Symbol : symbolA)
            : (string.IsNullOrWhiteSpace(symbolB) ? match.WinnerTeam?.Currency?.Symbol : symbolB);
    }

    private static (bool CanPost, string? SkipReason) EvaluateEligibility(
        Match match,
        PriceCrossoverAnalysisOutcome outcome,
        PriceCrossoverPublicationState? publication)
    {
        if (match.Status != MatchStatus.Completed)
            return (false, "match_not_completed");

        if (publication?.Status == PriceCrossoverPublicationStatuses.Posted)
            return (false, "already_published");

        if (publication?.Status == PriceCrossoverPublicationStatuses.ReconciliationRequired)
            return (false, "reconciliation_required");

        var isHeldByOther = publication is not null
            && (publication.Status == PriceCrossoverPublicationStatuses.Reserved
                || publication.Status == PriceCrossoverPublicationStatuses.Publishing)
            && publication.LeaseExpiresAtUtc is not null
            && publication.LeaseExpiresAtUtc.Value > DateTime.UtcNow;

        if (isHeldByOther)
            return (false, "already_reserved");
        if (!outcome.DataQuality.IsSufficient)
            return (false, "insufficient_data_quality");

        if (!outcome.DataQuality.CanReconstructChart)
            return (false, "cannot_reconstruct_chart");

        return (true, null);
    }
}
