using EthicAI.EntityModel;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace BLL.Blockchain;

public sealed class HybridContractCustodyFundsService : FundsServiceBase, ICriptoVersusFundsService
{
    public HybridContractCustodyFundsService(
        EthicAIDbContext db,
        ILedgerService ledgerService,
        IOptions<CriptoVersusBlockchainOptions> options,
        ILogger<HybridContractCustodyFundsService> logger)
        : base(db, ledgerService, options, logger)
    {
    }

    public Task<OperationResult> EnsureUserAccountAsync(string wallet)
    {
        Options.ValidateForRuntime();
        var normalizedWallet = NormalizeWallet(wallet);
        Logger.LogInformation(
            "HybridContractCustody: wallet {Wallet} deve usar initUserAccount quando necessario. ProgramId={ProgramId}",
            normalizedWallet,
            Options.CurrentHybridProgramId);

        return Task.FromResult(
            OperationResult.Success(
                "Hybrid contract custody mode uses the current contract onboarding flow.",
                metadata: new Dictionary<string, string>
                {
                    ["programId"] = Options.CurrentHybridProgramId
                }));
    }

    public Task<OperationResult> DepositAsync(string wallet, decimal amount, string? transactionSignature = null)
    {
        Options.ValidateForRuntime();
        Logger.LogInformation(
            "HybridContractCustody: deposito mantido no contrato atual. Wallet={Wallet}, Amount={Amount}, Signature={Signature}",
            wallet,
            amount,
            transactionSignature);

        return Task.FromResult(
            OperationResult.Success(
                "Hybrid custody deposit delegated to the current Solana contract flow.",
                transactionSignature: transactionSignature,
                amount: RoundMoney(amount)));
    }

    public async Task<OperationResult> WithdrawAsync(string wallet, decimal amount)
    {
        var user = await RequireUserAsync(wallet);
        return await DebitUserAsync(
            user,
            amount,
            "WITHDRAW",
            "Saque registrado para a carteira Solana do usuario.",
            mutateUser: current => current.TotalWithdrawn = RoundMoney(current.TotalWithdrawn + amount));
    }

    public async Task<OperationResult> LockBetAmountAsync(string wallet, long matchId, long teamId, decimal amount)
    {
        var user = await RequireUserAsync(wallet);
        return await DebitUserAsync(
            user,
            amount,
            "BET",
            $"Investimento reservado no modo hibrido para o match {matchId}, team {teamId}.");
    }

    public async Task<OperationResult> SettleBetAsync(long betId, decimal payoutAmount, bool isWinner)
    {
        var bet = await FindBetAsync(betId);
        if (bet is null)
            return OperationResult.Failure($"Bet {betId} não encontrada.", "BET_NOT_FOUND");

        bet.IsWinner = isWinner;
        bet.PayoutAmount = RoundMoney(payoutAmount);
        bet.SettledAt = DateTime.UtcNow;
        bet.Claimed = false;
        bet.ClaimedAt = null;

        await Db.SaveChangesAsync();

        return OperationResult.Success(
            $"Bet {betId} liquidada em modo hibrido.",
            amount: bet.PayoutAmount,
            referenceId: bet.BetId);
    }

    public async Task<OperationResult> ReleasePayoutAsync(string wallet, decimal amount, string reason)
    {
        var user = await RequireUserAsync(wallet);
        return await CreditUserAsync(
            user,
            amount,
            "CLAIM",
            string.IsNullOrWhiteSpace(reason) ? "Claim liberado no modo hibrido." : reason,
            mutateUser: current => current.TotalClaimed = RoundMoney(current.TotalClaimed + amount));
    }
}
