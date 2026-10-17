using BLL.NFTFutebol;
using DAL.NftFutebol;
using DTOs;
using EthicAI.EntityModel;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace CriptoVersus.API.Services;

public interface IPriceCrossoverHighlightSelector
{
    Task<PriceCrossoverHighlightResponse> GetHighlightAsync(
        int lookbackHours,
        string language,
        bool includeSeries,
        CancellationToken ct);

    Task<PriceCrossoverCandidatesResponse> GetCandidatesAsync(
        int lookbackHours,
        int take,
        CancellationToken ct);
}

/// <summary>
/// Escolhe automaticamente a partida mais interessante para a publicacao social.
///
/// A escolha considera apenas partidas OFICIALMENTE encerradas na janela configurada.
/// Nao basta ser a ultima partida: o indice de interesse prioriza cruzamentos relevantes,
/// reviravoltas, competitividade, diferenca de desempenho legivel e intensidade de movimentos,
/// sempre normalizado por TEMPO para nao favorecer ativos com mais atualizacoes.
///
/// Se nenhuma partida for elegivel, a resposta indica o motivo. Nunca seleciona uma partida
/// com dados ruins so para garantir uma publicacao.
/// </summary>
public sealed class PriceCrossoverHighlightSelector : IPriceCrossoverHighlightSelector
{
    private readonly EthicAIDbContext _db;
    private readonly IPriceCrossoverSocialService _socialService;
    private readonly IPriceCrossoverPublicationService _publicationService;
    private readonly PriceCrossoverOptions _options;

    public PriceCrossoverHighlightSelector(
        EthicAIDbContext db,
        IPriceCrossoverSocialService socialService,
        IPriceCrossoverPublicationService publicationService,
        IOptions<PriceCrossoverOptions> options)
    {
        _db = db;
        _socialService = socialService;
        _publicationService = publicationService;
        _options = options.Value;
    }

    public async Task<PriceCrossoverHighlightResponse> GetHighlightAsync(
        int lookbackHours,
        string language,
        bool includeSeries,
        CancellationToken ct)
    {
        lookbackHours = Math.Clamp(lookbackHours, _options.MinLookbackHours, _options.MaxLookbackHours);
        var nowUtc = DateTime.UtcNow;

        var candidates = await BuildCandidatesAsync(lookbackHours, _options.MaxCandidates, nowUtc, ct);

        var selected = candidates.FirstOrDefault(x => x.IsEligible);

        if (selected is null)
        {
            return new PriceCrossoverHighlightResponse
            {
                Highlight = null,
                HasHighlight = false,
                SkipReason = ResolveEmptyReason(candidates),
                GeneratedAtUtc = nowUtc,
                LookbackHours = lookbackHours,
                MatchesScanned = candidates.Count,
                EligibleCount = 0,
                Candidates = candidates
            };
        }

        var response = await _socialService.GetByMatchIdAsync(selected.MatchId, language, includeSeries, ct);

        return new PriceCrossoverHighlightResponse
        {
            Highlight = response,
            HasHighlight = response is not null && response.CanPost,
            SkipReason = response?.CanPost == true ? null : response?.SkipReason ?? "analysis_unavailable",
            GeneratedAtUtc = nowUtc,
            LookbackHours = lookbackHours,
            MatchesScanned = candidates.Count,
            EligibleCount = candidates.Count(x => x.IsEligible),
            Candidates = candidates
        };
    }

    public async Task<PriceCrossoverCandidatesResponse> GetCandidatesAsync(
        int lookbackHours,
        int take,
        CancellationToken ct)
    {
        lookbackHours = Math.Clamp(lookbackHours, _options.MinLookbackHours, _options.MaxLookbackHours);
        take = Math.Clamp(take, 1, 50);
        var nowUtc = DateTime.UtcNow;

        var candidates = await BuildCandidatesAsync(lookbackHours, Math.Max(take, _options.MaxCandidates), nowUtc, ct);

        return new PriceCrossoverCandidatesResponse
        {
            GeneratedAtUtc = nowUtc,
            LookbackHours = lookbackHours,
            MatchesScanned = candidates.Count,
            EligibleCount = candidates.Count(x => x.IsEligible),
            SelectedMatchId = candidates.FirstOrDefault(x => x.IsEligible)?.MatchId,
            Candidates = candidates.Take(take).ToList()
        };
    }

