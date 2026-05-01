using DAL;
using DAL.NftFutebol;
using EthicAI.EntityModel;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace BLL.Blockchain;

public abstract class FundsServiceBase
{
    protected readonly EthicAIDbContext Db;
    protected readonly ILedgerService LedgerService;
    protected readonly CriptoVersusBlockchainOptions Options;
    protected readonly ILogger Logger;

    protected FundsServiceBase(
        EthicAIDbContext db,
        ILedgerService ledgerService,
        IOptions<CriptoVersusBlockchainOptions> options,
        ILogger logger)
    {
        Db = db;
        LedgerService = ledgerService;
        Options = options.Value;
        Logger = logger;
    }

    protected async Task<User> RequireUserAsync(string wallet, CancellationToken ct = default)
    {
        var normalizedWallet = NormalizeWallet(wallet);
        var user = await Db.User.FirstOrDefaultAsync(x => x.Wallet == normalizedWallet, ct);

        if (user is null)
            throw new InvalidOperationException($"Wallet '{normalizedWallet}' não encontrada.");

        return user;
    }

    protected static string NormalizeWallet(string wallet)
    {
        if (string.IsNullOrWhiteSpace(wallet))
            throw new InvalidOperationException("Wallet é obrigatória.");

        return wallet.Trim();
    }

    protected static decimal RoundMoney(decimal value)
        => Math.Round(value, 8, MidpointRounding.ToZero);

    protected async Task<OperationResult> CreditUserAsync(
        User user,
        decimal amount,
        string ledgerType,
        string description,
        int? referenceId = null,
        Action<User>? mutateUser = null,
        CancellationToken ct = default)
    {
        var roundedAmount = RoundMoney(amount);
        var balanceBefore = user.Balance;
        user.Balance = RoundMoney(user.Balance + roundedAmount);
        user.DtUpdate = DateTime.UtcNow;
        mutateUser?.Invoke(user);

        await Db.SaveChangesAsync(ct);
        await LedgerService.AddEntryAsync(
            user,
            ledgerType,
            roundedAmount,
            balanceBefore,
            user.Balance,
            referenceId,
            description,
            ct);

        return OperationResult.Success(
            description,
            amount: roundedAmount,
            balanceBefore: balanceBefore,
            balanceAfter: user.Balance,
            referenceId: referenceId);
    }

    protected async Task<OperationResult> DebitUserAsync(
        User user,
        decimal amount,
        string ledgerType,
        string description,
        int? referenceId = null,
        Action<User>? mutateUser = null,
        CancellationToken ct = default)
    {
        var roundedAmount = RoundMoney(amount);
        if (roundedAmount <= 0m)
            return OperationResult.Failure("O valor deve ser maior que zero.", "INVALID_AMOUNT");

        if (user.Balance < roundedAmount)
        {
            return OperationResult.Failure(
                $"Saldo insuficiente. Balance={user.Balance:0.########} Requested={roundedAmount:0.########}",
                "INSUFFICIENT_BALANCE");
        }

        var balanceBefore = user.Balance;
        user.Balance = RoundMoney(user.Balance - roundedAmount);
        user.DtUpdate = DateTime.UtcNow;
        mutateUser?.Invoke(user);

        await Db.SaveChangesAsync(ct);
        await LedgerService.AddEntryAsync(
            user,
            ledgerType,
            -roundedAmount,
            balanceBefore,
            user.Balance,
            referenceId,
            description,
            ct);

        return OperationResult.Success(
            description,
            amount: roundedAmount,
            balanceBefore: balanceBefore,
            balanceAfter: user.Balance,
            referenceId: referenceId);
    }

    protected async Task<Bet?> FindBetAsync(long betId, CancellationToken ct = default)
    {
        return await Db.Bet.FirstOrDefaultAsync(x => x.BetId == betId, ct);
    }
}
