using DAL.NftFutebol;
using DTOs;
using EthicAI.EntityModel;
using Microsoft.EntityFrameworkCore;

namespace CriptoVersus.API.Services;

public interface IAudioAssetAdminService
{
    Task<AudioAssetAdminListResponseDto> GetAssetsAsync(AudioAssetAdminQueryDto query, CancellationToken ct = default);
    Task<AudioAssetAdminListItemDto?> GetAssetAsync(long id, CancellationToken ct = default);
    Task<AudioAssetFilesystemResponseDto> GetFilesystemAsync(CancellationToken ct = default);
    Task<AudioAssetAdminActionResultDto> DisableAsync(long id, string actorWallet, CancellationToken ct = default);
    Task<AudioAssetAdminActionResultDto> DeleteRecordAsync(long id, string actorWallet, CancellationToken ct = default);
    Task<AudioAssetAdminActionResultDto> DeleteFileAndRecordAsync(long id, string actorWallet, CancellationToken ct = default);
    Task<AudioAssetAdminActionResultDto> BulkDisableAsync(IReadOnlyCollection<long> ids, string actorWallet, CancellationToken ct = default);
    Task<AudioAssetAdminActionResultDto> BulkDeleteFileAndRecordAsync(IReadOnlyCollection<long> ids, string actorWallet, CancellationToken ct = default);
    Task<AudioAssetMaintenanceDisableSuspectResponseDto> DisableSuspectsAsync(AudioAssetMaintenanceDisableSuspectRequestDto request, string actorWallet, CancellationToken ct = default);
}

public sealed class AudioAssetAdminService : IAudioAssetAdminService
{
    private readonly EthicAIDbContext _db;
    private readonly IAudioStorageService _storage;
    private readonly ILogger<AudioAssetAdminService> _logger;

    public AudioAssetAdminService(
        EthicAIDbContext db,
        IAudioStorageService storage,
        ILogger<AudioAssetAdminService> logger)
    {
        _db = db;
        _storage = storage;
        _logger = logger;
    }

