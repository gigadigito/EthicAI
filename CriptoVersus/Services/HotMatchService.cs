using System.Collections.Concurrent;
using DTOs;
using Microsoft.Extensions.Caching.Memory;

namespace CriptoVersus.Web.Services;

public sealed class HotMatchService
{
    private const string CacheKey = "hot-match-feed-v1";
    private const string LastKnownGoodCacheKey = "hot-match-feed-v1:last-good";
    private static readonly SemaphoreSlim CacheLock = new(1, 1);

    private readonly CriptoVersusApiClient _api;
    private readonly IMemoryCache _cache;
    private readonly MatchSlugHelper _slugHelper;
    private readonly ILogger<HotMatchService> _logger;

    public HotMatchService(
        CriptoVersusApiClient api,
        IMemoryCache cache,
        MatchSlugHelper slugHelper,
        ILogger<HotMatchService> logger)
    {
        _api = api;
        _cache = cache;
        _slugHelper = slugHelper;
        _logger = logger;
    }

    public async Task<IReadOnlyList<HotMatchDto>> GetHotMatchesAsync(CancellationToken ct = default)
    {
        if (_cache.TryGetValue<IReadOnlyList<HotMatchDto>>(CacheKey, out var cached) && cached is not null)
            return cached;

        await CacheLock.WaitAsync(ct);
        try
        {
            if (_cache.TryGetValue<IReadOnlyList<HotMatchDto>>(CacheKey, out cached) && cached is not null)
                return cached;

            var items = await LoadHotMatchesCoreAsync(ct);
            if (items.Count == 0 &&
                _cache.TryGetValue<IReadOnlyList<HotMatchDto>>(LastKnownGoodCacheKey, out var lastKnownGood) &&
                lastKnownGood is { Count: > 0 })
            {
                _logger.LogWarning("[HOT_MATCH] Using last known good feed because live load returned empty. Count={Count}", lastKnownGood.Count);
                items = lastKnownGood;
            }

            _cache.Set(CacheKey, items, TimeSpan.FromSeconds(10));
            if (items.Count > 0)
                _cache.Set(LastKnownGoodCacheKey, items, TimeSpan.FromMinutes(2));
            return items;
        }
        finally
        {
            CacheLock.Release();
        }
    }

    public TvHotMatchDto ToTvHotMatch(HotMatchDto hotMatch, string culture, RouteLocalizationService routeLocalization)
    {
        var leader = ResolveLeaderSymbol(hotMatch);
        var publicWatchUrl = routeLocalization.BuildTvMatchPath(culture, hotMatch.MatchId, hotMatch.Slug);

        return new TvHotMatchDto
        {
            HasMatch = true,
            MatchId = hotMatch.MatchId,
            Slug = hotMatch.Slug,
            LeftSymbol = hotMatch.HomeSymbol,
            RightSymbol = hotMatch.AwaySymbol,
            LeftName = hotMatch.HomeSymbol,
            RightName = hotMatch.AwaySymbol,
            LeftScore = hotMatch.HomeScore,
            RightScore = hotMatch.AwayScore,
            LeftLogoUrl = hotMatch.HomeLogoUrl,
            RightLogoUrl = hotMatch.AwayLogoUrl,
            HotScore = hotMatch.HotScore,
            Reason = hotMatch.Reason,
            WatchUrl = publicWatchUrl,
            VolumeLabel = hotMatch.TotalPoolAmount > 0m
                ? hotMatch.TotalPoolAmount.ToString("0.##", System.Globalization.CultureInfo.InvariantCulture)
                : hotMatch.TotalPool.ToString("0.##", System.Globalization.CultureInfo.InvariantCulture),
            MomentumLabel = BuildMomentumLabel(hotMatch, leader),
            RemainingTimeLabel = $"{Math.Max(0, hotMatch.RemainingMinutes):00}:00",
            RemainingSeconds = Math.Max(0, hotMatch.RemainingMinutes) * 60,
            MatchStartTimeUtc = hotMatch.MatchSnapshot?.StartTime?.ToUniversalTime(),
            LeftChangePercent = hotMatch.PctA,
            RightChangePercent = hotMatch.PctB,
            LeaderSymbol = leader,
            PressureSymbol = leader,
            PoolStatusLabel = hotMatch.HasBetsOnBothSides ? "balanced" : "activeFlow",
            HasRecentReversal = hotMatch.RecentGoals > 0 && hotMatch.ScoreDifference <= 1
        };
    }

