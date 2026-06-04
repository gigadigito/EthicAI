namespace CriptoVersus.API.Services;

public sealed class AudioGenerationOptions
{
    public const string SectionName = "CriptoVersusAudio";

    public string WorkerKey { get; set; } = string.Empty;
    public int LeaseDurationSeconds { get; set; } = 300;
    public string AudioRootFolder { get; set; } = "audio";
    public string? PublicBaseUrl { get; set; }
    public string? PublicAudioRootPath { get; set; }
}
