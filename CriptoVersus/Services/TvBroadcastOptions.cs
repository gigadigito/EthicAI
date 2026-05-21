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
}