    private async Task<IReadOnlyList<HotMatchDto>> LoadHotMatchesCoreAsync(CancellationToken ct)
    {
        var matchesTask = TryGetMatchesAsync(ct);
        var socialHotMatchesTask = TryGetSocialHotMatchesAsync(ct);

        await Task.WhenAll(matchesTask, socialHotMatchesTask);

        var matches = matchesTask.Result ?? [];
        var socialHotMatches = socialHotMatchesTask.Result;

        if (socialHotMatches is { Count: > 0 })
        {
            var normalized = NormalizeSocialHotMatches(socialHotMatches, matches);
            if (normalized.Count > 0)
            {
                _logger.LogInformation("[HOT_MATCH] Loaded {Count} matches from social hot feed.", normalized.Count);
                return normalized;
            }
        }

        var fallback = await BuildFallbackHotMatchesAsync(matches, ct);
        _logger.LogWarning("[HOT_MATCH] Falling back to legacy/local ranking. Count={Count}", fallback.Count);
        return fallback;
    }

    private async Task<List<SocialHotMatchDto>?> TryGetSocialHotMatchesAsync(CancellationToken ct)
    {
        for (var attempt = 1; attempt <= 2; attempt++)
        {
            try
            {
                return await _api.GetSocialHotMatchesAsync(ct);
            }
            catch (OperationCanceledException)
            {
                throw;
            }
            catch (Exception ex) when (attempt < 2)
            {
                _logger.LogDebug(ex, "[HOT_MATCH] social hot feed attempt {Attempt} failed; retrying silently.", attempt);
                await Task.Delay(250, ct);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "[HOT_MATCH] social hot feed unavailable.");
            }
        }

