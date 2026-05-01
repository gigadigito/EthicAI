using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using DAL.NftFutebol;
using EthicAI.EntityModel;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace BLL.Blockchain;

public sealed class FundMigrationService : IFundMigrationService
{
    private readonly EthicAIDbContext _db;
    private readonly CriptoVersusBlockchainOptions _options;
    private readonly ILogger<FundMigrationService> _logger;

    public FundMigrationService(
        EthicAIDbContext db,
        IOptions<CriptoVersusBlockchainOptions> options,
        ILogger<FundMigrationService> logger)
    {
        _db = db;
        _options = options.Value;
        _logger = logger;
    }

    public async Task<MigrationPreviewResult> PreviewMigrationAsync(BlockchainOperationMode from, BlockchainOperationMode to)
    {
        EnsureMigrationAllowed(previewOnly: true);
        var snapshot = await BuildSnapshotAsync(from, to);

        return new MigrationPreviewResult
        {
            FromMode = from,
            ToMode = to,
            TotalUsers = snapshot.TotalUsers,
            TotalAvailableBalance = snapshot.TotalAvailableBalance,
            TotalLockedBalance = snapshot.TotalLockedBalance,
            TotalSystemBalance = snapshot.TotalSystemBalance,
            LedgerLastId = snapshot.LedgerLastId,
            LockedByConfiguration = _options.MigrationLockEnabled,
            SummaryHash = snapshot.BatchHash
        };
    }

    public async Task<MigrationBatchResult> CreateMigrationSnapshotAsync(BlockchainOperationMode from, BlockchainOperationMode to)
    {
        EnsureMigrationAllowed(previewOnly: false);
        var snapshot = await BuildSnapshotAsync(from, to);
        var nowUtc = DateTime.UtcNow;

        var batch = new FinancialMigrationBatch
        {
            FromMode = from.ToString(),
            ToMode = to.ToString(),
            TotalUsers = snapshot.TotalUsers,
            TotalAvailableBalance = snapshot.TotalAvailableBalance,
            TotalLockedBalance = snapshot.TotalLockedBalance,
            TotalSystemBalance = snapshot.TotalSystemBalance,
            LedgerLastId = snapshot.LedgerLastId,
            BatchHash = snapshot.BatchHash,
            Status = "SNAPSHOT_CREATED",
            CreatedAt = nowUtc
        };

        _db.FinancialMigrationBatch.Add(batch);
        await _db.SaveChangesAsync();

        foreach (var checkpoint in snapshot.Checkpoints)
            checkpoint.BatchId = batch.Id;

        _db.FundMigrationCheckpoint.AddRange(snapshot.Checkpoints);
        await _db.SaveChangesAsync();

        _logger.LogInformation(
            "Migration snapshot created. BatchId={BatchId}, From={FromMode}, To={ToMode}, Users={TotalUsers}, Hash={BatchHash}",
            batch.Id,
            from,
            to,
            batch.TotalUsers,
            batch.BatchHash);

        return new MigrationBatchResult
        {
            BatchId = batch.Id,
            FromMode = from,
            ToMode = to,
            TotalUsers = batch.TotalUsers,
            TotalAvailableBalance = batch.TotalAvailableBalance,
            TotalLockedBalance = batch.TotalLockedBalance,
            TotalSystemBalance = batch.TotalSystemBalance,
            LedgerLastId = batch.LedgerLastId,
            BatchHash = batch.BatchHash,
            Status = batch.Status
        };
    }

    public async Task<MigrationValidationResult> ValidateMigrationSnapshotAsync(long batchId)
    {
        var batch = await _db.FinancialMigrationBatch.FirstOrDefaultAsync(x => x.Id == batchId);
        if (batch is null)
        {
            return new MigrationValidationResult
            {
                BatchId = batchId,
                IsValid = false,
                Message = $"Batch {batchId} não encontrado."
            };
        }

        var checkpoints = await _db.FundMigrationCheckpoint
            .Where(x => x.BatchId == batchId)
            .ToListAsync();

        var validCount = checkpoints.Count(x => string.Equals(x.MigrationHash, BuildCheckpointHash(x), StringComparison.OrdinalIgnoreCase));
        var isValid = validCount == checkpoints.Count && string.Equals(batch.BatchHash, BuildBatchHash(checkpoints, batch), StringComparison.OrdinalIgnoreCase);

        return new MigrationValidationResult
        {
            BatchId = batchId,
            IsValid = isValid,
            TotalCheckpoints = checkpoints.Count,
            ValidCheckpoints = validCount,
            BatchHash = batch.BatchHash,
            Message = isValid ? "Snapshot validado com sucesso." : "Snapshot possui divergencias de hash."
        };
    }

    private void EnsureMigrationAllowed(bool previewOnly)
    {
        if (_options.MigrationLockEnabled)
            throw new InvalidOperationException("Migration snapshot is locked by configuration.");

        if (previewOnly && !_options.EnableMigrationPreview)
            throw new InvalidOperationException("Migration preview is disabled by configuration.");

        if (!previewOnly && !_options.EnableMigrationSnapshot)
            throw new InvalidOperationException("Migration snapshot creation is disabled by configuration.");
    }

