using System.Text.Json;
using BLL.NFTFutebol;
using DAL.NftFutebol;
using DTOs;
using EthicAI.EntityModel;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace CriptoVersus.API.Services;

public interface ICandleBattleSocialService
{
    Task<CandleBattleSocialResponse?> GetByMatchIdAsync(int matchId, string language, bool includeRounds, CancellationToken ct);
    Task<CandleBattleHighlightResponse> GetHighlightAsync(int lookbackHours, string language, bool includeRounds, CancellationToken ct);
    Task<CandleBattleCandidatesResponse> GetCandidatesAsync(int lookbackHours, int take, CancellationToken ct);
}

public sealed class CandleBattleSocialService : ICandleBattleSocialService
{
    private readonly EthicAIDbContext _db;
    private readonly ICandleBattlePublicationService _publication;
    private readonly CandleBattleSocialOptions _options;
    private readonly IConfiguration _configuration;
    private readonly ILogger<CandleBattleSocialService> _logger;

    public CandleBattleSocialService(EthicAIDbContext db, ICandleBattlePublicationService publication,
        IOptions<CandleBattleSocialOptions> options, IConfiguration configuration,
        ILogger<CandleBattleSocialService> logger)
    {
        _db = db;
        _publication = publication;
        _options = options.Value;
        _configuration = configuration;
        _logger = logger;
    }

    public async Task<CandleBattleSocialResponse?> GetByMatchIdAsync(int matchId, string language, bool includeRounds, CancellationToken ct)
    {
        var match = await _db.Match.AsNoTracking()
            .Include(x => x.TeamA).ThenInclude(x => x.Currency)
            .Include(x => x.TeamB).ThenInclude(x => x.Currency)
            .SingleOrDefaultAsync(x => x.MatchId == matchId, ct);
        if (match is null) return null;

        var state = await _db.Set<CandleBattlesState>().AsNoTracking()
            .SingleOrDefaultAsync(x => x.MatchId == matchId, ct);
        var query = _db.Set<CandleBattlesRound>().AsNoTracking().Where(x => x.MatchId == matchId);
        if (match.StartTime.HasValue)
        {
            var startMs = new DateTimeOffset(DateTime.SpecifyKind(match.StartTime.Value, DateTimeKind.Utc)).ToUnixTimeMilliseconds();
            var firstMs = CandleBattlesResolver.FirstOpen(startMs);
            var lastCloseMs = CandleBattlesResolver.LastClose(startMs);
            if (match.EndTime.HasValue)
                lastCloseMs = Math.Min(lastCloseMs, new DateTimeOffset(DateTime.SpecifyKind(match.EndTime.Value, DateTimeKind.Utc)).ToUnixTimeMilliseconds());
            var firstUtc = DateTimeOffset.FromUnixTimeMilliseconds(firstMs).UtcDateTime;
            var lastOpenUtc = DateTimeOffset.FromUnixTimeMilliseconds(lastCloseMs - CandleBattlesResolver.PeriodMs).UtcDateTime;
            query = query.Where(x => x.OpenTimeUtc >= firstUtc && x.OpenTimeUtc <= lastOpenUtc);
        }
        var rows = await query.OrderBy(x => x.OpenTimeUtc).ToListAsync(ct);
        var publication = await _publication.GetStateAsync(matchId, ct);
        return BuildResponse(match, state, rows, publication, language, includeRounds);
    }