        return null;
    }

    private async Task<List<MatchDto>?> TryGetMatchesAsync(CancellationToken ct)
    {
        try
        {
            return await _api.GetMatchesAsync(includeParticipants: false, ct);
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "[HOT_MATCH] unable to load matches for normalization.");
            return null;
        }
    }

    private async Task<IReadOnlyList<HotMatchDto>> BuildFallbackHotMatchesAsync(IReadOnlyList<MatchDto> matches, CancellationToken ct)
    {
        TvHotMatchDto? legacyHotMatch = null;

        try
        {
            legacyHotMatch = await _api.GetTvHotMatchAsync(ct);
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "[HOT_MATCH] legacy tv hot match unavailable during fallback.");
        }

        var ranked = matches
            .Where(x => x.MatchId > 0)
            .GroupBy(x => x.MatchId)
            .Select(x => x.First())
            .Select(x => NormalizeFallbackMatch(x, legacyHotMatch))
            .OrderByDescending(x => x.PriorityScore)
            .ThenByDescending(x => x.HotScore)
            .Take(10)
            .ToList();

        foreach (var item in ranked.Take(3))
            LogHotScore(item);

        return ranked;
    }

    private List<HotMatchDto> NormalizeSocialHotMatches(IReadOnlyList<SocialHotMatchDto> socialHotMatches, IReadOnlyList<MatchDto> matches)
    {
        var matchMap = matches
            .Where(x => x.MatchId > 0)
            .GroupBy(x => x.MatchId)
            .Select(x => x.First())
            .ToDictionary(x => x.MatchId);

        var normalized = new List<HotMatchDto>(socialHotMatches.Count);

        foreach (var social in socialHotMatches)
        {
            matchMap.TryGetValue(social.MatchId, out var match);
            var item = NormalizeHotMatch(social, match);
            normalized.Add(item);
            LogHotScore(item);
        }

        return normalized
            .OrderByDescending(x => x.PriorityScore)
            .ThenByDescending(x => x.HotScore)
            .ThenBy(x => x.ScoreDifference)
            .Take(10)
            .ToList();
    }

    private HotMatchDto NormalizeHotMatch(SocialHotMatchDto social, MatchDto? match)
    {
        var pctA = match?.PctA ?? 0m;
        var pctB = match?.PctB ?? 0m;
        var momentum = Math.Clamp(Math.Abs(pctA - pctB) * 18m + (social.TotalGoals * 4m), 0m, 100m);
        var scoreDifference = Math.Abs(social.HomeGoals - social.AwayGoals);
        var recentGoals = HasRecentGoalSignal(social) ? Math.Max(1, Math.Min(3, social.TotalGoals)) : 0;
        var activity = Math.Clamp((social.TotalBets * 4) + (social.TotalGoals * 10), 0, 100);
        var fear = CalculateFear(scoreDifference, social.Minute, match?.RemainingMinutes ?? Math.Max(0, 90 - social.Minute), social.TotalBets);
        var arenaPressure = CalculateArenaPressure(social.HotScore, activity, scoreDifference, recentGoals);
        var isTrending = social.HotScore >= 70 || activity >= 72 || social.TotalBets >= 10;
        var isExplosive = social.HotScore >= 90 || (recentGoals > 0 && scoreDifference <= 1 && (activity >= 68 || momentum >= 50m));
        var slug = match is not null
            ? _slugHelper.BuildSlug(match.TeamA, match.TeamB)
            : _slugHelper.BuildSlug(social.HomeSymbol, social.AwaySymbol);
        var remainingMinutes = match?.RemainingMinutes ?? Math.Max(0, 90 - social.Minute);
        var priorityScore = CalculatePriorityScore(social.HotScore, scoreDifference, recentGoals, momentum, fear, activity, isExplosive, isTrending);

        return new HotMatchDto
        {
            MatchId = social.MatchId,
            Slug = slug,
            HomeSymbol = match?.TeamA ?? social.HomeSymbol,
            AwaySymbol = match?.TeamB ?? social.AwaySymbol,
            HomeScore = match?.ScoreA ?? social.HomeGoals,
            AwayScore = match?.ScoreB ?? social.AwayGoals,
            HotScore = social.HotScore,
            Momentum = momentum,
            Fear = fear,
            ArenaPressure = arenaPressure,
            LastGoalAt = recentGoals > 0 ? DateTime.UtcNow.AddMinutes(-Math.Min(10, Math.Max(1, 90 - social.Minute))) : null,
            IsTrending = isTrending,
            IsExplosive = isExplosive,
            ViewerCount = null,
            ActivityLevel = activity,
            ScoreDifference = scoreDifference,
            RecentGoals = recentGoals,
            Status = match?.Status ?? social.Status,
            Minute = social.Minute,
            ElapsedMinutes = match?.ElapsedMinutes ?? social.Minute,
            RemainingMinutes = remainingMinutes,
            IsFinished = match?.IsFinished ?? IsTerminalMatchStatus(social.Status),
            PctA = match?.PctA,
            PctB = match?.PctB,
            TotalPool = match?.TotalPool ?? 0m,
            TotalPoolAmount = match?.TotalPoolAmount ?? social.HomeBetAmount + social.AwayBetAmount,
            HasBetsOnBothSides = match?.HasBetsOnBothSides ?? (social.HomeBetAmount > 0m && social.AwayBetAmount > 0m),
            PoolStrengthTeamA = match?.PoolStrengthTeamA ?? 0,
            PoolStrengthTeamB = match?.PoolStrengthTeamB ?? 0,
            TotalGoals = social.TotalGoals,
            TotalBets = social.TotalBets,
            HomeBetAmount = social.HomeBetAmount,
            AwayBetAmount = social.AwayBetAmount,
            Reason = social.Reason,
            PublicUrl = social.PublicUrl,
            HomeLogoUrl = _api.BuildBinanceIconUrl(match?.TeamA ?? social.HomeSymbol),
            AwayLogoUrl = _api.BuildBinanceIconUrl(match?.TeamB ?? social.AwaySymbol),
            PriorityScore = priorityScore,
            MatchSnapshot = match
        };
    }

    private static bool IsTerminalMatchStatus(string? status)
    {
        if (string.IsNullOrWhiteSpace(status))
            return false;

        return status.Trim().ToUpperInvariant() switch
        {
            "COMPLETED" => true,
            "CANCELLED" => true,
            "CANCELED" => true,
            "CLOSED" => true,
            "SETTLED" => true,
            "FINISHED" => true,
            "EXPIRED" => true,
            "ABORTED" => true,
            _ => false
        };
    }

    private HotMatchDto NormalizeFallbackMatch(MatchDto match, TvHotMatchDto? legacyHotMatch)
    {
        var hotScore = legacyHotMatch?.HasMatch == true && legacyHotMatch.MatchId == match.MatchId
            ? Math.Max(legacyHotMatch.HotScore, CalculateFallbackHotScore(match))
            : CalculateFallbackHotScore(match);
        var scoreDifference = Math.Abs(match.ScoreA - match.ScoreB);
        var momentum = Math.Clamp(Math.Abs((match.PctA ?? 0m) - (match.PctB ?? 0m)) * 20m, 0m, 100m);
        var activity = Math.Clamp((match.BetCountTeamA + match.BetCountTeamB) * 4 + (match.ScoreA + match.ScoreB) * 10, 0, 100);
        var recentGoals = scoreDifference <= 1 && (match.ScoreA + match.ScoreB) >= 3 ? 1 : 0;
        var fear = CalculateFear(scoreDifference, match.ElapsedMinutes, match.RemainingMinutes, match.BetCountTeamA + match.BetCountTeamB);
        var arenaPressure = CalculateArenaPressure(hotScore, activity, scoreDifference, recentGoals);
        var isTrending = hotScore >= 68 || match.TotalPoolAmount >= 100m;
        var isExplosive = hotScore >= 88 || (match.RemainingMinutes <= 15 && scoreDifference <= 1);

        return new HotMatchDto
        {
            MatchId = match.MatchId,
            Slug = _slugHelper.BuildSlug(match.TeamA, match.TeamB),
            HomeSymbol = match.TeamA,
            AwaySymbol = match.TeamB,
            HomeScore = match.ScoreA,
            AwayScore = match.ScoreB,
            HotScore = hotScore,
            Momentum = momentum,
            Fear = fear,
            ArenaPressure = arenaPressure,
            LastGoalAt = null,
            IsTrending = isTrending,
            IsExplosive = isExplosive,
            ViewerCount = null,
            ActivityLevel = activity,
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
            TotalGoals = match.ScoreA + match.ScoreB,
            TotalBets = match.BetCountTeamA + match.BetCountTeamB,
            HomeBetAmount = match.TotalAmountTeamA,
            AwayBetAmount = match.TotalAmountTeamB,
            Reason = legacyHotMatch?.HasMatch == true && legacyHotMatch.MatchId == match.MatchId
                ? legacyHotMatch.Reason
                : "Fallback hot-match ranking based on match competitiveness and pool activity.",
            PublicUrl = string.Empty,
            HomeLogoUrl = _api.BuildBinanceIconUrl(match.TeamA),
            AwayLogoUrl = _api.BuildBinanceIconUrl(match.TeamB),
            PriorityScore = CalculatePriorityScore(hotScore, scoreDifference, recentGoals, momentum, fear, activity, isExplosive, isTrending),
            MatchSnapshot = match
        };
    }

    private static int CalculateFallbackHotScore(MatchDto match)
    {
        var scoreDifference = Math.Abs(match.ScoreA - match.ScoreB);
        var closeness = scoreDifference switch
        {
            0 => 24,
            1 => 18,
            2 => 10,
            _ => 4
        };

        var poolScore = (int)Math.Min(24m, match.TotalPoolAmount / 8m);
        var betScore = Math.Min(18, (match.BetCountTeamA + match.BetCountTeamB) * 2);
        var momentumScore = (int)Math.Min(18m, Math.Abs((match.PctA ?? 0m) - (match.PctB ?? 0m)) * 10m);
        var timeScore = match.RemainingMinutes switch
        {
            > 5 and < 50 => 12,
            <= 5 => 4,
            _ => 8
        };

        return Math.Clamp(22 + closeness + poolScore + betScore + momentumScore + timeScore, 0, 100);
    }

    private static decimal CalculatePriorityScore(int hotScore, int scoreDifference, int recentGoals, decimal momentum, decimal fear, int activity, bool isExplosive, bool isTrending)
    {
        decimal score = hotScore * 1.45m;
        score += Math.Max(0, 20 - (scoreDifference * 6));
        score += recentGoals * 14;
        score += momentum * 0.35m;
        score += fear * 0.18m;
        score += activity * 0.22m;
        if (isTrending)
            score += 18m;
        if (isExplosive)
            score += 34m;
        return Math.Round(score, 2, MidpointRounding.AwayFromZero);
    }

    private static decimal CalculateFear(int scoreDifference, int minute, int remainingMinutes, int totalBets)
    {
        decimal fear = scoreDifference <= 1 ? 40m : 18m;
        fear += remainingMinutes <= 15 ? 24m : 8m;
        fear += minute >= 70 ? 12m : 0m;
        fear += totalBets >= 10 ? 10m : 0m;
        return Math.Clamp(fear, 0m, 100m);
    }

    private static int CalculateArenaPressure(int hotScore, int activity, int scoreDifference, int recentGoals)
    {
        var pressure = (int)Math.Round((hotScore * 0.55m) + (activity * 0.22m) + (Math.Max(0, 24 - (scoreDifference * 7))) + (recentGoals * 8), MidpointRounding.AwayFromZero);
        return Math.Clamp(pressure, 0, 100);
    }

    private static bool HasRecentGoalSignal(SocialHotMatchDto social)
    {
        var reason = social.Reason ?? string.Empty;
        return reason.Contains("gol recente", StringComparison.OrdinalIgnoreCase)
            || reason.Contains("recent goal", StringComparison.OrdinalIgnoreCase)
            || reason.Contains("virada recente", StringComparison.OrdinalIgnoreCase)
            || reason.Contains("recent comeback", StringComparison.OrdinalIgnoreCase);
    }

    private static string ResolveLeaderSymbol(HotMatchDto hotMatch)
    {
        if (hotMatch.HomeScore != hotMatch.AwayScore)
            return hotMatch.HomeScore > hotMatch.AwayScore ? hotMatch.HomeSymbol : hotMatch.AwaySymbol;

        if ((hotMatch.PctA ?? 0m) != (hotMatch.PctB ?? 0m))
            return (hotMatch.PctA ?? 0m) > (hotMatch.PctB ?? 0m) ? hotMatch.HomeSymbol : hotMatch.AwaySymbol;

        return hotMatch.HomeSymbol;
    }

    private static string BuildMomentumLabel(HotMatchDto hotMatch, string leader)
    {
        if (hotMatch.Momentum < 8m)
            return "Momentum balanced";

        return $"{leader} momentum rising";
    }

    private void LogHotScore(HotMatchDto item)
    {
        _logger.LogInformation(
            "[HOT_SCORE] Match={MatchId} HotScore={HotScore} Priority={PriorityScore} Diff={ScoreDifference} RecentGoals={RecentGoals} Momentum={Momentum} Fear={Fear} Activity={Activity}",
            item.MatchId,
            item.HotScore,
            item.PriorityScore,
            item.ScoreDifference,
            item.RecentGoals,
            item.Momentum,
            item.Fear,
            item.ActivityLevel);
    }
}