    private async Task<MigrationSnapshotData> BuildSnapshotAsync(BlockchainOperationMode from, BlockchainOperationMode to)
    {
        var totalUsers = await _db.User.AsNoTracking().CountAsync();
        var totalAvailableBalance = await _db.User.AsNoTracking().SumAsync(x => (decimal?)x.Balance) ?? 0m;
        var totalLockedBalance = await _db.UserTeamPosition
            .AsNoTracking()
            .Where(x => x.Status == TeamPositionStatus.Active || x.Status == TeamPositionStatus.ClosingRequested)
            .SumAsync(x => (decimal?)x.CurrentCapital) ?? 0m;
        var totalSystemBalance = RoundMoney(totalAvailableBalance + totalLockedBalance);
        var ledgerLastId = await _db.Ledger.AsNoTracking().MaxAsync(x => (int?)x.Id) ?? 0;

        var users = await _db.User
            .AsNoTracking()
            .OrderBy(x => x.UserID)
            .Select(x => new
            {
                x.UserID,
                x.Wallet,
                x.Balance
            })
            .ToListAsync();

        var positionMap = await _db.UserTeamPosition
            .AsNoTracking()
            .Where(x => x.Status == TeamPositionStatus.Active || x.Status == TeamPositionStatus.ClosingRequested)
            .GroupBy(x => x.UserId)
            .Select(g => new
            {
                UserId = g.Key,
                LockedBalance = g.Sum(x => x.CurrentCapital)
            })
            .ToDictionaryAsync(x => x.UserId, x => x.LockedBalance);

        var checkpoints = new List<FundMigrationCheckpoint>(users.Count);
        foreach (var user in users)
        {
            var lockedBalance = positionMap.TryGetValue(user.UserID, out var currentLocked) ? currentLocked : 0m;
            var checkpoint = new FundMigrationCheckpoint
            {
                TxWallet = user.Wallet,
                OldMode = from.ToString(),
                NewMode = to.ToString(),
                BalanceBefore = RoundMoney(user.Balance),
                LockedBalanceBefore = RoundMoney(lockedBalance),
                SystemBalanceBefore = RoundMoney(user.Balance + lockedBalance),
                LedgerLastId = ledgerLastId,
                Status = "SNAPSHOT_CREATED",
                CreatedAt = DateTime.UtcNow
            };
            checkpoint.MigrationHash = BuildCheckpointHash(checkpoint);
            checkpoints.Add(checkpoint);
        }

        var batchTemplate = new FinancialMigrationBatch
        {
            FromMode = from.ToString(),
            ToMode = to.ToString(),
            TotalUsers = totalUsers,
            TotalAvailableBalance = RoundMoney(totalAvailableBalance),
            TotalLockedBalance = RoundMoney(totalLockedBalance),
            TotalSystemBalance = totalSystemBalance,
            LedgerLastId = ledgerLastId
        };

        return new MigrationSnapshotData
        {
            TotalUsers = totalUsers,
            TotalAvailableBalance = batchTemplate.TotalAvailableBalance,
            TotalLockedBalance = batchTemplate.TotalLockedBalance,
            TotalSystemBalance = batchTemplate.TotalSystemBalance,
            LedgerLastId = ledgerLastId,
            Checkpoints = checkpoints,
            BatchHash = BuildBatchHash(checkpoints, batchTemplate)
        };
    }

    private static string BuildCheckpointHash(FundMigrationCheckpoint checkpoint)
    {
        var raw = string.Join("|", [
            checkpoint.TxWallet,
            checkpoint.OldMode,
            checkpoint.NewMode,
            checkpoint.BalanceBefore.ToString("0.########", CultureInfo.InvariantCulture),
            checkpoint.LockedBalanceBefore.ToString("0.########", CultureInfo.InvariantCulture),
            checkpoint.SystemBalanceBefore.ToString("0.########", CultureInfo.InvariantCulture),
            checkpoint.LedgerLastId.ToString(CultureInfo.InvariantCulture)
        ]);

        return ComputeSha256(raw);
    }

    private static string BuildBatchHash(IEnumerable<FundMigrationCheckpoint> checkpoints, FinancialMigrationBatch batch)
    {
        var checkpointHash = string.Join("|", checkpoints.OrderBy(x => x.TxWallet).Select(x => x.MigrationHash));
        var raw = string.Join("|", [
            batch.FromMode,
            batch.ToMode,
            batch.TotalUsers.ToString(CultureInfo.InvariantCulture),
            batch.TotalAvailableBalance.ToString("0.########", CultureInfo.InvariantCulture),
            batch.TotalLockedBalance.ToString("0.########", CultureInfo.InvariantCulture),
            batch.TotalSystemBalance.ToString("0.########", CultureInfo.InvariantCulture),
            batch.LedgerLastId.ToString(CultureInfo.InvariantCulture),
            checkpointHash
        ]);

        return ComputeSha256(raw);
    }

    private static string ComputeSha256(string raw)
    {
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(raw));
        return Convert.ToHexString(bytes);
    }

    private static decimal RoundMoney(decimal value)
        => Math.Round(value, 8, MidpointRounding.ToZero);

    private sealed class MigrationSnapshotData
    {
        public int TotalUsers { get; init; }
        public decimal TotalAvailableBalance { get; init; }
        public decimal TotalLockedBalance { get; init; }
        public decimal TotalSystemBalance { get; init; }
        public int LedgerLastId { get; init; }
        public string BatchHash { get; init; } = string.Empty;
        public List<FundMigrationCheckpoint> Checkpoints { get; init; } = [];
    }
}
