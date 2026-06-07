using DAL.NftFutebol;
using DTOs;
using EthicAI.EntityModel;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace CriptoVersus.API.Services;

public interface IAudioGenerationQueueService
{
    Task<AudioQueueEnqueueResult> EnqueueIfMissingAsync(AudioResolveRequest request, CancellationToken ct = default);
    Task<IReadOnlyList<AudioGenerationJobDto>> LeaseJobsAsync(AudioGenerationJobLeaseRequest request, CancellationToken ct = default);
    Task<AudioAsset> CompleteJobAsync(long id, AudioGenerationCompleteRequest request, IFormFile audioFile, CancellationToken ct = default);
    Task<bool> FailJobAsync(long id, AudioGenerationFailRequest request, CancellationToken ct = default);
    Task<AudioAssetTestGenerateResponseDto> EnqueueManualTestAsync(AudioAssetTestGenerateRequestDto request, CancellationToken ct = default);
    Task<AudioAssetTestStatusResponseDto?> GetJobStatusAsync(long id, CancellationToken ct = default);
}

public sealed record AudioQueueEnqueueResult(
    bool Queued,
    bool AlreadyQueued,
    string Status,
    string Reason,
    long? JobId = null);

public sealed class AudioGenerationQueueService : IAudioGenerationQueueService
{
    private static readonly string[] ActiveStatuses =
    [
        AudioGenerationJobStatus.Pending,
        AudioGenerationJobStatus.Leased,
        AudioGenerationJobStatus.Generating
    ];

    private readonly EthicAIDbContext _db;
    private readonly IAudioStorageService _storage;
    private readonly IAudioNarrativeResolverService _narrativeResolver;
    private readonly IOptions<AudioGenerationOptions> _options;
    private readonly IOptions<ProceduralAudioFeatureOptions> _featureOptions;
    private readonly ILogger<AudioGenerationQueueService> _logger;

    public AudioGenerationQueueService(
        EthicAIDbContext db,
        IAudioStorageService storage,
        IAudioNarrativeResolverService narrativeResolver,
        IOptions<AudioGenerationOptions> options,
        IOptions<ProceduralAudioFeatureOptions> featureOptions,
        ILogger<AudioGenerationQueueService> logger)
    {
        _db = db;
        _storage = storage;
        _narrativeResolver = narrativeResolver;
        _options = options;
        _featureOptions = featureOptions;
        _logger = logger;
    }

