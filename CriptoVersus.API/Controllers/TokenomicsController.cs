using DAL.NftFutebol;
using DTOs;
using EthicAI.EntityModel;
using BLL.Blockchain;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace CriptoVersus.API.Controllers;

[AllowAnonymous]
[ApiController]
[Route("api/tokenomics")]
public sealed class TokenomicsController : ControllerBase
{
    private readonly EthicAIDbContext _context;
    private readonly IConfiguration _configuration;
    private readonly CriptoVersusBlockchainOptions _blockchainOptions;

    public TokenomicsController(
        EthicAIDbContext context,
        IConfiguration configuration,
        IOptions<CriptoVersusBlockchainOptions> blockchainOptions)
    {
        _context = context;
        _configuration = configuration;
        _blockchainOptions = blockchainOptions.Value;
    }

    [HttpGet]
    public async Task<ActionResult<TokenomicsDto>> Get(CancellationToken ct)
    {
        var houseFeeRate = ClampRate(GetDecimal("CriptoVersusWorker:Settlement:HouseFeeRate", 0.01m));
        var loserRefundRate = ClampRate(
            GetDecimal("CriptoVersusWorker:Settlement:LoserRefundRate", 0.94m),
            max: 1m - houseFeeRate);
        var winnerPoolRate = 1m - houseFeeRate - loserRefundRate;

        var activeStatuses = new[] { TeamPositionStatus.Active, TeamPositionStatus.ClosingRequested };

        var topPositions = await _context.UserTeamPosition
            .AsNoTracking()
            .Include(p => p.Team).ThenInclude(t => t.Currency)
            .Where(p => activeStatuses.Contains(p.Status))
            .GroupBy(p => new
            {
                p.TeamId,
                Symbol = p.Team.Currency != null ? p.Team.Currency.Symbol : null
            })
            .Select(g => new TokenomicsPositionDto
            {
                Symbol = g.Key.Symbol ?? $"Team#{g.Key.TeamId}",
                CurrentCapital = g.Sum(p => p.CurrentCapital),
                PrincipalAllocated = g.Sum(p => p.PrincipalAllocated),
                Status = "Active"
            })
            .OrderByDescending(p => p.CurrentCapital)
            .Take(6)
            .ToListAsync(ct);

        var openEntryAmount = await _context.Bet
            .AsNoTracking()
            .Where(b => b.SettledAt == null)
            .SumAsync(b => (decimal?)b.Amount, ct) ?? 0m;

        return Ok(new TokenomicsDto
        {
            ServerTimeUtc = DateTime.UtcNow,
            BlockchainMode = _blockchainOptions.Mode.ToString(),
            Cluster = _blockchainOptions.Cluster,
            ProgramId = _blockchainOptions.GetActiveProgramId(),
            AuthorityWallet = _blockchainOptions.GetActiveAuthorityPublicKey(),
            CustodyWalletPublicKey = _blockchainOptions.CustodyWalletPublicKey,
            CustodyWalletLabel = _blockchainOptions.CustodyWalletLabel,
            EnableOnChainBets = _blockchainOptions.IsOnChainBetFlowEnabled(),
            EnableOnChainSettlement = _blockchainOptions.IsOnChainSettlementFlowEnabled(),
            HouseFeeRate = houseFeeRate,
            LoserRefundRate = loserRefundRate,
            WinnerPoolRate = winnerPoolRate,
            AutoReenterEnabled = GetBool("CriptoVersusWorker:Settlement:AutoReenterEnabled", true),
            MinPositionCapital = GetDecimal("CriptoVersusWorker:Settlement:MinPositionCapital", 0.00000001m),
            PercentPerGoal = GetDouble("CriptoVersusWorker:Scoring:PercentPerGoal", 2.0),
            MaxGoalsPerTeam = GetInt("CriptoVersusWorker:Scoring:MaxGoalsPerTeam", 7),
            MatchDurationMinutes = GetInt("CriptoVersusWorker:MatchDurationMinutes", 90),
            Users = await _context.User.AsNoTracking().CountAsync(ct),
            TotalMatches = await _context.Match.AsNoTracking().CountAsync(ct),
            PendingMatches = await _context.Match.AsNoTracking().CountAsync(m => m.Status == MatchStatus.Pending, ct),
            OngoingMatches = await _context.Match.AsNoTracking().CountAsync(m => m.Status == MatchStatus.Ongoing, ct),
            CompletedMatches = await _context.Match.AsNoTracking().CountAsync(m => m.Status == MatchStatus.Completed, ct),
            OpenEntries = await _context.Bet.AsNoTracking().CountAsync(b => b.SettledAt == null, ct),
            ActivePositions = await _context.UserTeamPosition.AsNoTracking().CountAsync(p => p.Status == TeamPositionStatus.Active, ct),
            ClosingPositions = await _context.UserTeamPosition.AsNoTracking().CountAsync(p => p.Status == TeamPositionStatus.ClosingRequested, ct),
            ClosedPositions = await _context.UserTeamPosition.AsNoTracking().CountAsync(p => p.Status == TeamPositionStatus.Closed, ct),
            ActiveCapital = await _context.UserTeamPosition
                .AsNoTracking()
                .Where(p => activeStatuses.Contains(p.Status))
                .SumAsync(p => (decimal?)p.CurrentCapital, ct) ?? 0m,
            PrincipalAllocated = await _context.UserTeamPosition
                .AsNoTracking()
                .SumAsync(p => (decimal?)p.PrincipalAllocated, ct) ?? 0m,
            OpenEntryAmount = openEntryAmount,
            TopPositions = topPositions
        });
    }

    private int GetInt(string key, int fallback)
        => int.TryParse(_configuration[key], out var value) ? value : fallback;

    private double GetDouble(string key, double fallback)
        => double.TryParse(_configuration[key], out var value) ? value : fallback;

    private decimal GetDecimal(string key, decimal fallback)
        => decimal.TryParse(_configuration[key], out var value) ? value : fallback;

    private bool GetBool(string key, bool fallback)
        => bool.TryParse(_configuration[key], out var value) ? value : fallback;

    private static decimal ClampRate(decimal value, decimal max = 1m)
    {
        if (value < 0m || max < 0m)
            return 0m;

        return value > max ? max : value;
    }
}
