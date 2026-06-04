using DAL.NftFutebol;
using DTOs;
using EthicAI.EntityModel;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace CriptoVersus.API.Services;

public interface IAudioAssetResolverService
{
    Task<AudioAssetResolveResult?> ResolveAsync(AudioResolveRequest request, CancellationToken ct = default);
    Task<AudioResolveDiagnosticResult> DiagnoseAsync(AudioResolveRequest request, bool incrementUsage, CancellationToken ct = default);
}

public sealed class AudioAssetResolverService : IAudioAssetResolverService
{
    private readonly EthicAIDbContext _db;
    private readonly IOptions<ProceduralAudioFeatureOptions> _featureOptions;
    private readonly ILogger<AudioAssetResolverService> _logger;

    public AudioAssetResolverService(
        EthicAIDbContext db,
        IOptions<ProceduralAudioFeatureOptions> featureOptions,
        ILogger<AudioAssetResolverService> logger)
    {
        _db = db;
        _featureOptions = featureOptions;
        _logger = logger;
    }

    public async Task<AudioAssetResolveResult?> ResolveAsync(AudioResolveRequest request, CancellationToken ct = default)
    {
        if (!_featureOptions.Value.Enabled)
        {
            _logger.LogInformation(
                "Procedural audio disabled. Skipping resolve. EventType={EventType} Language={Language} TeamSymbol={TeamSymbol}",
                request.EventType,
                request.Language,
                request.TeamSymbol);
            return null;
        }

        var diagnostic = await DiagnoseAsync(request, incrementUsage: true, ct);
        return diagnostic.ResolvedAsset is null
            ? null
            : new AudioAssetResolveResult(
                diagnostic.ResolvedAsset,
                diagnostic.FallbackUsed,
                diagnostic.ResolvedLanguage ?? diagnostic.NormalizedRequest.Language,
                diagnostic.SpecificityScore);
    }

    public async Task<AudioResolveDiagnosticResult> DiagnoseAsync(
        AudioResolveRequest request,
        bool incrementUsage,
        CancellationToken ct = default)
    {
        var normalized = AudioRequestNormalizer.Normalize(request);
        var candidates = await _db.AudioAsset
            .Where(x => x.Status == AudioAssetStatus.Ready
                && x.EventType == normalized.EventType
                && x.Language == normalized.Language)
            .ToListAsync(ct);

        var rankedCandidates = candidates
            .Select(asset => Rank(asset, normalized))
            .Where(x => x is not null)
            .OrderByDescending(x => x!.SpecificityScore)
            .ThenByDescending(x => x!.Asset.Priority)
            .ThenByDescending(x => x!.Asset.Id)
            .ToList();

        var ranked = rankedCandidates.FirstOrDefault();
        if (ranked is not null && incrementUsage)
        {
            ranked.Asset.UsageCount += 1;
            ranked.Asset.LastUsedAtUtc = DateTime.UtcNow;
            ranked.Asset.UpdatedAtUtc = DateTime.UtcNow;
            await _db.SaveChangesAsync(ct);
        }

        if (ranked is not null)
        {
            _logger.LogInformation(
                ranked.FallbackUsed
                    ? "Audio asset resolved with procedural fallback. EventType={EventType} Language={Language} TeamSymbol={TeamSymbol} ContextKey={ContextKey} Intensity={Intensity} VoiceKey={VoiceKey} AssetId={AssetId} SpecificityScore={SpecificityScore}"
                    : "Audio asset resolved with exact procedural hit. EventType={EventType} Language={Language} TeamSymbol={TeamSymbol} ContextKey={ContextKey} Intensity={Intensity} VoiceKey={VoiceKey} AssetId={AssetId} SpecificityScore={SpecificityScore}",
                normalized.EventType,
                normalized.Language,
                normalized.TeamSymbol,
                normalized.ContextKey,
                normalized.Intensity,
                normalized.VoiceKey,
                ranked.Asset.Id,
                ranked.SpecificityScore);
        }
        else
        {
            _logger.LogWarning(
                "No procedural audio asset found. EventType={EventType} Language={Language} TeamSymbol={TeamSymbol} ContextKey={ContextKey} Intensity={Intensity} VoiceKey={VoiceKey}",
                normalized.EventType,
                normalized.Language,
                normalized.TeamSymbol,
                normalized.ContextKey,
                normalized.Intensity,
                normalized.VoiceKey);
        }

        return new AudioResolveDiagnosticResult(
            NormalizedRequest: normalized,
            ResolvedAsset: ranked?.Asset,
            FallbackUsed: ranked?.FallbackUsed ?? false,
            SpecificityScore: ranked?.SpecificityScore ?? 0,
            CandidateCount: candidates.Count,
            RankedCandidateIds: rankedCandidates.Select(x => x!.Asset.Id).ToArray(),
            ResolutionSteps:
            [
                "event_type + language + team_symbol + context_key + intensity + voice_key",
                "event_type + language + team_symbol + context_key + intensity",
                "event_type + language + team_symbol + intensity",
                "event_type + language + team_symbol",
                "event_type + language + context_key + intensity",
                "event_type + language + intensity",
                "event_type + language (generic)"
            ],
            ResolvedLanguage: ranked is null ? null : normalized.Language);
    }

    private static RankedAudioAsset? Rank(AudioAsset asset, AudioResolveRequest request)
    {
        var score = 0;
        var fallbackUsed = false;

        if (!TryScore(asset.TeamSymbol, request.TeamSymbol, 16, ref score, ref fallbackUsed, upper: true))
            return null;

        if (!TryScore(asset.ContextKey, request.ContextKey, 8, ref score, ref fallbackUsed))
            return null;

        if (!TryScore(asset.Intensity, request.Intensity, 4, ref score, ref fallbackUsed))
            return null;

        if (!TryScore(asset.VoiceKey, request.VoiceKey, 2, ref score, ref fallbackUsed))
            return null;

        return new RankedAudioAsset(asset, score, fallbackUsed);
    }

    private static bool TryScore(
        string? assetValue,
        string? requestValue,
        int exactScore,
        ref int score,
        ref bool fallbackUsed,
        bool upper = false)
    {
        var normalizedAsset = AudioRequestNormalizer.NormalizeToken(assetValue, upper);
        var normalizedRequest = AudioRequestNormalizer.NormalizeToken(requestValue, upper);

        if (normalizedRequest is null)
            return normalizedAsset is null;

        if (normalizedAsset is null)
        {
            fallbackUsed = true;
            return true;
        }

        if (!string.Equals(normalizedAsset, normalizedRequest, StringComparison.Ordinal))
            return false;

        score += exactScore;
        return true;
    }

    private sealed record RankedAudioAsset(AudioAsset Asset, int SpecificityScore, bool FallbackUsed);
}

public sealed record AudioAssetResolveResult(AudioAsset Asset, bool FallbackUsed, string ResolvedLanguage, int SpecificityScore);

public sealed record AudioResolveDiagnosticResult(
    AudioResolveRequest NormalizedRequest,
    AudioAsset? ResolvedAsset,
    bool FallbackUsed,
    int SpecificityScore,
    int CandidateCount,
    IReadOnlyList<long> RankedCandidateIds,
    IReadOnlyList<string> ResolutionSteps,
    string? ResolvedLanguage);