    private async Task<IReadOnlyList<PriceCrossoverCandidateDto>> BuildCandidatesAsync(
        int lookbackHours,
        int limit,
        DateTime nowUtc,
        CancellationToken ct)
    {
        if (!_options.Enabled)
            return [];

        var cutoffUtc = nowUtc.AddHours(-lookbackHours);

        // Selecao inicial barata: apenas partidas encerradas na janela, sem carregar series.
        var matches = await _db.Match
            .AsNoTracking()
            .Include(x => x.TeamA).ThenInclude(t => t.Currency)
            .Include(x => x.TeamB).ThenInclude(t => t.Currency)
            .Where(x =>
                x.Status == MatchStatus.Completed
                && x.EndTime != null
                && x.EndTime >= cutoffUtc
                && x.EndTime <= nowUtc)
            .OrderByDescending(x => x.EndTime)
            .ThenBy(x => x.MatchId)
            .Take(limit * 2)
            .ToListAsync(ct);

        var eligible = new List<PriceCrossoverCandidateDto>(limit);

        foreach (var match in matches)
        {
            ct.ThrowIfCancellationRequested();

            if (IsForbiddenPair(match))
                continue;

            var candidate = await BuildCandidateAsync(match, ct);
            if (candidate is not null)
                eligible.Add(candidate);

            if (eligible.Count >= limit)
                break;
        }

        // Ordenacao deterministica: indice de interesse, proximidade do placar, recencia, MatchId.
        return eligible
            .OrderByDescending(x => x.InterestScore)
            .ThenBy(x => Math.Abs(x.ScoreA - x.ScoreB))
            .ThenByDescending(x => x.EndTimeUtc ?? DateTime.MinValue)
            .ThenBy(x => x.MatchId)
            .ToList();
    }

    private async Task<PriceCrossoverCandidateDto?> BuildCandidateAsync(Match match, CancellationToken ct)
    {
        var rows = await _socialService.LoadRowsAsync(match.MatchId, match.TeamAId, match.TeamBId, ct);
        var events = await _socialService.LoadOfficialEventsAsync(match.MatchId, ct);

        var response = await _socialService.BuildResponseCoreAsync(
            match, rows, events, "pt-BR", includeSeries: false, ct);

        var rejection = BuildRejectionReasons(response);

        return new PriceCrossoverCandidateDto
        {
            MatchId = match.MatchId,
            Status = response.Status,
            EndTimeUtc = match.EndTime,
            AssetASymbol = response.AssetA.Symbol,
            AssetBSymbol = response.AssetB.Symbol,
            ScoreA = response.Official.ScoreA,
            ScoreB = response.Official.ScoreB,
            WinnerTeamId = response.Official.WinnerTeamId,
            InterestScore = response.InterestScore,
            TotalCrossovers = response.Comparative.TotalCrossovers,
            RelevantCrossovers = response.Comparative.RelevantCrossovers,
            HasComeback = response.Comparative.HasComeback,
            Competitiveness = response.Comparative.Competitiveness,
            PerformanceDifferencePercent = response.Comparative.PerformanceDifferencePercent,
            IsEligible = rejection.Count == 0,
            IsSelected = false,
            RejectionReasons = rejection,
            SelectionReasons = response.InterestBreakdown.Reasons
        };
    }

    private static IReadOnlyList<string> BuildRejectionReasons(PriceCrossoverSocialResponse response)
    {
        var reasons = new List<string>();

        if (response.Status != nameof(MatchStatus.Completed))
            reasons.Add("match_not_completed");

        if (response.AlreadyPublished)
            reasons.Add("already_published");

        if (response.Publication?.Status == PriceCrossoverPublicationStatuses.ReconciliationRequired)
            reasons.Add("reconciliation_required");

        if (response.Publication?.Status is not null
            && (response.Publication.Status == PriceCrossoverPublicationStatuses.Reserved
                || response.Publication.Status == PriceCrossoverPublicationStatuses.Publishing)
            && response.Publication.LeaseExpiresAtUtc is not null
            && response.Publication.LeaseExpiresAtUtc.Value > DateTime.UtcNow)
            reasons.Add("already_reserved");

        if (!response.DataQuality.IsSufficient)
            reasons.Add("insufficient_data_quality");

        if (!response.DataQuality.CanReconstructChart)
            reasons.Add("cannot_reconstruct_chart");

        if (response.AssetA.InitialPrice is null || response.AssetB.InitialPrice is null)
            reasons.Add("missing_baseline_price");

        return reasons;
    }

    private static string ResolveEmptyReason(IReadOnlyList<PriceCrossoverCandidateDto> candidates)
    {
        if (candidates.Count == 0)
            return "no_completed_matches_in_window";

        if (candidates.All(x => x.RejectionReasons.Contains("already_published")
            || x.RejectionReasons.Contains("already_reserved")
            || x.RejectionReasons.Contains("reconciliation_required")))
            return "all_candidates_already_published_or_reserved";

        if (candidates.All(x => x.RejectionReasons.Contains("insufficient_data_quality")
            || x.RejectionReasons.Contains("cannot_reconstruct_chart")
            || x.RejectionReasons.Contains("missing_baseline_price")))
            return "all_candidates_unreliable_data";

        return "no_eligible_match";
    }

    private static bool IsForbiddenPair(Match match)
    {
        var symbolA = match.TeamA?.Currency?.Symbol;
        var symbolB = match.TeamB?.Currency?.Symbol;

        return MatchPairRules.IsForbiddenPair(symbolA, symbolB);
    }
}
