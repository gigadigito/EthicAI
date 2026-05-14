using DAL.NftFutebol;
using DTOs;
using EthicAI.EntityModel;
using Microsoft.EntityFrameworkCore;

namespace CriptoVersus.API.Services;

public interface ITvHotMatchService
{
    Task<TvHotMatchDto> GetHotMatchAsync(CancellationToken ct);
}

public sealed class TvHotMatchService : ITvHotMatchService
{
    private const int MatchDurationMinutes = 90;
    private static readonly HashSet<string> PopularSymbols = new(StringComparer.OrdinalIgnoreCase)
    {
        "BTC", "ETH", "SOL", "BNB", "XRP", "ADA", "DOGE", "AVAX", "LINK", "SUI"
    };

    private readonly EthicAIDbContext _db;
    private readonly IConfiguration _configuration;

    public TvHotMatchService(EthicAIDbContext db, IConfiguration configuration)
    {
        _db = db;
        _configuration = configuration;
    }

    public async Task<TvHotMatchDto> GetHotMatchAsync(CancellationToken ct)
    {
        var nowUtc = DateTime.UtcNow;

        var matches = await _db.Set<Match>()
            .AsNoTracking()
            .Include(x => x.TeamA).ThenInclude(x => x.Currency)
            .Include(x => x.TeamB).ThenInclude(x => x.Currency)
            .Where(x => x.Status == MatchStatus.Ongoing)
            .OrderBy(x => x.StartTime ?? DateTime.MaxValue)
            .ToListAsync(ct);

        if (matches.Count == 0)
            return BuildEmpty("No hot match available right now");

        var matchIds = matches.Select(x => x.MatchId).ToList();
        var recentBetCutoff = nowUtc.AddMinutes(-15);
        var reversalCutoff = nowUtc.AddMinutes(-20);

        var aggregates = await _db.Set<Bet>()
            .AsNoTracking()
            .Where(x => matchIds.Contains(x.MatchId))
            .GroupBy(x => new { x.MatchId, x.TeamId })
            .Select(g => new MatchSideAggregate
            {
                MatchId = g.Key.MatchId,
                TeamId = g.Key.TeamId,
                TotalAmount = g.Sum(x => x.Amount),
                BetCount = g.Count(),
                RecentBetCount = g.Count(x => x.BetTime >= recentBetCutoff)
            })
            .ToListAsync(ct);

        var recentEvents = await _db.Set<MatchScoreEvent>()
            .AsNoTracking()
            .Include(x => x.Team).ThenInclude(x => x.Currency)
            .Where(x => matchIds.Contains(x.MatchId) && x.EventTimeUtc >= reversalCutoff)
            .OrderByDescending(x => x.EventTimeUtc)
            .ThenByDescending(x => x.EventSequence)
            .ToListAsync(ct);

        var best = matches
            .Select(match => BuildCandidate(match, aggregates, recentEvents, nowUtc))
            .Where(candidate => candidate is not null)
            .OrderByDescending(candidate => candidate!.HotScore)
            .ThenByDescending(candidate => candidate!.RemainingMinutes)
            .FirstOrDefault();

        if (best is null || best.HotScore < 25)
            return BuildEmpty("No hot match available right now");

        return best.Dto;
    }

