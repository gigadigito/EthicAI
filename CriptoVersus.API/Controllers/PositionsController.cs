using BLL;
using BLL.Blockchain;
using DAL.NftFutebol;
using DTOs;
using EthicAI.EntityModel;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;

namespace CriptoVersus.API.Controllers;

[Authorize]
[ApiController]
[Route("api/positions")]
public sealed class PositionsController : ControllerBase
{
    private readonly EthicAIDbContext _context;
    private readonly ILedgerService _ledgerService;
    private readonly IConfiguration _configuration;
    private readonly CriptoVersusBlockchainOptions _blockchainOptions;

    public PositionsController(
        EthicAIDbContext context,
        ILedgerService ledgerService,
        IConfiguration configuration,
        IOptions<CriptoVersusBlockchainOptions> blockchainOptions)
    {
        _context = context;
        _ledgerService = ledgerService;
        _configuration = configuration;
        _blockchainOptions = blockchainOptions.Value;
    }

    [HttpGet]
    public async Task<ActionResult<List<TeamPositionDto>>> GetMyPositions(CancellationToken ct)
    {
        var user = await GetAuthenticatedUserAsync(ct);
        if (user is null)
            return Unauthorized(new { message = "Token sem wallet valida." });

        var positions = await _context.UserTeamPosition
            .AsNoTracking()
            .Where(p => p.UserId == user.UserID && p.Status != TeamPositionStatus.Closed)
            .Include(p => p.Team).ThenInclude(t => t.Currency)
            .OrderByDescending(p => p.UpdatedAt)
            .ToListAsync(ct);

        var openBetStatuses = await GetOpenBetStatusesAsync(user.UserID, ct);
        return Ok(positions.Select(p => ToDto(
            p,
            openBetStatuses.TryGetValue(p.PositionId, out var matchStatus),
            matchStatus)).ToList());
    }

