using BLL;
using BLL.Blockchain;
using CriptoVersus.API.Services;
using DAL;
using DAL.NftFutebol;
using DTOs;
using EthicAI.EntityModel;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;

namespace EthicAI.test;

public sealed class SystemBalanceWithdrawalServiceTests
{
    [Fact]
    public async Task Withdraw_WithAvailableBalance_DebitsOnlyAfterVerifiedTransaction()
    {
        await using var db = CreateDbContext();
        var user = await SeedUserAsync(db, "wallet-user-a", 12m);
        var service = CreateService(db, verifier: new FakeVerifier(success: true));

        var result = await service.WithdrawAsync(
            user,
            new WithdrawSystemBalanceRequest
            {
                Amount = 5m,
                OnChainSignature = "sig-ok-1",
                ConnectedWalletPublicKey = user.Wallet
            });

        var reloaded = await db.User.SingleAsync(x => x.UserID == user.UserID);
        Assert.Equal(7m, reloaded.Balance);
        Assert.Equal(5m, reloaded.TotalWithdrawn);
        Assert.Equal(5m, result.ProcessedAmount);
        Assert.Equal("Resgate concluido.", result.Message);
        Assert.Contains(await db.Ledger.Select(x => x.Type).ToListAsync(), x => x == SystemBalanceWithdrawalService.CompletedLedgerType);
    }

    [Fact]
    public async Task Withdraw_WithoutBalance_ReturnsControlledError()
    {
        await using var db = CreateDbContext();
        var user = await SeedUserAsync(db, "wallet-user-b", 0m);
        var service = CreateService(db, verifier: new FakeVerifier(success: true));

        var ex = await Assert.ThrowsAsync<WithdrawalFlowException>(() => service.WithdrawAsync(
            user,
            new WithdrawSystemBalanceRequest
            {
                Amount = 1m,
                OnChainSignature = "sig-no-balance",
                ConnectedWalletPublicKey = user.Wallet
            }));

        Assert.Equal("INSUFFICIENT_SYSTEM_BALANCE", ex.Code);
    }

    [Fact]
    public async Task Withdraw_WithDifferentWallet_ReturnsWalletMismatch()
    {
        await using var db = CreateDbContext();
        var user = await SeedUserAsync(db, "wallet-user-c", 8m);
        var service = CreateService(db, verifier: new FakeVerifier(success: true));

        var ex = await Assert.ThrowsAsync<WithdrawalFlowException>(() => service.WithdrawAsync(
            user,
            new WithdrawSystemBalanceRequest
            {
                Amount = 2m,
                OnChainSignature = "sig-wallet-mismatch",
                ConnectedWalletPublicKey = "other-wallet"
            }));

        Assert.Equal("WALLET_MISMATCH", ex.Code);
    }

    [Fact]
    public async Task Withdraw_WithInvalidSignature_DoesNotDebitAndRegistersFailure()
    {
        await using var db = CreateDbContext();
        var user = await SeedUserAsync(db, "wallet-user-d", 9m);
        var service = CreateService(db, verifier: new FakeVerifier(success: false, code: "WITHDRAW_PROOF_INVALID", message: "assinatura invalida"));

        var ex = await Assert.ThrowsAsync<WithdrawalFlowException>(() => service.WithdrawAsync(
            user,
            new WithdrawSystemBalanceRequest
            {
                Amount = 3m,
                OnChainSignature = "sig-invalid",
                ConnectedWalletPublicKey = user.Wallet
            }));

        var reloaded = await db.User.SingleAsync(x => x.UserID == user.UserID);
        Assert.Equal("WITHDRAW_PROOF_INVALID", ex.Code);
        Assert.Equal(9m, reloaded.Balance);
        Assert.Contains(await db.Ledger.Select(x => x.Type).ToListAsync(), x => x == SystemBalanceWithdrawalService.FailedLedgerType);
    }

