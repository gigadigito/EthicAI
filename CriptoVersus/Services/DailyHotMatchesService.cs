using System.Diagnostics;
using DTOs;
using Microsoft.Extensions.Caching.Memory;

namespace CriptoVersus.Web.Services;

/// <summary>
/// Ranking exclusivo da página /social/hot-matches.
///
/// Esta classe NÃO reutiliza o feed de HotMatchService, porque aquele feed é
/// voltado principalmente a partidas ativas/TV. Aqui buscamos o histórico
/// recente diretamente na API e classificamos partidas iniciadas ou encerradas
/// dentro da janela solicitada.
/// </summary>
public sealed class DailyHotMatchesService
{
    private const string CacheKeyPrefix = "daily-hot-matches-v1";
    private static readonly SemaphoreSlim CacheLock = new(1, 1);

    private readonly CriptoVersusApiClient _api;
    private readonly IMemoryCache _cache;
    private readonly MatchSlugHelper _slugHelper;
    private readonly ILogger<DailyHotMatchesService> _logger;

    public DailyHotMatchesService(
        CriptoVersusApiClient api,
        IMemoryCache cache,
        MatchSlugHelper slugHelper,
        ILogger<DailyHotMatchesService> logger)
    {
        _api = api;
        _cache = cache;
        _slugHelper = slugHelper;
        _logger = logger;
    }

    public async Task<IReadOnlyList<HotMatchDto>> GetTopMatchesAsync(
        int windowHours = 24,
        int limit = 5,
        CancellationToken ct = default)
    {
        windowHours = Math.Clamp(windowHours, 1, 72);
        limit = Math.Clamp(limit, 1, 10);

        var cacheKey = $"{CacheKeyPrefix}:{windowHours}:{limit}";

        if (_cache.TryGetValue<IReadOnlyList<HotMatchDto>>(cacheKey, out var cached) &&
            cached is not null)
        {
            return cached;
        }

        await CacheLock.WaitAsync(ct);
        try
        {
            if (_cache.TryGetValue<IReadOnlyList<HotMatchDto>>(cacheKey, out cached) &&
                cached is not null)
            {
                return cached;
            }

            var result = await LoadAsync(windowHours, limit, ct);

            _cache.Set(
                cacheKey,
                result,
                new MemoryCacheEntryOptions
                {
                    AbsoluteExpirationRelativeToNow = TimeSpan.FromMinutes(2),
                    Size = Math.Max(1, result.Count)
                });

            return result;
        }
        finally
        {
            CacheLock.Release();
        }
    }

    private async Task<IReadOnlyList<HotMatchDto>> LoadAsync(
        int windowHours,
        int limit,
        CancellationToken ct)
    {
        var sw = Stopwatch.StartNew();
        var utcNow = DateTime.UtcNow;
        var cutoffUtc = utcNow.AddHours(-windowHours);

        /*
         * O endpoint social diário já seleciona partidas ativas ou encerradas
         * dentro da janela solicitada.
         *
         * Este serviço fica responsável somente pelo ranking editorial:
         * gols, equilíbrio, apostas, pool e recência.
         */
        var matches = await _api.GetDailyHotMatchCandidatesAsync(
            hours: windowHours,
            take: 200,
            ct: ct);

        if (matches is not { Count: > 0 })
        {
            _logger.LogWarning(
                "[DAILY_HOT_MATCH] API returned no matches. WindowHours={WindowHours}",
                windowHours);

            return [];
        }

        var candidates = matches
            .Where(x => x.MatchId > 0)
            .GroupBy(x => x.MatchId)
            .Select(group => group
                .OrderByDescending(GetReferenceTimeUtc)
                .First())
            .Select(match => new
            {
                Match = match,
                ReferenceTimeUtc = GetReferenceTimeUtc(match)
            })
            .Where(x =>
                x.ReferenceTimeUtc >= cutoffUtc &&
                x.ReferenceTimeUtc <= utcNow.AddMinutes(5))
            .Where(x => x.Match.ScoreA + x.Match.ScoreB > 0)
            .Select(x => Normalize(x.Match, x.ReferenceTimeUtc, utcNow))
            .OrderByDescending(x => x.PriorityScore)
            .ThenByDescending(x => x.TotalGoals)
            .ThenBy(x => x.ScoreDifference)
            .ThenByDescending(x => GetReferenceTimeUtc(x.MatchSnapshot))
            .Take(limit)
            .ToList();

        _logger.LogInformation(
            "[DAILY_HOT_MATCH] Ranked {Count} matches from {SourceCount}. WindowHours={WindowHours} CutoffUtc={CutoffUtc:o} ElapsedMs={ElapsedMs}",
            candidates.Count,
            matches.Count,
            windowHours,
            cutoffUtc,
            sw.ElapsedMilliseconds);

        foreach (var item in candidates)
        {
            _logger.LogInformation(
                "[DAILY_HOT_MATCH_ITEM] Match={MatchId} Score={HomeScore}x{AwayScore} TotalGoals={TotalGoals} DailyHotScore={HotScore} Priority={PriorityScore} Status={Status}",
                item.MatchId,
                item.HomeScore,
                item.AwayScore,
                item.TotalGoals,
                item.HotScore,
                item.PriorityScore,
                item.Status);
        }

        return candidates;
    }

