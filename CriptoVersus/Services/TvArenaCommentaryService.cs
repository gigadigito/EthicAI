using System.Collections.Concurrent;
using System.Globalization;
using DTOs;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging;
using Microsoft.AspNetCore.Hosting;

namespace CriptoVersus.Web.Services;

public sealed class TvArenaCommentaryService
{
    private const int MaxHistoryItems = 24;
    private static readonly ConcurrentDictionary<string, object> Locks = new(StringComparer.Ordinal);

    private readonly LocalizationService _localization;
    private readonly AppCultureService _appCulture;
    private readonly IMemoryCache _cache;
    private readonly IWebHostEnvironment _environment;
    private readonly ILogger<TvArenaCommentaryService> _logger;

    public TvArenaCommentaryService(
        LocalizationService localization,
        AppCultureService appCulture,
        IMemoryCache cache,
        IWebHostEnvironment environment,
        ILogger<TvArenaCommentaryService> logger)
    {
        _localization = localization;
        _appCulture = appCulture;
        _cache = cache;
        _environment = environment;
        _logger = logger;
    }

    public TvArenaCommentaryResult Generate(TvArenaCommentaryContext context)
    {
        var culture = _appCulture.NormalizeRouteCulture(context.Culture);
        var cacheKey = BuildCacheKey(context.MatchId, culture);
        var gate = Locks.GetOrAdd(cacheKey, static _ => new object());

        lock (gate)
        {
            var state = _cache.GetOrCreate(cacheKey, _ => new CommentaryState()) ?? new CommentaryState();
            var category = PickCategory(context, state);
            var templates = _localization.GetSection<string[]>($"tv.commentary.templates.{category}", culture)
                ?? [];

            if (templates.Length == 0)
                templates = _localization.GetSection<string[]>("tv.commentary.templates.balanced", culture) ?? [];

            var templateIndex = PickTemplateIndex(context, state, category, templates.Length);
            var sourceKey = templates.Length > 0
                ? $"tv.commentary.templates.{category}"
                : "tv.commentary.fallback";

            var template = templates.Length > 0
                ? templates[templateIndex]
                : _localization.T("tv.commentary.fallback", culture, context.TeamA, context.TeamB);

            if (!string.IsNullOrWhiteSpace(state.LastCategory)
                && state.LastCategory.Equals(category, StringComparison.OrdinalIgnoreCase)
                && state.LastTemplateIndex == templateIndex
                && templates.Length > 1)
            {
                templateIndex = (templateIndex + 1) % templates.Length;
                template = templates[templateIndex];
            }

            var text = string.Format(
                CultureInfo.InvariantCulture,
                template,
                context.Leader,
                context.Trailer,
                context.TeamA,
                context.TeamB,
                context.ScoreA,
                context.ScoreB,
                FormatPercent(context.PercentA),
                FormatPercent(context.PercentB),
                context.HotScore,
                FormatVolume(context.PoolVolume),
                FormatRemaining(context.RemainingTime),
                context.Momentum,
                context.Competitiveness,
                context.ScoreGap,
                context.EventType);

            LogCommentaryEncodingIfNeeded(culture, sourceKey, text);

            var entry = new CommentaryEntry(category, templateIndex, text, context.EventType, DateTime.UtcNow);
            state.LastCategory = category;
            state.LastTemplateIndex = templateIndex;
            state.LastLeader = context.Leader;
            state.LastScoreA = context.ScoreA;
            state.LastScoreB = context.ScoreB;
            state.History.Add(entry);

            if (state.History.Count > MaxHistoryItems)
                state.History.RemoveRange(0, state.History.Count - MaxHistoryItems);

            _cache.Set(cacheKey, state, TimeSpan.FromHours(6));

            return new TvArenaCommentaryResult(
                text,
                "template",
                category,
                entry.GeneratedAtUtc,
                state.History.Select(x => x.Text).ToList());
        }
    }

