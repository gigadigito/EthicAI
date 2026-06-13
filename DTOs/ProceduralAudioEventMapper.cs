namespace DTOs;

public sealed class ProceduralAudioDescriptor
{
    public string RawEventType { get; init; } = string.Empty;
    public string EventType { get; init; } = string.Empty;
    public string? NormalizedTeamSymbol { get; init; }
    public string? ContextKey { get; init; }
    public string? Intensity { get; init; }
    public int PlaybackPriority { get; init; }
}

public static class ProceduralAudioNormalization
{
    private static readonly string[] QuoteSuffixes =
    [
        "USDT",
        "USDC",
        "FDUSD",
        "BUSD",
        "TUSD",
        "USDE",
        "USD",
        "BRL",
        "EUR"
    ];

    public static string NormalizeLanguage(string? language)
    {
        var normalized = (language ?? string.Empty).Trim().ToLowerInvariant();
        return normalized switch
        {
            "pt" or "pt-br" => "pt-BR",
            "en" or "en-us" => "en-US",
            _ when string.IsNullOrWhiteSpace(normalized) => "en-US",
            _ => language!.Trim()
        };
    }

    public static string NormalizeEventTypeToken(string? eventType)
        => string.IsNullOrWhiteSpace(eventType)
            ? string.Empty
            : eventType.Trim().ToLowerInvariant();

    public static string? NormalizeToken(string? value, bool upper = false)
    {
        var normalized = string.IsNullOrWhiteSpace(value) ? null : value.Trim();
        return normalized is null
            ? null
            : upper ? normalized.ToUpperInvariant() : normalized.ToLowerInvariant();
    }

    public static string? NormalizeTeamSymbol(string? teamSymbol)
    {
        var normalized = NormalizeToken(teamSymbol, upper: true);
        if (string.IsNullOrWhiteSpace(normalized))
            return null;

        foreach (var suffix in QuoteSuffixes)
        {
            if (normalized.Length <= suffix.Length + 1)
                continue;

            if (normalized.EndsWith(suffix, StringComparison.Ordinal))
                return normalized[..^suffix.Length];
        }

        return normalized;
    }
}