    private HotMatchDto Normalize(
        MatchDto match,
        DateTime referenceTimeUtc,
        DateTime utcNow)
    {
        var totalGoals = Math.Max(0, match.ScoreA) + Math.Max(0, match.ScoreB);
        var scoreDifference = Math.Abs(match.ScoreA - match.ScoreB);
        var totalBets = Math.Max(0, match.BetCountTeamA) + Math.Max(0, match.BetCountTeamB);

        var dailyScore = CalculateDailyHotScore(
            totalGoals,
            scoreDifference,
            totalBets,
            match.TotalPoolAmount,
            match.IsFinished,
            referenceTimeUtc,
            utcNow);

        var activity = Math.Clamp(
            (totalGoals * 12) +
            (totalBets * 3) +
            (int)Math.Min(25m, match.TotalPoolAmount / 10m),
            0,
            100);

        var momentum = Math.Clamp(
            Math.Abs((match.PctA ?? 0m) - (match.PctB ?? 0m)) * 20m,
            0m,
            100m);

        var recentGoals = totalGoals switch
        {
            >= 8 => 3,
            >= 5 => 2,
            >= 2 => 1,
            _ => 0
        };

        var priorityScore = CalculateDailyPriorityScore(
            dailyScore,
            totalGoals,
            scoreDifference,
            totalBets,
            match.TotalPoolAmount,
            match.IsFinished,
            referenceTimeUtc,
            utcNow);

        return new HotMatchDto
        {
            MatchId = match.MatchId,
            Slug = _slugHelper.BuildSlug(match.TeamA, match.TeamB),

            HomeSymbol = match.TeamA,
            AwaySymbol = match.TeamB,
            HomeScore = match.ScoreA,
            AwayScore = match.ScoreB,

            // Este HotScore pertence somente ao ranking diário.
            HotScore = dailyScore,
            PriorityScore = priorityScore,

            Momentum = momentum,
            Fear = CalculateDrama(totalGoals, scoreDifference, match.IsFinished),
            ArenaPressure = activity,
            ActivityLevel = activity,

            LastGoalAt = null,
            IsTrending = dailyScore >= 70,
            IsExplosive = totalGoals >= 6 || dailyScore >= 85,
            ViewerCount = null,

            ScoreDifference = scoreDifference,
            RecentGoals = recentGoals,

            Status = match.Status,
            Minute = match.ElapsedMinutes,
            ElapsedMinutes = match.ElapsedMinutes,
            RemainingMinutes = match.RemainingMinutes,
            IsFinished = match.IsFinished,

            PctA = match.PctA,
            PctB = match.PctB,

            TotalPool = match.TotalPool,
            TotalPoolAmount = match.TotalPoolAmount,
            HasBetsOnBothSides = match.HasBetsOnBothSides,
            PoolStrengthTeamA = match.PoolStrengthTeamA,
            PoolStrengthTeamB = match.PoolStrengthTeamB,

            TotalGoals = totalGoals,
            TotalBets = totalBets,
            HomeBetAmount = match.TotalAmountTeamA,
            AwayBetAmount = match.TotalAmountTeamB,

            Reason = BuildReason(totalGoals, scoreDifference, match.IsFinished),
            PublicUrl = string.Empty,

            HomeLogoUrl = _api.BuildBinanceIconUrl(match.TeamA),
            AwayLogoUrl = _api.BuildBinanceIconUrl(match.TeamB),

            MatchSnapshot = match
        };
    }

