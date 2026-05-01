using System.Globalization;

namespace BLL.Blockchain;

public sealed class CriptoVersusBlockchainOptions
{
    public const string SectionName = "CriptoVersusBlockchain";

    public BlockchainOperationMode Mode { get; set; } = BlockchainOperationMode.HybridContractCustody;

    public string Cluster { get; set; } = "devnet";
    public string RpcUrl { get; set; } = "https://api.devnet.solana.com";

    public string CurrentHybridProgramId { get; set; } = "2xGqwZH6wwfL5q12ftd2weu8zsYcmEZ8wFVWHjPY25FV";
    public string FutureFullOnChainProgramId { get; set; } = "";

    public string ContractAuthorityPublicKey { get; set; } = "GgbL9aYEAcZycbqFnJ8jnBxYEwu3jn8L2Ss8UbrN31Sc";
    public string FutureContractAuthorityPublicKey { get; set; } = "";

    public string CustodyWalletPublicKey { get; set; } = "";
    public string CustodyWalletLabel { get; set; } = "CriptoVersus Beta Custody";

    public bool EnableOffChainCustody { get; set; } = true;
    public bool EnableHybridContractCustody { get; set; } = true;
    public bool EnableFullOnChain { get; set; } = false;

    public bool EnableOnChainDeposits { get; set; } = true;
    public bool EnableOnChainWithdrawals { get; set; } = true;
    public bool EnableOnChainBets { get; set; } = false;
    public bool EnableOnChainSettlement { get; set; } = false;

    public bool RequireOnChainConfirmation { get; set; } = true;
    public bool AllowFallbackToOffChain { get; set; } = false;

    public bool MigrationLockEnabled { get; set; } = false;
    public bool EnableMigrationPreview { get; set; } = true;
    public bool EnableMigrationSnapshot { get; set; } = true;

    public bool IsOffChainCustodyMode => Mode == BlockchainOperationMode.OffChainCustody;
    public bool IsHybridContractCustodyMode => Mode == BlockchainOperationMode.HybridContractCustody;
    public bool IsFullOnChainMode => Mode == BlockchainOperationMode.FullOnChain;
    public bool UsesOnChainContract => !IsOffChainCustodyMode;
    public bool ShouldInitializeUserAccount => UsesOnChainContract;

    public bool IsModeEnabled()
        => Mode switch
        {
            BlockchainOperationMode.OffChainCustody => EnableOffChainCustody,
            BlockchainOperationMode.HybridContractCustody => EnableHybridContractCustody,
            BlockchainOperationMode.FullOnChain => EnableFullOnChain,
            _ => false
        };

    public string GetActiveProgramId()
        => Mode switch
        {
            BlockchainOperationMode.HybridContractCustody => CurrentHybridProgramId?.Trim() ?? string.Empty,
            BlockchainOperationMode.FullOnChain => FutureFullOnChainProgramId?.Trim() ?? string.Empty,
            _ => string.Empty
        };

    public string GetActiveAuthorityPublicKey()
        => Mode switch
        {
            BlockchainOperationMode.FullOnChain => FutureContractAuthorityPublicKey?.Trim() ?? string.Empty,
            _ => ContractAuthorityPublicKey?.Trim() ?? string.Empty
        };

    public bool IsOnChainDepositFlowEnabled()
        => UsesOnChainContract && EnableOnChainDeposits;

    public bool IsOnChainWithdrawalFlowEnabled()
        => UsesOnChainContract && EnableOnChainWithdrawals;

    public bool IsOnChainBetFlowEnabled()
        => UsesOnChainContract && EnableOnChainBets;

    public bool IsOnChainSettlementFlowEnabled()
        => UsesOnChainContract && EnableOnChainSettlement;

    public void ValidateForRuntime()
    {
        if (!IsModeEnabled())
            throw new InvalidOperationException($"Blockchain mode '{Mode}' is disabled by configuration.");

        if (IsOffChainCustodyMode)
            return;

        if (IsFullOnChainMode && !EnableFullOnChain)
            throw new InvalidOperationException("FullOnChain mode requires EnableFullOnChain = true.");

        if (string.IsNullOrWhiteSpace(GetActiveProgramId()))
        {
            throw new InvalidOperationException(
                IsFullOnChainMode
                    ? "FullOnChain mode requires FutureFullOnChainProgramId to be configured."
                    : "HybridContractCustody mode requires CurrentHybridProgramId to be configured.");
        }
    }

    public string DescribeActiveProgram()
        => string.IsNullOrWhiteSpace(GetActiveProgramId()) ? "(none)" : GetActiveProgramId();

    public string DescribeCustodyWallet()
        => string.IsNullOrWhiteSpace(CustodyWalletPublicKey)
            ? "(not configured)"
            : $"{CustodyWalletLabel} [{CustodyWalletPublicKey}]";

    public string DescribeFlags()
    {
        return string.Create(
            CultureInfo.InvariantCulture,
            $"Deposits={EnableOnChainDeposits}, Withdrawals={EnableOnChainWithdrawals}, Bets={EnableOnChainBets}, Settlement={EnableOnChainSettlement}, RequireConfirmation={RequireOnChainConfirmation}, AllowFallbackToOffChain={AllowFallbackToOffChain}");
    }
}