    public CandleBattleSocialResponse BuildResponse(Match match, CandleBattlesState? state,
        IReadOnlyList<CandleBattlesRound> rows, PriceCrossoverPublicationState? publication,
        string language, bool includeRounds)
    {
        var symbolA = match.TeamA?.Currency?.Symbol ?? string.Empty;
        var symbolB = match.TeamB?.Currency?.Symbol ?? string.Empty;
        var ordered = rows.OrderBy(x => x.OpenTimeUtc).ToArray();
        var firstOpen = match.StartTime.HasValue
            ? CandleBattlesResolver.FirstOpen(new DateTimeOffset(DateTime.SpecifyKind(match.StartTime.Value, DateTimeKind.Utc)).ToUnixTimeMilliseconds())
            : (long?)null;
        var endMs = match.EndTime.HasValue
            ? new DateTimeOffset(DateTime.SpecifyKind(match.EndTime.Value, DateTimeKind.Utc)).ToUnixTimeMilliseconds()
            : (long?)null;
        var rounds = new List<CandleBattlesRoundDto>(ordered.Length);
        var rejectedRounds = 0;
        foreach (var row in ordered)
        {
            CandleBattlesRoundDto round;
            try { round = CandleBattlesRoundProjection.ToDto(row); }
            catch (JsonException ex)
            {
                rejectedRounds++;
                _logger.LogWarning(ex,
                    "Candle Battle replay round transformation failed. MatchId={MatchId}, OpenTimeUtc={OpenTimeUtc}",
                    match.MatchId, row.OpenTimeUtc);
                continue;
            }
            var rejection = ReplayRejection(round, row, symbolA, symbolB, endMs);
            if (rejection is not null)
            {
                rejectedRounds++;
                _logger.LogWarning(
                    "Candle Battle replay round rejected. MatchId={MatchId}, OpenTimeUtc={OpenTimeUtc}, Reason={Reason}",
                    match.MatchId, row.OpenTimeUtc, rejection);
                continue;
            }
            rounds.Add(round);
        }
        var count = ordered.Length;
        var replayAvailable = rounds.Count > 0;
        var replayUnavailableReason = replayAvailable ? null
            : count == 0 ? "no_persisted_rounds"
            : rejectedRounds > 0 ? "no_replayable_rounds"
            : "insufficient_historical_data";
        if (!replayAvailable)
            _logger.LogWarning(
                "Candle Battle replay unavailable. MatchId={MatchId}, PersistedRounds={PersistedRounds}, RejectedRounds={RejectedRounds}, Reason={Reason}",
                match.MatchId, count, rejectedRounds, replayUnavailableReason);

        var publicationSequenceValid = firstOpen.HasValue
            && !string.IsNullOrWhiteSpace(symbolA)
            && !string.IsNullOrWhiteSpace(symbolB)
            && rejectedRounds == 0
            && rounds.Count == CandleBattlesResolver.ExpectedRounds
            && rounds.Select((round, index) => round.Left.OpenTime == firstOpen.Value + index * CandleBattlesResolver.PeriodMs)
                .All(x => x);
        var complete = publicationSequenceValid
            && state is { Complete: true, Status: "finished" };
        var scoreA = rounds.Count(x => x.Winner == "left");
        var scoreB = rounds.Count(x => x.Winner == "right");
        var final = match.Status == MatchStatus.Completed && state is { Complete: true, Status: "finished" };
        var winner = !final || scoreA == scoreB ? null : scoreA > scoreB ? symbolA : symbolB;
        var (interest, reasons) = publicationSequenceValid ? Score(rounds, scoreA, scoreB) : (0, (IReadOnlyList<string>)[]);
        var (canPost, skipReason) = _options.Enabled
            ? Eligibility(match, state, publication, complete) : (false, "disabled");
        string? publicUrl = null;
        if (match.Status == MatchStatus.Completed && complete
            && PriceCrossoverSocialPublicUrl.TryBuildCandleBattle(ResolvePublicBaseUrl(),
                match.MatchId, language, out var builtUrl)) publicUrl = builtUrl;
        var generatedAtUtc = DateTime.UtcNow;
        var durationEnd = match.Status == MatchStatus.Completed ? match.EndTime : generatedAtUtc;
        var duration = match.StartTime.HasValue && durationEnd.HasValue && durationEnd.Value >= match.StartTime.Value
            ? (int?)Math.Round((durationEnd.Value - match.StartTime.Value).TotalMinutes, MidpointRounding.AwayFromZero)
            : null;
        return new CandleBattleSocialResponse
        {
            MatchId = match.MatchId,
            BattleId = $"{match.MatchId}:5m",
            Status = match.Status.ToString(),
            BattleStatus = state?.Status ?? "unavailable",
            StartTimeUtc = match.StartTime,
            EndTimeUtc = match.EndTime,
            DurationMinutes = duration,
            AssetA = BuildAsset(symbolA, rounds.Select(x => x.Left).ToArray()),
            AssetB = BuildAsset(symbolB, rounds.Select(x => x.Right).ToArray()),
            ScoreA = scoreA, ScoreB = scoreB, WinnerSymbol = winner,
            ConfrontationCount = count, ExpectedConfrontations = CandleBattlesResolver.ExpectedRounds,
            InterestScore = interest, SelectionReasons = reasons,
            Rounds = includeRounds ? rounds : [], ReplayAvailable = replayAvailable,
            ReplayUnavailableReason = replayUnavailableReason,
            CanPost = canPost, SkipReason = skipReason,
            AlreadyPublished = publication?.Status == PriceCrossoverPublicationStatuses.Posted,
            Publication = publication,
            PublicUrl = publicUrl, PublicUrlAvailable = publicUrl is not null,
            GeneratedAtUtc = generatedAtUtc
        };
    }