    public async Task<AudioQueueEnqueueResult> EnqueueIfMissingAsync(AudioResolveRequest request, CancellationToken ct = default)
    {
        if (!request.QueueIfMissing)
        {
            _logger.LogInformation(
                "Procedural audio queue skipped because queueIfMissing=false. EventType={EventType} Language={Language} TeamSymbol={TeamSymbol}",
                request.EventType,
                request.Language,
                request.TeamSymbol);
            return new AudioQueueEnqueueResult(false, false, "skipped", "queueIfMissing=false");
        }

        if (!_featureOptions.Value.Enabled)
        {
            _logger.LogInformation(
                "Procedural audio queue skipped because feature flag is disabled. EventType={EventType} Language={Language} TeamSymbol={TeamSymbol}",
                request.EventType,
                request.Language,
                request.TeamSymbol);
            return new AudioQueueEnqueueResult(false, false, "skipped", "procedural audio disabled");
        }

        if (!_featureOptions.Value.AllowQueueGeneration)
        {
            _logger.LogInformation(
                "Procedural audio queue skipped because AllowQueueGeneration=false. EventType={EventType} Language={Language} TeamSymbol={TeamSymbol}",
                request.EventType,
                request.Language,
                request.TeamSymbol);
            return new AudioQueueEnqueueResult(false, false, "skipped", "queue generation disabled");
        }

        var normalized = await _narrativeResolver.ResolveAsync(request, ct);
        var resolvedVoiceKey = ResolveVoiceKey(normalized);
        var template = await ResolveTemplateAsync(normalized, ct);
        var textPrompt = BuildPrompt(normalized, template);
        var normalizedText = ProceduralAudioTextDeduplication.NormalizeNarrationText(textPrompt);
        var textHash = string.IsNullOrWhiteSpace(normalizedText)
            ? null
            : ProceduralAudioTextDeduplication.ComputeTextHash(
                textPrompt,
                normalized.Language,
                resolvedVoiceKey,
                ResolveTextHashUniquenessSuffix(normalized));

        if (!request.ForceQueue && !string.IsNullOrWhiteSpace(textHash))
        {
            var existingAssetCandidates = await _db.AudioAsset
                .Where(x => x.Status == AudioAssetStatus.Ready
                    && x.Language == normalized.Language
                    && x.VoiceKey == resolvedVoiceKey
                    && (x.TextHash == textHash || (x.TextHash == null && x.TextPrompt != null)))
                .OrderByDescending(x => x.QualityScore ?? 0m)
                .ThenByDescending(x => x.UsageCount)
                .ThenByDescending(x => x.LastUsedAtUtc ?? x.CreatedAtUtc)
                .ThenByDescending(x => x.Id)
                .ToListAsync(ct);

            var existingAsset = existingAssetCandidates.FirstOrDefault(x =>
                _storage.StoredAudioExists(x.RelativePath)
                && string.Equals(
                    x.TextHash ?? ProceduralAudioTextDeduplication.ComputeTextHash(
                        x.TextPrompt,
                        x.Language,
                        x.VoiceKey,
                        ResolveTextHashUniquenessSuffix(x.EventType, x.ContextKey)),
                    textHash,
                    StringComparison.Ordinal));

            if (existingAsset is not null)
            {
                existingAsset.LastUsedAtUtc = DateTime.UtcNow;
                existingAsset.UpdatedAtUtc = DateTime.UtcNow;
                existingAsset.NormalizedText ??= normalizedText;
                existingAsset.TextHash ??= textHash;
                await _db.SaveChangesAsync(ct);

                _logger.LogInformation(
                    "[AUDIO_GENERATION] skipped-existing-hash assetId={AssetId} textHash={TextHash} eventType={EventType} language={Language} voiceKey={VoiceKey}",
                    existingAsset.Id,
                    textHash,
                    normalized.EventType,
                    normalized.Language,
                    resolvedVoiceKey);
                return new AudioQueueEnqueueResult(false, true, "skipped_existing_hash", "matching text hash already exists", existingAsset.Id);
            }
        }

        if (!request.ForceQueue)
        {
            var existingJob = await _db.AudioGenerationQueueItem
                .Where(x =>
                    ActiveStatuses.Contains(x.Status)
                    && x.Language == normalized.Language
                    && x.VoiceKey == resolvedVoiceKey
                    && (x.TextHash == textHash
                        || (x.EventType == normalized.EventType
                            && x.NormalizedSymbol == normalized.NormalizedSymbol
                            && x.ContextKey == normalized.ContextKey
                            && x.TextPrompt == textPrompt)))
                .OrderByDescending(x => x.CreatedAtUtc)
                .FirstOrDefaultAsync(ct);

            if (existingJob is not null)
            {
                _logger.LogInformation(
                    "Procedural audio queue skipped because an active generation job already exists. JobId={JobId} EventType={EventType} Language={Language} TeamSymbol={TeamSymbol} ContextKey={ContextKey} Intensity={Intensity} VoiceKey={VoiceKey}",
                    existingJob.Id,
                    normalized.EventType,
                    normalized.Language,
                    normalized.NormalizedSymbol,
                    normalized.ContextKey,
                    normalized.Intensity,
                    resolvedVoiceKey);
                return new AudioQueueEnqueueResult(true, true, "already_queued", "active generation job already exists", existingJob.Id);
            }
        }

        var job = new AudioGenerationQueueItem
        {
            EventType = normalized.EventType,
            Language = normalized.Language,
            RawSymbol = normalized.RawSymbol,
            NormalizedSymbol = normalized.NormalizedSymbol,
            TeamSymbol = normalized.TeamSymbol,
            TeamName = normalized.TeamName,
            ContextKey = normalized.ContextKey,
            Intensity = normalized.Intensity,
            VoiceKey = resolvedVoiceKey,
            TemplateKey = template?.TemplateKey,
            TextPrompt = textPrompt,
            NormalizedText = normalizedText,
            TextHash = textHash,
            TargetFileName = BuildTargetFileName(normalized, textHash),
            TargetRelativePath = BuildTargetRelativePath(normalized),
            Status = AudioGenerationJobStatus.Pending,
            Priority = ResolvePriority(normalized),
            CreatedAtUtc = DateTime.UtcNow,
            UpdatedAtUtc = DateTime.UtcNow
        };

        _db.AudioGenerationQueueItem.Add(job);
        await _db.SaveChangesAsync(ct);

        _logger.LogInformation(
            "Procedural audio asset missing; generation job enqueued. JobId={JobId} RawSymbol={RawSymbol} NormalizedSymbol={NormalizedSymbol} TeamName={TeamName} EventType={EventType} Language={Language} TextPrompt={TextPrompt} TextHash={TextHash} ContextKey={ContextKey} Intensity={Intensity} VoiceKey={VoiceKey}",
            job.Id,
            job.RawSymbol,
            job.NormalizedSymbol,
            job.TeamName,
            job.EventType,
            job.Language,
            job.TextPrompt,
            job.TextHash,
            job.ContextKey,
            job.Intensity,
            job.VoiceKey);

        return new AudioQueueEnqueueResult(true, false, "enqueued", "generation job created", job.Id);
    }

