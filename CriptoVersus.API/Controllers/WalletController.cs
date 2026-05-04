using DAL;
using DAL.NftFutebol;
using DTOs;
using EthicAI.EntityModel;
using BLL.Blockchain;
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
[Route("api/wallet")]
public sealed class WalletController : ControllerBase
{
    private readonly EthicAIDbContext _context;
    private readonly IConfiguration _configuration;
    private readonly ILogger<WalletController> _logger;
    private readonly ICriptoVersusFundsService _fundsService;
    private readonly CriptoVersusBlockchainOptions _blockchainOptions;

    public WalletController(
        EthicAIDbContext context,
        IConfiguration configuration,
        ILogger<WalletController> logger,
        ICriptoVersusFundsService fundsService,
        IOptions<CriptoVersusBlockchainOptions> blockchainOptions)
    {
        _context = context;
        _configuration = configuration;
        _logger = logger;
        _fundsService = fundsService;
        _blockchainOptions = blockchainOptions.Value;
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
                PositionId = b.PositionId,
                PositionStatus = b.PositionEntry != null
                    ? b.PositionEntry.Status
                    : (TeamPositionStatus?)null,
                Amount = b.Amount,
                PayoutAmount = b.PayoutAmount,
                BetTime = b.BetTime,
                MatchStatus = b.Match.Status,
                IsWinner = b.IsWinner,
                SettledAt = b.SettledAt,
                Claimed = b.Claimed,
                EndReasonCode = b.Match.EndReasonCode,
                ScoreTeamA = b.Match.ScoreA,
                ScoreTeamB = b.Match.ScoreB
            })
            .ToListAsync(cancellationToken);

        var positions = await _context.UserTeamPosition
            .AsNoTracking()
            .Where(p => p.UserId == user.UserID && p.Status != TeamPositionStatus.Closed)
            .Include(p => p.Team).ThenInclude(t => t.Currency)
            .OrderByDescending(p => p.UpdatedAt)
            .ToListAsync(cancellationToken);

        var openBetPositionIds = await _context.Bet
            .AsNoTracking()
            .Where(b => b.UserId == user.UserID && b.PositionId.HasValue && b.SettledAt == null)
            .Select(b => b.PositionId!.Value)
            .Distinct()
            .ToListAsync(cancellationToken);
        var openBetPositionIdSet = openBetPositionIds.ToHashSet();

        var claimableBets = new List<ClaimableBetDto>();

        var totalInvested = positions.Sum(p => p.PrincipalAllocated);
        var openAmount = betRows.Where(IsOpen).Sum(i => i.Amount);
        const decimal availableReturns = 0m;
        var realizedProfit = betRows.Where(i => i.SettledAt.HasValue).Sum(GetProfitAmount);
        var realizedLoss = betRows.Where(i => i.SettledAt.HasValue).Sum(GetLossAmount);
        var realizedNetResult = realizedProfit - realizedLoss;
        var positionInfoByTeam = positions
            .GroupBy(p => p.TeamId)
            .ToDictionary(
                g => g.Key,
                g => new
                {
                    Symbol = g.First().Team?.Currency?.Symbol ?? $"Team#{g.Key}",
                    CurrencyName = g.First().Team?.Currency?.Name ?? "Moeda",
                    PrincipalAllocated = g.Sum(p => p.PrincipalAllocated),
                    OpenCapital = g
                        .Where(p => openBetPositionIdSet.Contains(p.PositionId))
                        .Sum(p => p.CurrentCapital),
                    OpenCount = g.Count(p => openBetPositionIdSet.Contains(p.PositionId))
                });

        var betGroupsByTeam = betRows
            .GroupBy(x => x.TeamId)
            .ToDictionary(g => g.Key, g => g.ToList());

        var teamIds = betGroupsByTeam.Keys
            .Union(positionInfoByTeam.Keys)
            .ToList();

        var investmentGroups = teamIds
            .Select(teamId =>
            {
                var rows = betGroupsByTeam.TryGetValue(teamId, out var groupedRows)
                    ? groupedRows
                    : [];
                var positionInfo = positionInfoByTeam.TryGetValue(teamId, out var groupedPosition)
                    ? groupedPosition
                    : null;

                var openAmountFromBets = rows.Where(IsOpen).Sum(x => x.Amount);
                var openCountFromBets = rows.Count(IsOpen);
                var symbol = rows.FirstOrDefault()?.TeamSymbol
                    ?? positionInfo?.Symbol
                    ?? $"Team#{teamId}";
                var currencyName = rows.FirstOrDefault()?.TeamName
                    ?? positionInfo?.CurrencyName
                    ?? "Moeda";

                return new MyWalletInvestmentGroupDto
                {
                    TeamId = teamId,
                    Symbol = symbol,
                    CurrencyName = currencyName,
                    TotalInvested = positionInfo?.PrincipalAllocated ?? 0m,
                    OpenAmount = openAmountFromBets,
                    AvailableReturns = 0m,
                    RealizedNetResult = rows.Where(x => x.SettledAt.HasValue).Sum(GetNetAmount),
                    MatchCount = rows.Count,
                    WonCount = rows.Count(IsWon),
                    LostCount = rows.Count(IsLost),
                    OpenCount = openCountFromBets,
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
            BlockchainMode = _blockchainOptions.Mode.ToString(),
            CustodyWalletPublicKey = _blockchainOptions.CustodyWalletPublicKey,
            CustodyWalletLabel = _blockchainOptions.CustodyWalletLabel,
            UsesOnChainContract = _blockchainOptions.UsesOnChainContract,
            EnableOnChainWithdrawals = _blockchainOptions.IsOnChainWithdrawalFlowEnabled(),
            Name = user.Name,
            Email = user.Email,
            DtCreate = user.DtCreate,
            LastLogin = user.LastLogin,
            SystemBalance = user.Balance,
            TotalInvested = totalInvested,
            OpenAmount = openAmount,
            AvailableReturns = availableReturns,
            TotalClaimed = user.TotalClaimed,
            TotalWithdrawn = user.TotalWithdrawn,
            RealizedProfit = realizedProfit,
            RealizedLoss = realizedLoss,
            RealizedNetResult = realizedNetResult,
            OpenInvestments = betRows.Count(IsOpen),
            SettledInvestments = betRows.Count(x => x.SettledAt.HasValue),
            CanClaim = false,
            CanWithdraw = user.Balance > 0m,
            ClaimableBets = claimableBets,
            ActivePositions = positions.Select(p => ToPositionDto(p, openBetPositionIdSet.Contains(p.PositionId))).ToList(),
            InvestmentGroups = investmentGroups
        });
    }

    [HttpPost("claim")]
    public ActionResult<WalletActionResultDto> ClaimAvailableReturns(
        [FromBody] ClaimAvailableReturnsRequest? request,
        CancellationToken cancellationToken)
    {
        _ = request;
        _ = cancellationToken;

        return BadRequest(new
        {
            message = "O claim manual foi desativado. Para liberar saldo para saque, finalize uma posicao ativa fora de jogo ou solicite saida de uma posicao ainda em partida."
        });
    }

    [HttpPost("withdraw")]
    public async Task<ActionResult<WalletActionResultDto>> WithdrawSystemBalance(
        [FromBody] WithdrawSystemBalanceRequest request,
        CancellationToken cancellationToken)
    {
        var wallet = GetAuthenticatedWallet();
        if (string.IsNullOrWhiteSpace(wallet))
            return Unauthorized(new { message = "Token sem wallet valida." });

        var amount = RoundMoney(request.Amount);
        if (amount <= 0m)
            return BadRequest(new { message = "NothingToWithdraw" });

        var strategy = _context.Database.CreateExecutionStrategy();

        try
        {
            WalletActionResultDto? response = null;

            await strategy.ExecuteAsync(async () =>
            {
                await using var transaction = await _context.Database.BeginTransactionAsync(IsolationLevel.Serializable, cancellationToken);

                try
                {
                    var user = await GetAuthenticatedTrackedUserAsync(cancellationToken);
                    if (user is null)
                        throw new InvalidOperationException("Token sem wallet valida.");

                    if (user.Balance <= 0m || amount > user.Balance)
                        throw new WalletFlowException(StatusCodes.Status400BadRequest, "InsufficientSystemBalance");

                    var withdrawResult = await _fundsService.WithdrawAsync(user.Wallet, amount);
                    if (!withdrawResult.Succeeded)
                        throw new WalletFlowException(StatusCodes.Status400BadRequest, withdrawResult.Message, withdrawResult.Code);

                    await transaction.CommitAsync(cancellationToken);

                    response = new WalletActionResultDto
                    {
                        ProcessedAmount = amount,
                        SystemBalance = withdrawResult.BalanceAfter ?? user.Balance,
                        AvailableReturns = 0m,
                        OnChainSignature = request.OnChainSignature,
                        Message = "Saque registrado com sucesso."
                    };
                }
                catch
                {
                    await transaction.RollbackAsync(cancellationToken);
                    throw;
                }
            });

            return Ok(response);
        }
        catch (WalletFlowException ex)
        {
            return StatusCode(ex.StatusCode, new { message = ex.Message, code = ex.Code });
        }
        catch (InvalidOperationException ex)
        {
            return Unauthorized(new { message = ex.Message });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Falha ao processar saque da wallet {Wallet}", wallet);
            return StatusCode(StatusCodes.Status500InternalServerError, new
            {
                message = "WithdrawFailed",
                detail = "Nao foi possivel concluir o saque com seguranca."
            });
        }
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
                TotalDistributed = g.Sum(x => x.PayoutAmount ?? 0m),
                BetCount = g.Count(),
                WalletCount = g.Select(x => x.UserId).Distinct().Count()
            })
            .ToListAsync(cancellationToken);

        var participantRows = await _context.Bet
            .AsNoTracking()
            .Where(b => matchIds.Contains(b.MatchId))
            .Include(b => b.User)
            .Include(b => b.Match)
            .Include(b => b.Team).ThenInclude(t => t.Currency)
            .OrderByDescending(b => b.BetTime)
            .ToListAsync(cancellationToken);

        var participantsByMatch = participantRows
            .GroupBy(x => x.MatchId)
            .ToDictionary(
                g => g.Key,
                g => g.Select(x => new MatchParticipantDto
                {
                    WalletMasked = MaskWallet(x.User?.Wallet),
                    TeamSymbol = x.Team?.Currency?.Symbol ?? $"Team#{x.TeamId}",
                    BetAmount = x.Amount,
                    ResultLabel = GetParticipantResultLabel(x.Match?.Status ?? MatchStatus.Pending, x.IsWinner, x.PayoutAmount ?? 0m, x.Amount, x.Match?.EndReasonCode),
                    ReceivedAmount = GetParticipantReceivedAmount(x.Match?.Status ?? MatchStatus.Pending, x.PayoutAmount ?? 0m, x.Amount, x.Match?.EndReasonCode)
                }).ToList());

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
                var effectiveWinnerTeamId = GetEffectiveWinnerTeamId(match);
                var userTeamSymbol = selectedTeam?.Currency?.Symbol ?? $"Team#{bet.TeamId}";
                var teamASymbol = teamA?.Currency?.Symbol ?? $"Team#{match.TeamAId}";
                var teamBSymbol = teamB?.Currency?.Symbol ?? $"Team#{match.TeamBId}";
                var opponentSymbol = bet.TeamId == match.TeamAId ? teamBSymbol : teamASymbol;
                var teamAPool = matchPoolMap.FirstOrDefault(x => x.MatchId == match.MatchId && x.TeamId == match.TeamAId);
                var teamBPool = matchPoolMap.FirstOrDefault(x => x.MatchId == match.MatchId && x.TeamId == match.TeamBId);
                var totalBetOnTeamA = teamAPool?.TotalAmount ?? 0m;
                var totalBetOnTeamB = teamBPool?.TotalAmount ?? 0m;
                var betCountTeamA = teamAPool?.BetCount ?? 0;
                var betCountTeamB = teamBPool?.BetCount ?? 0;
                var walletCountTeamA = teamAPool?.WalletCount ?? 0;
                var walletCountTeamB = teamBPool?.WalletCount ?? 0;
                var totalDistributed = matchPoolMap.Where(x => x.MatchId == match.MatchId).Sum(x => x.TotalDistributed);
                var totalPool = totalBetOnTeamA + totalBetOnTeamB;
                var hasBetsOnBothSides = totalBetOnTeamA > 0m && totalBetOnTeamB > 0m && walletCountTeamA > 0 && walletCountTeamB > 0;
                var settlementReasonCode = ResolveSettlementReasonCode(match, totalBetOnTeamA, totalBetOnTeamB, walletCountTeamA, walletCountTeamB);
                var hasValidFinancialDispute = HasValidFinancialDispute(match, totalBetOnTeamA, totalBetOnTeamB, walletCountTeamA, walletCountTeamB);
                var winningPool = effectiveWinnerTeamId == match.TeamAId ? totalBetOnTeamA : effectiveWinnerTeamId == match.TeamBId ? totalBetOnTeamB : 0m;
                var losingPool = effectiveWinnerTeamId == match.TeamAId ? totalBetOnTeamB : effectiveWinnerTeamId == match.TeamBId ? totalBetOnTeamA : 0m;
                var houseFeeAmount = hasValidFinancialDispute && match.Status == MatchStatus.Completed ? Math.Round(losingPool * houseFeeRate, 8) : 0m;
                var result = ClassifyResult(match.Status, bet.IsWinner, bet.PayoutAmount ?? 0m, bet.Amount, settlementReasonCode);
                var scoreSummary = $"{teamASymbol} {match.ScoreA} x {match.ScoreB} {teamBSymbol}";
                var winnerSymbol = winner?.Currency?.Symbol
                    ?? (effectiveWinnerTeamId == match.TeamAId ? teamASymbol : effectiveWinnerTeamId == match.TeamBId ? teamBSymbol : null);
                var totalReceivedAmount = GetTotalReceivedAmount(result, bet.PayoutAmount ?? 0m, bet.Amount);
                var refundAmount = GetRefundAmount(result, bet.PayoutAmount ?? 0m, bet.Amount);
                var netResult = GetNetResult(result, totalReceivedAmount, bet.Amount);
                var settlementSteps = BuildSettlementSteps(result, bet.Amount, totalReceivedAmount, refundAmount, netResult, houseFeeAmount, totalPool, totalDistributed, settlementReasonCode, hasValidFinancialDispute);

                return new UserMatchHistoryItemDto
                {
                    BetId = bet.BetId,
                    MatchId = bet.MatchId,
                    UserId = bet.UserId,
                    TeamId = bet.TeamId,
                    TeamAId = match.TeamAId,
                    TeamBId = match.TeamBId,
                    WinnerTeamId = effectiveWinnerTeamId,
                    UserTeamSymbol = userTeamSymbol,
                    OpponentSymbol = opponentSymbol,
                    TeamASymbol = teamASymbol,
                    TeamBSymbol = teamBSymbol,
                    WinnerTeamSymbol = winnerSymbol,
                    CurrencyName = selectedTeam?.Currency?.Name ?? "Moeda",
                    BetAmount = bet.Amount,
                    ReceivedAmount = totalReceivedAmount,
                    PayoutAmount = bet.PayoutAmount ?? 0m,
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
                    HumanSummary = BuildHumanSummary(result, userTeamSymbol, opponentSymbol, bet.Amount, totalReceivedAmount, refundAmount, netResult, winnerSymbol),
                    SettlementSummary = BuildSettlementSummary(result, bet.Amount, totalReceivedAmount, refundAmount, netResult),
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
                    WalletCountTeamA = walletCountTeamA,
                    WalletCountTeamB = walletCountTeamB,
                    BetCountTeamA = betCountTeamA,
                    BetCountTeamB = betCountTeamB,
                    TotalPool = totalPool,
                    WinningPool = winningPool,
                    LosingPool = losingPool,
                    TotalDistributed = totalDistributed,
                    HasBetsOnBothSides = hasBetsOnBothSides,
                    HasValidFinancialDispute = hasValidFinancialDispute,
                    SettlementReasonCode = settlementReasonCode,
                    SettlementReasonDetail = match.EndReasonDetail,
                    ScoreEvents = scoreEventsByMatch.TryGetValue(match.MatchId, out var eventsForMatch) ? eventsForMatch : [],
                    Participants = participantsByMatch.TryGetValue(match.MatchId, out var participants) ? participants : [],
                    SettlementSteps = settlementSteps
                };
            })
            .ToList();

        foreach (var item in items)
        {
            _logger.LogInformation(
                "WalletHistory financial item: matchId={MatchId}, betAmount={BetAmount}, receivedAmount={ReceivedAmount}, refundAmount={RefundAmount}, houseFeeAmount={HouseFeeAmount}, netResult={NetResult}, financialStatus={FinancialStatus}",
                item.MatchId,
                item.BetAmount,
                item.ReceivedAmount,
                item.RefundAmount,
                item.HouseFeeAmount,
                item.NetResult,
                item.UserResultLabel);
        }

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

    private async Task<User?> GetAuthenticatedTrackedUserAsync(CancellationToken cancellationToken)
    {
        var wallet = GetAuthenticatedWallet();
        if (string.IsNullOrWhiteSpace(wallet))
            return null;

        return await _context.User
            .FirstOrDefaultAsync(u => u.Wallet == wallet, cancellationToken);
    }

    private string? GetAuthenticatedWallet()
    {
        return User.FindFirstValue("wallet")
            ?? User.FindFirstValue(ClaimTypes.NameIdentifier)
            ?? User.FindFirstValue(JwtRegisteredClaimNames.Sub);
    }

    private static TeamPositionDto ToPositionDto(UserTeamPosition position, bool hasOpenBet)
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

    private string GetDecimalKey(string key) => _configuration[key] ?? string.Empty;

    private decimal GetDecimal(string key, decimal fallback)
        => decimal.TryParse(GetDecimalKey(key), System.Globalization.NumberStyles.Any, System.Globalization.CultureInfo.InvariantCulture, out var value)
            ? value
            : fallback;

    private static decimal ClampRate(decimal rate)
        => Math.Clamp(rate, 0m, 1m);

    private sealed class WalletFlowException : Exception
    {
        public WalletFlowException(int statusCode, string message, string? code = null)
            : base(message)
        {
            StatusCode = statusCode;
            Code = code;
        }

        public int StatusCode { get; }
        public string? Code { get; }
    }

    private static bool IsOpen(WalletBetSummaryRow row)
        => row.MatchStatus is MatchStatus.Pending or MatchStatus.Ongoing || !row.SettledAt.HasValue && row.MatchStatus == MatchStatus.Completed;

    private static bool IsWon(WalletBetSummaryRow row)
        => ClassifyResult(row.MatchStatus, row.IsWinner, row.PayoutAmount ?? 0m, row.Amount, row.EndReasonCode).Code == "won";

    private static bool IsLost(WalletBetSummaryRow row)
        => ClassifyResult(row.MatchStatus, row.IsWinner, row.PayoutAmount ?? 0m, row.Amount, row.EndReasonCode).IsLoser;

    private static bool IsRefunded(WalletBetSummaryRow row)
        => ClassifyResult(row.MatchStatus, row.IsWinner, row.PayoutAmount ?? 0m, row.Amount, row.EndReasonCode).IsRefunded;

    private static bool IsCancelled(WalletBetSummaryRow row)
        => ClassifyResult(row.MatchStatus, row.IsWinner, row.PayoutAmount ?? 0m, row.Amount, row.EndReasonCode).IsCancelled;

    private static bool IsDraw(WalletBetSummaryRow row)
        => ClassifyResult(row.MatchStatus, row.IsWinner, row.PayoutAmount ?? 0m, row.Amount, row.EndReasonCode).IsDraw;

    private static bool IsClaimableReturn(WalletBetSummaryRow row)
        => row.SettledAt.HasValue
            && !row.Claimed
            && (row.PayoutAmount ?? 0m) > 0m
            && (!row.PositionId.HasValue || row.PositionStatus == TeamPositionStatus.Closed);

    private static decimal GetLossAmount(WalletBetSummaryRow investment)
    {
        var result = ClassifyResult(investment.MatchStatus, investment.IsWinner, investment.PayoutAmount ?? 0m, investment.Amount, investment.EndReasonCode);
        var settledValue = GetTotalReceivedAmount(result, investment.PayoutAmount ?? 0m, investment.Amount);
        return settledValue < investment.Amount ? investment.Amount - settledValue : 0m;
    }

    private static decimal GetProfitAmount(WalletBetSummaryRow investment)
    {
        var result = ClassifyResult(investment.MatchStatus, investment.IsWinner, investment.PayoutAmount ?? 0m, investment.Amount, investment.EndReasonCode);
        var settledValue = GetTotalReceivedAmount(result, investment.PayoutAmount ?? 0m, investment.Amount);
        return settledValue > investment.Amount ? settledValue - investment.Amount : 0m;
    }

    private static decimal GetSettledValue(WalletBetSummaryRow investment)
    {
        var result = ClassifyResult(investment.MatchStatus, investment.IsWinner, investment.PayoutAmount ?? 0m, investment.Amount, investment.EndReasonCode);
        return GetTotalReceivedAmount(result, investment.PayoutAmount ?? 0m, investment.Amount);
    }

    private static decimal GetNetAmount(WalletBetSummaryRow investment)
    {
        var result = ClassifyResult(investment.MatchStatus, investment.IsWinner, investment.PayoutAmount ?? 0m, investment.Amount, investment.EndReasonCode);
        var receivedAmount = GetTotalReceivedAmount(result, investment.PayoutAmount ?? 0m, investment.Amount);
        return GetNetResult(result, receivedAmount, investment.Amount);
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

        var result = ClassifyResult(bet.Match.Status, bet.IsWinner, bet.PayoutAmount ?? 0m, bet.Amount, bet.Match.EndReasonCode);

        return status switch
        {
            "won" => result.Code == "won",
            "lost" => result.IsLoser,
            "open" => result.IsOpen,
            "finalized" => !result.IsOpen,
            _ => true
        };
    }

    private static WalletResultClassification ClassifyResult(MatchStatus matchStatus, bool? isWinner, decimal receivedAmount, decimal betAmount, string? settlementReasonCode)
    {
        if (matchStatus is MatchStatus.Pending or MatchStatus.Ongoing)
            return new("open", "EM ABERTO", IsOpen: true);

        if (matchStatus == MatchStatus.Cancelled || settlementReasonCode == "CANCELLED")
            return new("cancelled", "CANCELADA", IsCancelled: true, IsRefunded: true);

        if (settlementReasonCode == "DRAW_ZERO_ZERO")
            return new("draw-refunded", "REEMBOLSADO", IsRefunded: true, IsDraw: true);

        if (settlementReasonCode is "NO_BETS_ON_TEAM_A" or "NO_BETS_ON_TEAM_B" or "NO_COUNTERPARTY")
            return isWinner == true
                ? new("won-no-opponent-pool", "VENCEU SEM GANHO", IsRefunded: true)
                : new("refunded-no-counterparty", "REEMBOLSADO", IsRefunded: true);

        if (settlementReasonCode == "NO_WINNER")
            return new("refunded", "REEMBOLSADO", IsRefunded: true, IsDraw: true);

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
            "partial-loss" => $"Voce apostou {FmtSol(betAmount)} em {userTeamSymbol}. Recebeu de volta {FmtSol(receivedAmount)}. Perda liquida: {FmtSol(Math.Abs(netResult))}.",
            "refunded" => $"Voce apostou {FmtSol(betAmount)} em {userTeamSymbol}. Sua aposta foi devolvida integralmente. Nenhum prejuizo foi realizado.",
            "cancelled" => $"Sua aposta em {userTeamSymbol} foi devolvida integralmente. Nenhum prejuizo foi realizado.",
            "draw-refunded" => $"Partida terminou sem vencedor. Sua aposta foi devolvida integralmente. Nenhum prejuizo foi realizado.",
            "won-no-opponent-pool" => $"Seu time {userTeamSymbol} venceu a partida, mas nao havia apostas validas do outro lado. Nao houve ganho financeiro nem cobranca de taxa. Sua aposta foi devolvida.",
            "refunded-no-counterparty" => $"Seu time {userTeamSymbol} nao teve contraparte financeira valida. Nao houve perda financeira nem cobranca de taxa. Sua aposta foi devolvida.",
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
            "refunded" => $"Apostado: {FmtSol(betAmount)}. Recebido: {FmtSol(receivedAmount)}. Reembolso: {FmtSol(refundAmount)}. Resultado liquido: 0 SOL.",
            "cancelled" => $"Apostado: {FmtSol(betAmount)}. Recebido: {FmtSol(receivedAmount)}. Reembolso: {FmtSol(refundAmount)}. Resultado liquido: 0 SOL.",
            "draw-refunded" => $"Apostado: {FmtSol(betAmount)}. Recebido: {FmtSol(receivedAmount)}. Reembolso integral: {FmtSol(refundAmount)}. Resultado liquido: 0 SOL.",
            "won-no-opponent-pool" => $"Apostado: {FmtSol(betAmount)}. Sem pool adversaria valida. Valor devolvido: {FmtSol(refundAmount)}. Resultado liquido: 0 SOL.",
            "refunded-no-counterparty" => $"Apostado: {FmtSol(betAmount)}. Sem contraparte financeira valida. Reembolso integral: {FmtSol(refundAmount)}.",
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
        decimal totalDistributed,
        string? settlementReasonCode,
        bool hasValidFinancialDispute)
    {
        var steps = new List<string>
        {
            $"Aposta registrada: {FmtSol(betAmount)}.",
            $"Pool total da partida: {FmtSol(totalPool)}.",
            $"Houve disputa financeira valida? {(hasValidFinancialDispute ? "Sim" : "Nao")}."
        };

        if (!string.IsNullOrWhiteSpace(settlementReasonCode))
            steps.Add($"Motivo da liquidacao: {settlementReasonCode}.");

        if (houseFeeAmount > 0m)
            steps.Add($"Taxa da casa estimada na pool: {FmtSol(houseFeeAmount)}.");

        if (totalDistributed > 0m)
            steps.Add($"Total distribuido na liquidacao: {FmtSol(totalDistributed)}.");

        steps.Add(result.Code switch
        {
            "open" => "Partida ainda nao liquidada.",
            "won" => $"Aposta vencedora. Recebimento: {FmtSol(receivedAmount)}.",
            "lost" => "Aposta perdedora. Nao houve retorno.",
            "partial-loss" => $"Aposta com devolucao parcial. Recebido de volta: {FmtSol(receivedAmount)}.",
            "refunded" => $"Aposta reembolsada integralmente. Recebido: {FmtSol(receivedAmount)}.",
            "cancelled" => $"Partida cancelada. Reembolso integral ao usuario: {FmtSol(refundAmount)}.",
            "draw-refunded" => $"Partida sem vencedor. Reembolso integral: {FmtSol(refundAmount)}.",
            "won-no-opponent-pool" => $"Venceu no placar, mas sem pool adversaria. Reembolso integral: {FmtSol(refundAmount)}.",
            "refunded-no-counterparty" => $"Sem contraparte financeira valida. Reembolso integral: {FmtSol(refundAmount)}.",
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

    private static decimal RoundMoney(decimal value)
        => Math.Round(value, 8, MidpointRounding.ToZero);

    private async Task AddLedgerEntrySafeAsync(
        User user,
        string type,
        decimal amount,
        decimal balanceBefore,
        decimal balanceAfter,
        string description,
        CancellationToken ct)
    {
        _context.Set<Ledger>().Add(new Ledger
        {
            UserId = user.UserID,
            Type = type.Trim().ToUpperInvariant(),
            Amount = RoundMoney(amount),
            BalanceBefore = RoundMoney(balanceBefore),
            BalanceAfter = RoundMoney(balanceAfter),
            CreatedAt = DateTime.UtcNow,
            Description = description
        });

        await _context.SaveChangesAsync(ct);
    }

    private sealed class WalletBetSummaryRow
    {
        public int TeamId { get; init; }
        public string TeamSymbol { get; init; } = "";
        public string TeamName { get; init; } = "";
        public int? PositionId { get; init; }
        public TeamPositionStatus? PositionStatus { get; init; }
        public decimal Amount { get; init; }
        public decimal? PayoutAmount { get; init; }
        public DateTime BetTime { get; init; }
        public MatchStatus MatchStatus { get; init; }
        public bool? IsWinner { get; init; }
        public DateTimeOffset? SettledAt { get; init; }
        public bool Claimed { get; init; }
        public string? EndReasonCode { get; init; }
        public int ScoreTeamA { get; init; }
        public int ScoreTeamB { get; init; }
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

    private static bool HasValidFinancialDispute(
        Match match,
        decimal totalBetOnTeamA,
        decimal totalBetOnTeamB,
        int walletCountTeamA,
        int walletCountTeamB)
        => match.Status == MatchStatus.Completed
           && GetEffectiveWinnerTeamId(match).HasValue
           && match.ScoreA != match.ScoreB
           && totalBetOnTeamA > 0m
           && totalBetOnTeamB > 0m
           && walletCountTeamA > 0
           && walletCountTeamB > 0;

    private static int? GetEffectiveWinnerTeamId(Match match)
    {
        if (match.WinnerTeamId.HasValue)
            return match.WinnerTeamId;

        if (match.Status != MatchStatus.Completed)
            return null;

        if (match.ScoreA > match.ScoreB)
            return match.TeamAId;

        if (match.ScoreB > match.ScoreA)
            return match.TeamBId;

        return null;
    }

    private static string ResolveSettlementReasonCode(
        Match match,
        decimal totalBetOnTeamA,
        decimal totalBetOnTeamB,
        int walletCountTeamA,
        int walletCountTeamB)
    {
        if (!string.IsNullOrWhiteSpace(match.EndReasonCode))
            return match.EndReasonCode!;

        if (match.Status == MatchStatus.Cancelled)
            return "CANCELLED";

        if (match.ScoreA == 0 && match.ScoreB == 0)
            return "DRAW_ZERO_ZERO";

        if (!GetEffectiveWinnerTeamId(match).HasValue || match.ScoreA == match.ScoreB)
            return "NO_WINNER";

        if (totalBetOnTeamA <= 0m || walletCountTeamA <= 0)
            return "NO_BETS_ON_TEAM_A";

        if (totalBetOnTeamB <= 0m || walletCountTeamB <= 0)
            return "NO_BETS_ON_TEAM_B";

        return "SETTLED";
    }

    private static decimal GetTotalReceivedAmount(WalletResultClassification result, decimal payoutAmount, decimal betAmount)
        => result.Code switch
        {
            "won" or "lost" or "partial-loss" => payoutAmount,
            "refunded" => payoutAmount > 0m ? payoutAmount : betAmount,
            "cancelled" or "draw-refunded" or "won-no-opponent-pool" or "refunded-no-counterparty" => betAmount,
            _ => 0m
        };

    private static decimal GetRefundAmount(WalletResultClassification result, decimal payoutAmount, decimal betAmount)
        => result.Code switch
        {
            "partial-loss" => payoutAmount,
            "refunded" => payoutAmount > 0m ? payoutAmount : betAmount,
            "cancelled" or "draw-refunded" or "won-no-opponent-pool" or "refunded-no-counterparty" => betAmount,
            _ => 0m
        };

    private static decimal GetNetResult(WalletResultClassification result, decimal receivedAmount, decimal betAmount)
        => result.IsOpen ? 0m : receivedAmount - betAmount;

    private static string MaskWallet(string? wallet)
    {
        if (string.IsNullOrWhiteSpace(wallet))
            return "-";

        var trimmed = wallet.Trim();
        if (trimmed.Length <= 10)
            return trimmed;

        return $"{trimmed[..4]}...{trimmed[^4..]}";
    }

    private static decimal GetParticipantReceivedAmount(MatchStatus matchStatus, decimal payoutAmount, decimal betAmount, string? settlementReasonCode)
    {
        var result = ClassifyResult(matchStatus, null, payoutAmount, betAmount, settlementReasonCode);
        return GetTotalReceivedAmount(result, payoutAmount, betAmount);
    }

    private static string GetParticipantResultLabel(MatchStatus matchStatus, bool? isWinner, decimal payoutAmount, decimal betAmount, string? settlementReasonCode)
        => ClassifyResult(matchStatus, isWinner, payoutAmount, betAmount, settlementReasonCode).Label;
}