public static class ProceduralAudioEventMapper
{
    public static ProceduralAudioDescriptor MapScoreEvent(
        string? scoreEventType,
        string? reasonCode,
        decimal? metricDelta,
        string? teamSymbol = null)
    {
        var normalizedType = (scoreEventType ?? string.Empty).Trim().ToUpperInvariant();
        var normalizedReason = (reasonCode ?? string.Empty).Trim().ToUpperInvariant();
        var intensity = ResolveIntensity(metricDelta);
        var normalizedSymbol = ProceduralAudioNormalization.NormalizeTeamSymbol(teamSymbol);

        return normalizedType switch
        {
            "ARENA_PRESSURE_GOAL" => Create(scoreEventType, "goal", normalizedSymbol, "arena_pressure", "hype", 100),
            "CANDLE_BATTLE_LEAD_CHANGE" => Create(scoreEventType, "goal", normalizedSymbol, "candle_battle", UpgradeIntensity(intensity, "hype"), 99),
            "PERCENT_THRESHOLD_REACHED" => Create(scoreEventType, "market_pump", normalizedSymbol, "threshold_break", UpgradeIntensity(intensity, "hype"), 78),
            "PERCENTAGE_CROSSOVER_UP" => Create(
                scoreEventType,
                SelectCrossoverUpNarrative(metricDelta),
                normalizedSymbol,
                "percentage_crossover_up",
                UpgradeIntensity(intensity, SelectCrossoverUpNarrative(metricDelta) == "volatility_spike" ? "epic" : "hype"),
                SelectCrossoverUpNarrative(metricDelta) == "volatility_spike" ? 80 : 72),
            "PERCENTAGE_CROSSOVER_DOWN" => Create(
                scoreEventType,
                SelectCrossoverDownNarrative(metricDelta),
                normalizedSymbol,
                "percentage_crossover_down",
                UpgradeIntensity(intensity, SelectCrossoverDownNarrative(metricDelta) == "market_crash" ? "dramatic" : "hype"),
                SelectCrossoverDownNarrative(metricDelta) == "market_crash" ? 88 : 72),
            "VOLUME_WINDOW_WINNER" => Create(scoreEventType, "dominant_lead", normalizedSymbol, "volume_window", UpgradeIntensity(intensity, "hype"), 82),
            "VOLUME_CROSSOVER_UP" => Create(scoreEventType, "market_pump", normalizedSymbol, "volume_crossover", UpgradeIntensity(intensity, "hype"), 76),
            "FAST_PUMP" => Create(scoreEventType, "volatility_spike", normalizedSymbol, "fast_pump", UpgradeIntensity(intensity, "epic"), 80),
            "UNDERDOG_RECOVERY" => Create(scoreEventType, "comeback", normalizedSymbol, "underdog_recovery", UpgradeIntensity(intensity, "epic"), 92),
            "LATE_REVERSAL" => Create(scoreEventType, "comeback", normalizedSymbol, "late_reversal", UpgradeIntensity(intensity, "legendary"), 96),
            "DOMINANT_RUN" => Create(scoreEventType, "dominant_lead", normalizedSymbol, "dominant_run", UpgradeIntensity(intensity, "hype"), 90),
            "NEAR_BREAKOUT" => Create(scoreEventType, "near_goal", normalizedSymbol, "near_breakout", UpgradeIntensity(intensity, "normal"), 58),
            "EQUALIZER" => Create(scoreEventType, "equalizer", normalizedSymbol, "equalizer", UpgradeIntensity(intensity, "epic"), 94),
            "UNDERDOG_GOAL" => Create(scoreEventType, "underdog_goal", normalizedSymbol, "underdog_goal", UpgradeIntensity(intensity, "epic"), 95),
            _ when normalizedType.Contains("GOAL", StringComparison.Ordinal)
                => Create(scoreEventType, normalizedType.Contains("UNDERDOG", StringComparison.Ordinal) ? "underdog_goal" : "goal", normalizedSymbol, NormalizeContext(scoreEventType), "hype", normalizedType.Contains("UNDERDOG", StringComparison.Ordinal) ? 95 : 100),
            _ when normalizedType.Contains("EQUAL", StringComparison.Ordinal) || normalizedReason.Contains("EQUAL", StringComparison.Ordinal)
                => Create(scoreEventType, "equalizer", normalizedSymbol, NormalizeContext(scoreEventType), UpgradeIntensity(intensity, "epic"), 94),
            _ when normalizedType.Contains("COMEBACK", StringComparison.Ordinal) || normalizedReason.Contains("COMEBACK", StringComparison.Ordinal)
                || normalizedType.Contains("RECOVERY", StringComparison.Ordinal) || normalizedReason.Contains("RECOVERY", StringComparison.Ordinal)
                || normalizedType.Contains("REVERS", StringComparison.Ordinal) || normalizedReason.Contains("REVERS", StringComparison.Ordinal)
                => Create(scoreEventType, "comeback", normalizedSymbol, NormalizeContext(scoreEventType), UpgradeIntensity(intensity, "epic"), 92),
            _ when normalizedType.Contains("DOMINANT", StringComparison.Ordinal) || normalizedReason.Contains("DOMINANT", StringComparison.Ordinal)
                => Create(scoreEventType, "dominant_lead", normalizedSymbol, NormalizeContext(scoreEventType), UpgradeIntensity(intensity, "hype"), 90),
            _ when normalizedType.Contains("NEAR", StringComparison.Ordinal) || normalizedReason.Contains("NEAR", StringComparison.Ordinal)
                => Create(scoreEventType, "near_goal", normalizedSymbol, NormalizeContext(scoreEventType), UpgradeIntensity(intensity, "normal"), 58),
            _ when normalizedType.Contains("SPIKE", StringComparison.Ordinal) || normalizedReason.Contains("SPIKE", StringComparison.Ordinal)
                || normalizedType.Contains("FAST_PUMP", StringComparison.Ordinal) || normalizedReason.Contains("FAST_PUMP", StringComparison.Ordinal)
                => Create(scoreEventType, "volatility_spike", normalizedSymbol, NormalizeContext(scoreEventType), UpgradeIntensity(intensity, "epic"), 80),
            _ when normalizedType.Contains("CRASH", StringComparison.Ordinal) || normalizedReason.Contains("CRASH", StringComparison.Ordinal)
                => Create(scoreEventType, "market_crash", normalizedSymbol, NormalizeContext(scoreEventType), UpgradeIntensity(intensity, "dramatic"), 88),
            _ when normalizedType.Contains("CROSSOVER_UP", StringComparison.Ordinal) || normalizedReason.Contains("CROSSOVER_UP", StringComparison.Ordinal)
                => Create(scoreEventType, SelectCrossoverUpNarrative(metricDelta), normalizedSymbol, NormalizeContext(scoreEventType), UpgradeIntensity(intensity, SelectCrossoverUpNarrative(metricDelta) == "volatility_spike" ? "epic" : "hype"), SelectCrossoverUpNarrative(metricDelta) == "volatility_spike" ? 80 : 72),
            _ when normalizedType.Contains("CROSSOVER_DOWN", StringComparison.Ordinal) || normalizedReason.Contains("CROSSOVER_DOWN", StringComparison.Ordinal)
                => Create(scoreEventType, SelectCrossoverDownNarrative(metricDelta), normalizedSymbol, NormalizeContext(scoreEventType), UpgradeIntensity(intensity, SelectCrossoverDownNarrative(metricDelta) == "market_crash" ? "dramatic" : "hype"), SelectCrossoverDownNarrative(metricDelta) == "market_crash" ? 88 : 72),
            _ when normalizedType.Contains("PUMP", StringComparison.Ordinal) || normalizedReason.Contains("PUMP", StringComparison.Ordinal)
                => Create(scoreEventType, "market_pump", normalizedSymbol, NormalizeContext(scoreEventType), UpgradeIntensity(intensity, "hype"), 76),
            _ => Create(scoreEventType, "momentum_shift", normalizedSymbol, NormalizeContext(scoreEventType), intensity, 60)
        };
    }

