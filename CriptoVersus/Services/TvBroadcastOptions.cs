namespace CriptoVersus.Web.Services;

public sealed class TvBroadcastOptions
{
    public const string SectionName = "CriptoVersusTV";

    public bool UseAiNarration { get; set; } = false;
    public bool EnableBroadcastCrowdAudio { get; set; } = true;
    public decimal CrowdAudioVolume { get; set; } = 0.10m;
    public int BroadcastRotationMinutes { get; set; } = 5;
}
