using DAL.NftFutebol;
using DTOs;
using EthicAI.EntityModel;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;

namespace CriptoVersus.API.Controllers;

[Authorize]
[ApiController]
[Route("api/positions")]
public sealed class PositionsController : ControllerBase
{
    private readonly EthicAIDbContext _context;

    public PositionsController(EthicAIDbContext context)
    {
        _context = context;
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

        return Ok(positions.Select(ToDto).ToList());
    }

    [HttpPost]
    public async Task<ActionResult<TeamPositionDto>> CreateOrIncrease(
        [FromBody] CreateTeamPositionRequest request,
        CancellationToken ct)
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

        var nowUtc = DateTime.UtcNow;
        var position = await _context.UserTeamPosition
            .Include(p => p.Team).ThenInclude(t => t.Currency)
            .FirstOrDefaultAsync(p => p.UserId == user.UserID && p.TeamId == request.TeamId, ct);

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
                OnChainCluster = "devnet",
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
            position.CurrentLamports = AddLamports(position.CurrentLamports, ParseLamports(request.OnChainAmountLamports));
            position.UpdatedAt = nowUtc;
        }

        await _context.SaveChangesAsync(ct);

        await _context.Entry(position).Reference(p => p.Team).LoadAsync(ct);
        await _context.Entry(position.Team).Reference(t => t.Currency).LoadAsync(ct);

        return Ok(ToDto(position));
    }

    [HttpPatch("{positionId:int}")]
    public async Task<ActionResult<TeamPositionDto>> Update(
        int positionId,
        [FromBody] UpdateTeamPositionRequest request,
        CancellationToken ct)
    {
        var user = await GetAuthenticatedUserAsync(ct);
        if (user is null)
            return Unauthorized(new { message = "Token sem wallet valida." });

        var position = await _context.UserTeamPosition
            .Include(p => p.Team).ThenInclude(t => t.Currency)
            .FirstOrDefaultAsync(p => p.PositionId == positionId && p.UserId == user.UserID, ct);

        if (position is null)
            return NotFound(new { message = "Posicao nao encontrada." });

        if (request.AddAmount.HasValue)
        {
            var amount = RoundMoney(request.AddAmount.Value);
            if (amount <= 0m)
                return BadRequest(new { message = "Informe um valor adicional maior que zero." });

            position.PrincipalAllocated = RoundMoney(position.PrincipalAllocated + amount);
            position.CurrentCapital = RoundMoney(position.CurrentCapital + amount);
            position.Status = TeamPositionStatus.Active;
            position.ClosedAt = null;
        }

        if (request.AutoCompound.HasValue)
            position.AutoCompound = request.AutoCompound.Value;

        position.UpdatedAt = DateTime.UtcNow;
        await _context.SaveChangesAsync(ct);

        return Ok(ToDto(position));
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

        position.Status = TeamPositionStatus.ClosingRequested;
        position.AutoCompound = false;
        position.UpdatedAt = DateTime.UtcNow;

        await _context.SaveChangesAsync(ct);
        return Ok(ToDto(position));
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

    private static TeamPositionDto ToDto(UserTeamPosition position)
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
