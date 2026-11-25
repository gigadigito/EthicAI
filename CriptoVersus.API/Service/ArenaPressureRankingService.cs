using System.Globalization;
using System.Net.Http.Json;
using System.Text.Json.Serialization;
using DAL.NftFutebol;
using DTOs;
using EthicAI.EntityModel;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Options;

namespace CriptoVersus.API.Services;

public interface IArenaPressureRankingService
{
    Task<ArenaPressureRankingResponseDto> GetTodayAsync(int page, int pageSize, CancellationToken ct);
}

public interface ITopGainersProvider
{
    Task<TopGainersSnapshot> GetAsync(CancellationToken ct);
}

public sealed record TopGainersSnapshot(bool Available, string Status, DateTime? CapturedAtUtc, IReadOnlyDictionary<string, TopGainerEntry> Entries);

public sealed class BinanceTopGainersProvider(
    HttpClient httpClient, IMemoryCache cache, IOptions<ArenaPressureRankingOptions> configured,
    TimeProvider clock, ILogger<BinanceTopGainersProvider> logger) : ITopGainersProvider
{
    private const string CacheKey = "arena-pressure:top-gainers:v1";
    private readonly ArenaPressureRankingOptions _options = configured.Value;

    public async Task<TopGainersSnapshot> GetAsync(CancellationToken ct)
    {
        if (cache.TryGetValue(CacheKey, out TopGainersSnapshot? cached) && cached is not null)
            return cached;
        try
        {
            var rows = await httpClient.GetFromJsonAsync<List<Ticker>>("api/v3/ticker/24hr", ct) ?? [];
            var excluded = _options.ExcludedBaseAssets.ToHashSet(StringComparer.OrdinalIgnoreCase);
            var ranked = rows
                .Where(x => x.Symbol.EndsWith("USDT", StringComparison.OrdinalIgnoreCase))
                .Select(x => new { Row = x, Base = x.Symbol[..^4] })
                .Where(x => !excluded.Contains(x.Base) && Decimal(x.Row.QuoteVolume) >= _options.MinimumQuoteVolume)
                .Select(x => new { x.Row.Symbol, Change = Decimal(x.Row.PriceChangePercent) })
                .OrderByDescending(x => x.Change).ThenBy(x => x.Symbol, StringComparer.Ordinal)
                .Take(Math.Clamp(_options.TopGainersLimit, 1, 50))
                .Select((x, i) => new TopGainerEntry(x.Symbol.ToUpperInvariant(), i + 1, x.Change))
                .ToDictionary(x => x.Symbol, StringComparer.OrdinalIgnoreCase);
            var snapshot = new TopGainersSnapshot(true, "available", clock.GetUtcNow().UtcDateTime, ranked);
            cache.Set(CacheKey, snapshot, TimeSpan.FromMinutes(Math.Max(1, _options.MarketCacheMinutes)));
            return snapshot;
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or NotSupportedException)
        {
            logger.LogWarning(ex, "Binance Top Gainers snapshot is unavailable.");
            return new(false, "unavailable", null, new Dictionary<string, TopGainerEntry>());
        }
    }

    private static decimal Decimal(string? value) => decimal.TryParse(value, NumberStyles.Float, CultureInfo.InvariantCulture, out var parsed) ? parsed : 0m;
    private sealed class Ticker
    {
        [JsonPropertyName("symbol")] public string Symbol { get; set; } = string.Empty;
        [JsonPropertyName("priceChangePercent")] public string PriceChangePercent { get; set; } = string.Empty;
        [JsonPropertyName("quoteVolume")] public string QuoteVolume { get; set; } = string.Empty;
    }
}

