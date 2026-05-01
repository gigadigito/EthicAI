namespace BLL.Blockchain;

public interface IFundMigrationService
{
    Task<MigrationPreviewResult> PreviewMigrationAsync(BlockchainOperationMode from, BlockchainOperationMode to);
    Task<MigrationBatchResult> CreateMigrationSnapshotAsync(BlockchainOperationMode from, BlockchainOperationMode to);
    Task<MigrationValidationResult> ValidateMigrationSnapshotAsync(long batchId);
}
