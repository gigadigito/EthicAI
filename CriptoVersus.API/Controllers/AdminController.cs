using DAL.NftFutebol;
using DTOs;
using EthicAI.EntityModel;
using BLL.Blockchain;
using BLL;
using CriptoVersus.API.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using System.Data;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;

namespace CriptoVersus.API.Controllers;

[Authorize]
[ApiController]
[Route("api/admin")]
public sealed class AdminController : ControllerBase
{
    private readonly EthicAIDbContext _context;
    private readonly IConfiguration _configuration;
    private readonly CriptoVersusBlockchainOptions _blockchainOptions;
    private readonly ILedgerService _ledgerService;
    private readonly ISystemBalanceWithdrawalService _systemBalanceWithdrawalService;

    public AdminController(
        EthicAIDbContext context,
        IConfiguration configuration,
        ILedgerService ledgerService,
        ISystemBalanceWithdrawalService systemBalanceWithdrawalService,
        IOptions<CriptoVersusBlockchainOptions> blockchainOptions)
    {
        _context = context;
        _configuration = configuration;
        _ledgerService = ledgerService;
        _systemBalanceWithdrawalService = systemBalanceWithdrawalService;
        _blockchainOptions = blockchainOptions.Value;
    }

    [HttpGet("system")]
    public async Task<ActionResult<AdminSystemDto>> System(CancellationToken ct)
    {
        var wallet = GetAuthenticatedWallet();
        if (!IsAdminWallet(wallet))
            return Forbid();

        var pending = MatchStatus.Pending;
        var ongoing = MatchStatus.Ongoing;
        var completed = MatchStatus.Completed;

        var recentPositions = await _context.UserTeamPosition
            .AsNoTracking()
            .Include(p => p.User)
            .Include(p => p.Team).ThenInclude(t => t.Currency)
            .OrderByDescending(p => p.UpdatedAt)
            .Take(12)
            .Select(p => new AdminPositionSummaryDto
            {
                PositionId = p.PositionId,
                UserId = p.UserId,
                TeamId = p.TeamId,
                Symbol = p.Team.Currency != null ? p.Team.Currency.Symbol : $"Team#{p.TeamId}",
                Wallet = p.User.Wallet,
                CurrentCapital = p.CurrentCapital,
                PrincipalAllocated = p.PrincipalAllocated,
                Status = p.Status.ToString(),
                OnChainPositionAddress = p.OnChainPositionAddress,
                OnChainVaultAddress = p.OnChainVaultAddress,
                LastOnChainSignature = p.LastOnChainSignature,
                CurrentLamports = p.CurrentLamports,
                UpdatedAt = p.UpdatedAt
            })
            .ToListAsync(ct);

        var openBetAmount = await _context.Bet
            .AsNoTracking()
            .Where(b => b.SettledAt == null)
            .SumAsync(b => (decimal?)b.Amount, ct) ?? 0m;

        return Ok(new AdminSystemDto
        {
            ServerTimeUtc = DateTime.UtcNow,
            AdminWallet = _configuration["CriptoVersus:AdminWallet"] ?? "",
            BlockchainMode = _blockchainOptions.Mode.ToString(),
            OnChainAuthorityWallet = _blockchainOptions.GetActiveAuthorityPublicKey(),
            OnChainCluster = _blockchainOptions.Cluster,
            ProgramId = _blockchainOptions.GetActiveProgramId(),
            CustodyWalletPublicKey = _blockchainOptions.CustodyWalletPublicKey,
            CustodyWalletLabel = _blockchainOptions.CustodyWalletLabel,
            EnableOnChainBets = _blockchainOptions.IsOnChainBetFlowEnabled(),
            EnableOnChainSettlement = _blockchainOptions.IsOnChainSettlementFlowEnabled(),
            Users = await _context.User.AsNoTracking().CountAsync(ct),
            MatchesTotal = await _context.Match.AsNoTracking().CountAsync(ct),
            MatchesPending = await _context.Match.AsNoTracking().CountAsync(m => m.Status == pending, ct),
            MatchesOngoing = await _context.Match.AsNoTracking().CountAsync(m => m.Status == ongoing, ct),
            MatchesCompleted = await _context.Match.AsNoTracking().CountAsync(m => m.Status == completed, ct),
            BetsTotal = await _context.Bet.AsNoTracking().CountAsync(ct),
            BetsOpen = await _context.Bet.AsNoTracking().CountAsync(b => b.SettledAt == null, ct),
            PositionsActive = await _context.UserTeamPosition.AsNoTracking().CountAsync(p => p.Status == TeamPositionStatus.Active, ct),
            PositionsClosingRequested = await _context.UserTeamPosition.AsNoTracking().CountAsync(p => p.Status == TeamPositionStatus.ClosingRequested, ct),
            PositionsClosed = await _context.UserTeamPosition.AsNoTracking().CountAsync(p => p.Status == TeamPositionStatus.Closed, ct),
            ActivePositionCapital = await _context.UserTeamPosition
                .AsNoTracking()
                .Where(p => p.Status == TeamPositionStatus.Active || p.Status == TeamPositionStatus.ClosingRequested)
                .SumAsync(p => (decimal?)p.CurrentCapital, ct) ?? 0m,
            PrincipalAllocated = await _context.UserTeamPosition
                .AsNoTracking()
                .SumAsync(p => (decimal?)p.PrincipalAllocated, ct) ?? 0m,
            OpenBetAmount = openBetAmount,
            RecentPositions = recentPositions
        });
    }

