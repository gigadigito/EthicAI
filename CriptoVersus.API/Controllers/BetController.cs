using BLL;
using BLL.NFTFutebol;
using CriptoVersus.API.Hubs;
using DTOs;
using EthicAI.EntityModel;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text.Json;

namespace CriptoVersus.API.Controllers
{
    [Authorize]
    [ApiController]
    [Route("api/match")]
    public class BetController : ControllerBase
    {
        private readonly EthicAIDbContext _context;
        private readonly ILogger<BetController> _logger;
        private readonly ILedgerService _ledgerService;
        private readonly IHubContext<DashboardHub> _hub;
        private readonly IConfiguration _configuration;

        private const int LiveBetMaxMinutes = 45;

        public BetController(
            EthicAIDbContext context,
            ILogger<BetController> logger,
            ILedgerService ledgerService,
            IHubContext<DashboardHub> hub,
            IConfiguration configuration)
        {
            _context = context;
            _logger = logger;
            _ledgerService = ledgerService;
            _hub = hub;
            _configuration = configuration;
        }

        [HttpPost("{matchId:int}/bet")]
        public async Task<IActionResult> CreateBet(
            int matchId,
            [FromBody] BetCreateRequest request,
            CancellationToken cancellationToken)
        {
            if (request == null)
                return BadRequest("Requisição inválida.");

            var wallet = GetAuthenticatedWallet();
            if (string.IsNullOrWhiteSpace(wallet))
                return Unauthorized(new { message = "Token sem wallet válida." });

            if (request.TeamId <= 0)
                return BadRequest("TeamId inválido.");

            if (request.Amount <= 0)
                return BadRequest("O valor da aposta deve ser maior que zero.");

            request.Amount = decimal.Round(request.Amount, 8, MidpointRounding.ToZero);

            if (request.Amount <= 0)
                return BadRequest("O valor da aposta ficou inválido após o arredondamento.");

            var onChainBettingEnabled = _configuration.GetValue<bool>("OnChainBetting:Enabled");

            if (onChainBettingEnabled && string.IsNullOrWhiteSpace(request.OnChainSignature))
            {
                return BadRequest(new
                {
                    message = "A assinatura da transação Solana é obrigatória para apostas on-chain."
                });
            }

            var strategy = _context.Database.CreateExecutionStrategy();

            BetCreateResponse? response = null;

            try
            {
                await strategy.ExecuteAsync(async () =>
                {
                    await using var transaction = await _context.Database.BeginTransactionAsync(cancellationToken);

                    var match = await _context.Match
                        .Include(m => m.TeamA)
                        .Include(m => m.TeamB)
                        .FirstOrDefaultAsync(m => m.MatchId == matchId, cancellationToken);

                    if (match == null)
                        throw new BetHttpException(StatusCodes.Status404NotFound, $"Partida {matchId} não encontrada.");

                    var authenticatedUser = await _context.User
                        .FirstOrDefaultAsync(u => u.Wallet == wallet, cancellationToken);

                    if (authenticatedUser == null)
                        throw new BetHttpException(StatusCodes.Status404NotFound, "Usuário autenticado não encontrado.");

                    var isAdminWallet = IsAdminWallet(wallet);
                    var targetUserId = request.UserId > 0 ? request.UserId : authenticatedUser.UserID;

                    if (!isAdminWallet && targetUserId != authenticatedUser.UserID)
                    {
                        throw new BetHttpPayloadException(StatusCodes.Status403Forbidden, new
                        {
                            message = "O UserId informado não pertence ao usuário autenticado."
                        });
                    }

                    var user = targetUserId == authenticatedUser.UserID
                        ? authenticatedUser
                        : await _context.User.FirstOrDefaultAsync(u => u.UserID == targetUserId, cancellationToken);

                    if (user == null)
                        throw new BetHttpException(StatusCodes.Status404NotFound, $"Usuário {targetUserId} não encontrado.");

                    if (!IsValidMatchTeam(match, request.TeamId))
                        throw new BetHttpException(StatusCodes.Status400BadRequest, "O TeamId informado não pertence a esta partida.");

                    var elapsedMinutes = GetElapsedMinutes(match);

                    if (!IsBettingWindowOpen(match, elapsedMinutes))
                    {
                        throw new BetHttpPayloadException(StatusCodes.Status400BadRequest, new
                        {
                            message = "A janela de apostas desta partida está fechada.",
                            bettingCloseTime = match.BettingCloseTime,
                            matchStartTime = match.StartTime,
                            matchStatus = match.Status.ToString(),
                            elapsedMinutes,
                            liveBetMaxMinutes = LiveBetMaxMinutes
                        });
                    }

                    if (!onChainBettingEnabled && user.Balance < request.Amount)
                    {
                        throw new BetHttpPayloadException(StatusCodes.Status400BadRequest, new
                        {
                            message = "Saldo insuficiente para realizar a aposta.",
                            currentBalance = user.Balance,
                            requestedAmount = request.Amount
                        });
                    }

                    var nextPosition = (await _context.Bet
                        .Where(b => b.MatchId == matchId)
                        .Select(b => (int?)b.Position)
                        .MaxAsync(cancellationToken) ?? 0) + 1;

                    var nowUtc = DateTime.UtcNow;
                    var balanceBefore = user.Balance;

                    if (!onChainBettingEnabled)
                        user.Balance -= request.Amount;

                    var bet = new DAL.NftFutebol.Bet
                    {
                        MatchId = matchId,
                        TeamId = request.TeamId,
                        UserId = user.UserID,
                        Amount = request.Amount,
                        BetTime = nowUtc,
                        Position = nextPosition,
                        Claimed = false,
                        ClaimedAt = null,
                        IsWinner = null,
                        PayoutAmount = null,
                        SettledAt = null
                    };

                    _context.Bet.Add(bet);

                    await _context.SaveChangesAsync(cancellationToken);

                    await _ledgerService.AddEntryAsync(
                        user: user,
                        type: onChainBettingEnabled ? "BET_ONCHAIN" : "BET",
                        amount: onChainBettingEnabled ? 0m : -request.Amount,
                        balanceBefore: balanceBefore,
                        balanceAfter: user.Balance,
                        referenceId: bet.BetId,
                        description: onChainBettingEnabled
                            ? $"Aposta on-chain realizada no match {bet.MatchId}, team {bet.TeamId}, signature {request.OnChainSignature}"
                            : $"Aposta realizada no match {bet.MatchId}, team {bet.TeamId}",
                        ct: cancellationToken);

                    await transaction.CommitAsync(cancellationToken);

                    _logger.LogInformation(
                        "Aposta criada com sucesso. BetId={BetId}, MatchId={MatchId}, UserId={UserId}, TeamId={TeamId}, Amount={Amount}, BalanceBefore={BalanceBefore}, BalanceAfter={BalanceAfter}, MatchStatus={MatchStatus}, ElapsedMinutes={ElapsedMinutes}",
                        bet.BetId,
                        bet.MatchId,
                        bet.UserId,
                        bet.TeamId,
                        bet.Amount,
                        balanceBefore,
                        user.Balance,
                        match.Status,
                        elapsedMinutes);

                    response = new BetCreateResponse
                    {
                        BetId = bet.BetId,
                        MatchId = bet.MatchId,
                        UserId = bet.UserId,
                        TeamId = bet.TeamId,
                        Amount = bet.Amount,
                        UserBalanceAfterBet = user.Balance,
                        BetTime = bet.BetTime,
                        Position = bet.Position,
                        Claimed = bet.Claimed,
                        IsWinner = bet.IsWinner,
                        PayoutAmount = bet.PayoutAmount,
                        SettledAt = bet.SettledAt,
                        BettingCloseTime = match.BettingCloseTime,
                        OnChainSignature = request.OnChainSignature,
                        Message = "Aposta registrada com sucesso."
                    };
                });

                if (response is not null)
                    await NotifyDashboardChangedAsync(response, cancellationToken);

                return Ok(response);
            }
            catch (BetHttpPayloadException ex)
            {
                return StatusCode(ex.StatusCode, ex.Payload);
            }
            catch (BetHttpException ex)
            {
                return StatusCode(ex.StatusCode, ex.Message);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex,
                    "Erro ao criar aposta para MatchId={MatchId}, UserId={UserId}, TeamId={TeamId}, Amount={Amount}",
                    matchId,
                    request?.UserId,
                    request?.TeamId,
                    request?.Amount);

                return StatusCode(StatusCodes.Status500InternalServerError, new
                {
                    message = "Erro interno ao registrar a aposta.",
                    detail = ex.Message
                });
            }
        }