    private string PickCategory(TvArenaCommentaryContext context, CommentaryState state)
    {
        if (context.IsFinished || context.RemainingTime <= TimeSpan.FromMinutes(2))
            return "cycleEnding";

        if (context.EventType.Equals("goal", StringComparison.OrdinalIgnoreCase))
            return "goalRecent";

        if (!string.IsNullOrWhiteSpace(state.LastLeader)
            && !string.Equals(state.LastLeader, context.Leader, StringComparison.OrdinalIgnoreCase)
            && !string.IsNullOrWhiteSpace(context.Leader))
            return "comeback";

        if (context.ScoreGap == 0 && context.RemainingTime <= TimeSpan.FromMinutes(10))
            return "finalThriller";

        if (context.RemainingTime <= TimeSpan.FromMinutes(10) && context.ScoreGap >= 2)
            return "finalControlled";

        if (context.RemainingTime >= TimeSpan.FromMinutes(40) && context.ScoreGap <= 1)
            return "opening";

        if (context.ScoreGap <= 1 && Math.Abs(context.PercentA - context.PercentB) <= 0.30m && context.Competitiveness >= 70)
            return "balanced";

        if (context.ScoreGap <= 1 && Math.Abs(context.PercentA - context.PercentB) <= 0.18m)
            return "balanced";

        if (context.PoolVolume <= 0m || context.PoolVolume < 50m)
            return "quietPool";

        if (context.PoolVolume >= 500m || context.HotScore >= 85 || context.Competitiveness >= 82)
            return "heatedPool";

        if (context.ScoreGap >= 3)
            return "dominance";

        if (context.PercentA < 0m && context.PercentB < 0m)
            return "bothDown";

        if (context.PercentA > 0m && context.PercentB > 0m)
            return "bothUp";

        if (!string.IsNullOrWhiteSpace(context.Leader)
            && ((context.PercentA < 0m && context.PercentB < 0m) || context.ScoreGap == 1))
            return "relativeLead";

        if (context.EventType.Equals("momentum-shift", StringComparison.OrdinalIgnoreCase)
            || context.EventType.Equals("pressure-rising", StringComparison.OrdinalIgnoreCase))
            return "pressureRising";

        if (context.EventType.Equals("leader-change", StringComparison.OrdinalIgnoreCase))
            return "comeback";

        return "balanced";
    }

    private static int PickTemplateIndex(TvArenaCommentaryContext context, CommentaryState state, string category, int length)
    {
        if (length <= 1)
            return 0;

        var hashCode = new HashCode();
        hashCode.Add(context.MatchId);
        hashCode.Add(context.ScoreA);
        hashCode.Add(context.ScoreB);
        hashCode.Add(context.HotScore);
        hashCode.Add(context.Competitiveness);
        hashCode.Add(category, StringComparer.Ordinal);
        hashCode.Add(context.EventType, StringComparer.Ordinal);
        hashCode.Add(context.Leader, StringComparer.Ordinal);
        hashCode.Add(state.History.Count);
        var hash = hashCode.ToHashCode();

        return Math.Abs(hash) % length;
    }

    private string BuildCacheKey(int matchId, string culture)
        => $"tv-commentary:{matchId}:{culture}";

    private void LogCommentaryEncodingIfNeeded(string culture, string sourceKey, string text)
    {
        if (!_environment.IsDevelopment() || !TextMojibakeRepair.LooksLikeMojibake(text))
            return;

        _logger.LogWarning(
            "[TV_COMMENTARY_ENCODING] origin=i18n.{Culture}.json key={Key} culture={Culture} text={Text}",
            culture,
            sourceKey,
            culture,
            text);
    }

    private static string FormatPercent(decimal value)
        => value >= 0m
            ? $"+{value:0.##}%"
            : $"{value:0.##}%";

    private static string FormatVolume(decimal value)
        => value <= 0m ? "0" : value.ToString("0.##", CultureInfo.InvariantCulture);

    private static string FormatRemaining(TimeSpan remaining)
    {
        var safe = remaining < TimeSpan.Zero ? TimeSpan.Zero : remaining;
        var totalMinutes = (int)Math.Floor(safe.TotalMinutes);
        return $"{totalMinutes:00}:{safe.Seconds:00}";
    }

    private sealed class CommentaryState
    {
        public string LastCategory { get; set; } = string.Empty;
        public int LastTemplateIndex { get; set; } = -1;
        public string LastLeader { get; set; } = string.Empty;
        public int LastScoreA { get; set; }
        public int LastScoreB { get; set; }
        public List<CommentaryEntry> History { get; } = [];
    }

    private sealed record CommentaryEntry(
        string Category,
        int TemplateIndex,
        string Text,
        string EventType,
        DateTime GeneratedAtUtc);
}

public sealed record TvArenaCommentaryContext(
    int MatchId,
    string Culture,
    string TeamA,
    string TeamB,
    int ScoreA,
    int ScoreB,
    decimal PercentA,
    decimal PercentB,
    string Momentum,
    string Leader,
    TimeSpan RemainingTime,
    int HotScore,
    decimal PoolVolume,
    int Competitiveness,
    string EventType,
    bool IsFinished)
{
    public int ScoreGap => Math.Abs(ScoreA - ScoreB);
    public string Trailer => string.Equals(Leader, TeamA, StringComparison.OrdinalIgnoreCase) ? TeamB : TeamA;
}

public sealed record TvArenaCommentaryResult(
    string Text,
    string Source,
    string Category,
    DateTime GeneratedAtUtc,
    IReadOnlyList<string> History);