    public async Task<IReadOnlyList<AudioGenerationJobDto>> LeaseJobsAsync(AudioGenerationJobLeaseRequest request, CancellationToken ct = default)
    {
        var workerId = string.IsNullOrWhiteSpace(request.WorkerId) ? "unknown-worker" : request.WorkerId.Trim();
        var nowUtc = DateTime.UtcNow;
        var take = Math.Clamp(request.MaxJobs, 1, 10);

        var jobs = await _db.AudioGenerationQueueItem
            .Where(x =>
                x.Status == AudioGenerationJobStatus.Pending
                || ((x.Status == AudioGenerationJobStatus.Leased || x.Status == AudioGenerationJobStatus.Generating)
                    && x.LeasedUntilUtc.HasValue
                    && x.LeasedUntilUtc.Value <= nowUtc))
            .OrderByDescending(x => x.Priority)
            .ThenBy(x => x.CreatedAtUtc)
            .Take(take)
            .ToListAsync(ct);

        if (jobs.Count == 0)
            return [];

        var leaseUntilUtc = nowUtc.AddSeconds(Math.Max(30, _options.Value.LeaseDurationSeconds));
        foreach (var job in jobs)
        {
            job.Status = AudioGenerationJobStatus.Leased;
            job.LeaseOwner = workerId;
            job.LeasedUntilUtc = leaseUntilUtc;
            job.UpdatedAtUtc = nowUtc;
        }

        await _db.SaveChangesAsync(ct);

        return jobs.Select(ToDto).ToList();
    }

    public async Task<AudioAsset> CompleteJobAsync(long id, AudioGenerationCompleteRequest request, IFormFile audioFile, CancellationToken ct = default)
    {
        var job = await _db.AudioGenerationQueueItem.FirstOrDefaultAsync(x => x.Id == id, ct)
            ?? throw new InvalidOperationException($"Audio generation job {id} was not found.");

        job.Status = AudioGenerationJobStatus.Generating;
        job.UpdatedAtUtc = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);

