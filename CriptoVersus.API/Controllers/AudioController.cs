using CriptoVersus.API.Services;
using DAL.NftFutebol;
using DTOs;
using EthicAI.EntityModel;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace CriptoVersus.API.Controllers;

[ApiController]
[Route("api/audio")]
public sealed class AudioController : ControllerBase
{
    private readonly IAudioAssetResolverService _resolver;
    private readonly IAudioGenerationQueueService _queue;
    private readonly IOptions<ProceduralAudioFeatureOptions> _featureOptions;
    private readonly EthicAIDbContext _db;
    private readonly ILogger<AudioController> _logger;

    public AudioController(
        IAudioAssetResolverService resolver,
        IAudioGenerationQueueService queue,
        IOptions<ProceduralAudioFeatureOptions> featureOptions,
        EthicAIDbContext db,
        ILogger<AudioController> logger)
    {
        _resolver = resolver;
        _queue = queue;
        _featureOptions = featureOptions;
        _db = db;
        _logger = logger;
    }

    [AllowAnonymous]
    [HttpPost("resolve")]
    public async Task<ActionResult<AudioResolveResponse>> Resolve([FromBody] AudioResolveRequest request, CancellationToken ct)
    {
        if (!_featureOptions.Value.Enabled)
        {
            _logger.LogInformation(
                "Procedural audio resolve requested while disabled. EventType={EventType} Language={Language} TeamSymbol={TeamSymbol}",
                request.EventType,
                request.Language,
                request.TeamSymbol);
            return Ok(new AudioResolveResponse
            {
                Found = false,
                AudioUrl = null,
                Queued = false
            });
        }

        var resolved = await _resolver.ResolveAsync(request, ct);
        if (resolved is not null)
        {
            var queued = false;
            if (resolved.FallbackUsed)
                queued = await _queue.EnqueueIfMissingAsync(request, ct);

            return Ok(new AudioResolveResponse
            {
                Found = true,
                AudioUrl = resolved.Asset.AudioUrl,
                AssetId = resolved.Asset.Id,
                FallbackUsed = resolved.FallbackUsed,
                Queued = queued,
                ResolvedLanguage = resolved.ResolvedLanguage,
                RelativePath = resolved.Asset.RelativePath,
                SpecificityScore = resolved.SpecificityScore
            });
        }

        var enqueued = await _queue.EnqueueIfMissingAsync(request, ct);
        return Ok(new AudioResolveResponse
        {
            Found = false,
            AudioUrl = null,
            Queued = enqueued
        });
    }

    [AllowAnonymous]
    [HttpGet("health")]
    public async Task<ActionResult<object>> Health(CancellationToken ct)
    {
        var templates = await _db.AudioPhraseTemplate.CountAsync(ct);
        var voiceProfiles = await _db.AudioVoiceProfile.CountAsync(ct);
        var assets = await _db.AudioAsset.CountAsync(ct);
        var queuePending = await _db.AudioGenerationQueueItem.CountAsync(x => x.Status == AudioGenerationJobStatus.Pending, ct);
        var queueFailed = await _db.AudioGenerationQueueItem.CountAsync(x => x.Status == AudioGenerationJobStatus.Failed, ct);

        return Ok(new
        {
            enabled = _featureOptions.Value.Enabled,
            templates,
            voiceProfiles,
            assets,
            queuePending,
            queueFailed
        });
    }

    [HttpPost("test-resolve")]
    public async Task<ActionResult<object>> TestResolve([FromBody] AudioResolveRequest request, CancellationToken ct)
    {
        var diagnostic = await _resolver.DiagnoseAsync(request, incrementUsage: false, ct);
        var queued = false;

        if (_featureOptions.Value.Enabled && diagnostic.ResolvedAsset is null)
            queued = await _queue.EnqueueIfMissingAsync(request, ct);

        return Ok(new
        {
            enabled = _featureOptions.Value.Enabled,
            request = diagnostic.NormalizedRequest,
            found = diagnostic.ResolvedAsset is not null,
            fallbackUsed = diagnostic.FallbackUsed,
            queued,
            specificityScore = diagnostic.SpecificityScore,
            candidateCount = diagnostic.CandidateCount,
            rankedCandidateIds = diagnostic.RankedCandidateIds,
            resolutionSteps = diagnostic.ResolutionSteps,
            resolvedLanguage = diagnostic.ResolvedLanguage,
            asset = diagnostic.ResolvedAsset is null
                ? null
                : new
                {
                    diagnostic.ResolvedAsset.Id,
                    diagnostic.ResolvedAsset.AudioUrl,
                    diagnostic.ResolvedAsset.RelativePath,
                    diagnostic.ResolvedAsset.TeamSymbol,
                    diagnostic.ResolvedAsset.ContextKey,
                    diagnostic.ResolvedAsset.Intensity,
                    diagnostic.ResolvedAsset.VoiceKey
                }
        });
    }
}
