namespace DTOs;

public sealed class AudioResolveRequest
{
    public string EventType { get; set; } = string.Empty;
    public string Language { get; set; } = string.Empty;
    public string? TeamSymbol { get; set; }
    public string? TeamName { get; set; }
    public string? ContextKey { get; set; }
    public string? Intensity { get; set; }
    public string? VoiceKey { get; set; }
}

public sealed class AudioResolveResponse
{
    public bool Found { get; set; }
    public string? AudioUrl { get; set; }
    public long? AssetId { get; set; }
    public bool FallbackUsed { get; set; }
    public bool Queued { get; set; }
    public string? ResolvedLanguage { get; set; }
    public string? RelativePath { get; set; }
    public int SpecificityScore { get; set; }
}

public sealed class AudioGenerationJobLeaseRequest
{
    public string WorkerId { get; set; } = string.Empty;
    public int MaxJobs { get; set; } = 1;
}

public sealed class AudioGenerationJobDto
{
    public long Id { get; set; }
    public string EventType { get; set; } = string.Empty;
    public string Language { get; set; } = string.Empty;
    public string? TeamSymbol { get; set; }
    public string? ContextKey { get; set; }
    public string? Intensity { get; set; }
    public string VoiceKey { get; set; } = string.Empty;
    public string? TemplateKey { get; set; }
    public string TextPrompt { get; set; } = string.Empty;
    public string? TargetRelativePath { get; set; }
    public string? TargetFileName { get; set; }
    public string Status { get; set; } = string.Empty;
    public int Priority { get; set; }
    public int AttemptCount { get; set; }
    public int MaxAttempts { get; set; }
    public string? LeaseOwner { get; set; }
    public DateTime? LeasedUntilUtc { get; set; }
}

public sealed class AudioGenerationCompleteRequest
{
    public int? DurationMs { get; set; }
    public string? FileHash { get; set; }
    public long? FileSizeBytes { get; set; }
    public string? GenerationModel { get; set; }
    public string? GenerationSource { get; set; }
    public string WorkerId { get; set; } = string.Empty;
    public decimal? QualityScore { get; set; }
}

public sealed class AudioGenerationFailRequest
{
    public string WorkerId { get; set; } = string.Empty;
    public string ErrorMessage { get; set; } = string.Empty;
}