    private HotMatchCandidate? BuildCandidate(
        Match match,
        List<MatchSideAggregate> aggregates,
        List<MatchScoreEvent> recentEvents,
        DateTime nowUtc)
    {
        if (match.TeamA?.Currency is null || match.TeamB?.Currency is null || match.StartTime is null)
            return null;

        var elapsed = nowUtc - match.StartTime.Value;
        var elapsedMinutes = Math.Max(0, (int)elapsed.TotalMinutes);
        var remainingMinutes = Math.Max(0, MatchDurationMinutes - elapsedMinutes);
        var remainingTime = TimeSpan.FromMinutes(MatchDurationMinutes) - elapsed;
        if (remainingMinutes <= 0)
            return null;

        var left = aggregates.FirstOrDefault(x => x.MatchId == match.MatchId && x.TeamId == match.TeamAId);
        var right = aggregates.FirstOrDefault(x => x.MatchId == match.MatchId && x.TeamId == match.TeamBId);
        var totalPool = (left?.TotalAmount ?? 0m) + (right?.TotalAmount ?? 0m);
        var totalBetCount = (left?.BetCount ?? 0) + (right?.BetCount ?? 0);
        var totalRecentBetCount = (left?.RecentBetCount ?? 0) + (right?.RecentBetCount ?? 0);

        if (totalPool <= 0m && totalBetCount <= 0 && Math.Abs(match.TeamA.Currency.PercentageChange - match.TeamB.Currency.PercentageChange) < 0.35d)
            return null;

        var scoreDiff = Math.Abs(match.ScoreA - match.ScoreB);
        var scoreCloseness = scoreDiff switch
        {
            0 => 24,
            1 => 18,
            2 => 10,
            3 => 4,
            _ => 0
        };

        var volumeScore = (int)Math.Clamp(Math.Round(Math.Log10((double)(totalPool + 1m)) * 16d, MidpointRounding.AwayFromZero), 0d, 22d);
        var betActivityScore = Math.Min(18, totalRecentBetCount * 2);
        var poolBalanceGap = totalPool > 0m
            ? Math.Abs((left?.TotalAmount ?? 0m) - (right?.TotalAmount ?? 0m)) / totalPool
            : 1m;
        var balancedPoolScore = totalPool > 0m ? (int)Math.Clamp(Math.Round((1m - poolBalanceGap) * 10m, MidpointRounding.AwayFromZero), 0m, 10m) : 0;

        var pctGap = Math.Abs(match.TeamA.Currency.PercentageChange - match.TeamB.Currency.PercentageChange);
        var momentumGapScore = pctGap >= 3d
            ? 12
            : pctGap >= 1.5d
                ? 8
                : pctGap >= 0.75d
                    ? 5
                    : 1;

        var popularityScore = (PopularSymbols.Contains(match.TeamA.Currency.Symbol) ? 6 : 0)
            + (PopularSymbols.Contains(match.TeamB.Currency.Symbol) ? 6 : 0);

        var remainingTimeScore = remainingMinutes switch
        {
            <= 3 => -16,
            <= 8 => -6,
            <= 15 => 4,
            <= 55 => 10,
            _ => 6
        };

        var matchEvents = recentEvents
            .Where(x => x.MatchId == match.MatchId)
            .OrderByDescending(x => x.EventTimeUtc)
            .ThenByDescending(x => x.EventSequence)
            .ToList();

        var hasRecentReversal = HasRecentReversal(matchEvents);
        var reversalScore = hasRecentReversal ? 14 : 0;

        var hotScore = 18
            + scoreCloseness
            + volumeScore
            + betActivityScore
            + balancedPoolScore
            + momentumGapScore
            + popularityScore
            + remainingTimeScore
            + reversalScore;

        var leaderSymbol = ResolveMomentumLeader(match);
        var reason = BuildReason(scoreDiff, totalPool, totalRecentBetCount, hasRecentReversal, remainingMinutes, leaderSymbol);
        var momentumLabel = hasRecentReversal
            ? $"{leaderSymbol} reversal pressure rising"
            : $"{leaderSymbol} pressure rising";
        var pressureSymbol = hasRecentReversal
            ? leaderSymbol
            : ResolvePressureSymbol(match, left?.TotalAmount ?? 0m, right?.TotalAmount ?? 0m);

        var slug = $"{Slugify(match.TeamA.Currency.Symbol)}-vs-{Slugify(match.TeamB.Currency.Symbol)}";
        var publicBaseUrl = ResolvePublicBaseUrl();
        var dto = new TvHotMatchDto
        {
            HasMatch = true,
            MatchId = match.MatchId,
            Slug = slug,
            LeftSymbol = match.TeamA.Currency.Symbol,
            RightSymbol = match.TeamB.Currency.Symbol,
            LeftName = match.TeamA.Currency.Name,
            RightName = match.TeamB.Currency.Name,
            LeftScore = match.ScoreA,
            RightScore = match.ScoreB,
            LeftLogoUrl = BuildLogoUrl(match.TeamA.Currency.Symbol),
            RightLogoUrl = BuildLogoUrl(match.TeamB.Currency.Symbol),
            HotScore = Math.Max(0, hotScore),
            Reason = reason,
            WatchUrl = $"{publicBaseUrl}/tv/match/{match.MatchId}/{slug}",
            VolumeLabel = $"{totalPool:0.##} SOL",
            MomentumLabel = momentumLabel,
            RemainingTimeLabel = FormatRemainingTime(remainingTime),
            RemainingSeconds = Math.Max(0, (int)Math.Floor(remainingTime.TotalSeconds)),
            MatchStartTimeUtc = match.StartTime,
            LeftChangePercent = Convert.ToDecimal(match.TeamA.Currency.PercentageChange),
            RightChangePercent = Convert.ToDecimal(match.TeamB.Currency.PercentageChange),
            LeaderSymbol = leaderSymbol,
            PressureSymbol = pressureSymbol,
            PoolStatusLabel = BuildPoolStatusLabel(totalPool, totalRecentBetCount, scoreDiff),
            HasRecentReversal = hasRecentReversal
        };

        return new HotMatchCandidate(dto, hotScore, remainingMinutes);
    }

    private static bool HasRecentReversal(List<MatchScoreEvent> matchEvents)
    {
        if (matchEvents.Count < 2)
            return false;

        var latest = matchEvents[0];
        var previous = matchEvents.Skip(1).FirstOrDefault(x => x.TeamId != latest.TeamId);
        if (previous is null)
            return false;

        return latest.TeamId != previous.TeamId
            && Math.Abs((latest.EventTimeUtc - previous.EventTimeUtc).TotalMinutes) <= 20;
    }