        if (!string.IsNullOrWhiteSpace(job.TextHash))
        {
            var existingAssetCandidates = await _db.AudioAsset
                .Where(x => x.Status == AudioAssetStatus.Ready
                    && x.Language == job.Language
                    && x.VoiceKey == job.VoiceKey
                    && (x.TextHash == job.TextHash || (x.TextHash == null && x.TextPrompt != null)))
                .OrderByDescending(x => x.QualityScore ?? 0m)
                .ThenByDescending(x => x.UsageCount)
                .ThenByDescending(x => x.LastUsedAtUtc ?? x.CreatedAtUtc)
                .ThenByDescending(x => x.Id)
                .ToListAsync(ct);

            var existingAsset = existingAssetCandidates.FirstOrDefault(x =>
                _storage.StoredAudioExists(x.RelativePath)
                && string.Equals(
                    x.TextHash ?? ProceduralAudioTextDeduplication.ComputeTextHash(
                        x.TextPrompt,
                        x.Language,
                        x.VoiceKey,
                        ResolveTextHashUniquenessSuffix(x.EventType, x.ContextKey)),
                    job.TextHash,
                    StringComparison.Ordinal));

            if (existingAsset is not null)
            {
                existingAsset.NormalizedText ??= job.NormalizedText;
                existingAsset.TextHash ??= job.TextHash;
                job.Status = AudioGenerationJobStatus.Completed;
                job.CompletedAudioAssetId = existingAsset.Id;
                job.ProcessedAtUtc = DateTime.UtcNow;
                job.UpdatedAtUtc = DateTime.UtcNow;
                job.ErrorMessage = null;
                await _db.SaveChangesAsync(ct);

                _logger.LogInformation(
                    "[AUDIO_GENERATION] skipped-existing-hash assetId={AssetId} textHash={TextHash} jobId={JobId}",
                    existingAsset.Id,
                    job.TextHash,
                    job.Id);
                return existingAsset;
            }
        }

        var storedFile = await _storage.SaveGeneratedAudioAsync(ToDto(job), audioFile, ct);
        var asset = new AudioAsset
        {
            EventType = job.EventType,
            Language = job.Language,
            RawSymbol = job.RawSymbol,
            NormalizedSymbol = job.NormalizedSymbol,
            TeamSymbol = job.TeamSymbol,
            TeamName = job.TeamName,
            ContextKey = job.ContextKey,
            Intensity = job.Intensity,
            VoiceKey = job.VoiceKey,
            TemplateKey = job.TemplateKey,
            TextPrompt = job.TextPrompt,
            NormalizedText = job.NormalizedText,
            TextHash = job.TextHash,
            AudioUrl = storedFile.AudioUrl,
            RelativePath = storedFile.RelativePath,
            FileName = storedFile.FileName,
            MimeType = string.IsNullOrWhiteSpace(audioFile.ContentType) ? "audio/mpeg" : audioFile.ContentType,
            DurationMs = request.DurationMs,
            FileSizeBytes = request.FileSizeBytes ?? audioFile.Length,
            FileHash = request.FileHash,
            GenerationModel = request.GenerationModel,
            GenerationSource = ResolveGenerationSource(job, request),
            QualityScore = request.QualityScore,
            Priority = job.Priority,
            Status = AudioAssetStatus.Ready,
            CreatedAtUtc = DateTime.UtcNow,
            UpdatedAtUtc = DateTime.UtcNow
        };

        _db.AudioAsset.Add(asset);
        await _db.SaveChangesAsync(ct);

        job.Status = AudioGenerationJobStatus.Completed;
        job.CompletedAudioAssetId = asset.Id;
        job.ProcessedAtUtc = DateTime.UtcNow;
        job.UpdatedAtUtc = DateTime.UtcNow;
        job.ErrorMessage = null;
        await _db.SaveChangesAsync(ct);

        _logger.LogInformation(
            "Audio generation job completed. JobId={JobId} AssetId={AssetId} RelativePath={RelativePath} AudioUrl={AudioUrl} TextPrompt={TextPrompt} TextHash={TextHash} WorkerId={WorkerId}",
            job.Id,
            asset.Id,
            asset.RelativePath,
            asset.AudioUrl,
            asset.TextPrompt,
            asset.TextHash,
            request.WorkerId);

