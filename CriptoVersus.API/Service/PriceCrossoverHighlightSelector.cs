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
        int? minInterestScore,
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
/// Todo candidato e montado por <see cref="IPriceCrossoverSocialService.BuildResponseCoreAsync"/>,
/// unico dono do calculo, da validacao de elegibilidade, da URL social e da narrativa. O seletor
/// nao replica regras: apenas agrega motivos estruturados e a rotacao de moedas.
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

        var candidates = await BuildCandidatesAsync(
            lookbackHours,
            _options.MaxCandidates,
            minInterestScore: null,
            desiredScoredCount: _options.MaxCandidates,
            nowUtc,
            ct);

        var selected = candidates.FirstOrDefault(x => x.IsEligible);
        if (selected is not null)
            selected.IsSelected = true;

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
        int? minInterestScore,
        CancellationToken ct)
    {
        lookbackHours = Math.Clamp(lookbackHours, _options.MinLookbackHours, _options.MaxLookbackHours);
        take = Math.Clamp(take, 1, 50);

        // Piso do indice de interesse: nunca rebaixado para "achar" candidatos. Quando os
        // candidatos acima do piso sao escassos, o seletor amplia a varredura de partidas.
        var floor = Math.Clamp(minInterestScore ?? _options.MinInterestScore, 0, 100);
        var nowUtc = DateTime.UtcNow;

        var scanned = await BuildCandidatesAsync(
            lookbackHours,
            Math.Max(take, _options.MaxCandidates),
            floor,
            take,
            nowUtc,
            ct);

        var scored = scanned.Where(x => x.InterestScore >= floor).ToList();

        var selectedMatchId = scored.FirstOrDefault(x => x.IsEligible)?.MatchId;
        if (selectedMatchId is not null)
        {
            foreach (var candidate in scored)
                candidate.IsSelected = candidate.MatchId == selectedMatchId.Value;
        }

        return new PriceCrossoverCandidatesResponse
        {
            GeneratedAtUtc = nowUtc,
            LookbackHours = lookbackHours,
            Take = take,
            MinInterestScore = floor,
            MatchesScanned = scanned.Count,
            FilteredByMinInterestScore = scanned.Count - scored.Count,
            EligibleCount = scored.Count(x => x.IsEligible),
            SelectedMatchId = selectedMatchId,
            Candidates = scored.Take(take).ToList()
        };
    }

    private async Task<IReadOnlyList<PriceCrossoverCandidateDto>> BuildCandidatesAsync(
        int lookbackHours,
        int limit,
        int? minInterestScore,
        int desiredScoredCount,
        DateTime nowUtc,
        CancellationToken ct)
    {
        if (!_options.Enabled)
            return [];

        var cutoffUtc = nowUtc.AddHours(-lookbackHours);

        // Ampliacao controlada de desempenho: o primeiro lote preserva a profundidade de
        // ranking atual (limit) e o segundo lote so e varrido quando ainda faltam candidatos
        // acima do piso de interesse. Nunca mais que 2 * limit analises por consulta.
        var analysisCap = limit * 2;

        // Selecao inicial barata: apenas partidas encerradas na janela, sem carregar series.
        // Times e moedas sao ligados manualmente: um Include com relacionamento obrigatorio
        // removeria a partida inteira quando a moeda nao existe, escondendo exatamente os
        // candidatos sem identificacao de ativos que precisam aparecer como rejeitados.
        var matches = await _db.Match
            .AsNoTracking()
            .Where(x =>
                x.Status == MatchStatus.Completed
                && x.EndTime != null
                && x.EndTime >= cutoffUtc
                && x.EndTime <= nowUtc)
            .OrderByDescending(x => x.EndTime)
            .ThenBy(x => x.MatchId)
            .Take(analysisCap)
            .ToListAsync(ct);

        await AttachTeamsAndCurrenciesAsync(matches, ct);

        var rotation = await LoadRotationWindowAsync(nowUtc, ct);

        var built = new List<PriceCrossoverCandidateDto>(limit);

        foreach (var match in matches)
        {
            ct.ThrowIfCancellationRequested();

            if (IsForbiddenPair(match))
                continue;

            var candidate = await BuildCandidateAsync(match, rotation, ct);
            built.Add(candidate);

            var scoredCount = minInterestScore is null
                ? built.Count
                : built.Count(x => x.InterestScore >= minInterestScore.Value);

            if (built.Count >= limit && scoredCount >= desiredScoredCount)
                break;
            if (built.Count >= analysisCap)
                break;
        }

        // Ordenacao deterministica: elegiveis primeiro (concluida, dados suficientes, URL
        // social disponivel e nao publicada), depois indice de interesse, proximidade do
        // placar, recencia e MatchId.
        return built
            .OrderByDescending(x => x.IsEligible)
            .ThenByDescending(x => x.InterestScore)
            .ThenBy(x => Math.Abs(x.ScoreA - x.ScoreB))
            .ThenByDescending(x => x.EndTimeUtc ?? DateTime.MinValue)
            .ThenBy(x => x.MatchId)
            .ToList();
    }

    private async Task<PriceCrossoverCandidateDto> BuildCandidateAsync(
        Match match,
        CoinRotationWindow rotation,
        CancellationToken ct)
    {
        var rows = await _socialService.LoadRowsAsync(match.MatchId, match.TeamAId, match.TeamBId, ct);
        var events = await _socialService.LoadOfficialEventsAsync(match.MatchId, ct);

        var response = await _socialService.BuildResponseCoreAsync(
            match, rows, events, "pt-BR", includeSeries: false, ct);

        var rejection = BuildRejectionReasons(response, rotation);

        return new PriceCrossoverCandidateDto
        {
            MatchId = match.MatchId,
            Status = response.Status,
            EndTimeUtc = match.EndTime,
            AssetA = BuildCandidateAsset(response.AssetA),
            AssetB = BuildCandidateAsset(response.AssetB),
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
            CanPost = response.CanPost,
            SkipReason = response.SkipReason,
            DataQuality = response.DataQuality,
            PublicUrl = response.PublicUrl,
            PublicUrlAvailable = response.PublicUrlAvailable,
            AlreadyPublished = response.AlreadyPublished,
            PublicationStatus = response.Publication?.Status,
            Narrative = response.Narrative,
            IsEligible = rejection.Count == 0,
            IsSelected = false,
            RejectionReasons = rejection,
            SelectionReasons = response.InterestBreakdown.Reasons
        };
    }

    private static PriceCrossoverCandidateAsset BuildCandidateAsset(PriceCrossoverAssetStats stats)
        => new()
        {
            TeamId = stats.TeamId,
            Symbol = stats.Symbol,
            BaseAsset = stats.BaseAsset,
            QuoteAsset = stats.QuoteAsset
        };

    /// <summary>
    /// Motivos estruturados de rejeicao. A elegibilidade base (status, publicacao, qualidade
    /// de dados e reconstrucao do grafico) vem pronta em <c>CanPost</c>/<c>SkipReason</c>,
    /// calculada por <c>PriceCrossoverSocialService</c>; aqui entram apenas as verificacoes
    /// especificas do candidato (identificacao dos ativos, baseline e rotacao de moedas).
    /// </summary>
    private static IReadOnlyList<string> BuildRejectionReasons(
        PriceCrossoverSocialResponse response,
        CoinRotationWindow rotation)
    {
        var reasons = new List<string>();

        if (!response.CanPost)
            reasons.Add(response.SkipReason ?? "not_publishable");

        var symbolA = response.AssetA.Symbol.Trim();
        var symbolB = response.AssetB.Symbol.Trim();

        if (symbolA.Length == 0 || symbolB.Length == 0)
        {
            // Ja coberto por CanPost/SkipReason (missing_asset_symbols); guarda defensiva.
            if (!reasons.Contains("missing_asset_symbols"))
                reasons.Add("missing_asset_symbols");
        }
        else if (rotation.Enabled)
        {
            // Rotacao de moedas: somente publicacoes CONFIRMADAS contam. Reserva,
            // selecao ou tentativa de postagem nunca bloqueiam outro candidato.
            if (rotation.AssetsPublishedToday.Contains(symbolA)
                || rotation.AssetsPublishedToday.Contains(symbolB))
                reasons.Add("asset_already_published_today");

            if (rotation.PairsPublishedRecently.Contains(BuildPairKey(symbolA, symbolB)))
                reasons.Add("pair_recently_published");
        }

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
            || x.RejectionReasons.Contains("missing_baseline_price")
            || x.RejectionReasons.Contains("missing_asset_symbols")))
            return "all_candidates_unreliable_data";

        if (candidates.All(x => x.RejectionReasons.Contains("asset_already_published_today")
            || x.RejectionReasons.Contains("pair_recently_published")))
            return "all_candidates_blocked_by_coin_rotation";

        return "no_eligible_match";
    }

    /// <summary>
    /// Liga times e moedas as partidas sem depender de Include: moeda ausente ou sem
    /// simbolo vira identificacao vazia (rejeitada depois), nunca some da varredura.
    /// </summary>
    private async Task AttachTeamsAndCurrenciesAsync(IReadOnlyList<Match> matches, CancellationToken ct)
    {
        if (matches.Count == 0)
            return;

        var teamIds = matches
            .SelectMany(x => new[] { x.TeamAId, x.TeamBId })
            .Where(x => x != 0)
            .Distinct()
            .ToList();

        var teams = await _db.Team
            .AsNoTracking()
            .Where(x => teamIds.Contains(x.TeamId))
            .ToListAsync(ct);

        var teamsById = teams.ToDictionary(x => x.TeamId);

        var currencyIds = teams
            .Select(x => x.CurrencyId)
            .Where(x => x != 0)
            .Distinct()
            .ToList();

        var currenciesById = await _db.Currency
            .AsNoTracking()
            .Where(x => currencyIds.Contains(x.CurrencyId))
            .ToDictionaryAsync(x => x.CurrencyId, ct);

        foreach (var team in teams)
        {
            if (currenciesById.TryGetValue(team.CurrencyId, out var currency))
                team.Currency = currency;
        }

        foreach (var match in matches)
        {
            if (teamsById.TryGetValue(match.TeamAId, out var teamA))
                match.TeamA = teamA;
            if (teamsById.TryGetValue(match.TeamBId, out var teamB))
                match.TeamB = teamB;
        }
    }

    private async Task<CoinRotationWindow> LoadRotationWindowAsync(DateTime nowUtc, CancellationToken ct)
    {
        if (!_options.CoinRotationEnabled)
            return CoinRotationWindow.Disabled;

        var dayStartUtc = nowUtc.Date;
        var pairCutoffUtc = nowUtc.AddHours(-Math.Max(0, _options.CoinRotationPairWindowHours));
        var sinceUtc = dayStartUtc < pairCutoffUtc ? dayStartUtc : pairCutoffUtc;

        var posted = await _publicationService.GetRecentlyPostedAsync(sinceUtc, ct);

        var assets = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var pairs = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        foreach (var record in posted)
        {
            var symbolA = record.AssetASymbol.Trim();
            var symbolB = record.AssetBSymbol.Trim();

            if (record.PostedAtUtc >= dayStartUtc)
            {
                if (symbolA.Length > 0) assets.Add(symbolA);
                if (symbolB.Length > 0) assets.Add(symbolB);
            }

            if (symbolA.Length > 0 && symbolB.Length > 0 && record.PostedAtUtc >= pairCutoffUtc)
                pairs.Add(BuildPairKey(symbolA, symbolB));
        }

        return new CoinRotationWindow(true, assets, pairs);
    }

    private static string BuildPairKey(string symbolA, string symbolB)
        => string.Join(":", new[] { symbolA.Trim(), symbolB.Trim() }.Order(StringComparer.OrdinalIgnoreCase));

    private static bool IsForbiddenPair(Match match)
    {
        var symbolA = match.TeamA?.Currency?.Symbol;
        var symbolB = match.TeamB?.Currency?.Symbol;

        return MatchPairRules.IsForbiddenPair(symbolA, symbolB);
    }

    /// <summary>Janela de rotacao de moedas derivada de publicacoes CONFIRMADAS.</summary>
    private sealed record CoinRotationWindow(
        bool Enabled,
        HashSet<string> AssetsPublishedToday,
        HashSet<string> PairsPublishedRecently)
    {
        public static CoinRotationWindow Disabled { get; } = new(
            false,
            new HashSet<string>(StringComparer.OrdinalIgnoreCase),
            new HashSet<string>(StringComparer.OrdinalIgnoreCase));
    }
}
