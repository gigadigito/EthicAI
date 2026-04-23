using DAL;
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
    private readonly IConfiguration _configuration;

    public WalletController(EthicAIDbContext context, IConfiguration configuration)
    {
        _context = context;
        _configuration = configuration;
    }

    [HttpGet("me")]
    public async Task<ActionResult<MyWalletDto>> GetMyWallet(CancellationToken cancellationToken)
    {
        var user = await GetAuthenticatedUserAsync(cancellationToken);
        if (user is null)
            return Unauthorized(new { message = "Token sem wallet valida." });

        var betRows = await _context.Bet
            .AsNoTracking()
            .Where(b => b.UserId == user.UserID)
            .Select(b => new WalletBetSummaryRow
            {
                TeamId = b.TeamId,
                TeamSymbol = b.Team.Currency != null ? b.Team.Currency.Symbol : $"Team#{b.TeamId}",
                TeamName = b.Team.Currency != null ? b.Team.Currency.Name : "Moeda",
                Amount = b.Amount,
                PayoutAmount = b.PayoutAmount,
                BetTime = b.BetTime,
                MatchStatus = b.Match.Status,
                IsWinner = b.IsWinner,
                SettledAt = b.SettledAt
            })
            .ToListAsync(cancellationToken);

        var positions = await _context.UserTeamPosition
            .AsNoTracking()
            .Where(p => p.UserId == user.UserID && p.Status != TeamPositionStatus.Closed)
            .Include(p => p.Team).ThenInclude(t => t.Currency)
            .OrderByDescending(p => p.UpdatedAt)
            .ToListAsync(cancellationToken);

        var totalInvested = betRows.Sum(i => i.Amount);
        var openAmount = betRows.Where(IsOpen).Sum(i => i.Amount);
        var totalPayout = betRows.Where(i => i.SettledAt.HasValue).Sum(i => i.PayoutAmount ?? 0m);
        var realizedProfit = betRows.Where(i => i.SettledAt.HasValue).Sum(GetProfitAmount);
        var realizedLoss = betRows.Where(i => i.SettledAt.HasValue).Sum(GetLossAmount);
        var realizedNetResult = realizedProfit - realizedLoss;

        var investmentGroups = betRows
            .GroupBy(x => new { x.TeamId, x.TeamSymbol, x.TeamName })
            .Select(group =>
            {
                var rows = group.ToList();
                return new MyWalletInvestmentGroupDto
                {
                    TeamId = group.Key.TeamId,
                    Symbol = group.Key.TeamSymbol,
                    CurrencyName = group.Key.TeamName,
                    TotalInvested = rows.Sum(x => x.Amount),
                    OpenAmount = rows.Where(IsOpen).Sum(x => x.Amount),
                    ReceivedAmount = rows.Where(x => x.SettledAt.HasValue).Sum(x => x.PayoutAmount ?? 0m),
                    RealizedNetResult = rows.Where(x => x.SettledAt.HasValue).Sum(x => (x.PayoutAmount ?? 0m) - x.Amount),
                    MatchCount = rows.Count,
                    WonCount = rows.Count(IsWon),
                    LostCount = rows.Count(IsLost),
                    OpenCount = rows.Count(IsOpen),
                    RefundedCount = rows.Count(IsRefunded),
                    CancelledCount = rows.Count(IsCancelled),
                    DrawCount = rows.Count(IsDraw),
                    LastBetTime = rows.Max(x => (DateTime?)x.BetTime)
                };
            })
            .OrderByDescending(x => x.OpenCount)
            .ThenByDescending(x => x.TotalInvested)
            .ThenBy(x => x.Symbol)
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
            TotalInvested = totalInvested,
            OpenAmount = openAmount,
            TotalPayout = totalPayout,
            RealizedProfit = realizedProfit,
            RealizedLoss = realizedLoss,
            RealizedNetResult = realizedNetResult,
            OpenInvestments = betRows.Count(IsOpen),
            SettledInvestments = betRows.Count(x => x.SettledAt.HasValue),
            ActivePositions = positions.Select(ToPositionDto).ToList(),
            InvestmentGroups = investmentGroups
        });
    }

    [HttpGet("/api/users/{userId:int}/wallet-history/{teamId:int}/matches")]
    public async Task<ActionResult<UserMatchHistoryPageDto>> GetWalletHistoryMatches(
        int userId,
        int teamId,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 10,
        [FromQuery] string status = "all",
        CancellationToken cancellationToken = default)
    {
        var user = await GetAuthenticatedUserAsync(cancellationToken);
        if (user is null || user.UserID != userId)
            return Forbid();

        page = Math.Max(1, page);
        pageSize = Math.Clamp(pageSize, 1, 50);
        var normalizedStatus = NormalizeStatusFilter(status);

        var baseQuery = _context.Bet
            .AsNoTracking()
            .Where(b => b.UserId == userId && b.TeamId == teamId)
            .Include(b => b.Team).ThenInclude(t => t.Currency)
            .Include(b => b.Match).ThenInclude(m => m.TeamA).ThenInclude(t => t.Currency)
            .Include(b => b.Match).ThenInclude(m => m.TeamB).ThenInclude(t => t.Currency)
            .Include(b => b.Match).ThenInclude(m => m.WinnerTeam).ThenInclude(t => t!.Currency);

        var bets = await baseQuery
            .OrderByDescending(b => b.BetTime)
            .ThenByDescending(b => b.MatchId)
            .ToListAsync(cancellationToken);

        var filteredBets = bets
            .Where(b => MatchesStatusFilter(b, normalizedStatus))
            .ToList();

        var totalItems = filteredBets.Count;
        var totalPages = Math.Max(1, (int)Math.Ceiling(totalItems / (double)pageSize));
        page = Math.Min(page, totalPages);

        var pageBets = filteredBets
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .ToList();

        var matchIds = pageBets.Select(x => x.MatchId).Distinct().ToList();

        var matchPoolMap = await _context.Bet
            .AsNoTracking()
            .Where(b => matchIds.Contains(b.MatchId))
            .GroupBy(b => new { b.MatchId, b.TeamId })
            .Select(g => new
            {
                g.Key.MatchId,
                g.Key.TeamId,
                TotalAmount = g.Sum(x => x.Amount),
                TotalDistributed = g.Sum(x => x.PayoutAmount ?? 0m)
            })
            .ToListAsync(cancellationToken);

        var scoreEvents = await _context.MatchScoreEvent
            .AsNoTracking()
            .Where(x => matchIds.Contains(x.MatchId))
            .Include(x => x.Team).ThenInclude(t => t.Currency)
            .OrderBy(x => x.MatchId)
            .ThenBy(x => x.EventSequence)
            .ToListAsync(cancellationToken);

        var scoreEventsByMatch = scoreEvents
            .GroupBy(x => x.MatchId)
            .ToDictionary(
                g => g.Key,
                g => g.Select(x => new MatchScoreEventDto
                {
                    MatchScoreEventId = x.MatchScoreEventId,
                    MatchId = x.MatchId,
                    TeamId = x.TeamId,
                    TeamSymbol = x.Team?.Currency?.Symbol ?? $"Team#{x.TeamId}",
                    RuleType = x.RuleType.ToString(),
                    EventType = x.EventType.ToString(),
                    ReasonCode = x.ReasonCode,
                    Points = x.Points,
                    EventSequence = x.EventSequence,
                    TeamPercentageChange = x.TeamPercentageChange,
                    OpponentPercentageChange = x.OpponentPercentageChange,
                    TeamQuoteVolume = x.TeamQuoteVolume,
                    OpponentQuoteVolume = x.OpponentQuoteVolume,
                    MetricDelta = x.MetricDelta,
                    WindowStartUtc = x.WindowStartUtc,
                    WindowEndUtc = x.WindowEndUtc,
                    Description = x.Description ?? string.Empty,
                    EventTimeUtc = x.EventTimeUtc
                }).ToList());

        var houseFeeRate = ClampRate(GetDecimal("CriptoVersusWorker:Settlement:HouseFeeRate", 0.01m));

        var items = pageBets
            .Select(bet =>
            {
                var match = bet.Match;
                var selectedTeam = bet.Team;
                var teamA = match.TeamA;
                var teamB = match.TeamB;
                var winner = match.WinnerTeam;
                var userTeamSymbol = selectedTeam?.Currency?.Symbol ?? $"Team#{bet.TeamId}";
                var teamASymbol = teamA?.Currency?.Symbol ?? $"Team#{match.TeamAId}";
                var teamBSymbol = teamB?.Currency?.Symbol ?? $"Team#{match.TeamBId}";
                var opponentSymbol = bet.TeamId == match.TeamAId ? teamBSymbol : teamASymbol;
                var receivedAmount = bet.PayoutAmount ?? 0m;
                var netResult = match.Status switch
                {
                    MatchStatus.Completed => receivedAmount - bet.Amount,
                    MatchStatus.Cancelled => 0m,
                    _ => 0m
                };
                var totalBetOnTeamA = matchPoolMap.FirstOrDefault(x => x.MatchId == match.MatchId && x.TeamId == match.TeamAId)?.TotalAmount ?? 0m;
                var totalBetOnTeamB = matchPoolMap.FirstOrDefault(x => x.MatchId == match.MatchId && x.TeamId == match.TeamBId)?.TotalAmount ?? 0m;
                var totalDistributed = matchPoolMap.Where(x => x.MatchId == match.MatchId).Sum(x => x.TotalDistributed);
                var totalPool = totalBetOnTeamA + totalBetOnTeamB;
                var houseFeeAmount = match.Status == MatchStatus.Completed ? Math.Round(totalPool * houseFeeRate, 8) : 0m;
                var result = ClassifyResult(match.Status, bet.IsWinner, receivedAmount, bet.Amount);
                var scoreSummary = $"{teamASymbol} {match.ScoreA} x {match.ScoreB} {teamBSymbol}";
                var winnerSymbol = winner?.Currency?.Symbol
                    ?? (match.WinnerTeamId == match.TeamAId ? teamASymbol : match.WinnerTeamId == match.TeamBId ? teamBSymbol : null);
                var refundAmount = result.Code switch
                {
                    "refunded" or "partial-loss" => receivedAmount,
                    "cancelled" => bet.Amount,
                    _ => 0m
                };
                var settlementSteps = BuildSettlementSteps(result, bet.Amount, receivedAmount, refundAmount, netResult, houseFeeAmount, totalPool, totalDistributed);

                return new UserMatchHistoryItemDto
                {
                    BetId = bet.BetId,
                    MatchId = bet.MatchId,
                    UserId = bet.UserId,
                    TeamId = bet.TeamId,
                    TeamAId = match.TeamAId,
                    TeamBId = match.TeamBId,
                    WinnerTeamId = match.WinnerTeamId,
                    UserTeamSymbol = userTeamSymbol,
                    OpponentSymbol = opponentSymbol,
                    TeamASymbol = teamASymbol,
                    TeamBSymbol = teamBSymbol,
                    WinnerTeamSymbol = winnerSymbol,
                    CurrencyName = selectedTeam?.Currency?.Name ?? "Moeda",
                    BetAmount = bet.Amount,
                    ReceivedAmount = receivedAmount,
                    PayoutAmount = receivedAmount,
                    RefundAmount = refundAmount,
                    HouseFeeAmount = houseFeeAmount,
                    NetResult = netResult,
                    BetTime = bet.BetTime,
                    MatchStartTime = match.StartTime,
                    MatchEndTime = match.EndTime,
                    ScoreTeamA = match.ScoreA,
                    ScoreTeamB = match.ScoreB,
                    MatchStatus = match.Status.ToString(),
                    UserResult = result.Code,
                    UserResultLabel = result.Label,
                    MatchResultSummary = scoreSummary,
                    HumanSummary = BuildHumanSummary(result, userTeamSymbol, opponentSymbol, bet.Amount, receivedAmount, refundAmount, netResult, winnerSymbol),
                    SettlementSummary = BuildSettlementSummary(result, bet.Amount, receivedAmount, refundAmount, netResult),
                    Claimed = bet.Claimed,
                    IsWinner = bet.IsWinner,
                    IsLoser = result.IsLoser,
                    IsOpen = result.IsOpen,
                    IsRefunded = result.IsRefunded,
                    IsCancelled = result.IsCancelled,
                    IsDraw = result.IsDraw,
                    IsPartialLoss = result.IsPartialLoss,
                    SettledAt = bet.SettledAt,
                    BettingCloseTime = match.BettingCloseTime,
                    TotalBetOnTeamA = totalBetOnTeamA,
                    TotalBetOnTeamB = totalBetOnTeamB,
                    TotalPool = totalPool,
                    TotalDistributed = totalDistributed,
                    ScoreEvents = scoreEventsByMatch.TryGetValue(match.MatchId, out var eventsForMatch) ? eventsForMatch : [],
                    SettlementSteps = settlementSteps
                };
            })
            .ToList();

        return Ok(new UserMatchHistoryPageDto
        {
            Items = items,
            Page = page,
            PageSize = pageSize,
            TotalItems = totalItems,
            TotalPages = totalPages,
            Status = normalizedStatus
        });
    }

    private async Task<User?> GetAuthenticatedUserAsync(CancellationToken cancellationToken)
    {
        var wallet = GetAuthenticatedWallet();
        if (string.IsNullOrWhiteSpace(wallet))
            return null;

        return await _context.User
            .AsNoTracking()
            .FirstOrDefaultAsync(u => u.Wallet == wallet, cancellationToken);
    }

    private string? GetAuthenticatedWallet()
    {
        return User.FindFirstValue("wallet")
            ?? User.FindFirstValue(ClaimTypes.NameIdentifier)
            ?? User.FindFirstValue(JwtRegisteredClaimNames.Sub);
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

    private string GetDecimalKey(string key) => _configuration[key] ?? string.Empty;

    private decimal GetDecimal(string key, decimal fallback)
        => decimal.TryParse(GetDecimalKey(key), System.Globalization.NumberStyles.Any, System.Globalization.CultureInfo.InvariantCulture, out var value)
            ? value
            : fallback;

    private static decimal ClampRate(decimal rate)
        => Math.Clamp(rate, 0m, 1m);

    private static bool IsOpen(WalletBetSummaryRow row)
        => row.MatchStatus is MatchStatus.Pending or MatchStatus.Ongoing || !row.SettledAt.HasValue && row.MatchStatus == MatchStatus.Completed;

    private static bool IsWon(WalletBetSummaryRow row)
        => ClassifyResult(row.MatchStatus, row.IsWinner, row.PayoutAmount ?? 0m, row.Amount).Code == "won";

    private static bool IsLost(WalletBetSummaryRow row)
        => ClassifyResult(row.MatchStatus, row.IsWinner, row.PayoutAmount ?? 0m, row.Amount).IsLoser;

    private static bool IsRefunded(WalletBetSummaryRow row)
        => ClassifyResult(row.MatchStatus, row.IsWinner, row.PayoutAmount ?? 0m, row.Amount).IsRefunded;

    private static bool IsCancelled(WalletBetSummaryRow row)
        => ClassifyResult(row.MatchStatus, row.IsWinner, row.PayoutAmount ?? 0m, row.Amount).IsCancelled;

    private static bool IsDraw(WalletBetSummaryRow row)
        => ClassifyResult(row.MatchStatus, row.IsWinner, row.PayoutAmount ?? 0m, row.Amount).IsDraw;

    private static decimal GetLossAmount(WalletBetSummaryRow investment)
    {
        var payout = investment.PayoutAmount ?? 0m;
        return payout < investment.Amount ? investment.Amount - payout : 0m;
    }

    private static decimal GetProfitAmount(WalletBetSummaryRow investment)
    {
        var payout = investment.PayoutAmount ?? 0m;
        return payout > investment.Amount ? payout - investment.Amount : 0m;
    }

    private static string NormalizeStatusFilter(string? status)
        => status?.Trim().ToLowerInvariant() switch
        {
            "won" => "won",
            "lost" => "lost",
            "open" => "open",
            "finalized" => "finalized",
            _ => "all"
        };

    private static bool MatchesStatusFilter(Bet bet, string status)
    {
        if (status == "all")
            return true;

        var result = ClassifyResult(bet.Match.Status, bet.IsWinner, bet.PayoutAmount ?? 0m, bet.Amount);

        return status switch
        {
            "won" => result.Code == "won",
            "lost" => result.IsLoser,
            "open" => result.IsOpen,
            "finalized" => !result.IsOpen,
            _ => true
        };
    }

    private static WalletResultClassification ClassifyResult(MatchStatus matchStatus, bool? isWinner, decimal receivedAmount, decimal betAmount)
    {
        if (matchStatus is MatchStatus.Pending or MatchStatus.Ongoing)
            return new("open", "EM ABERTO", IsOpen: true);

        if (matchStatus == MatchStatus.Cancelled)
            return receivedAmount > 0m
                ? new("refunded", "REEMBOLSADO", IsRefunded: true)
                : new("cancelled", "CANCELADA", IsCancelled: true);

        if (isWinner == true || receivedAmount > betAmount)
            return new("won", "GANHOU");

        if (receivedAmount == betAmount && betAmount > 0m)
            return new("refunded", "REEMBOLSADO", IsRefunded: true);

        if (receivedAmount > 0m && receivedAmount < betAmount)
            return new("partial-loss", "PERDEU PARCIALMENTE", IsLoser: true, IsRefunded: true, IsPartialLoss: true);

        if (isWinner == false && receivedAmount <= 0m)
            return new("lost", "PERDEU", IsLoser: true);

        return new("draw", "EMPATE", IsDraw: true);
    }

    private static string BuildHumanSummary(
        WalletResultClassification result,
        string userTeamSymbol,
        string opponentSymbol,
        decimal betAmount,
        decimal receivedAmount,
        decimal refundAmount,
        decimal netResult,
        string? winnerSymbol)
    {
        return result.Code switch
        {
            "won" => $"Voce apostou {FmtSol(betAmount)} em {userTeamSymbol}. {userTeamSymbol} venceu a partida. Voce recebeu {FmtSol(receivedAmount)}. Lucro liquido: {FmtSignedSol(netResult)}.",
            "lost" => $"Voce apostou {FmtSol(betAmount)} em {userTeamSymbol}. O vencedor foi {winnerSymbol ?? opponentSymbol}. Resultado: perdeu {FmtSol(betAmount)}.",
            "partial-loss" => $"Voce apostou {FmtSol(betAmount)} em {userTeamSymbol}. Houve devolucao parcial de {FmtSol(receivedAmount)}. Resultado liquido: {FmtSignedSol(netResult)}.",
            "refunded" => $"Voce apostou {FmtSol(betAmount)} em {userTeamSymbol}. A partida foi reembolsada. Voce recebeu {FmtSol(receivedAmount)} de volta.",
            "cancelled" => $"Sua aposta em {userTeamSymbol} foi cancelada. Nenhum prejuizo foi realizado. Reembolso previsto: {FmtSol(refundAmount)}.",
            "draw" => $"Voce apostou {FmtSol(betAmount)} em {userTeamSymbol}. A partida terminou empatada. Consulte a regra aplicada no detalhe da partida.",
            _ => "Sua posicao esta ativa. O resultado sera calculado quando a partida finalizar."
        };
    }

    private static string BuildSettlementSummary(
        WalletResultClassification result,
        decimal betAmount,
        decimal receivedAmount,
        decimal refundAmount,
        decimal netResult)
    {
        return result.Code switch
        {
            "open" => $"Apostado: {FmtSol(betAmount)}. Ainda sem liquidacao.",
            "won" => $"Apostado: {FmtSol(betAmount)}. Recebido: {FmtSol(receivedAmount)}. Resultado liquido: {FmtSignedSol(netResult)}.",
            "lost" => $"Apostado: {FmtSol(betAmount)}. Recebido: {FmtSol(receivedAmount)}. Resultado liquido: {FmtSignedSol(netResult)}.",
            "partial-loss" => $"Apostado: {FmtSol(betAmount)}. Recebido parcialmente: {FmtSol(receivedAmount)}. Resultado liquido: {FmtSignedSol(netResult)}.",
            "refunded" => $"Apostado: {FmtSol(betAmount)}. Reembolso: {FmtSol(receivedAmount)}.",
            "cancelled" => $"Apostado: {FmtSol(betAmount)}. Partida cancelada. Reembolso previsto: {FmtSol(refundAmount)}. Resultado liquido: 0 SOL.",
            _ => $"Apostado: {FmtSol(betAmount)}. Recebido: {FmtSol(receivedAmount)}."
        };
    }

    private static List<string> BuildSettlementSteps(
        WalletResultClassification result,
        decimal betAmount,
        decimal receivedAmount,
        decimal refundAmount,
        decimal netResult,
        decimal houseFeeAmount,
        decimal totalPool,
        decimal totalDistributed)
    {
        var steps = new List<string>
        {
            $"Aposta registrada: {FmtSol(betAmount)}.",
            $"Pool total da partida: {FmtSol(totalPool)}."
        };

        if (houseFeeAmount > 0m)
            steps.Add($"Taxa da casa estimada na pool: {FmtSol(houseFeeAmount)}.");

        if (totalDistributed > 0m)
            steps.Add($"Total distribuido na liquidacao: {FmtSol(totalDistributed)}.");

        steps.Add(result.Code switch
        {
            "open" => "Partida ainda nao liquidada.",
            "won" => $"Aposta vencedora. Recebimento: {FmtSol(receivedAmount)}.",
            "lost" => "Aposta perdedora. Nao houve retorno.",
            "partial-loss" => $"Aposta com devolucao parcial. Recebimento: {FmtSol(receivedAmount)}.",
            "refunded" => $"Aposta reembolsada. Recebimento: {FmtSol(receivedAmount)}.",
            "cancelled" => $"Partida cancelada. Reembolso previsto ao usuario: {FmtSol(refundAmount)}.",
            _ => "Regra especial aplicada na liquidacao."
        });

        if (!result.IsOpen)
            steps.Add($"Resultado liquido final: {FmtSignedSol(netResult)}.");

        return steps;
    }

    private static string FmtSol(decimal value)
        => $"{value:0.########} SOL";

    private static string FmtSignedSol(decimal value)
        => value > 0m
            ? $"+{value:0.########} SOL"
            : value < 0m
                ? $"-{Math.Abs(value):0.########} SOL"
                : "0 SOL";

    private sealed class WalletBetSummaryRow
    {
        public int TeamId { get; init; }
        public string TeamSymbol { get; init; } = "";
        public string TeamName { get; init; } = "";
        public decimal Amount { get; init; }
        public decimal? PayoutAmount { get; init; }
        public DateTime BetTime { get; init; }
        public MatchStatus MatchStatus { get; init; }
        public bool? IsWinner { get; init; }
        public DateTimeOffset? SettledAt { get; init; }
    }

    private sealed record WalletResultClassification(
        string Code,
        string Label,
        bool IsLoser = false,
        bool IsOpen = false,
        bool IsRefunded = false,
        bool IsCancelled = false,
        bool IsDraw = false,
        bool IsPartialLoss = false);
}