    /// <summary>
    /// Momento usado para decidir se a partida pertence à janela.
    ///
    /// Para partidas finalizadas, aproxima o encerramento usando StartTime +
    /// ElapsedMinutes. Para partidas ainda ativas, usa o momento atual implícito
    /// pelo progresso da partida.
    /// </summary>
    private static DateTime GetReferenceTimeUtc(MatchDto? match)
    {
        if (match is null)
            return DateTime.MinValue;

        if (match.EndTime.HasValue)
            return match.EndTime.Value.ToUniversalTime();

        if (match.StartTime.HasValue)
        {
            var startUtc = match.StartTime.Value.ToUniversalTime();
            var elapsedMinutes = Math.Max(0, match.ElapsedMinutes);

            return startUtc.AddMinutes(elapsedMinutes);
        }

        return DateTime.MinValue;
    }

    private static int CalculateDailyHotScore(
        int totalGoals,
        int scoreDifference,
        int totalBets,
        decimal totalPoolAmount,
        bool isFinished,
        DateTime referenceTimeUtc,
        DateTime utcNow)
    {
        var goalsScore = Math.Min(55, totalGoals * 7);

        var balanceScore = scoreDifference switch
        {
            0 => 20,
            1 => 16,
            2 => 10,
            3 => 6,
            _ => 2
        };

        var engagementScore =
            Math.Min(12, totalBets) +
            (int)Math.Min(10m, totalPoolAmount / 25m);

        var finishedBonus = isFinished ? 5 : 0;

        var ageHours = Math.Max(0d, (utcNow - referenceTimeUtc).TotalHours);
        var recencyScore = ageHours switch
        {
            <= 2 => 8,
            <= 6 => 6,
            <= 12 => 4,
            <= 24 => 2,
            _ => 0
        };

        return Math.Clamp(
            goalsScore +
            balanceScore +
            engagementScore +
            finishedBonus +
            recencyScore,
            0,
            100);
    }

    private static decimal CalculateDailyPriorityScore(
        int dailyHotScore,
        int totalGoals,
        int scoreDifference,
        int totalBets,
        decimal totalPoolAmount,
        bool isFinished,
        DateTime referenceTimeUtc,
        DateTime utcNow)
    {
        /*
         * Neste ranking, quantidade de gols pesa mais que o fato de a partida
         * ainda estar ativa. Assim, um 7x6 encerrado recentemente tende a vencer
         * um 1x0 atual.
         */
        decimal score = dailyHotScore * 1.2m;
        score += totalGoals * 18m;
        score += Math.Max(0, 18 - (scoreDifference * 3));
        score += Math.Min(20, totalBets) * 1.5m;
        score += Math.Min(30m, totalPoolAmount / 10m);

        if (isFinished)
            score += 8m;

        var ageHours = Math.Max(0d, (utcNow - referenceTimeUtc).TotalHours);
        score -= (decimal)Math.Min(18d, ageHours * 0.75d);

        return Math.Round(score, 2, MidpointRounding.AwayFromZero);
    }

    private static decimal CalculateDrama(
        int totalGoals,
        int scoreDifference,
        bool isFinished)
    {
        decimal drama = Math.Min(60, totalGoals * 8);

        drama += scoreDifference switch
        {
            0 => 28,
            1 => 22,
            2 => 12,
            _ => 4
        };

        if (isFinished)
            drama += 5;

        return Math.Clamp(drama, 0m, 100m);
    }

    private static string BuildReason(
        int totalGoals,
        int scoreDifference,
        bool isFinished)
    {
        var state = isFinished ? "finished" : "active";

        return scoreDifference switch
        {
            0 => $"{state} high-scoring match with a tied score.",
            1 => $"{state} high-scoring match decided by one goal.",
            <= 3 => $"{state} match with strong scoring activity.",
            _ => $"{state} match ranked by total goals and recent activity."
        };
    }
}
