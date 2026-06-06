namespace DAL.NftFutebol;

public sealed class AudioGenerationQueueItem
{
    public long Id { get; set; }
    public string EventType { get; set; } = string.Empty;
    public string Language { get; set; } = string.Empty;
    public string? RawSymbol { get; set; }
    public string? NormalizedSymbol { get; set; }
    public string? TeamSymbol { get; set; }
    public string? TeamName { get; set; }
    public string? ContextKey { get; set; }
    public string? Intensity { get; set; }
    public string VoiceKey { get; set; } = string.Empty;
    public string? TemplateKey { get; set; }
    public string TextPrompt { get; set; } = string.Empty;
    public string? NormalizedText { get; set; }
    public string? TextHash { get; set; }
    public string? TargetRelativePath { get; set; }
    public string? TargetFileName { get; set; }
    public string Status { get; set; } = AudioGenerationJobStatus.Pending;
    public int Priority { get; set; }
    public int AttemptCount { get; set; }
    public int MaxAttempts { get; set; } = 3;
    public string? LeaseOwner { get; set; }
    public DateTime? LeasedUntilUtc { get; set; }
    public string? ErrorMessage { get; set; }
    public DateTime CreatedAtUtc { get; set; }
    public DateTime UpdatedAtUtc { get; set; }
    public DateTime? ProcessedAtUtc { get; set; }
    public long? CompletedAudioAssetId { get; set; }

    public AudioAsset? CompletedAudioAsset { get; set; }
}
