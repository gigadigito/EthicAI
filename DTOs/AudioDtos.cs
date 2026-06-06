namespace DTOs;

public sealed class AudioResolveRequest
{
    public string EventType { get; set; } = string.Empty;
    public string Language { get; set; } = string.Empty;
    public string? RawSymbol { get; set; }
    public string? NormalizedSymbol { get; set; }
    public string? TeamSymbol { get; set; }
    public string? TeamName { get; set; }
    public string? TextPrompt { get; set; }
    public string? ContextKey { get; set; }
    public string? Intensity { get; set; }
    public string? VoiceKey { get; set; }
    public bool QueueIfMissing { get; set; } = true;
    public bool ForceQueue { get; set; }
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
    public string? NormalizedText { get; set; }
    public string? TextHash { get; set; }
    public int SpecificityScore { get; set; }
    public string? QueueStatus { get; set; }
    public string? QueueReason { get; set; }
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
    public bool KeepWavFiles { get; set; }
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

public sealed class AudioAssetAdminQueryDto
{
    public string? EventType { get; set; }
    public string? Language { get; set; }
    public string? TeamSymbol { get; set; }
    public string? NormalizedSymbol { get; set; }
    public string? TeamName { get; set; }
    public string? Status { get; set; }
    public string? ContainsText { get; set; }
    public DateTime? CreatedAfterUtc { get; set; }
    public DateTime? CreatedBeforeUtc { get; set; }
    public bool? SuspectsOnly { get; set; }
    public string? SortBy { get; set; }
    public string? SortDirection { get; set; }
    public int Page { get; set; } = 1;
    public int PageSize { get; set; } = 50;
}

public sealed class AudioAssetAdminListItemDto
{
    public long Id { get; set; }
    public string EventType { get; set; } = string.Empty;
    public string Language { get; set; } = string.Empty;
    public string? RawSymbol { get; set; }
    public string? NormalizedSymbol { get; set; }
    public string? TeamName { get; set; }
    public string? TeamSymbol { get; set; }
    public string? ContextKey { get; set; }
    public string? Intensity { get; set; }
    public string? VoiceKey { get; set; }
    public string? TextPrompt { get; set; }
    public string? NormalizedText { get; set; }
    public string? TextHash { get; set; }
    public string AudioUrl { get; set; } = string.Empty;
    public string ResolvedAudioUrl { get; set; } = string.Empty;
    public string RelativePath { get; set; } = string.Empty;
    public string? PhysicalPath { get; set; }
    public string FileName { get; set; } = string.Empty;
    public string Status { get; set; } = string.Empty;
    public DateTime CreatedAtUtc { get; set; }
    public int UsageCount { get; set; }
    public int? DurationMs { get; set; }
    public long? FileSizeBytes { get; set; }
    public bool HasPhysicalFile { get; set; }
    public bool PublicUrlValid { get; set; }
    public bool IsOrphan { get; set; }
    public string? OrphanReason { get; set; }
    public bool IsSuspect { get; set; }
    public IReadOnlyList<string> SuspectRules { get; set; } = Array.Empty<string>();
    public string? GenerationSource { get; set; }
}

public sealed class AudioAssetAdminListResponseDto
{
    public int Page { get; set; }
    public int PageSize { get; set; }
    public int TotalCount { get; set; }
    public AudioAssetAdminSummaryDto Summary { get; set; } = new();
    public IReadOnlyList<AudioAssetAdminListItemDto> Items { get; set; } = Array.Empty<AudioAssetAdminListItemDto>();
}

public sealed class AudioAssetAdminSummaryDto
{
    public int TotalAssetsInDatabase { get; set; }
    public int TotalPhysicalFiles { get; set; }
    public int TotalOrphans { get; set; }
    public int TotalDisabled { get; set; }
    public int TotalReady { get; set; }
    public long TotalDirectoryBytes { get; set; }
    public string AudioRootPath { get; set; } = string.Empty;
}

public sealed class AudioAssetFilesystemEntryDto
{
    public string FileName { get; set; } = string.Empty;
    public string RelativePath { get; set; } = string.Empty;
    public string FullPath { get; set; } = string.Empty;
    public bool Exists { get; set; }
    public long SizeBytes { get; set; }
    public DateTime? LastModifiedUtc { get; set; }
    public string PublicUrl { get; set; } = string.Empty;
}

public sealed class AudioAssetFilesystemResponseDto
{
    public string AudioRootPath { get; set; } = string.Empty;
    public int TotalFiles { get; set; }
    public long TotalDirectoryBytes { get; set; }
    public IReadOnlyList<AudioAssetFilesystemEntryDto> Items { get; set; } = Array.Empty<AudioAssetFilesystemEntryDto>();
}

public sealed class AudioAssetAdminActionResultDto
{
    public bool Success { get; set; }
    public int AffectedCount { get; set; }
    public IReadOnlyList<long> AssetIds { get; set; } = Array.Empty<long>();
    public string Message { get; set; } = string.Empty;
}

public sealed class AudioAssetBulkActionRequestDto
{
    public IReadOnlyList<long> AssetIds { get; set; } = Array.Empty<long>();
}

public sealed class AudioAssetMaintenanceDisableSuspectRequestDto
{
    public bool DryRun { get; set; } = true;
    public IReadOnlyList<string> Rules { get; set; } = Array.Empty<string>();
}

public sealed class AudioAssetMaintenanceDisableSuspectResponseDto
{
    public bool DryRun { get; set; }
    public int AffectedCount { get; set; }
    public IReadOnlyList<long> AssetIds { get; set; } = Array.Empty<long>();
    public IReadOnlyList<string> Rules { get; set; } = Array.Empty<string>();
}

public sealed class AudioAssetTestGenerateRequestDto
{
    public string EventType { get; set; } = string.Empty;
    public string Language { get; set; } = string.Empty;
    public string? TeamSymbol { get; set; }
    public string? TeamName { get; set; }
    public string? ContextKey { get; set; }
    public string? Intensity { get; set; }
    public string? VoiceKey { get; set; }
    public string? OverrideTextPrompt { get; set; }
}

public sealed class AudioAssetTestGenerateResponseDto
{
    public bool Queued { get; set; }
    public long JobId { get; set; }
}

public sealed class AudioAssetTestStatusResponseDto
{
    public string Status { get; set; } = string.Empty;
    public long JobId { get; set; }
    public long? AssetId { get; set; }
    public string? AudioUrl { get; set; }
    public string? TextPrompt { get; set; }
    public string? NormalizedText { get; set; }
    public string? TextHash { get; set; }
    public string? TeamName { get; set; }
    public string? ErrorMessage { get; set; }
}

public sealed class AudioResolveDiagnosticPreviewDto
{
    public bool Enabled { get; set; }
    public bool Found { get; set; }
    public bool FallbackUsed { get; set; }
    public bool Queued { get; set; }
    public string? QueueStatus { get; set; }
    public string? QueueReason { get; set; }
    public int SpecificityScore { get; set; }
    public int CandidateCount { get; set; }
    public string? ResolvedLanguage { get; set; }
    public string? NormalizedText { get; set; }
    public string? TextHash { get; set; }
    public AudioResolveRequest? Request { get; set; }
}

public sealed class AudioAssetMaintenanceDeduplicateRequestDto
{
    public bool DryRun { get; set; } = true;
    public bool DeleteDuplicateFiles { get; set; } = true;
    public bool DeleteWavFiles { get; set; } = true;
}

public sealed class AudioAssetMaintenanceDeduplicateResponseDto
{
    public bool DryRun { get; set; }
    public int GroupsScanned { get; set; }
    public int DuplicateAssetsFound { get; set; }
    public int DuplicateAssetsUpdated { get; set; }
    public int FilesDeleted { get; set; }
    public int WavFilesDeleted { get; set; }
    public IReadOnlyList<long> KeptAssetIds { get; set; } = Array.Empty<long>();
    public IReadOnlyList<long> DuplicateAssetIds { get; set; } = Array.Empty<long>();
}