        private static bool IsValidMatchTeam(DAL.NftFutebol.Match match, int teamId)
        {
            return match.TeamAId == teamId || match.TeamBId == teamId;
        }

        private string? GetAuthenticatedWallet()
        {
            return User.FindFirstValue("wallet")
                ?? User.FindFirstValue(ClaimTypes.NameIdentifier)
                ?? User.FindFirstValue(JwtRegisteredClaimNames.Sub);
        }

        private bool IsAdminWallet(string wallet)
        {
            var adminWallet = _configuration["CriptoVersus:AdminWallet"];

            return !string.IsNullOrWhiteSpace(adminWallet)
                && string.Equals(wallet, adminWallet, StringComparison.Ordinal);
        }

        private Task NotifyDashboardChangedAsync(BetCreateResponse response, CancellationToken cancellationToken)
        {
            return _hub.Clients.All.SendAsync(
                "dashboard_changed",
                JsonSerializer.Serialize(new
                {
                    reason = "bet_created",
                    response.MatchId,
                    response.BetId,
                    response.UserId,
                    utc = DateTimeOffset.UtcNow
                }),
                cancellationToken);
        }

        private static bool IsBettingWindowOpen(DAL.NftFutebol.Match match, int elapsedMinutes)
        {
            var now = DateTimeOffset.UtcNow;

            if (match.Status == MatchStatus.Pending)
            {
                if (match.BettingCloseTime.HasValue)
                    return now <= match.BettingCloseTime.Value;

                return match.StartTime.HasValue && now < match.StartTime.Value;
            }

            if (match.Status == MatchStatus.Ongoing)
            {
                return elapsedMinutes >= 0 && elapsedMinutes < LiveBetMaxMinutes;
            }

            return false;
        }

        private static int GetElapsedMinutes(DAL.NftFutebol.Match match)
        {
            if (!match.StartTime.HasValue)
                return 0;

            var startUtc = match.StartTime.Value.ToUniversalTime();
            var elapsed = DateTime.UtcNow - startUtc;

            if (elapsed.TotalMinutes < 0)
                return 0;

            return (int)elapsed.TotalMinutes;
        }

        private sealed class BetHttpException : Exception
        {
            public int StatusCode { get; }

            public BetHttpException(int statusCode, string message) : base(message)
            {
                StatusCode = statusCode;
            }
        }

        private sealed class BetHttpPayloadException : Exception
        {
            public int StatusCode { get; }
            public object Payload { get; }

            public BetHttpPayloadException(int statusCode, object payload)
            {
                StatusCode = statusCode;
                Payload = payload;
            }
        }
    }
}
