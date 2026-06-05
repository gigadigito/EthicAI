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
    private readonly IAudioStorageService _storage;
    private readonly IOptions<ProceduralAudioFeatureOptions> _featureOptions;
    private readonly ILogger<AudioAssetResolverService> _logger;

    public AudioAssetResolverService(
        EthicAIDbContext db,
        IAudioStorageService storage,
        IOptions<ProceduralAudioFeatureOptions> featureOptions,
        ILogger<AudioAssetResolverService> logger)
    {
        _db = db;
        _storage = storage;
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
        _logger.LogInformation(
            "Procedural audio resolve request normalized. RawSymbol={RawSymbol} NormalizedSymbol={NormalizedSymbol} TeamName={TeamName} EventType={EventType} Language={Language} TeamSymbol={TeamSymbol} ContextKey={ContextKey} Intensity={Intensity} VoiceKey={VoiceKey}",
            normalized.RawSymbol,
            normalized.NormalizedSymbol,
            normalized.TeamName,
            normalized.EventType,
            normalized.Language,
            normalized.TeamSymbol,
            normalized.ContextKey,
            normalized.Intensity,
            normalized.VoiceKey);

        var candidates = await _db.AudioAsset
            .Where(x => x.Status == AudioAssetStatus.Ready
                && x.EventType == normalized.EventType
                && x.Language == normalized.Language)
            .ToListAsync(ct);

        var availableCandidates = new List<AudioAsset>(candidates.Count);
        foreach (var candidate in candidates)
        {
            if (_storage.StoredAudioExists(candidate.RelativePath))
            {
                availableCandidates.Add(candidate);
                continue;
            }

            _logger.LogWarning(
                "Procedural audio candidate ignored because the file is missing. AssetId={AssetId} RelativePath={RelativePath} AudioUrl={AudioUrl}",
                candidate.Id,
                candidate.RelativePath,
                candidate.AudioUrl);
        }

        _logger.LogInformation(
            "Procedural audio resolver loaded {CandidateCount} ready candidates and kept {AvailableCandidateCount} with existing files for EventType={EventType} Language={Language}",
            candidates.Count,
            availableCandidates.Count,
            normalized.EventType,
            normalized.Language);

        var evaluations = availableCandidates
            .Select(asset => Evaluate(asset, normalized))
            .ToList();

        foreach (var discarded in evaluations.Where(x => !x.IsMatch))
        {
            _logger.LogInformation(
                "Procedural audio candidate discarded. AssetId={AssetId} EventType={EventType} Language={Language} TeamSymbol={TeamSymbol} ContextKey={ContextKey} Intensity={Intensity} VoiceKey={VoiceKey} Status={Status} Reason={Reason}",
                discarded.Asset.Id,
                discarded.Asset.EventType,
                discarded.Asset.Language,
                discarded.Asset.TeamSymbol,
                discarded.Asset.ContextKey,
                discarded.Asset.Intensity,
                discarded.Asset.VoiceKey,
                discarded.Asset.Status,
                discarded.Reason);
        }

        var rankedCandidates = evaluations
            .Where(x => x.IsMatch)
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
                    ? "Audio asset resolved with procedural fallback. EventType={EventType} Language={Language} TeamSymbol={TeamSymbol} ContextKey={ContextKey} Intensity={Intensity} VoiceKey={VoiceKey} AssetId={AssetId} SpecificityScore={SpecificityScore} Reason={Reason}"
                    : "Audio asset resolved with exact procedural hit. EventType={EventType} Language={Language} TeamSymbol={TeamSymbol} ContextKey={ContextKey} Intensity={Intensity} VoiceKey={VoiceKey} AssetId={AssetId} SpecificityScore={SpecificityScore} Reason={Reason}",
                normalized.EventType,
                normalized.Language,
                normalized.TeamSymbol,
                normalized.ContextKey,
                normalized.Intensity,
                normalized.VoiceKey,
                ranked.Asset.Id,
                ranked.SpecificityScore,
                ranked.Reason);
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
            CandidateCount: availableCandidates.Count,
            RankedCandidateIds: rankedCandidates.Select(x => x.Asset.Id).ToArray(),
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

    private static EvaluatedAudioAsset Evaluate(AudioAsset asset, AudioResolveRequest request)
    {
        var score = 0;
        var fallbackUsed = false;
        var reasons = new List<string>();

        if (!TryScore("team_symbol", asset.TeamSymbol, request.TeamSymbol, 16, ref score, ref fallbackUsed, reasons, normalizer: AudioRequestNormalizer.NormalizeTeamSymbol))
            return new EvaluatedAudioAsset(asset, false, fallbackUsed, score, string.Join("; ", reasons));

        if (!TryScore("context_key", asset.ContextKey, request.ContextKey, 8, ref score, ref fallbackUsed, reasons))
            return new EvaluatedAudioAsset(asset, false, fallbackUsed, score, string.Join("; ", reasons));

        if (!TryScore("intensity", asset.Intensity, request.Intensity, 4, ref score, ref fallbackUsed, reasons))
            return new EvaluatedAudioAsset(asset, false, fallbackUsed, score, string.Join("; ", reasons));

        if (!TryScore("voice_key", asset.VoiceKey, request.VoiceKey, 2, ref score, ref fallbackUsed, reasons))
            return new EvaluatedAudioAsset(asset, false, fallbackUsed, score, string.Join("; ", reasons));

        reasons.Add(fallbackUsed ? "matched with fallback" : "exact/high-specificity match");
        return new EvaluatedAudioAsset(asset, true, fallbackUsed, score, string.Join("; ", reasons));
    }

    private static bool TryScore(
        string dimension,
        string? assetValue,
        string? requestValue,
        int exactScore,
        ref int score,
        ref bool fallbackUsed,
        List<string> reasons,
        Func<string?, string?>? normalizer = null,
        bool upper = false)
    {
        var normalizedAsset = normalizer is not null
            ? normalizer(assetValue)
            : AudioRequestNormalizer.NormalizeToken(assetValue, upper);
        var normalizedRequest = normalizer is not null
            ? normalizer(requestValue)
            : AudioRequestNormalizer.NormalizeToken(requestValue, upper);

        if (normalizedRequest is null)
        {
            reasons.Add(normalizedAsset is null
                ? $"{dimension}: request null, asset generic accepted"
                : $"{dimension}: request null, asset-specific value '{normalizedAsset}' accepted");
            return true;
        }

        if (normalizedAsset is null)
        {
            fallbackUsed = true;
            reasons.Add($"{dimension}: request '{normalizedRequest}' used generic fallback");
            return true;
        }

        if (!string.Equals(normalizedAsset, normalizedRequest, StringComparison.Ordinal))
        {
            reasons.Add($"{dimension}: asset '{normalizedAsset}' does not match request '{normalizedRequest}'");
            return false;
        }

        score += exactScore;
        reasons.Add($"{dimension}: exact match '{normalizedRequest}'");
        return true;
    }

    private sealed record EvaluatedAudioAsset(AudioAsset Asset, bool IsMatch, bool FallbackUsed, int SpecificityScore, string Reason);
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