        return asset;
    }

    public async Task<bool> FailJobAsync(long id, AudioGenerationFailRequest request, CancellationToken ct = default)
    {
        var job = await _db.AudioGenerationQueueItem.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (job is null)
            return false;

        job.AttemptCount += 1;
        job.ErrorMessage = request.ErrorMessage;
        job.UpdatedAtUtc = DateTime.UtcNow;
        job.LeaseOwner = request.WorkerId;
        job.LeasedUntilUtc = null;
        job.Status = job.AttemptCount >= job.MaxAttempts
            ? AudioGenerationJobStatus.Failed
            : AudioGenerationJobStatus.Pending;

        if (job.Status == AudioGenerationJobStatus.Failed)
            job.ProcessedAtUtc = DateTime.UtcNow;

        await _db.SaveChangesAsync(ct);

        _logger.LogWarning(
            "Audio generation job failed. JobId={JobId} AttemptCount={AttemptCount} MaxAttempts={MaxAttempts} Status={Status} WorkerId={WorkerId} Error={Error}",
            job.Id,
            job.AttemptCount,
            job.MaxAttempts,
            job.Status,
            request.WorkerId,
            request.ErrorMessage);

        return true;
    }

    public async Task<AudioAssetTestGenerateResponseDto> EnqueueManualTestAsync(
        AudioAssetTestGenerateRequestDto request,
        CancellationToken ct = default)
    {
        var normalized = await _narrativeResolver.ResolveAsync(new AudioResolveRequest
        {
            EventType = request.EventType,
            Language = request.Language,
            RawSymbol = request.TeamSymbol,
            NormalizedSymbol = request.TeamSymbol,
            TeamSymbol = request.TeamSymbol,
            TeamName = request.TeamName,
            TextPrompt = request.OverrideTextPrompt,
            ContextKey = request.ContextKey,
            Intensity = request.Intensity,
            VoiceKey = request.VoiceKey,
            QueueIfMissing = false,
            ForceQueue = true
        }, ct);

        var resolvedVoiceKey = ResolveVoiceKey(normalized);
        var template = await ResolveTemplateAsync(normalized, ct);
        var textPrompt = BuildPrompt(
            string.IsNullOrWhiteSpace(request.OverrideTextPrompt)
                ? normalized
                : new AudioResolveRequest
                {
                    EventType = normalized.EventType,
                    Language = normalized.Language,
                    RawSymbol = normalized.RawSymbol,
                    NormalizedSymbol = normalized.NormalizedSymbol,
                    TeamSymbol = normalized.TeamSymbol,
                    TeamName = normalized.TeamName,
                    TextPrompt = request.OverrideTextPrompt,
                    ContextKey = normalized.ContextKey,
                    Intensity = normalized.Intensity,
                    VoiceKey = resolvedVoiceKey
                },
            template);
        var normalizedText = ProceduralAudioTextDeduplication.NormalizeNarrationText(textPrompt);
        var textHash = string.IsNullOrWhiteSpace(normalizedText)
            ? null
            : ProceduralAudioTextDeduplication.ComputeTextHash(
                textPrompt,
                normalized.Language,
                resolvedVoiceKey,
                ResolveTextHashUniquenessSuffix(normalized));

        var nowUtc = DateTime.UtcNow;
        var job = new AudioGenerationQueueItem
        {
            EventType = normalized.EventType,
            Language = normalized.Language,
            RawSymbol = normalized.RawSymbol,
            NormalizedSymbol = normalized.NormalizedSymbol,
            TeamSymbol = normalized.TeamSymbol,
            TeamName = normalized.TeamName,
            ContextKey = normalized.ContextKey,
            Intensity = normalized.Intensity,
            VoiceKey = resolvedVoiceKey,
            TemplateKey = template?.TemplateKey,
            TextPrompt = textPrompt,
            NormalizedText = normalizedText,
            TextHash = textHash,
            TargetFileName = BuildTargetFileName(normalized, textHash, "test"),
            TargetRelativePath = BuildTestTargetRelativePath(),
            Status = AudioGenerationJobStatus.Pending,
            Priority = 5,
            CreatedAtUtc = nowUtc,
            UpdatedAtUtc = nowUtc
        };

        _db.AudioGenerationQueueItem.Add(job);
        await _db.SaveChangesAsync(ct);

        _logger.LogInformation(
            "Manual test audio generation job enqueued. JobId={JobId} EventType={EventType} Language={Language} TeamSymbol={TeamSymbol} VoiceKey={VoiceKey}",
            job.Id,
            job.EventType,
            job.Language,
            job.TeamSymbol,
            job.VoiceKey);

        return new AudioAssetTestGenerateResponseDto
        {
            Queued = true,
            JobId = job.Id
        };
    }

    public async Task<AudioAssetTestStatusResponseDto?> GetJobStatusAsync(long id, CancellationToken ct = default)
    {
        var job = await _db.AudioGenerationQueueItem
            .AsNoTracking()
            .Include(x => x.CompletedAudioAsset)
            .FirstOrDefaultAsync(x => x.Id == id, ct);

        if (job is null)
            return null;

        return new AudioAssetTestStatusResponseDto
        {
            JobId = job.Id,
            Status = job.Status,
            AssetId = job.CompletedAudioAssetId,
            AudioUrl = job.CompletedAudioAsset?.AudioUrl,
            TextPrompt = job.CompletedAudioAsset?.TextPrompt ?? job.TextPrompt,
            NormalizedText = job.CompletedAudioAsset?.NormalizedText ?? job.NormalizedText,
            TextHash = job.CompletedAudioAsset?.TextHash ?? job.TextHash,
            TeamName = job.CompletedAudioAsset?.TeamName ?? job.TeamName,
            ErrorMessage = job.ErrorMessage
        };
    }

    private async Task<AudioPhraseTemplate?> ResolveTemplateAsync(AudioResolveRequest request, CancellationToken ct)
    {
        return await _db.AudioPhraseTemplate
            .Where(x => x.IsActive && x.EventType == request.EventType && x.Language == request.Language)
            .Where(x => x.ContextKey == request.ContextKey || x.ContextKey == null)
            .Where(x => x.Intensity == request.Intensity || x.Intensity == null)
            .OrderByDescending(x => x.ContextKey == request.ContextKey)
            .ThenByDescending(x => x.Intensity == request.Intensity)
            .ThenByDescending(x => x.Priority)
            .FirstOrDefaultAsync(ct);
    }

    private string ResolveVoiceKey(AudioResolveRequest request)
    {
        if (!string.IsNullOrWhiteSpace(request.VoiceKey))
            return request.VoiceKey!;

        return request.Language == "pt-BR"
            ? "narrator_pt_br"
            : "narrator_en_us";
    }

    private static string BuildPrompt(AudioResolveRequest request, AudioPhraseTemplate? template)
    {
        if (!string.IsNullOrWhiteSpace(request.TextPrompt))
            return request.TextPrompt!;

        var text = template?.TemplateText
            ?? ProceduralNarrativeText.BuildTextPrompt(
                request.EventType,
                request.Language,
                request.TeamName ?? request.NormalizedSymbol ?? request.TeamSymbol ?? "CriptoVersus");

        return text
            .Replace("{TEAM_SYMBOL}", request.NormalizedSymbol ?? request.TeamSymbol ?? "GENERIC", StringComparison.OrdinalIgnoreCase)
            .Replace("{TEAM_NAME}", request.TeamName ?? request.NormalizedSymbol ?? request.TeamSymbol ?? "CriptoVersus", StringComparison.OrdinalIgnoreCase)
            .Replace("{EVENT_TYPE}", request.EventType, StringComparison.OrdinalIgnoreCase)
            .Replace("{LANGUAGE}", request.Language, StringComparison.OrdinalIgnoreCase);
    }

    private static string BuildTargetRelativePath(AudioResolveRequest request)
        => $"audio/{request.Language}/{request.EventType}/{ResolveStorageSymbolSegment(request)}";

    private static string BuildTargetFileName(AudioResolveRequest request, string? textHash, string? prefix = null)
    {
        var parts = new[]
        {
            prefix,
            request.EventType,
            request.Language,
            string.IsNullOrWhiteSpace(request.TeamSymbol) ? "generic" : request.TeamSymbol,
            ProceduralAudioTextDeduplication.GetShortHash(textHash)
        };

        return $"{string.Join("_", parts.Where(x => !string.IsNullOrWhiteSpace(x)).Select(x => x!.Trim().ToLowerInvariant()))}.mp3";
    }

    private static string ResolveStorageSymbolSegment(AudioResolveRequest request)
    {
        if (IsScoreSensitiveRequest(request))
            return "shared";

        return string.IsNullOrWhiteSpace(request.TeamSymbol) ? "generic" : request.TeamSymbol!;
    }

    private static bool IsScoreSensitiveRequest(AudioResolveRequest request)
        => string.Equals(request.EventType, "score_event", StringComparison.OrdinalIgnoreCase)
            || (!string.IsNullOrWhiteSpace(request.ContextKey)
                && request.ContextKey.StartsWith("scoreboard_", StringComparison.OrdinalIgnoreCase));

    private static string? ResolveTextHashUniquenessSuffix(AudioResolveRequest request)
        => ResolveTextHashUniquenessSuffix(request.EventType, request.ContextKey);

    private static string? ResolveTextHashUniquenessSuffix(string? eventType, string? contextKey)
        => string.Equals(eventType, "score_event", StringComparison.OrdinalIgnoreCase)
            || (!string.IsNullOrWhiteSpace(contextKey)
                && contextKey.StartsWith("scoreboard_", StringComparison.OrdinalIgnoreCase))
            ? $"{eventType}|{contextKey}"
            : null;

    private static string BuildTestTargetRelativePath()
        => "audio/test";

    private static int ResolvePriority(AudioResolveRequest request)
    {
        return request.EventType switch
        {
            "goal" => 100,
            "match_start" => 70,
            "final_whistle" => 65,
            "market_pump" => 75,
            "market_crash" => 75,
            _ => 40
        };
    }

    private AudioGenerationJobDto ToDto(AudioGenerationQueueItem job)
    {
        return new AudioGenerationJobDto
        {
            Id = job.Id,
            EventType = job.EventType,
            Language = job.Language,
            RawSymbol = job.RawSymbol,
            NormalizedSymbol = job.NormalizedSymbol,
            TeamSymbol = job.TeamSymbol,
            TeamName = job.TeamName,
            ContextKey = job.ContextKey,
            Intensity = job.Intensity,
            VoiceKey = job.VoiceKey,
            TemplateKey = job.TemplateKey,
            TextPrompt = job.TextPrompt,
            NormalizedText = job.NormalizedText,
            TextHash = job.TextHash,
            TargetRelativePath = job.TargetRelativePath,
            TargetFileName = job.TargetFileName,
            KeepWavFiles = _options.Value.KeepWavFiles,
            Status = job.Status,
            Priority = job.Priority,
            AttemptCount = job.AttemptCount,
            MaxAttempts = job.MaxAttempts,
            LeaseOwner = job.LeaseOwner,
            LeasedUntilUtc = job.LeasedUntilUtc
        };
    }

    private static string ResolveGenerationSource(AudioGenerationQueueItem job, AudioGenerationCompleteRequest request)
    {
        if (!string.IsNullOrWhiteSpace(request.GenerationSource))
            return request.GenerationSource!;

        if (!string.IsNullOrWhiteSpace(job.TargetRelativePath)
            && job.TargetRelativePath.StartsWith("audio/test", StringComparison.OrdinalIgnoreCase))
        {
            return "manual_test";
        }

        return request.WorkerId;
    }
}
