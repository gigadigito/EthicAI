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
[Route("api/wallet")]
public sealed class WalletController : ControllerBase
{
    private readonly EthicAIDbContext _context;

    public WalletController(EthicAIDbContext context)
    {
        _context = context;
    }

    [HttpGet("me")]
    public async Task<ActionResult<MyWalletDto>> GetMyWallet(CancellationToken cancellationToken)
    {
        var wallet = GetAuthenticatedWallet();
        if (string.IsNullOrWhiteSpace(wallet))
            return Unauthorized(new { message = "Token sem wallet valida." });

        var user = await _context.User
            .AsNoTracking()
            .FirstOrDefaultAsync(u => u.Wallet == wallet, cancellationToken);

        if (user is null)
            return NotFound(new { message = "Usuario autenticado nao encontrado." });

        var bets = await _context.Bet
            .AsNoTracking()
            .Where(b => b.UserId == user.UserID)
            .Include(b => b.Team).ThenInclude(t => t.Currency)
            .Include(b => b.Match).ThenInclude(m => m.TeamA).ThenInclude(t => t.Currency)
            .Include(b => b.Match).ThenInclude(m => m.TeamB).ThenInclude(t => t.Currency)
            .OrderByDescending(b => b.BetTime)
            .ToListAsync(cancellationToken);

        var positions = await _context.UserTeamPosition
            .AsNoTracking()
            .Where(p => p.UserId == user.UserID && p.Status != TeamPositionStatus.Closed)
            .Include(p => p.Team).ThenInclude(t => t.Currency)
            .OrderByDescending(p => p.UpdatedAt)
            .ToListAsync(cancellationToken);

        var investments = bets
            .Select(ToInvestmentDto)
            .ToList();

        var openInvestments = investments
            .Where(i => i.MatchStatus is nameof(MatchStatus.Pending) or nameof(MatchStatus.Ongoing))
            .ToList();

        var settledInvestments = investments
            .Where(i => i.MatchStatus is nameof(MatchStatus.Completed) or nameof(MatchStatus.Cancelled)
                || i.IsWinner.HasValue
                || i.SettledAt.HasValue)
            .ToList();

        return Ok(new MyWalletDto
        {
            UserId = user.UserID,
            Wallet = user.Wallet,
            Name = user.Name,
            Email = user.Email,
            DtCreate = user.DtCreate,
            LastLogin = user.LastLogin,
            Balance = user.Balance,
            TotalInvested = investments.Sum(i => i.Amount),
            OpenAmount = openInvestments.Sum(i => i.Amount),
            TotalPayout = investments.Sum(i => i.PayoutAmount ?? 0m),
            OpenInvestments = openInvestments.Count,
            SettledInvestments = settledInvestments.Count,
            ActivePositions = positions.Select(ToPositionDto).ToList(),
            Investments = investments
        });
    }

    private string? GetAuthenticatedWallet()
    {
        return User.FindFirstValue("wallet")
            ?? User.FindFirstValue(ClaimTypes.NameIdentifier)
            ?? User.FindFirstValue(JwtRegisteredClaimNames.Sub);
    }

    private static MyInvestmentDto ToInvestmentDto(Bet bet)
    {
        var match = bet.Match;
        var selectedTeam = bet.Team;
        var selectedCurrency = selectedTeam?.Currency;
        var opponentCurrency = bet.TeamId == match.TeamAId
            ? match.TeamB?.Currency
            : match.TeamA?.Currency;

        return new MyInvestmentDto
        {
            BetId = bet.BetId,
            MatchId = bet.MatchId,
            TeamId = bet.TeamId,
            Symbol = selectedCurrency?.Symbol ?? $"Team#{bet.TeamId}",
            CurrencyName = selectedCurrency?.Name ?? "Moeda",
            OpponentSymbol = opponentCurrency?.Symbol ?? "-",
            Amount = bet.Amount,
            BetTime = bet.BetTime,
            MatchStatus = match.Status.ToString(),
            InvestmentStatus = GetInvestmentStatus(bet),
            Claimed = bet.Claimed,
            IsWinner = bet.IsWinner,
            PayoutAmount = bet.PayoutAmount,
            SettledAt = bet.SettledAt,
            BettingCloseTime = match.BettingCloseTime
        };
    }

    private static TeamPositionDto ToPositionDto(UserTeamPosition position)
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

    private static string GetInvestmentStatus(Bet bet)
    {
        return bet.Match.Status switch
        {
            MatchStatus.Pending => "Aberto",
            MatchStatus.Ongoing => "Em andamento",
            MatchStatus.Cancelled => "Cancelado",
            MatchStatus.Completed when bet.IsWinner == true && bet.Claimed => "Retorno reivindicado",
            MatchStatus.Completed when bet.IsWinner == true => "Retorno disponivel",
            MatchStatus.Completed when bet.IsWinner == false => "Finalizado",
            MatchStatus.Completed => "Aguardando liquidacao",
            _ => "Aguardando"
        };
    }
}