    public async Task<AudioAssetAdminListResponseDto> GetAssetsAsync(AudioAssetAdminQueryDto query, CancellationToken ct = default)
    {
        var page = Math.Max(1, query.Page);
        var pageSize = Math.Clamp(query.PageSize, 1, 200);
        var containsText = string.IsNullOrWhiteSpace(query.ContainsText) ? null : query.ContainsText.Trim();

        var dbQuery = _db.AudioAsset.AsNoTracking().AsQueryable();

        if (!string.IsNullOrWhiteSpace(query.EventType))
            dbQuery = dbQuery.Where(x => x.EventType == query.EventType);

        if (!string.IsNullOrWhiteSpace(query.Language))
            dbQuery = dbQuery.Where(x => x.Language == query.Language);

        if (!string.IsNullOrWhiteSpace(query.TeamSymbol))
            dbQuery = dbQuery.Where(x => x.TeamSymbol == query.TeamSymbol);

        if (!string.IsNullOrWhiteSpace(query.NormalizedSymbol))
            dbQuery = dbQuery.Where(x => x.NormalizedSymbol == query.NormalizedSymbol);

        if (!string.IsNullOrWhiteSpace(query.TeamName))
            dbQuery = dbQuery.Where(x => x.TeamName != null && EF.Functions.ILike(x.TeamName, $"%{query.TeamName.Trim()}%"));

        if (!string.IsNullOrWhiteSpace(query.Status))
            dbQuery = dbQuery.Where(x => x.Status == query.Status);

        if (query.CreatedAfterUtc.HasValue)
            dbQuery = dbQuery.Where(x => x.CreatedAtUtc >= query.CreatedAfterUtc.Value);

        if (query.CreatedBeforeUtc.HasValue)
            dbQuery = dbQuery.Where(x => x.CreatedAtUtc <= query.CreatedBeforeUtc.Value);

        if (!string.IsNullOrWhiteSpace(containsText))
        {
            dbQuery = dbQuery.Where(x =>
                (x.TextPrompt != null && EF.Functions.ILike(x.TextPrompt, $"%{containsText}%"))
                || EF.Functions.ILike(x.AudioUrl, $"%{containsText}%")
                || EF.Functions.ILike(x.RelativePath, $"%{containsText}%")
                || EF.Functions.ILike(x.FileName, $"%{containsText}%")
                || (x.RawSymbol != null && EF.Functions.ILike(x.RawSymbol, $"%{containsText}%"))
                || (x.NormalizedSymbol != null && EF.Functions.ILike(x.NormalizedSymbol, $"%{containsText}%"))
                || (x.TeamName != null && EF.Functions.ILike(x.TeamName, $"%{containsText}%"))
                || (x.TeamSymbol != null && EF.Functions.ILike(x.TeamSymbol, $"%{containsText}%")));
        }

        var materialized = await dbQuery
            .OrderByDescending(x => x.CreatedAtUtc)
            .ThenByDescending(x => x.Id)
            .ToListAsync(ct);

        var mapped = materialized
            .Select(Map)
            .Where(x => query.SuspectsOnly != true || x.IsSuspect)
            .ToList();

        var filesystem = await GetFilesystemAsync(ct);
        var totalAssetsInDatabase = await _db.AudioAsset.AsNoTracking().CountAsync(ct);
        var totalDisabled = await _db.AudioAsset.AsNoTracking().CountAsync(x => x.Status == AudioAssetStatus.Disabled, ct);
        var totalReady = await _db.AudioAsset.AsNoTracking().CountAsync(x => x.Status == AudioAssetStatus.Ready, ct);
        var totalOrphans = mapped.Count(x => x.IsOrphan);

        var totalCount = mapped.Count;
        var pageItems = mapped
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .ToList();

        return new AudioAssetAdminListResponseDto
        {
            Page = page,
            PageSize = pageSize,
            TotalCount = totalCount,
            Summary = new AudioAssetAdminSummaryDto
            {
                TotalAssetsInDatabase = totalAssetsInDatabase,
                TotalPhysicalFiles = filesystem.TotalFiles,
                TotalOrphans = totalOrphans,
                TotalDisabled = totalDisabled,
                TotalReady = totalReady,
                TotalDirectoryBytes = filesystem.TotalDirectoryBytes,
                AudioRootPath = filesystem.AudioRootPath
            },
            Items = pageItems
        };
    }

