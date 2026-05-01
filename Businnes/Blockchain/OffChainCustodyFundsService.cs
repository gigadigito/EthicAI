using EthicAI.EntityModel;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace BLL.Blockchain;

public sealed class OffChainCustodyFundsService : FundsServiceBase, ICriptoVersusFundsService
{
    public OffChainCustodyFundsService(
        EthicAIDbContext db,
        ILedgerService ledgerService,
        IOptions<CriptoVersusBlockchainOptions> options,
        ILogger<OffChainCustodyFundsService> logger)
        : base(db, ledgerService, options, logger)
    {
    }

    public Task<OperationResult> EnsureUserAccountAsync(string wallet)
    {
        var normalizedWallet = NormalizeWallet(wallet);
        Logger.LogInformation("OffChainCustody: wallet {Wallet} usa apenas identidade/login, sem initUserAccount.", normalizedWallet);
        return Task.FromResult(OperationResult.Success("Off-chain custody mode does not require on-chain user accounts."));
    }

    public async Task<OperationResult> DepositAsync(string wallet, decimal amount, string? transactionSignature = null)
    {
        var user = await RequireUserAsync(wallet);
        return await CreditUserAsync(
            user,
            amount,
            "DEPOSIT",
            string.IsNullOrWhiteSpace(transactionSignature)
                ? "Deposito off-chain registrado em custodia."
                : $"Deposito off-chain conciliado. Signature {transactionSignature}.",
            ct: default);
    }

    public async Task<OperationResult> WithdrawAsync(string wallet, decimal amount)
    {
        var user = await RequireUserAsync(wallet);
        return await DebitUserAsync(
            user,
            amount,
            "WITHDRAW",
            "Saque off-chain registrado para a carteira Solana do usuario.",
            mutateUser: current => current.TotalWithdrawn = RoundMoney(current.TotalWithdrawn + amount));
    }

    public async Task<OperationResult> LockBetAmountAsync(string wallet, long matchId, long teamId, decimal amount)
    {
        var user = await RequireUserAsync(wallet);
        return await DebitUserAsync(
            user,
            amount,
            "BET",
            $"Investimento reservado no match {matchId}, team {teamId}.");
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
            $"Bet {betId} liquidada em modo off-chain.",
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
            string.IsNullOrWhiteSpace(reason) ? "Payout liberado em modo off-chain." : reason,
            mutateUser: current => current.TotalClaimed = RoundMoney(current.TotalClaimed + amount));
    }
}