public sealed class ArenaPressureRankingService(
    IDbContextFactory<EthicAIDbContext> dbFactory,
    ITopGainersProvider topGainers,
    ArenaPressureQualityScorer scorer,
    IOptions<ArenaPressureRankingOptions> configured,
    TimeProvider clock) : IArenaPressureRankingService
{
    private readonly ArenaPressureRankingOptions _options = configured.Value;

    public async Task<ArenaPressureRankingResponseDto> GetTodayAsync(int page, int pageSize, CancellationToken ct)
    {
        page = Math.Max(1, page);
        pageSize = Math.Clamp(pageSize, 1, Math.Max(1, _options.MaximumPageSize));
        var (startUtc, endUtc) = BrasiliaDay(clock.GetUtcNow());
        await using var db = await dbFactory.CreateDbContextAsync(ct);
        var candidates = await db.Match.AsNoTracking()
            .Where(x => x.Status == MatchStatus.Completed && x.EndTime.HasValue && x.EndTime >= startUtc && x.EndTime < endUtc)
            .OrderByDescending(x => x.EndTime).ThenByDescending(x => x.MatchId)
            .Take(Math.Max(1, _options.MaximumCandidates))
            .Select(x => new Candidate(
                x.MatchId, x.StartTime, x.EndTime!.Value, x.ScoreA, x.ScoreB,
                x.TeamAId, x.TeamBId, x.TeamA.Currency.Symbol, x.TeamB.Currency.Symbol))
            .ToListAsync(ct);
        var ids = candidates.Select(x => x.MatchId).ToArray();
        var snapshots = await db.MatchMetricSnapshot.AsNoTracking().Where(x => ids.Contains(x.MatchId))
            .OrderBy(x => x.CapturedAtUtc).ToListAsync(ct);
        var events = await db.MatchScoreEvent.AsNoTracking().Where(x => ids.Contains(x.MatchId))
            .OrderBy(x => x.EventTimeUtc).ThenBy(x => x.EventSequence).ToListAsync(ct);
        var market = await topGainers.GetAsync(ct);

        var ranked = candidates.Select(candidate =>
        {
            var history = BuildHistory(candidate,
                snapshots.Where(x => x.MatchId == candidate.MatchId).ToArray(),
                events.Where(x => x.MatchId == candidate.MatchId).ToArray());
            return scorer.Score(candidate.MatchId, Utc(candidate.EndTime), candidate.LeftSymbol, candidate.RightSymbol, history, market.Entries, market.Available);
        })
        .Where(x => x.VideoEligible)
        .OrderByDescending(x => x.QualityScore).ThenByDescending(x => x.EndTimeUtc).ThenByDescending(x => x.MatchId)
        .ToList();

        return new()
        {
            DayStartUtc = startUtc,
            DayEndUtc = endUtc,
            GeneratedAtUtc = clock.GetUtcNow().UtcDateTime,
            MarketDataAvailable = market.Available,
            MarketDataStatus = market.Status,
            MarketSnapshotUtc = market.CapturedAtUtc,
            DuplicateControlAvailable = false,
            TotalCandidates = ranked.Count,
            Page = page,
            PageSize = pageSize,
            Items = ranked.Skip((page - 1) * pageSize).Take(pageSize).ToList()
        };
    }

    public static (DateTime StartUtc, DateTime EndUtc) BrasiliaDay(DateTimeOffset now)
    {
        var zone = ResolveSaoPauloZone();
        var local = TimeZoneInfo.ConvertTime(now, zone);
        var startLocal = DateTime.SpecifyKind(local.Date, DateTimeKind.Unspecified);
        return (TimeZoneInfo.ConvertTimeToUtc(startLocal, zone), TimeZoneInfo.ConvertTimeToUtc(startLocal.AddDays(1), zone));
    }

    private static TimeZoneInfo ResolveSaoPauloZone()
    {
        try { return TimeZoneInfo.FindSystemTimeZoneById("America/Sao_Paulo"); }
        catch (TimeZoneNotFoundException) { return TimeZoneInfo.FindSystemTimeZoneById("E. South America Standard Time"); }
    }

    private static IReadOnlyList<PressureSample> BuildHistory(Candidate match, IReadOnlyList<MatchMetricSnapshot> snapshots, IReadOnlyList<MatchScoreEvent> events)
    {
        var times = snapshots.Select(x => Utc(x.CapturedAtUtc)).Concat(events.Select(x => Utc(x.EventTimeUtc))).Distinct().Order().ToArray();
        if (times.Length == 0) return [];
        var totalEventA = events.Where(x => x.TeamId == match.TeamAId).Sum(x => Math.Max(0, x.Points));
        var totalEventB = events.Where(x => x.TeamId == match.TeamBId).Sum(x => Math.Max(0, x.Points));
        var baseA = Math.Max(0, match.ScoreA - totalEventA);
        var baseB = Math.Max(0, match.ScoreB - totalEventB);
        decimal? lastA = null, lastB = null;
        var result = new List<PressureSample>(times.Length);
        foreach (var at in times)
        {
            var snapA = snapshots.LastOrDefault(x => x.TeamId == match.TeamAId && Utc(x.CapturedAtUtc) <= at);
            var snapB = snapshots.LastOrDefault(x => x.TeamId == match.TeamBId && Utc(x.CapturedAtUtc) <= at);
            if (snapA is not null) lastA = snapA.PercentageChange;
            if (snapB is not null) lastB = snapB.PercentageChange;
            var scoreA = baseA + events.Where(x => x.TeamId == match.TeamAId && Utc(x.EventTimeUtc) <= at).Sum(x => Math.Max(0, x.Points));
            var scoreB = baseB + events.Where(x => x.TeamId == match.TeamBId && Utc(x.EventTimeUtc) <= at).Sum(x => Math.Max(0, x.Points));
            var pressure = Possession(scoreA, scoreB, lastA, lastB);
            result.Add(new(at, pressure));
        }
        return result;
    }

    // Mirrors TvFieldPositionService's persisted-history path (no live hot-match enrichment).
    private static decimal Possession(int scoreA, int scoreB, decimal? variationA, decimal? variationB)
    {
        var leaderA = scoreA != scoreB ? scoreA > scoreB : (variationA ?? 0m) >= (variationB ?? 0m);
        var competitiveness = Math.Clamp(92 - Math.Abs(scoreA - scoreB) * 14 - (int)(Math.Abs((variationA ?? 0m) - (variationB ?? 0m)) * 8m), 38, 96);
        var raw = 50d + ((scoreA - scoreB) * 4.4d) + ((double)((variationA ?? 0m) - (variationB ?? 0m)) * 3.2d)
            + (leaderA ? 4d : -4d) + (((competitiveness - 50d) / 50d) * 2d) + (((competitiveness - 50d) / 50d) * -1.5d);
        return (decimal)Math.Round(Math.Clamp(raw, 35d, 65d), MidpointRounding.AwayFromZero);
    }

    private static DateTime Utc(DateTime value) => value.Kind switch { DateTimeKind.Utc => value, DateTimeKind.Local => value.ToUniversalTime(), _ => DateTime.SpecifyKind(value, DateTimeKind.Utc) };
    private sealed record Candidate(int MatchId, DateTime? StartTime, DateTime EndTime, int ScoreA, int ScoreB, int TeamAId, int TeamBId, string LeftSymbol, string RightSymbol);
}