    public static string ResolveIntensity(decimal? metricDelta)
    {
        if (!metricDelta.HasValue)
            return "normal";

        var absolute = Math.Abs(metricDelta.Value);
        if (absolute >= 16m)
            return "legendary";

        if (absolute >= 8m)
            return "epic";

        if (absolute >= 3m)
            return "hype";

        return "normal";
    }

    private static string UpgradeIntensity(string current, string minimum)
    {
        var currentRank = IntensityRank(current);
        var minimumRank = IntensityRank(minimum);
        return currentRank >= minimumRank ? current : minimum;
    }

    private static int IntensityRank(string? intensity)
        => (intensity ?? string.Empty).Trim().ToLowerInvariant() switch
        {
            "calm" => 0,
            "normal" => 1,
            "hype" => 2,
            "dramatic" => 3,
            "epic" => 4,
            "legendary" => 5,
            _ => 1
        };

    private static ProceduralAudioDescriptor Create(
        string? rawEventType,
        string eventType,
        string? normalizedTeamSymbol,
        string? contextKey,
        string? intensity,
        int playbackPriority)
        => new()
        {
            RawEventType = rawEventType?.Trim() ?? string.Empty,
            EventType = eventType,
            NormalizedTeamSymbol = normalizedTeamSymbol,
            ContextKey = contextKey,
            Intensity = intensity,
            PlaybackPriority = playbackPriority
        };

    private static string NormalizeContext(string? raw)
        => string.IsNullOrWhiteSpace(raw)
            ? "generic"
            : raw.Trim().ToLowerInvariant().Replace(' ', '_');

    private static string SelectCrossoverUpNarrative(decimal? metricDelta)
        => Math.Abs(metricDelta ?? 0m) >= 8m ? "volatility_spike" : "momentum_shift";

    private static string SelectCrossoverDownNarrative(decimal? metricDelta)
        => Math.Abs(metricDelta ?? 0m) >= 8m ? "market_crash" : "momentum_shift";
}