    private static string? ReplayRejection(CandleBattlesRoundDto round, CandleBattlesRound row,
        string symbolA, string symbolB, long? endMs)
    {
        if (round.Left.OpenTime != round.Right.OpenTime) return "round_open_time_mismatch";
        if (endMs.HasValue && round.Left.CloseTime > endMs.Value) return "round_after_match_end";
        if (!round.Left.Confirmed || !round.Right.Confirmed) return "unconfirmed_candle";
        if (!CandleBattlesResolver.IsValid(round.Left) || !CandleBattlesResolver.IsValid(round.Right))
            return "invalid_candle";
        if (!string.Equals(round.Left.Symbol, symbolA, StringComparison.OrdinalIgnoreCase)
            || !string.Equals(round.Right.Symbol, symbolB, StringComparison.OrdinalIgnoreCase))
            return "symbol_mismatch";
        if (row.RuleVersion is not (CandleBattlesResolver.Version or CandleBattlesResolver.LegacyStrengthVersion))
            return "unsupported_rule_version";
        if (row.RuleVersion == CandleBattlesResolver.Version
            && row.Winner != CandleBattlesResolver.ResolveWinner(round.Left, round.Right, row.LeftStrength, row.RightStrength))
            return "winner_mismatch";
        return null;
    }

    public async Task<CandleBattleHighlightResponse> GetHighlightAsync(int lookbackHours, string language,
        bool includeRounds, CancellationToken ct)
    {
        var result = await GetCandidatesAsync(lookbackHours, _options.MaxCandidates, ct);
        var selected = result.Candidates.FirstOrDefault(x => x.IsEligible);
        var highlight = selected is null ? null : await GetByMatchIdAsync(selected.MatchId, language, includeRounds, ct);
        return new CandleBattleHighlightResponse
        {
            Highlight = highlight, HasHighlight = highlight?.CanPost == true,
            SkipReason = highlight?.CanPost == true ? null : result.MatchesScanned == 0
                ? "no_completed_matches_in_window" : highlight?.SkipReason ?? "no_eligible_match",
            GeneratedAtUtc = result.GeneratedAtUtc,
            LookbackHours = result.LookbackHours, MatchesScanned = result.MatchesScanned,
            EligibleCount = result.EligibleCount, Candidates = result.Candidates
        };
    }