    [HttpGet("wallet/withdraw-diagnostics")]
    public async Task<ActionResult<AdminSystemBalanceWithdrawDiagnosticsDto>> WithdrawDiagnostics(CancellationToken ct)
    {
        var wallet = GetAuthenticatedWallet();
        if (!IsAdminWallet(wallet))
            return Forbid();

        var diagnostics = await _systemBalanceWithdrawalService.BuildDiagnosticsAsync(ct);
        return Ok(diagnostics);
    }

    [HttpPost("wallet/credit-test-balance")]
    public async Task<ActionResult<AdminWalletBalanceAdjustmentResponseDto>> CreditTestBalance(
        [FromBody] AdminWalletCreditTestBalanceRequestDto request,
        CancellationToken ct)
    {
        try
        {
            var wallet = GetAuthenticatedWallet();
            if (!IsAdminWallet(wallet))
                return Forbid();

            if (request is null)
                return BadRequest(new { message = "Payload invalido." });

            var normalizedWallet = NormalizeWallet(request.Wallet);
            if (string.IsNullOrWhiteSpace(normalizedWallet))
                return BadRequest(new { message = "Wallet obrigatoria." });

            var amount = RoundMoney(request.Amount);
            if (amount <= 0m)
                return BadRequest(new { message = "Amount deve ser maior que zero." });

            var reason = string.IsNullOrWhiteSpace(request.Reason)
                ? "Credito manual de teste OffChainCustody."
                : request.Reason.Trim();

            var strategy = _context.Database.CreateExecutionStrategy();
            AdminWalletBalanceAdjustmentResponseDto? response = null;

            await strategy.ExecuteAsync(async () =>
            {
                await using var transaction = await _context.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);

                try
                {
                    var nowUtc = DateTime.UtcNow;
                    var user = await _context.User.FirstOrDefaultAsync(x => x.Wallet == normalizedWallet, ct);
                    var createdUser = false;

                    if (user is null)
                    {
                        user = new DAL.User
                        {
                            Wallet = normalizedWallet,
                            Name = "OffChain Test User",
                            Balance = 0m,
                            TotalClaimed = 0m,
                            TotalWithdrawn = 0m,
                            DtCreate = nowUtc,
                            DtUpdate = nowUtc,
                            LastLogin = nowUtc
                        };

                        _context.User.Add(user);
                        await _context.SaveChangesAsync(ct);
                        createdUser = true;
                    }

                    var balanceBefore = user.Balance;
                    user.Balance = RoundMoney(user.Balance + amount);
                    user.DtUpdate = nowUtc;

                    await _context.SaveChangesAsync(ct);

                    await _ledgerService.AddEntryAsync(
                        user,
                        "CREDIT_TEST_BALANCE",
                        amount,
                        balanceBefore,
                        user.Balance,
                        description: reason,
                        ct: ct);

                    await transaction.CommitAsync(ct);

                    response = new AdminWalletBalanceAdjustmentResponseDto
                    {
                        Wallet = user.Wallet,
                        Direction = "credit",
                        Reason = reason,
                        Amount = amount,
                        BalanceBefore = balanceBefore,
                        BalanceAfter = user.Balance,
                        UserId = user.UserID,
                        CreatedUser = createdUser
                    };
                }
                catch
                {
                    await transaction.RollbackAsync(ct);
                    throw;
                }
            });

            return Ok(response);
        }
        catch (Exception ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    [HttpPost("wallet/manual-adjustment")]
    public async Task<ActionResult<AdminWalletBalanceAdjustmentResponseDto>> ManualAdjustment(
        [FromBody] AdminWalletManualAdjustmentRequestDto request,
        CancellationToken ct)
    {
        try
        {
            var wallet = GetAuthenticatedWallet();
            if (!IsAdminWallet(wallet))
                return Forbid();

            if (request is null)
                return BadRequest(new { message = "Payload invalido." });

            var normalizedWallet = NormalizeWallet(request.Wallet);
            if (string.IsNullOrWhiteSpace(normalizedWallet))
                return BadRequest(new { message = "Wallet obrigatoria." });

            var amount = RoundMoney(request.Amount);
            if (amount <= 0m)
                return BadRequest(new { message = "Amount deve ser maior que zero." });

            var direction = request.Direction?.Trim().ToLowerInvariant();
            if (direction is not ("credit" or "debit"))
                return BadRequest(new { message = "Direction deve ser 'credit' ou 'debit'." });

            var reason = string.IsNullOrWhiteSpace(request.Reason)
                ? "Ajuste manual OffChainCustody."
                : request.Reason.Trim();

            var strategy = _context.Database.CreateExecutionStrategy();
            AdminWalletBalanceAdjustmentResponseDto? response = null;

            await strategy.ExecuteAsync(async () =>
            {
                await using var transaction = await _context.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);

                try
                {
                    var user = await _context.User.FirstOrDefaultAsync(x => x.Wallet == normalizedWallet, ct);
                    if (user is null)
                        throw new InvalidOperationException("Usuario nao encontrado para a wallet informada.");

                    var nowUtc = DateTime.UtcNow;
                    var balanceBefore = user.Balance;
                    var signedAmount = direction == "credit" ? amount : -amount;
                    var balanceAfter = RoundMoney(balanceBefore + signedAmount);

                    if (balanceAfter < 0m)
                        throw new InvalidOperationException("Ajuste invalido: o saldo nao pode ficar negativo.");

                    user.Balance = balanceAfter;
                    user.DtUpdate = nowUtc;

                    await _context.SaveChangesAsync(ct);

                    await _ledgerService.AddEntryAsync(
                        user,
                        direction == "credit" ? "OFFCHAIN_DEPOSIT_MANUAL" : "OFFCHAIN_DEBIT_MANUAL",
                        signedAmount,
                        balanceBefore,
                        balanceAfter,
                        description: reason,
                        ct: ct);

                    await transaction.CommitAsync(ct);

                    response = new AdminWalletBalanceAdjustmentResponseDto
                    {
                        Wallet = user.Wallet,
                        Direction = direction,
                        Reason = reason,
                        Amount = amount,
                        BalanceBefore = balanceBefore,
                        BalanceAfter = balanceAfter,
                        UserId = user.UserID,
                        CreatedUser = false
                    };
                }
                catch
                {
                    await transaction.RollbackAsync(ct);
                    throw;
                }
            });

            return Ok(response);
        }
        catch (Exception ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    private string? GetAuthenticatedWallet()
    {
        return User.FindFirstValue("wallet")
            ?? User.FindFirstValue(ClaimTypes.NameIdentifier)
            ?? User.FindFirstValue(JwtRegisteredClaimNames.Sub);
    }

    private bool IsAdminWallet(string? wallet)
    {
        if (string.IsNullOrWhiteSpace(wallet))
            return false;

        var adminWallet = _configuration["CriptoVersus:AdminWallet"];
        var authorityWallet = _blockchainOptions.GetActiveAuthorityPublicKey();

        return IsConfiguredWallet(wallet, adminWallet)
            || IsConfiguredWallet(wallet, authorityWallet);
    }

    private static bool IsConfiguredWallet(string wallet, string? configuredWallet)
    {
        return !string.IsNullOrWhiteSpace(configuredWallet)
            && string.Equals(wallet, configuredWallet, StringComparison.Ordinal);
    }

    private static string? NormalizeWallet(string? wallet)
        => string.IsNullOrWhiteSpace(wallet) ? null : wallet.Trim();

    private static decimal RoundMoney(decimal value)
        => Math.Round(value, 8, MidpointRounding.ToZero);
}