    private static string ResolveMomentumLeader(Match match)
    {
        var pctA = match.TeamA.Currency?.PercentageChange ?? 0d;
        var pctB = match.TeamB.Currency?.PercentageChange ?? 0d;

        if (pctA == pctB)
            return match.ScoreA >= match.ScoreB
                ? match.TeamA.Currency?.Symbol ?? "Arena"
                : match.TeamB.Currency?.Symbol ?? "Arena";

        return pctA > pctB
            ? match.TeamA.Currency?.Symbol ?? "Arena"
            : match.TeamB.Currency?.Symbol ?? "Arena";
    }

    private static string BuildReason(
        int scoreDiff,
        decimal totalPool,
        int recentBets,
        bool hasRecentReversal,
        int remainingMinutes,
        string leaderSymbol)
    {
        if (hasRecentReversal)
            return $"Close match with strong volume and recent momentum reversal around {leaderSymbol}";

        if (scoreDiff <= 1 && recentBets >= 4)
            return "Close match with active staking flow and rising live arena pressure";

        if (totalPool >= 10m)
            return "High-volume competitive pool with strong live reward dynamics";

        if (remainingMinutes <= 10)
            return "Late-cycle crypto battle with tight score pressure";

        return "Balanced crypto battle with competitive staking pool momentum";
    }

    private static string ResolvePressureSymbol(Match match, decimal leftPool, decimal rightPool)
    {
        if (leftPool == rightPool)
            return ResolveMomentumLeader(match);

        return leftPool > rightPool
            ? match.TeamA.Currency?.Symbol ?? "Arena"
            : match.TeamB.Currency?.Symbol ?? "Arena";
    }

    private static string BuildPoolStatusLabel(decimal totalPool, int recentBets, int scoreDiff)
    {
        if (recentBets >= 6)
            return "activeFlow";

        if (scoreDiff <= 1 && totalPool > 0m)
            return "balanced";

        if (totalPool > 0m)
            return "open";

        return "idle";
    }

    private string ResolvePublicBaseUrl()
    {
        var configured = _configuration["SocialAutomation:PublicBaseUrl"]?.Trim()
            ?? _configuration["CriptoVersus:PublicBaseUrl"]?.Trim()
            ?? "https://criptoversus.com";

        return configured.TrimEnd('/');
    }

    private static string FormatRemainingTime(TimeSpan remainingTime)
    {
        var safe = remainingTime < TimeSpan.Zero ? TimeSpan.Zero : remainingTime;
        var wholeMinutes = (int)safe.TotalMinutes;
        return $"{wholeMinutes:00}:{safe.Seconds:00}";
    }

    private static TvHotMatchDto BuildEmpty(string reason)
        => new()
        {
            HasMatch = false,
            Reason = reason
        };

    private static string Slugify(string value)
    {
        if (string.IsNullOrWhiteSpace(value))
            return "asset";

        var buffer = new List<char>(value.Length);
        foreach (var ch in value.Trim().ToLowerInvariant())
        {
            if (char.IsLetterOrDigit(ch))
                buffer.Add(ch);
            else if (buffer.Count > 0 && buffer[^1] != '-')
                buffer.Add('-');
        }

        return new string(buffer.ToArray()).Trim('-');
    }

    private string BuildLogoUrl(string? symbol)
        => $"{ResolveApiBaseUrl()}/api/icons/binance/{Uri.EscapeDataString(GetBaseSymbol(symbol))}";

    private string ResolveApiBaseUrl()
    {
        var configured = _configuration["Api:PublicBaseUrl"]?.Trim()
            ?? _configuration["Api:BaseUrl"]?.Trim()
            ?? "https://api.criptoversus.com";

        return configured.TrimEnd('/');
    }

    private static string GetBaseSymbol(string? symbol)
    {
        if (string.IsNullOrWhiteSpace(symbol))
            return string.Empty;

        var normalized = symbol.Trim().ToUpperInvariant();
        string[] quoteAssets = ["USDT", "USDC", "BUSD", "FDUSD", "BRL", "EUR", "BTC", "ETH"];

        foreach (var quote in quoteAssets)
        {
            if (normalized.Length > quote.Length && normalized.EndsWith(quote, StringComparison.OrdinalIgnoreCase))
                return normalized[..^quote.Length];
        }

        return normalized;
    }

    private sealed record HotMatchCandidate(TvHotMatchDto Dto, int HotScore, int RemainingMinutes);

    private sealed class MatchSideAggregate
    {
        public int MatchId { get; init; }
        public int TeamId { get; init; }
        public decimal TotalAmount { get; init; }
        public int BetCount { get; init; }
        public int RecentBetCount { get; init; }
    }
}