    public async Task<CandleBattleCandidatesResponse> GetCandidatesAsync(int lookbackHours, int take, CancellationToken ct)
    {
        lookbackHours = Math.Clamp(lookbackHours, 1, _options.MaxLookbackHours);
        take = Math.Clamp(take, 1, 50);
        var now = DateTime.UtcNow;
        if (!_options.Enabled) return new CandleBattleCandidatesResponse { GeneratedAtUtc = now, LookbackHours = lookbackHours };
        var matches = await _db.Match.AsNoTracking()
            .Include(x => x.TeamA).ThenInclude(x => x.Currency)
            .Include(x => x.TeamB).ThenInclude(x => x.Currency)
            .Where(x => x.Status == MatchStatus.Completed && x.EndTime >= now.AddHours(-lookbackHours)
                && x.EndTime <= now)
            .OrderByDescending(x => x.EndTime).ThenBy(x => x.MatchId)
            .Take(Math.Max(take, _options.MaxCandidates) * 2).ToListAsync(ct);
        var candidates = new List<CandleBattleCandidateDto>();
        var pairs = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        foreach (var match in matches)
        {
            ct.ThrowIfCancellationRequested();
            var symbolA = match.TeamA?.Currency?.Symbol ?? string.Empty;
            var symbolB = match.TeamB?.Currency?.Symbol ?? string.Empty;
            if (MatchPairRules.IsForbiddenPair(symbolA, symbolB)) continue;
            var pair = string.Join(":", new[] { symbolA, symbolB }.Order(StringComparer.OrdinalIgnoreCase));
            pairs.TryGetValue(pair, out var pairCount);
            if (pairCount >= _options.MaxSamePairCandidates) continue;
            var response = await GetByMatchIdAsync(match.MatchId, "pt-BR", false, ct);
            if (response is null) continue;
            if (response.CanPost) pairs[pair] = pairCount + 1;
            candidates.Add(new CandleBattleCandidateDto
            {
                MatchId = match.MatchId, AssetASymbol = symbolA, AssetBSymbol = symbolB,
                EndTimeUtc = match.EndTime, ScoreA = response.ScoreA, ScoreB = response.ScoreB,
                InterestScore = response.InterestScore, IsEligible = response.CanPost,
                SelectionReasons = response.SelectionReasons,
                RejectionReasons = response.CanPost ? [] : [response.SkipReason ?? "ineligible"]
            });
            if (candidates.Count >= Math.Max(take, _options.MaxCandidates)) break;
        }
        var sorted = candidates.OrderByDescending(x => x.IsEligible)
            .ThenByDescending(x => x.InterestScore)
            .ThenByDescending(x => x.EndTimeUtc)
            .ThenBy(x => x.MatchId).ToArray();
        return new CandleBattleCandidatesResponse
        {
            GeneratedAtUtc = now, LookbackHours = lookbackHours,
            MatchesScanned = candidates.Count, EligibleCount = candidates.Count(x => x.IsEligible),
            SelectedMatchId = sorted.FirstOrDefault(x => x.IsEligible)?.MatchId,
            Candidates = sorted.Take(take).ToArray()
        };
    }

    private static CandleBattleSocialAssetDto BuildAsset(string symbol, IReadOnlyList<CandleBattlesCandleDto> candles)
    {
        var opening = candles.FirstOrDefault()?.Open;
        var closing = candles.LastOrDefault()?.Close;
        return new CandleBattleSocialAssetDto
        {
            Symbol = symbol, Pair = symbol.EndsWith("USDT", StringComparison.OrdinalIgnoreCase)
                ? $"{symbol[..^4]}/USDT" : $"{symbol}/USDT",
            LogoUrl = $"/futurebol/team-logo/{Uri.EscapeDataString(symbol)}",
            OpeningPrice = opening, ClosingPrice = closing,
            PerformancePercent = opening is > 0 && closing.HasValue
                ? (closing.Value - opening.Value) / opening.Value * 100m : null,
            GreenCandles = candles.Count(x => x.Close > x.Open),
            RedCandles = candles.Count(x => x.Close < x.Open)
        };
    }

