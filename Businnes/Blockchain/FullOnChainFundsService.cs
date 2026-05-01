using EthicAI.EntityModel;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace BLL.Blockchain;

public sealed class FullOnChainFundsService : FundsServiceBase, ICriptoVersusFundsService
{
    public FullOnChainFundsService(
        EthicAIDbContext db,
        ILedgerService ledgerService,
        IOptions<CriptoVersusBlockchainOptions> options,
        ILogger<FullOnChainFundsService> logger)
        : base(db, ledgerService, options, logger)
    {
    }

    public Task<OperationResult> EnsureUserAccountAsync(string wallet) => NotImplementedAsync();
    public Task<OperationResult> DepositAsync(string wallet, decimal amount, string? transactionSignature = null) => NotImplementedAsync();
    public Task<OperationResult> WithdrawAsync(string wallet, decimal amount) => NotImplementedAsync();
    public Task<OperationResult> LockBetAmountAsync(string wallet, long matchId, long teamId, decimal amount) => NotImplementedAsync();
    public Task<OperationResult> SettleBetAsync(long betId, decimal payoutAmount, bool isWinner) => NotImplementedAsync();
    public Task<OperationResult> ReleasePayoutAsync(string wallet, decimal amount, string reason) => NotImplementedAsync();

    private Task<OperationResult> NotImplementedAsync()
    {
        Options.ValidateForRuntime();
        Logger.LogWarning("FullOnChain mode requested before implementation is available. ProgramId={ProgramId}", Options.FutureFullOnChainProgramId);
        throw new NotImplementedException("FullOnChain mode not implemented yet.");
    }
}
