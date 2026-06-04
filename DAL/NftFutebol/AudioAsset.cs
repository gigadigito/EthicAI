namespace DAL.NftFutebol;

public sealed class AudioAsset
{
    public long Id { get; set; }
    public string EventType { get; set; } = string.Empty;
    public string Language { get; set; } = string.Empty;
    public string? TeamSymbol { get; set; }
    public string? ContextKey { get; set; }
    public string? Intensity { get; set; }
    public string? VoiceKey { get; set; }
    public string? TemplateKey { get; set; }
    public string? TextPrompt { get; set; }
    public string AudioUrl { get; set; } = string.Empty;
    public string RelativePath { get; set; } = string.Empty;
    public string FileName { get; set; } = string.Empty;
    public string MimeType { get; set; } = "audio/mpeg";
    public int? DurationMs { get; set; }
    public long? FileSizeBytes { get; set; }
    public string? FileHash { get; set; }
    public string? GenerationModel { get; set; }
    public string? GenerationSource { get; set; }
    public decimal? QualityScore { get; set; }
    public int Priority { get; set; }
    public int UsageCount { get; set; }
    public string Status { get; set; } = AudioAssetStatus.Ready;
    public DateTime CreatedAtUtc { get; set; }
    public DateTime UpdatedAtUtc { get; set; }
    public DateTime? LastUsedAtUtc { get; set; }

    public ICollection<AudioGenerationQueueItem> CompletedJobs { get; set; } = [];
    public ICollection<MatchScoreEvent> MatchScoreEvents { get; set; } = [];
}