    private static (bool CanPost, string? SkipReason) Eligibility(Match match, CandleBattlesState? state,
        PriceCrossoverPublicationState? publication, bool complete)
    {
        if (match.Status != MatchStatus.Completed) return (false, "match_not_completed");
        if (state is null || !complete) return (false, "incomplete_battle_data");
        if (publication?.Status == PriceCrossoverPublicationStatuses.Posted) return (false, "already_published");
        if (publication?.Status == PriceCrossoverPublicationStatuses.ReconciliationRequired) return (false, "reconciliation_required");
        if (publication?.Status is PriceCrossoverPublicationStatuses.Reserved or PriceCrossoverPublicationStatuses.Publishing
            && (publication.LeaseExpiresAtUtc is null || publication.LeaseExpiresAtUtc > DateTime.UtcNow))
            return (false, "already_reserved");
        return (true, null);
    }

    private (int Score, IReadOnlyList<string> Reasons) Score(IReadOnlyList<CandleBattlesRoundDto> rounds, int scoreA, int scoreB)
    {
        if (rounds.Count == 0) return (0, []);
        var lead = 0; var comeback = false;
        var a = 0; var b = 0;
        foreach (var round in rounds)
        {
            if (round.Winner == "left") a++;
            if (round.Winner == "right") b++;
            var next = Math.Sign(a - b);
            if (lead != 0 && next != 0 && next != lead) comeback = true;
            if (next != 0) lead = next;
        }
        var decided = scoreA + scoreB;
        var balance = decided == 0 ? 0m : 1m - (decimal)Math.Abs(scoreA - scoreB) / decided;
        var decisive = decided == 0 ? 0m : (decimal)Math.Abs(scoreA - scoreB) / decided;
        var leftPerformance = CandleBattlesResolver.PercentageChange(rounds[0].Left with { Close = rounds[^1].Left.Close });
        var rightPerformance = CandleBattlesResolver.PercentageChange(rounds[0].Right with { Close = rounds[^1].Right.Close });
        var spread = Math.Abs(leftPerformance - rightPerformance);
        var movement = rounds.Average(x => (Math.Abs(CandleBattlesResolver.PercentageChange(x.Left))
            + Math.Abs(CandleBattlesResolver.PercentageChange(x.Right))) / 2m);
        var score = _options.WeightComeback * (comeback ? 1m : 0m)
            + _options.WeightBalance * balance
            + _options.WeightDecisiveWin * decisive
            + _options.WeightPerformanceSpread * Math.Min(1m, spread / Math.Max(.01m, _options.SignificantPerformanceSpreadPercent))
            + _options.WeightCandleMovement * Math.Min(1m, movement / Math.Max(.01m, _options.SignificantCandleMovementPercent));
        var maximum = _options.WeightComeback + _options.WeightBalance + _options.WeightDecisiveWin
            + _options.WeightPerformanceSpread + _options.WeightCandleMovement;
        var reasons = new List<string>();
        if (comeback) reasons.Add("comeback");
        if (balance >= .75m) reasons.Add("balanced_score");
        if (decisive >= .6m) reasons.Add("decisive_win");
        if (spread >= _options.SignificantPerformanceSpreadPercent) reasons.Add("performance_spread");
        if (movement >= _options.SignificantCandleMovementPercent) reasons.Add("candle_movement");
        return (maximum <= 0 ? 0 : (int)Math.Clamp(Math.Round(score / maximum * 100m), 0m, 100m), reasons);
    }

    private string ResolvePublicBaseUrl() => _options.PublicBaseUrl
        ?? _configuration["CriptoVersus:PublicBaseUrl"]
        ?? _configuration["SocialAutomation:PublicBaseUrl"]
        ?? PriceCrossoverSocialPublicUrl.DefaultPublicBaseUrl;
}
