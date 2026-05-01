namespace BLL.Blockchain;

public interface ICriptoVersusFundsService
{
    Task<OperationResult> EnsureUserAccountAsync(string wallet);
    Task<OperationResult> DepositAsync(string wallet, decimal amount, string? transactionSignature = null);
    Task<OperationResult> WithdrawAsync(string wallet, decimal amount);
    Task<OperationResult> LockBetAmountAsync(string wallet, long matchId, long teamId, decimal amount);
    Task<OperationResult> SettleBetAsync(long betId, decimal payoutAmount, bool isWinner);
    Task<OperationResult> ReleasePayoutAsync(string wallet, decimal amount, string reason);
}
