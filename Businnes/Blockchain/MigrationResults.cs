namespace BLL.Blockchain;

public sealed class MigrationPreviewResult
{
    public BlockchainOperationMode FromMode { get; init; }
    public BlockchainOperationMode ToMode { get; init; }
    public int TotalUsers { get; init; }
    public decimal TotalAvailableBalance { get; init; }
    public decimal TotalLockedBalance { get; init; }
    public decimal TotalSystemBalance { get; init; }
    public int LedgerLastId { get; init; }
    public bool LockedByConfiguration { get; init; }
    public string SummaryHash { get; init; } = string.Empty;
}

public sealed class MigrationBatchResult
{
    public long BatchId { get; init; }
    public BlockchainOperationMode FromMode { get; init; }
    public BlockchainOperationMode ToMode { get; init; }
    public int TotalUsers { get; init; }
    public decimal TotalAvailableBalance { get; init; }
    public decimal TotalLockedBalance { get; init; }
    public decimal TotalSystemBalance { get; init; }
    public int LedgerLastId { get; init; }
    public string BatchHash { get; init; } = string.Empty;
    public string Status { get; init; } = string.Empty;
}

public sealed class MigrationValidationResult
{
    public long BatchId { get; init; }
    public bool IsValid { get; init; }
    public int TotalCheckpoints { get; init; }
    public int ValidCheckpoints { get; init; }
    public string BatchHash { get; init; } = string.Empty;
    public string Message { get; init; } = string.Empty;
}
