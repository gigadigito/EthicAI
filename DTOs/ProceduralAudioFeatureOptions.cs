namespace DTOs;

public sealed class ProceduralAudioFeatureOptions
{
    public const string SectionName = "ProceduralAudio";

    public bool Enabled { get; set; }
    public bool AllowQueueGeneration { get; set; } = true;
    public bool ResolveOnScoreEvents { get; set; } = true;
    public bool FallbackToLegacyAudio { get; set; } = true;
}