    public async Task<AudioAssetAdminListItemDto?> GetAssetAsync(long id, CancellationToken ct = default)
    {
        var asset = await _db.AudioAsset.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id, ct);
        return asset is null ? null : Map(asset);
    }

    public Task<AudioAssetFilesystemResponseDto> GetFilesystemAsync(CancellationToken ct = default)
    {
        var entries = _storage.EnumerateStoredAudioFiles();
        var response = new AudioAssetFilesystemResponseDto
        {
            AudioRootPath = _storage.GetPrimaryAudioRootPath() ?? string.Empty,
            TotalFiles = entries.Count,
            TotalDirectoryBytes = entries.Sum(x => x.SizeBytes),
            Items = entries.Select(x => new AudioAssetFilesystemEntryDto
            {
                FileName = x.FileName,
                RelativePath = x.RelativePath,
                FullPath = x.FullPath,
                Exists = x.Exists,
                SizeBytes = x.SizeBytes,
                LastModifiedUtc = x.LastModifiedUtc,
                PublicUrl = x.PublicUrl
            }).ToList()
        };

        return Task.FromResult(response);
    }

    public async Task<AudioAssetAdminActionResultDto> DisableAsync(long id, string actorWallet, CancellationToken ct = default)
    {
        var asset = await _db.AudioAsset.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (asset is null)
            return NotFound(id);

        if (asset.Status != AudioAssetStatus.Disabled)
        {
            asset.Status = AudioAssetStatus.Disabled;
            asset.UpdatedAtUtc = DateTime.UtcNow;
            await _db.SaveChangesAsync(ct);
        }

        _logger.LogInformation(
            "ADMIN_AUDIO_ASSET_DISABLED assetId={AssetId} wallet={Wallet} relativePath={RelativePath}",
            asset.Id,
            actorWallet,
            asset.RelativePath);

        return Success("Asset desabilitado com seguranca.", [asset.Id]);
    }

    public async Task<AudioAssetAdminActionResultDto> DeleteRecordAsync(long id, string actorWallet, CancellationToken ct = default)
    {
        var asset = await _db.AudioAsset.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (asset is null)
            return NotFound(id);

        _db.AudioAsset.Remove(asset);
        await _db.SaveChangesAsync(ct);

        _logger.LogWarning(
            "ADMIN_AUDIO_ASSET_RECORD_DELETED assetId={AssetId} wallet={Wallet} relativePath={RelativePath}",
            asset.Id,
            actorWallet,
            asset.RelativePath);

        return Success("Registro removido. O arquivo fisico foi preservado.", [id]);
    }

    public async Task<AudioAssetAdminActionResultDto> DeleteFileAndRecordAsync(long id, string actorWallet, CancellationToken ct = default)
    {
        var asset = await _db.AudioAsset.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (asset is null)
            return NotFound(id);

        var deleteResult = await _storage.DeleteStoredAudioAsync(asset.RelativePath, ct);
        _db.AudioAsset.Remove(asset);
        await _db.SaveChangesAsync(ct);

        _logger.LogWarning(
            "ADMIN_AUDIO_ASSET_FILE_AND_RECORD_DELETED assetId={AssetId} wallet={Wallet} relativePath={RelativePath} deletedPaths={DeletedCount} missingPaths={MissingCount}",
            asset.Id,
            actorWallet,
            asset.RelativePath,
            deleteResult.DeletedPaths.Count,
            deleteResult.MissingPaths.Count);

        return Success("Arquivo fisico e registro removidos.", [id]);
    }

    public async Task<AudioAssetAdminActionResultDto> BulkDisableAsync(IReadOnlyCollection<long> ids, string actorWallet, CancellationToken ct = default)
    {
        var normalizedIds = NormalizeIds(ids);
        if (normalizedIds.Length == 0)
            return new AudioAssetAdminActionResultDto { Success = false, Message = "Nenhum asset selecionado." };

        var assets = await _db.AudioAsset.Where(x => normalizedIds.Contains(x.Id)).ToListAsync(ct);
        var nowUtc = DateTime.UtcNow;
        foreach (var asset in assets)
        {
            asset.Status = AudioAssetStatus.Disabled;
            asset.UpdatedAtUtc = nowUtc;
        }

        await _db.SaveChangesAsync(ct);

        _logger.LogInformation(
            "ADMIN_AUDIO_ASSET_BULK_DISABLED wallet={Wallet} affectedCount={AffectedCount} assetIds={AssetIds}",
            actorWallet,
            assets.Count,
            string.Join(",", assets.Select(x => x.Id)));

        return Success("Assets selecionados foram desabilitados.", assets.Select(x => x.Id).ToArray());
    }

    public async Task<AudioAssetAdminActionResultDto> BulkDeleteFileAndRecordAsync(IReadOnlyCollection<long> ids, string actorWallet, CancellationToken ct = default)
    {
        var normalizedIds = NormalizeIds(ids);
        if (normalizedIds.Length == 0)
            return new AudioAssetAdminActionResultDto { Success = false, Message = "Nenhum asset selecionado." };

        var assets = await _db.AudioAsset.Where(x => normalizedIds.Contains(x.Id)).ToListAsync(ct);
        foreach (var asset in assets)
            await _storage.DeleteStoredAudioAsync(asset.RelativePath, ct);

        _db.AudioAsset.RemoveRange(assets);
        await _db.SaveChangesAsync(ct);

        _logger.LogWarning(
            "ADMIN_AUDIO_ASSET_BULK_FILE_AND_RECORD_DELETED wallet={Wallet} affectedCount={AffectedCount} assetIds={AssetIds}",
            actorWallet,
            assets.Count,
            string.Join(",", assets.Select(x => x.Id)));

        return Success("Assets selecionados tiveram arquivo e registro removidos.", assets.Select(x => x.Id).ToArray());
    }

    public async Task<AudioAssetMaintenanceDisableSuspectResponseDto> DisableSuspectsAsync(
        AudioAssetMaintenanceDisableSuspectRequestDto request,
        string actorWallet,
        CancellationToken ct = default)
    {
        var rules = AudioAssetSuspicionInspector.NormalizeRules(request.Rules);
        var candidates = await _db.AudioAsset
            .Where(x => x.Status != AudioAssetStatus.Disabled)
            .OrderByDescending(x => x.CreatedAtUtc)
            .ToListAsync(ct);

        var matchedIds = candidates
            .Where(x => AudioAssetSuspicionInspector.MatchesAny(x, rules))
            .Select(x => x.Id)
            .ToArray();

        if (!request.DryRun && matchedIds.Length > 0)
        {
            var nowUtc = DateTime.UtcNow;
            foreach (var asset in candidates.Where(x => matchedIds.Contains(x.Id)))
            {
                asset.Status = AudioAssetStatus.Disabled;
                asset.UpdatedAtUtc = nowUtc;
            }

            await _db.SaveChangesAsync(ct);

            _logger.LogWarning(
                "ADMIN_AUDIO_ASSET_RULE_DISABLE wallet={Wallet} affectedCount={AffectedCount} rules={Rules}",
                actorWallet,
                matchedIds.Length,
                string.Join(",", rules));
        }

        return new AudioAssetMaintenanceDisableSuspectResponseDto
        {
            DryRun = request.DryRun,
            AffectedCount = matchedIds.Length,
            AssetIds = matchedIds,
            Rules = rules
        };
    }

    private AudioAssetAdminListItemDto Map(AudioAsset asset)
    {
        var suspectRules = AudioAssetSuspicionInspector.Evaluate(asset);
        var storageInfo = _storage.InspectStoredAudio(asset.RelativePath);
        var isOrphan = !storageInfo.Exists;

        _logger.LogInformation(
            "ADMIN_AUDIO_ASSET_DIAGNOSTIC assetId={AssetId} relativePath={RelativePath} physicalPath={PhysicalPath} fileExists={FileExists} publicUrl={PublicUrl} orphanReason={OrphanReason}",
            asset.Id,
            asset.RelativePath,
            storageInfo.PhysicalPath,
            storageInfo.Exists,
            storageInfo.PublicUrl,
            storageInfo.OrphanReason ?? string.Empty);

        return new AudioAssetAdminListItemDto
        {
            Id = asset.Id,
            EventType = asset.EventType,
            Language = asset.Language,
            RawSymbol = asset.RawSymbol,
            NormalizedSymbol = asset.NormalizedSymbol,
            TeamName = asset.TeamName,
            TeamSymbol = asset.TeamSymbol,
            ContextKey = asset.ContextKey,
            Intensity = asset.Intensity,
            VoiceKey = asset.VoiceKey,
            TextPrompt = asset.TextPrompt,
            AudioUrl = asset.AudioUrl,
            ResolvedAudioUrl = storageInfo.PublicUrl,
            RelativePath = asset.RelativePath,
            PhysicalPath = storageInfo.PhysicalPath,
            FileName = asset.FileName,
            Status = asset.Status,
            CreatedAtUtc = asset.CreatedAtUtc,
            UsageCount = asset.UsageCount,
            DurationMs = asset.DurationMs,
            FileSizeBytes = asset.FileSizeBytes,
            HasPhysicalFile = storageInfo.Exists,
            PublicUrlValid = storageInfo.Exists && !string.IsNullOrWhiteSpace(storageInfo.PublicUrl),
            IsOrphan = isOrphan,
            OrphanReason = storageInfo.OrphanReason,
            IsSuspect = suspectRules.Count > 0,
            SuspectRules = suspectRules,
            GenerationSource = asset.GenerationSource
        };
    }

    private static AudioAssetAdminActionResultDto Success(string message, IReadOnlyList<long> ids)
        => new()
        {
            Success = true,
            Message = message,
            AffectedCount = ids.Count,
            AssetIds = ids
        };

    private static AudioAssetAdminActionResultDto NotFound(long id)
        => new()
        {
            Success = false,
            Message = $"Audio asset {id} nao encontrado.",
            AffectedCount = 0,
            AssetIds = Array.Empty<long>()
        };

    private static long[] NormalizeIds(IReadOnlyCollection<long> ids)
        => ids.Where(x => x > 0).Distinct().ToArray();
}