    [Fact]
    public async Task Withdraw_WithDuplicateSignature_PreventsDoubleClickDuplicate()
    {
        await using var db = CreateDbContext();
        var user = await SeedUserAsync(db, "wallet-user-e", 10m);
        var service = CreateService(db, verifier: new FakeVerifier(success: true));

        await service.WithdrawAsync(
            user,
            new WithdrawSystemBalanceRequest
            {
                Amount = 4m,
                OnChainSignature = "sig-dup",
                ConnectedWalletPublicKey = user.Wallet
            });

        var ex = await Assert.ThrowsAsync<WithdrawalFlowException>(() => service.WithdrawAsync(
            user,
            new WithdrawSystemBalanceRequest
            {
                Amount = 4m,
                OnChainSignature = "sig-dup",
                ConnectedWalletPublicKey = user.Wallet
            }));

        var reloaded = await db.User.SingleAsync(x => x.UserID == user.UserID);
        Assert.Equal("DUPLICATE_SIGNATURE", ex.Code);
        Assert.Equal(6m, reloaded.Balance);
    }

    [Fact]
    public async Task Withdraw_AfterPreviousFailure_AllowsSafeRetry()
    {
        await using var db = CreateDbContext();
        var user = await SeedUserAsync(db, "wallet-user-f", 11m);
        var failingService = CreateService(db, verifier: new FakeVerifier(success: false, code: "RPC_FAILURE", message: "rpc falhou"));

        await Assert.ThrowsAsync<WithdrawalFlowException>(() => failingService.WithdrawAsync(
            user,
            new WithdrawSystemBalanceRequest
            {
                Amount = 2m,
                OnChainSignature = "sig-fail-first",
                ConnectedWalletPublicKey = user.Wallet
            }));

        var retryService = CreateService(db, verifier: new FakeVerifier(success: true));
        var result = await retryService.WithdrawAsync(
            user,
            new WithdrawSystemBalanceRequest
            {
                Amount = 2m,
                OnChainSignature = "sig-ok-retry",
                ConnectedWalletPublicKey = user.Wallet
            });

        var reloaded = await db.User.SingleAsync(x => x.UserID == user.UserID);
        Assert.Equal(9m, reloaded.Balance);
        Assert.Equal("Resgate concluido.", result.Message);
    }

    private static SystemBalanceWithdrawalService CreateService(EthicAIDbContext db, IOnChainWithdrawalVerifier verifier)
    {
        var options = Options.Create(new CriptoVersusBlockchainOptions
        {
            Mode = BlockchainOperationMode.HybridContractCustody,
            EnableHybridContractCustody = true,
            EnableOnChainWithdrawals = true,
            CurrentHybridProgramId = "HybridProgram1111111111111111111111111111111"
        });

        return new SystemBalanceWithdrawalService(
            db,
            new LedgerService(db),
            verifier,
            options,
            NullLogger<SystemBalanceWithdrawalService>.Instance);
    }

    private static async Task<User> SeedUserAsync(EthicAIDbContext db, string wallet, decimal balance)
    {
        var user = new User
        {
            Wallet = wallet,
            Name = wallet,
            Balance = balance,
            TotalWithdrawn = 0m,
            TotalClaimed = 0m,
            DtCreate = DateTime.UtcNow,
            DtUpdate = DateTime.UtcNow,
            LastLogin = DateTime.UtcNow,
            Bets = new List<Bet>(),
            TeamPositions = new List<DAL.NftFutebol.UserTeamPosition>(),
            PreSalePurchases = new List<PreSalePurchase>()
        };

        db.User.Add(user);
        await db.SaveChangesAsync();
        return user;
    }

    private static EthicAIDbContext CreateDbContext()
    {
        var options = new DbContextOptionsBuilder<EthicAIDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString("N"))
            .Options;

        return new EthicAIDbContext(options);
    }

    private sealed class FakeVerifier : IOnChainWithdrawalVerifier
    {
        private readonly bool _success;
        private readonly string _code;
        private readonly string _message;

        public FakeVerifier(bool success, string code = "WITHDRAW_VERIFIED", string message = "ok")
        {
            _success = success;
            _code = code;
            _message = message;
        }

        public Task<OnChainWithdrawalVerificationResult> VerifyAsync(string signature, string expectedWallet, decimal expectedAmount, CancellationToken ct = default)
        {
            return Task.FromResult(
                _success
                    ? OnChainWithdrawalVerificationResult.Success("ok", "devnet", expectedWallet, 1_000_000_000)
                    : OnChainWithdrawalVerificationResult.Failure(_code, _message));
        }
    }
}
