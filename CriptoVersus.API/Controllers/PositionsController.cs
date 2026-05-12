using BLL;
using BLL.Blockchain;
using BLL.Positions;
using DAL.NftFutebol;
using DTOs;
using EthicAI.EntityModel;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Microsoft.AspNetCore.SignalR;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text.Json;
using CriptoVersus.API.Hubs;

namespace CriptoVersus.API.Controllers;

[Authorize]
[ApiController]
[Route("api/positions")]
public sealed class PositionsController : ControllerBase
{
    private readonly EthicAIDbContext _context;
    private readonly ILedgerService _ledgerService;
    private readonly IPositionOrchestrationService _positionService;
    private readonly IConfiguration _configuration;
    private readonly CriptoVersusBlockchainOptions _blockchainOptions;
    private readonly IHubContext<DashboardHub> _hub;

    public PositionsController(
        EthicAIDbContext context,
        ILedgerService ledgerService,
        IPositionOrchestrationService positionService,
        IConfiguration configuration,
        IOptions<CriptoVersusBlockchainOptions> blockchainOptions,
        IHubContext<DashboardHub> hub)
    {
        _context = context;
        _ledgerService = ledgerService;
        _positionService = positionService;
        _configuration = configuration;
        _blockchainOptions = blockchainOptions.Value;
        _hub = hub;
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

    [HttpGet("assets")]
    [HttpGet("/api/wallet/position-assets")]
    public async Task<ActionResult<List<PositionAssetOptionDto>>> GetPositionAssets(
        [FromQuery] string? search,
        [FromQuery] int take = 40,
        CancellationToken ct = default)
    {
        var user = await GetAuthenticatedUserAsync(ct);
        if (user is null)
            return Unauthorized(new { message = "Token sem wallet valida." });

        take = Math.Clamp(take, 1, 60);
        var normalizedSearch = search?.Trim();
        var nowUtc = DateTime.UtcNow;
        var rankingMinUtc = nowUtc.AddMinutes(-20);
        var workerMinUtc = nowUtc.AddHours(-6);
        var recentMatchMinUtc = nowUtc.AddDays(-14);

        var rankingSymbols = await _context.Set<Currency>()
            .AsNoTracking()
            .Where(c => EF.Functions.ILike(c.Symbol, "%USDT"))
            .Where(c => c.LastUpdated >= rankingMinUtc)
            .OrderByDescending(c => c.PercentageChange)
            .ThenByDescending(c => c.LastUpdated)
            .Select(c => c.Symbol)
            .Take(40)
            .ToListAsync(ct);
        var rankingSymbolSet = rankingSymbols
            .Where(symbol => !MatchPairRules.IsForbiddenStablecoin(symbol, _configuration))
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        var liveMatchQuery = _context.Match
            .AsNoTracking()
            .Where(m => m.Status == MatchStatus.Ongoing);
        var liveTeamIds = await liveMatchQuery
            .Select(m => m.TeamAId)
            .Union(liveMatchQuery.Select(m => m.TeamBId))
            .Distinct()
            .ToListAsync(ct);
        var liveTeamIdSet = liveTeamIds.ToHashSet();

        var upcomingMatchQuery = _context.Match
            .AsNoTracking()
            .Where(m => m.Status == MatchStatus.Pending)
            .Where(m =>
                (m.BettingCloseTime.HasValue && m.BettingCloseTime.Value > nowUtc) ||
                (!m.BettingCloseTime.HasValue && m.StartTime.HasValue && m.StartTime.Value > nowUtc));
        var upcomingTeamIds = await upcomingMatchQuery
            .Select(m => m.TeamAId)
            .Union(upcomingMatchQuery.Select(m => m.TeamBId))
            .Distinct()
            .ToListAsync(ct);
        var upcomingTeamIdSet = upcomingTeamIds.ToHashSet();

        var recentMatchQuery = _context.Match
            .AsNoTracking()
            .Where(m =>
                (m.StartTime.HasValue && m.StartTime.Value >= recentMatchMinUtc) ||
                (m.EndTime.HasValue && m.EndTime.Value >= recentMatchMinUtc) ||
                m.Status == MatchStatus.Pending ||
                m.Status == MatchStatus.Ongoing);
        var recentMatchTeamIds = await recentMatchQuery
            .Select(m => m.TeamAId)
            .Union(recentMatchQuery.Select(m => m.TeamBId))
            .Distinct()
            .ToListAsync(ct);
        var recentMatchTeamIdSet = recentMatchTeamIds.ToHashSet();

        var candidateMatchRows = await recentMatchQuery
            .Select(m => new
            {
                m.MatchId,
                m.TeamAId,
                m.TeamBId,
                Status = m.Status.ToString(),
                m.StartTime,
                m.BettingCloseTime
            })
            .ToListAsync(ct);

        var matchContextByTeamId = candidateMatchRows
            .SelectMany(m => new[]
            {
                new AssetMatchContext(m.MatchId, m.TeamAId, m.Status, m.StartTime, m.BettingCloseTime),
                new AssetMatchContext(m.MatchId, m.TeamBId, m.Status, m.StartTime, m.BettingCloseTime)
            })
            .GroupBy(x => x.TeamId)
            .ToDictionary(
                g => g.Key,
                g => g.OrderByDescending(x => string.Equals(x.Status, "Ongoing", StringComparison.OrdinalIgnoreCase))
                    .ThenByDescending(x => string.Equals(x.Status, "Pending", StringComparison.OrdinalIgnoreCase))
                    .ThenByDescending(x => x.StartTimeUtc ?? DateTime.MinValue)
                    .First());

        var workerTeamIds = await _context.MatchMetricSnapshot
            .AsNoTracking()
            .Where(s => s.CapturedAtUtc >= workerMinUtc)
            .Select(s => s.TeamId)
            .Distinct()
            .ToListAsync(ct);
        var workerTeamIdSet = workerTeamIds.ToHashSet();

        var openPositionTeamIds = await _context.UserTeamPosition
            .AsNoTracking()
            .Where(p => p.UserId == user.UserID && p.Status != TeamPositionStatus.Closed)
            .Select(p => p.TeamId)
            .Distinct()
            .ToListAsync(ct);
        var openPositionTeamIdSet = openPositionTeamIds.ToHashSet();

        var candidateTeams = await _context.Team
            .AsNoTracking()
            .Include(t => t.Currency)
            .Where(t => t.Currency != null)
            .Where(t =>
                recentMatchTeamIdSet.Contains(t.TeamId) ||
                workerTeamIdSet.Contains(t.TeamId) ||
                rankingSymbolSet.Contains(t.Currency.Symbol))
            .Where(t =>
                string.IsNullOrWhiteSpace(normalizedSearch) ||
                EF.Functions.ILike(t.Currency.Symbol, $"%{normalizedSearch}%") ||
                EF.Functions.ILike(t.Currency.Name, $"%{normalizedSearch}%"))
            .ToListAsync(ct);

        var items = candidateTeams
            .Where(t => !MatchPairRules.IsForbiddenStablecoin(t.Currency.Symbol, _configuration))
            .Select(t =>
            {
                var pct = decimal.Round((decimal)t.Currency.PercentageChange, 4, MidpointRounding.AwayFromZero);
                matchContextByTeamId.TryGetValue(t.TeamId, out var matchContext);
                var accessDecision = matchContext is null
                    ? InvestmentAccessDecision.Allow(0)
                    : InvestmentAccessPolicy.EvaluatePersistentExposure(
                        matchContext.Status,
                        matchContext.StartTimeUtc,
                        matchContext.BettingCloseTimeUtc,
                        nowUtc: nowUtc);

                return new
                {
                    Team = t,
                    Score =
                        (accessDecision.CanInvest ? 2200 : 0) +
                        (liveTeamIdSet.Contains(t.TeamId) ? 1000 : 0) +
                        (upcomingTeamIdSet.Contains(t.TeamId) ? 450 : 0) +
                        (workerTeamIdSet.Contains(t.TeamId) ? 225 : 0) +
                        (rankingSymbolSet.Contains(t.Currency.Symbol) ? 125 : 0) +
                        (openPositionTeamIdSet.Contains(t.TeamId) ? 25 : 0),
                    PercentageChange = pct,
                    AccessDecision = accessDecision,
                    MatchContext = matchContext
                };
            })
            .OrderByDescending(x => x.Score)
            .ThenByDescending(x => Math.Abs(x.PercentageChange))
            .ThenByDescending(x => x.Team.Currency.LastUpdated)
            .ThenBy(x => x.Team.Currency.Symbol)
            .Take(take)
            .Select(x => new PositionAssetOptionDto
            {
                TeamId = x.Team.TeamId,
                Symbol = x.Team.Currency.Symbol,
                CurrencyName = string.IsNullOrWhiteSpace(x.Team.Currency.Name) ? x.Team.Currency.Symbol : x.Team.Currency.Name,
                PercentageChange = x.PercentageChange,
                LastUpdatedUtc = x.Team.Currency.LastUpdated,
                CurrentPriceDisplay = null,
                HasLiveMatch = liveTeamIdSet.Contains(x.Team.TeamId),
                HasUpcomingMatch = upcomingTeamIdSet.Contains(x.Team.TeamId),
                IsRankingAsset = rankingSymbolSet.Contains(x.Team.Currency.Symbol),
                IsWorkerAsset = workerTeamIdSet.Contains(x.Team.TeamId),
                HasOpenPosition = openPositionTeamIdSet.Contains(x.Team.TeamId),
                TrendDirection = x.PercentageChange > 0m ? "up" : x.PercentageChange < 0m ? "down" : "flat",
                CanInvestNow = x.AccessDecision.CanInvest,
                AccessReasonCode = x.AccessDecision.ReasonCode,
                AccessMessage = BuildAccessMessage(x.AccessDecision, x.MatchContext),
                MatchStatus = x.MatchContext?.Status,
                MatchId = x.MatchContext?.MatchId,
                MatchElapsedMinutes = x.AccessDecision.ElapsedMinutes,
                MatchStartTimeUtc = x.MatchContext?.StartTimeUtc,
                EntryCutoffUtc = x.MatchContext is null
                    ? null
                    : InvestmentAccessPolicy.GetEntryCutoffUtc(x.MatchContext.Status, x.MatchContext.StartTimeUtc)
            })
            .ToList();

        return Ok(items);
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

            var teamAccessDecision = await EvaluateTeamInvestmentAccessAsync(request.TeamId, ct);
            if (!teamAccessDecision.CanInvest)
            {
                return BadRequest(new
                {
                    message = BuildAccessMessage(teamAccessDecision, await GetAssetMatchContextAsync(request.TeamId, ct)),
                    reasonCode = teamAccessDecision.ReasonCode,
                    elapsedMinutes = teamAccessDecision.ElapsedMinutes,
                    advancedLiveThresholdMinutes = InvestmentAccessPolicy.AdvancedLiveThresholdMinutes
                });
            }

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
                var isNewPosition = false;
                var capitalBefore = 0m;
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
                    isNewPosition = true;
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
                        ExposureMode = PositionExposureMode.MatchRecurring,
                        BlockchainModeSnapshot = _positionService.BuildBlockchainModeSnapshot(),
                        TotalPnL = 0m,
                        TotalWins = 0,
                        TotalLosses = 0,
                        CreatedAt = nowUtc,
                        UpdatedAt = nowUtc
                    };

                    _context.UserTeamPosition.Add(position);
                }
                else
                {
                    capitalBefore = position.CurrentCapital;
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
                    position.ExposureMode = PositionExposureMode.MatchRecurring;
                    position.BlockchainModeSnapshot ??= _positionService.BuildBlockchainModeSnapshot();
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

                await _positionService.RecordLifecycleEventAsync(
                    _context,
                    position,
                    isNewPosition ? PositionLifecycleEventType.Opened : PositionLifecycleEventType.Increased,
                    nowUtc,
                    amount: request.Amount,
                    capitalBefore: isNewPosition ? 0m : capitalBefore,
                    capitalAfter: position.CurrentCapital,
                    notes: isNewPosition
                        ? "Persistent position opened from /api/positions."
                        : "Persistent position capital increased from /api/positions.",
                    ct: ct);

                await transaction.CommitAsync(ct);
            });

            await _context.Entry(position!).Reference(p => p.Team).LoadAsync(ct);
            await _context.Entry(position!.Team).Reference(t => t.Currency).LoadAsync(ct);
            await NotifyPositionChangedAsync(position!, user.UserID, ct);

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
                    var teamAccessDecision = await EvaluateTeamInvestmentAccessAsync(position.TeamId, ct);
                    if (!teamAccessDecision.CanInvest)
                    {
                        throw new InvalidOperationException(
                            BuildAccessMessage(teamAccessDecision, await GetAssetMatchContextAsync(position.TeamId, ct)));
                    }

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

                    var capitalBefore = position.CurrentCapital;
                    position.PrincipalAllocated = RoundMoney(position.PrincipalAllocated + amount);
                    position.CurrentCapital = RoundMoney(position.CurrentCapital + amount);
                    position.Status = TeamPositionStatus.Active;
                    position.ClosedAt = null;
                    position.ExposureMode = PositionExposureMode.MatchRecurring;
                    position.BlockchainModeSnapshot ??= _positionService.BuildBlockchainModeSnapshot();

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

                    await _positionService.RecordLifecycleEventAsync(
                        _context,
                        position,
                        PositionLifecycleEventType.Increased,
                        DateTime.UtcNow,
                        amount: amount,
                        capitalBefore: capitalBefore,
                        capitalAfter: position.CurrentCapital,
                        notes: "Persistent position increased via PATCH /api/positions/{id}.",
                        ct: ct);
                }

                if (request.AutoCompound.HasValue)
                {
                    var previousAutoCompound = position.AutoCompound;
                    position.AutoCompound = request.AutoCompound.Value;

                    if (previousAutoCompound != position.AutoCompound)
                    {
                        await _positionService.RecordLifecycleEventAsync(
                            _context,
                            position,
                            position.AutoCompound ? PositionLifecycleEventType.Resumed : PositionLifecycleEventType.Paused,
                            DateTime.UtcNow,
                            capitalBefore: position.CurrentCapital,
                            capitalAfter: position.CurrentCapital,
                            notes: position.AutoCompound
                                ? "Persistent position resumed for future match exposures."
                                : "Persistent position paused for future match exposures.",
                            ct: ct);
                    }
                }

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

                await _positionService.RecordLifecycleEventAsync(
                    _context,
                    position,
                    PositionLifecycleEventType.ClosingRequested,
                    nowUtc,
                    capitalBefore: position.CurrentCapital,
                    capitalAfter: position.CurrentCapital,
                    notes: "Close requested while the position still has ongoing match exposure.",
                    ct: ct);
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

                await _positionService.RecordLifecycleEventAsync(
                    _context,
                    position,
                    PositionLifecycleEventType.Closed,
                    nowUtc,
                    amount: releasableAmount,
                    capitalBefore: releasableAmount,
                    capitalAfter: position.CurrentCapital,
                    notes: "Persistent position closed and capital released back to the user balance.",
                    ct: ct);
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

    private async Task<InvestmentAccessDecision> EvaluateTeamInvestmentAccessAsync(int teamId, CancellationToken ct)
    {
        var ongoingMatches = await _context.Match
            .AsNoTracking()
            .Where(m =>
                m.Status == MatchStatus.Ongoing &&
                (m.TeamAId == teamId || m.TeamBId == teamId))
            .OrderByDescending(m => m.StartTime ?? DateTime.MinValue)
            .ToListAsync(ct);

        foreach (var match in ongoingMatches)
        {
            var decision = InvestmentAccessPolicy.EvaluatePersistentExposure(
                match.Status.ToString(),
                match.StartTime,
                match.BettingCloseTime,
                nowUtc: DateTimeOffset.UtcNow);

            if (!decision.CanInvest)
                return decision;
        }

        return InvestmentAccessDecision.Allow(0);
    }

    private async Task<AssetMatchContext?> GetAssetMatchContextAsync(int teamId, CancellationToken ct)
    {
        var nowUtc = DateTime.UtcNow;
        var recentMatchMinUtc = nowUtc.AddDays(-14);

        var match = await _context.Match
            .AsNoTracking()
            .Where(m =>
                (m.TeamAId == teamId || m.TeamBId == teamId) &&
                (
                    (m.StartTime.HasValue && m.StartTime.Value >= recentMatchMinUtc) ||
                    (m.EndTime.HasValue && m.EndTime.Value >= recentMatchMinUtc) ||
                    m.Status == MatchStatus.Pending ||
                    m.Status == MatchStatus.Ongoing
                ))
            .Select(m => new AssetMatchContext(
                m.MatchId,
                teamId,
                m.Status.ToString(),
                m.StartTime,
                m.BettingCloseTime))
            .ToListAsync(ct);

        return match
            .OrderByDescending(x => string.Equals(x.Status, "Ongoing", StringComparison.OrdinalIgnoreCase))
            .ThenByDescending(x => string.Equals(x.Status, "Pending", StringComparison.OrdinalIgnoreCase))
            .ThenByDescending(x => x.StartTimeUtc ?? DateTime.MinValue)
            .FirstOrDefault();
    }

    private static string BuildAccessMessage(InvestmentAccessDecision decision, AssetMatchContext? matchContext)
    {
        if (decision.CanInvest)
        {
            if (matchContext is null)
                return "Ativo disponivel para abrir posicao agora.";

            var status = string.Equals(matchContext.Status, "Ongoing", StringComparison.OrdinalIgnoreCase)
                ? "Partida em andamento"
                : string.Equals(matchContext.Status, "Pending", StringComparison.OrdinalIgnoreCase)
                    ? "Partida pendente"
                    : $"Status {matchContext.Status}";

            return $"{status} na partida #{matchContext.MatchId}. Entrada liberada no momento.";
        }

        if (string.Equals(decision.ReasonCode, InvestmentAccessPolicy.AdvancedLiveMatchReason, StringComparison.OrdinalIgnoreCase))
        {
            var matchLabel = matchContext is null ? "este ativo" : $"a partida #{matchContext.MatchId}";
            var cutoffMinute = InvestmentAccessPolicy.AdvancedLiveThresholdMinutes;
            return $"Nao e possivel aumentar exposicao agora: {matchLabel} esta em fase avancada. Status={(matchContext?.Status ?? "desconhecido")}, tempo decorrido={decision.ElapsedMinutes} min, limite de entrada={cutoffMinute} min.";
        }

        if (string.Equals(decision.ReasonCode, InvestmentAccessPolicy.MatchNotOpenReason, StringComparison.OrdinalIgnoreCase))
        {
            return matchContext is null
                ? "Este ativo nao esta em uma partida aberta no momento, mas continua disponivel para posicao persistente quando entrar em novo ciclo."
                : $"A partida #{matchContext.MatchId} nao esta aberta para nova exposicao agora. Status={matchContext.Status}.";
        }

        return "Este ativo nao esta disponivel para nova exposicao no momento.";
    }

    private Task NotifyPositionChangedAsync(UserTeamPosition position, int userId, CancellationToken ct)
    {
        return _hub.Clients.All.SendAsync(
            "dashboard_changed",
            JsonSerializer.Serialize(new
            {
                reason = "position_upsert",
                positionId = position.PositionId,
                position.TeamId,
                userId,
                utc = DateTimeOffset.UtcNow
            }),
            ct);
    }

    private sealed record AssetMatchContext(
        int MatchId,
        int TeamId,
        string Status,
        DateTime? StartTimeUtc,
        DateTimeOffset? BettingCloseTimeUtc);

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
            ExposureMode = position.ExposureMode.ToString(),
            BlockchainModeSnapshot = position.BlockchainModeSnapshot,
            TotalPnL = position.TotalPnL,
            TotalWins = position.TotalWins,
            TotalLosses = position.TotalLosses,
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
