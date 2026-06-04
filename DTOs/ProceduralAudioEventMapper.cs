namespace DTOs;

public sealed class ProceduralAudioDescriptor
{
    public string EventType { get; init; } = string.Empty;
    public string? ContextKey { get; init; }
    public string? Intensity { get; init; }
}

public static class ProceduralAudioEventMapper
{
    public static ProceduralAudioDescriptor MapScoreEvent(
        string? scoreEventType,
        string? reasonCode,
        decimal? metricDelta)
    {
        var normalizedType = (scoreEventType ?? string.Empty).Trim().ToUpperInvariant();
        var normalizedReason = (reasonCode ?? string.Empty).Trim().ToUpperInvariant();
        var intensity = ResolveIntensity(metricDelta);

        return normalizedType switch
        {
            "ARENA_PRESSURE_GOAL" => Create("goal", "arena_pressure", "hype"),
            "PERCENT_THRESHOLD_REACHED" => Create("goal", "pump", intensity),
            "PERCENTAGE_CROSSOVER_UP" => Create("ranking_change", "percentage_crossover", intensity),
            "VOLUME_WINDOW_WINNER" => Create("goal", "volume_window", intensity),
            "VOLUME_CROSSOVER_UP" => Create("market_pump", "volume_crossover", intensity),
            _ when normalizedType.Contains("GOAL", StringComparison.Ordinal)
                => Create("goal", NormalizeContext(scoreEventType), "hype"),
            _ when normalizedType.Contains("CRASH", StringComparison.Ordinal) || normalizedReason.Contains("CRASH", StringComparison.Ordinal)
                => Create("market_crash", NormalizeContext(scoreEventType), "dramatic"),
            _ when normalizedType.Contains("PUMP", StringComparison.Ordinal) || normalizedReason.Contains("PUMP", StringComparison.Ordinal)
                => Create("market_pump", NormalizeContext(scoreEventType), "hype"),
            _ => Create("ranking_change", NormalizeContext(scoreEventType), intensity)
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

    private static ProceduralAudioDescriptor Create(string eventType, string? contextKey, string? intensity)
        => new()
        {
            EventType = eventType,
            ContextKey = contextKey,
            Intensity = intensity
        };

    private static string NormalizeContext(string? raw)
        => string.IsNullOrWhiteSpace(raw)
            ? "generic"
            : raw.Trim().ToLowerInvariant().Replace(' ', '_');
}