    [HttpPost]
    public async Task<ActionResult<TeamPositionDto>> CreateOrIncrease(
        [FromBody] CreateTeamPositionRequest request,
        CancellationToken ct)
    {
        try
        {
            if (request.TeamId <= 0)
                return BadRequest(new { message = "TeamId invalido." });

            request.Amount = RoundMoney(request.Amount);
            if (request.Amount <= 0m)
                return BadRequest(new { message = "Informe um valor maior que zero." });

            var user = await GetAuthenticatedUserAsync(ct);
            if (user is null)
                return Unauthorized(new { message = "Token sem wallet valida." });

            var teamExists = await _context.Team.AnyAsync(t => t.TeamId == request.TeamId, ct);
            if (!teamExists)
                return NotFound(new { message = "Time nao encontrado." });

            var onChainBettingEnabled = _blockchainOptions.IsOnChainDepositFlowEnabled();
            if (onChainBettingEnabled
                && _blockchainOptions.RequireOnChainConfirmation
                && string.IsNullOrWhiteSpace(request.OnChainSignature)
                && !_blockchainOptions.AllowFallbackToOffChain)
            {
                return BadRequest(new
                {
                    message = "A assinatura da transação Solana é obrigatória para criar ou aumentar posição on-chain."
                });
            }

            var strategy = _context.Database.CreateExecutionStrategy();
            UserTeamPosition? position = null;

            await strategy.ExecuteAsync(async () =>
            {
                await using var transaction = await _context.Database.BeginTransactionAsync(ct);

                var nowUtc = DateTime.UtcNow;
                position = await _context.UserTeamPosition
                    .Include(p => p.Team).ThenInclude(t => t.Currency)
                    .FirstOrDefaultAsync(p => p.UserId == user.UserID && p.TeamId == request.TeamId, ct);

                if (!onChainBettingEnabled && user.Balance < request.Amount)
                {
                    throw new InvalidOperationException(
                        $"Saldo insuficiente para criar/aumentar posição. Balance={user.Balance} Amount={request.Amount}");
                }

                var balanceBefore = user.Balance;

                if (!onChainBettingEnabled)
                    user.Balance = RoundMoney(user.Balance - request.Amount);

                if (position is null)
                {
                    position = new UserTeamPosition
                    {
                        UserId = user.UserID,
                        TeamId = request.TeamId,
                        PrincipalAllocated = request.Amount,
                        CurrentCapital = request.Amount,
                        AutoCompound = request.AutoCompound,
                        Status = TeamPositionStatus.Active,
                        OnChainPositionAddress = NormalizeAddress(request.OnChainPositionAccount),
                        OnChainVaultAddress = NormalizeAddress(request.OnChainPositionVault),
                        LastOnChainSignature = NormalizeAddress(request.OnChainSignature),
                        OnChainCluster = onChainBettingEnabled
                            ? _blockchainOptions.Cluster
                            : null,
                        CurrentLamports = ParseLamports(request.OnChainAmountLamports),
                        CreatedAt = nowUtc,
                        UpdatedAt = nowUtc
                    };

                    _context.UserTeamPosition.Add(position);
                }
                else
                {
                    position.PrincipalAllocated = RoundMoney(position.PrincipalAllocated + request.Amount);
                    position.CurrentCapital = RoundMoney(position.CurrentCapital + request.Amount);
                    position.AutoCompound = request.AutoCompound;
                    position.Status = TeamPositionStatus.Active;
                    position.ClosedAt = null;
                    position.OnChainPositionAddress = NormalizeAddress(request.OnChainPositionAccount) ?? position.OnChainPositionAddress;
                    position.OnChainVaultAddress = NormalizeAddress(request.OnChainPositionVault) ?? position.OnChainVaultAddress;
                    position.LastOnChainSignature = NormalizeAddress(request.OnChainSignature) ?? position.LastOnChainSignature;
                    position.OnChainCluster = onChainBettingEnabled
                        ? _blockchainOptions.Cluster
                        : position.OnChainCluster;
                    position.CurrentLamports = AddLamports(position.CurrentLamports, ParseLamports(request.OnChainAmountLamports));
                    position.UpdatedAt = nowUtc;
                }

                await _context.SaveChangesAsync(ct);

                await _ledgerService.AddEntryAsync(
                    user: user,
                    type: onChainBettingEnabled ? "POSITION_ADD_ONCHAIN" : "POSITION_ADD",
                    amount: onChainBettingEnabled ? 0m : -request.Amount,
                    balanceBefore: balanceBefore,
                    balanceAfter: user.Balance,
                    referenceId: position.PositionId,
                    description: onChainBettingEnabled
                        ? $"Posição on-chain criada/aumentada no team {request.TeamId}, signature {request.OnChainSignature}"
                        : $"Posição criada/aumentada no team {request.TeamId}",
                    ct: ct);

                await transaction.CommitAsync(ct);
            });

            await _context.Entry(position!).Reference(p => p.Team).LoadAsync(ct);
            await _context.Entry(position!.Team).Reference(t => t.Currency).LoadAsync(ct);

            return Ok(ToDto(position!, hasOpenBet: false, openBetMatchStatus: null));
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    [HttpPatch("{positionId:int}")]
    public async Task<ActionResult<TeamPositionDto>> Update(
        int positionId,
        [FromBody] UpdateTeamPositionRequest request,
        CancellationToken ct)
    {
        try
        {
            var user = await GetAuthenticatedUserAsync(ct);
            if (user is null)
                return Unauthorized(new { message = "Token sem wallet valida." });

            var position = await _context.UserTeamPosition
                .Include(p => p.Team).ThenInclude(t => t.Currency)
                .FirstOrDefaultAsync(p => p.PositionId == positionId && p.UserId == user.UserID, ct);

            if (position is null)
                return NotFound(new { message = "Posicao nao encontrada." });

            var onChainBettingEnabled = _blockchainOptions.IsOnChainDepositFlowEnabled();
            var strategy = _context.Database.CreateExecutionStrategy();

            await strategy.ExecuteAsync(async () =>
            {
                await using var transaction = await _context.Database.BeginTransactionAsync(ct);

                if (request.AddAmount.HasValue)
                {
                    var amount = RoundMoney(request.AddAmount.Value);
                    if (amount <= 0m)
                        throw new InvalidOperationException("Informe um valor adicional maior que zero.");

                    if (!onChainBettingEnabled && user.Balance < amount)
                    {
                        throw new InvalidOperationException(
                            $"Saldo insuficiente para aumentar posição. Balance={user.Balance} Amount={amount}");
                    }

                    var balanceBefore = user.Balance;

                    if (!onChainBettingEnabled)
                        user.Balance = RoundMoney(user.Balance - amount);

                    position.PrincipalAllocated = RoundMoney(position.PrincipalAllocated + amount);
                    position.CurrentCapital = RoundMoney(position.CurrentCapital + amount);
                    position.Status = TeamPositionStatus.Active;
                    position.ClosedAt = null;

                    await _context.SaveChangesAsync(ct);

                    await _ledgerService.AddEntryAsync(
                        user: user,
                        type: onChainBettingEnabled ? "POS_TOPUP_ONCHAIN" : "POSITION_TOPUP",
                        amount: onChainBettingEnabled ? 0m : -amount,
                        balanceBefore: balanceBefore,
                        balanceAfter: user.Balance,
                        referenceId: position.PositionId,
                        description: onChainBettingEnabled
                            ? $"Aumento on-chain da posição {position.PositionId}"
                            : $"Aumento da posição {position.PositionId}",
                        ct: ct);
                }

                if (request.AutoCompound.HasValue)
                    position.AutoCompound = request.AutoCompound.Value;

                position.UpdatedAt = DateTime.UtcNow;
                await _context.SaveChangesAsync(ct);
                await transaction.CommitAsync(ct);
            });

            return Ok(ToDto(position, hasOpenBet: false, openBetMatchStatus: null));
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    [HttpPost("{positionId:int}/close")]
    public async Task<ActionResult<TeamPositionDto>> RequestClose(int positionId, CancellationToken ct)
    {
        var user = await GetAuthenticatedUserAsync(ct);
        if (user is null)
            return Unauthorized(new { message = "Token sem wallet valida." });

        var position = await _context.UserTeamPosition
            .Include(p => p.Team).ThenInclude(t => t.Currency)
            .FirstOrDefaultAsync(p => p.PositionId == positionId && p.UserId == user.UserID, ct);

        if (position is null)
            return NotFound(new { message = "Posicao nao encontrada." });

        var strategy = _context.Database.CreateExecutionStrategy();
        var hasOpenBet = false;
        string? openBetMatchStatus = null;

        await strategy.ExecuteAsync(async () =>
        {
            await using var transaction = await _context.Database.BeginTransactionAsync(ct);

            var openBets = await _context.Bet
                .Include(b => b.Match)
                .Where(b => b.PositionId == position.PositionId && b.SettledAt == null)
                .OrderByDescending(b => b.Match.Status == MatchStatus.Ongoing)
                .ToListAsync(ct);

            hasOpenBet = openBets.Count > 0;
            openBetMatchStatus = openBets
                .Select(b => b.Match.Status.ToString())
                .FirstOrDefault();

            var nowUtc = DateTime.UtcNow;
            var hasOngoingBet = openBets.Any(b => b.Match.Status == MatchStatus.Ongoing);

            if (hasOngoingBet)
            {
                position.Status = TeamPositionStatus.ClosingRequested;
                position.AutoCompound = false;
                position.UpdatedAt = nowUtc;
                await _context.SaveChangesAsync(ct);
            }
            else
            {
                if (openBets.Count > 0)
                    _context.Bet.RemoveRange(openBets);

                var releasableAmount = RoundMoney(position.CurrentCapital);
                var balanceBefore = user.Balance;

                if (releasableAmount > 0m)
                {
                    user.Balance = RoundMoney(user.Balance + releasableAmount);
                    user.DtUpdate = nowUtc;
                }

                position.PrincipalAllocated = 0m;
                position.CurrentCapital = 0m;
                position.Status = TeamPositionStatus.Closed;
                position.AutoCompound = false;
                position.ClosedAt = nowUtc;
                position.UpdatedAt = nowUtc;
                position.CurrentLamports = null;
                hasOpenBet = false;
                openBetMatchStatus = null;

                await _context.SaveChangesAsync(ct);

                if (releasableAmount > 0m)
                {
                    await _ledgerService.AddEntryAsync(
                        user: user,
                        type: "POS_CLOSE_RELEASE",
                        amount: releasableAmount,
                        balanceBefore: balanceBefore,
                        balanceAfter: user.Balance,
                        referenceId: position.PositionId,
                        description: $"Encerramento da posicao {position.PositionId} com liberacao para saldo do sistema.",
                        ct: ct);
                }
            }

            await transaction.CommitAsync(ct);
        });

        return Ok(ToDto(position, hasOpenBet, openBetMatchStatus));
    }

    private async Task<DAL.User?> GetAuthenticatedUserAsync(CancellationToken ct)
    {
        var wallet = User.FindFirstValue("wallet")
            ?? User.FindFirstValue(ClaimTypes.NameIdentifier)
            ?? User.FindFirstValue(JwtRegisteredClaimNames.Sub);

        if (string.IsNullOrWhiteSpace(wallet))
            return null;

        return await _context.User.FirstOrDefaultAsync(u => u.Wallet == wallet, ct);
    }

    private async Task<Dictionary<int, string>> GetOpenBetStatusesAsync(int userId, CancellationToken ct)
    {
        var rows = await _context.Bet
            .AsNoTracking()
            .Where(b => b.UserId == userId && b.PositionId.HasValue && b.SettledAt == null)
            .Select(b => new
            {
                PositionId = b.PositionId!.Value,
                Status = b.Match.Status
            })
            .ToListAsync(ct);

        return rows
            .GroupBy(x => x.PositionId)
            .ToDictionary(
                g => g.Key,
                g => g.OrderByDescending(x => x.Status == MatchStatus.Ongoing)
                    .Select(x => x.Status.ToString())
                    .First());
    }

    private static TeamPositionDto ToDto(UserTeamPosition position, bool hasOpenBet, string? openBetMatchStatus)
    {
        var currency = position.Team.Currency;

        return new TeamPositionDto
        {
            PositionId = position.PositionId,
            UserId = position.UserId,
            TeamId = position.TeamId,
            Symbol = currency?.Symbol ?? $"Team#{position.TeamId}",
            CurrencyName = currency?.Name ?? "Moeda",
            PrincipalAllocated = position.PrincipalAllocated,
            CurrentCapital = position.CurrentCapital,
            AutoCompound = position.AutoCompound,
            Status = position.Status.ToString(),
            HasOpenBet = hasOpenBet,
            OpenBetMatchStatus = openBetMatchStatus,
            CanCloseNow = !hasOpenBet && position.Status != TeamPositionStatus.Closed,
            OnChainPositionAddress = position.OnChainPositionAddress,
            OnChainVaultAddress = position.OnChainVaultAddress,
            LastOnChainSignature = position.LastOnChainSignature,
            OnChainCluster = position.OnChainCluster,
            CurrentLamports = position.CurrentLamports,
            CreatedAt = position.CreatedAt,
            UpdatedAt = position.UpdatedAt,
            ClosedAt = position.ClosedAt
        };
    }

    private static decimal RoundMoney(decimal value)
        => Math.Round(value, 8, MidpointRounding.ToZero);

    private static string? NormalizeAddress(string? value)
        => string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    private static long? ParseLamports(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
            return null;

        return long.TryParse(value, out var parsed) && parsed >= 0 ? parsed : null;
    }

    private static long? AddLamports(long? current, long? added)
        => added.HasValue ? (current ?? 0L) + added.Value : current;

}
