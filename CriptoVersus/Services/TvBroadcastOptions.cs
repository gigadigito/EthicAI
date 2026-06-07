namespace CriptoVersus.Web.Services;

public sealed class TvBroadcastOptions
{
    public const string SectionName = "CriptoVersusTV";

    public bool UseAiNarration { get; set; } = false;
    public bool EnableBroadcastCrowdAudio { get; set; } = true;
    public bool EnableTelemetryCube { get; set; } = false;
    public int TelemetryCubeIntervalSeconds { get; set; } = 12;
    public bool MovementEnabled { get; set; } = true;
    public bool TacticalMovementEnabled { get; set; } = true;
    public double FreedomRadiusMultiplier { get; set; } = 1.0d;
    public double CollisionRadiusMultiplier { get; set; } = 1.0d;
    public double CollisionStrength { get; set; } = 1.0d;
    public double SeparationStrength { get; set; } = 1.0d;
    public double WanderStrength { get; set; } = 0.9d;
    public double MomentumPushStrength { get; set; } = 1.0d;
    public double DefensiveCompactness { get; set; } = 1.0d;
    public double AnimationSpeed { get; set; } = 1.0d;
    public bool EnableFieldMovementDebug { get; set; } = false;
    public decimal CrowdAudioVolume { get; set; } = 0.10m;
    public int BroadcastRotationMinutes { get; set; } = 5;
    public TvBackgroundAudioOptions BackgroundAudio { get; set; } = new();

    public TvBackgroundAudioSettings BuildEffectiveBackgroundAudioSettings()
    {
        var configuredTracks = (BackgroundAudio.CrowdTracks ?? [])
            .Where(track => !string.IsNullOrWhiteSpace(track))
            .Select(track => track.Trim())
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();

        return new TvBackgroundAudioSettings(
            Enabled: BackgroundAudio.Enabled ?? true,
            CrowdEnabled: BackgroundAudio.CrowdEnabled ?? EnableBroadcastCrowdAudio,
            Volume: BackgroundAudio.Volume ?? CrowdAudioVolume,
            Shuffle: BackgroundAudio.Shuffle ?? false,
            RotateOnEnded: BackgroundAudio.RotateOnEnded ?? true,
            AvoidImmediateRepeat: BackgroundAudio.AvoidImmediateRepeat ?? true,
            FallbackLocale: string.IsNullOrWhiteSpace(BackgroundAudio.FallbackLocale) ? "en-US" : BackgroundAudio.FallbackLocale.Trim(),
            CrowdTracks: configuredTracks);
    }
}

public sealed class TvBackgroundAudioOptions
{
    public bool? Enabled { get; set; }
    public bool? CrowdEnabled { get; set; }
    public decimal? Volume { get; set; }
    public bool? Shuffle { get; set; }
    public bool? RotateOnEnded { get; set; }
    public bool? AvoidImmediateRepeat { get; set; }
    public string? FallbackLocale { get; set; }
    public string[] CrowdTracks { get; set; } = [];
}

public sealed record TvBackgroundAudioSettings(
    bool Enabled,
    bool CrowdEnabled,
    decimal Volume,
    bool Shuffle,
    bool RotateOnEnded,
    bool AvoidImmediateRepeat,
    string FallbackLocale,
    IReadOnlyList<string> CrowdTracks);
