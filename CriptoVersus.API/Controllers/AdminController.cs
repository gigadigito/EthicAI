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
[Route("api/admin")]
public sealed class AdminController : ControllerBase
{
    private readonly EthicAIDbContext _context;
    private readonly IConfiguration _configuration;

    public AdminController(EthicAIDbContext context, IConfiguration configuration)
    {
        _context = context;
        _configuration = configuration;
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
            OnChainAuthorityWallet = _configuration["OnChainBetting:AuthorityWallet"] ?? "",
            OnChainCluster = _configuration["OnChainBetting:Cluster"] ?? "devnet",
            ProgramId = _configuration["OnChainBetting:ProgramId"] ?? "",
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
        var authorityWallet = _configuration["OnChainBetting:AuthorityWallet"];

        return IsConfiguredWallet(wallet, adminWallet)
            || IsConfiguredWallet(wallet, authorityWallet);
    }

    private static bool IsConfiguredWallet(string wallet, string? configuredWallet)
    {
        return !string.IsNullOrWhiteSpace(configuredWallet)
            && string.Equals(wallet, configuredWallet, StringComparison.Ordinal);
    }
}
