using DTOs;
using EthicAI.EntityModel;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.Globalization;

namespace CriptoVersus.API.Controllers
{
    [ApiController]
    [Route("api/match")]
    public class BetController : ControllerBase
    {
        private readonly EthicAIDbContext _context;
        private readonly ILogger<BetController> _logger;

        public BetController(EthicAIDbContext context, ILogger<BetController> logger)
        {
            _context = context;
            _logger = logger;
        }

        [HttpPost("{matchId:int}/bet")]
        public async Task<IActionResult> CreateBet(int matchId, [FromBody] BetCreateRequest request, CancellationToken cancellationToken)
        {
            if (request == null)
                return BadRequest("Requisição inválida.");

            if (request.UserId <= 0)
                return BadRequest("UserId inválido.");

            if (request.TeamId <= 0)
                return BadRequest("TeamId inválido.");

            if (request.Amount <= 0)
                return BadRequest("O valor da aposta deve ser maior que zero.");

            // Evita valores absurdos de casas decimais além do que o banco suporta
            request.Amount = decimal.Round(request.Amount, 8, MidpointRounding.ToZero);

            if (request.Amount <= 0)
                return BadRequest("O valor da aposta ficou inválido após o arredondamento.");

            await using var transaction = await _context.Database.BeginTransactionAsync(cancellationToken);

            try
            {
                var match = await _context.Match
                    .Include(m => m.TeamA)
                    .Include(m => m.TeamB)
                    .FirstOrDefaultAsync(m => m.MatchId == matchId, cancellationToken);

                if (match == null)
                    return NotFound($"Partida {matchId} não encontrada.");

                var user = await _context.User
                    .FirstOrDefaultAsync(u => u.UserID == request.UserId, cancellationToken);

                if (user == null)
                    return NotFound($"Usuário {request.UserId} não encontrado.");

                if (!IsValidMatchTeam(match, request.TeamId))
                    return BadRequest("O TeamId informado não pertence a esta partida.");

                if (!IsBettingWindowOpen(match))
                    return BadRequest(new
                    {
                        message = "A janela de apostas desta partida está fechada.",
                        bettingCloseTime = match.BettingCloseTime,
                        matchStartTime = match.StartTime,
                        matchStatus = match.Status.ToString()
                    });

                if (user.Balance < request.Amount)
                    return BadRequest(new
                    {
                        message = "Saldo insuficiente para realizar a aposta.",
                        currentBalance = user.Balance,
                        requestedAmount = request.Amount
                    });

                // posição da aposta dentro da partida
                var nextPosition = (await _context.Bet
                    .Where(b => b.MatchId == matchId)
                    .Select(b => (int?)b.Position)
                    .MaxAsync(cancellationToken) ?? 0) + 1;

                var now = DateTimeOffset.UtcNow;

                user.Balance -= request.Amount;

                var bet = new DAL.NftFutebol.Bet
                {
                    MatchId = matchId,
                    TeamId = request.TeamId,
                    UserId = request.UserId,
                    Amount = request.Amount,
                    BetTime = now.UtcDateTime,
                    Position = nextPosition,
                    Claimed = false,
                    ClaimedAt = null,
                    IsWinner = null,
                    PayoutAmount = null,
                    SettledAt = null
                };

                _context.Bet.Add(bet);

                await _context.SaveChangesAsync(cancellationToken);
                await transaction.CommitAsync(cancellationToken);

                _logger.LogInformation(
                    "Aposta criada com sucesso. BetId={BetId}, MatchId={MatchId}, UserId={UserId}, TeamId={TeamId}, Amount={Amount}",
                    bet.BetId, bet.MatchId, bet.UserId, bet.TeamId, bet.Amount);

                var response = new BetCreateResponse
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
                    Message = "Aposta registrada com sucesso."
                };

                return Ok(response);
            }
            catch (Exception ex)
            {
                await transaction.RollbackAsync(cancellationToken);

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

        private static bool IsBettingWindowOpen(DAL.NftFutebol.Match match)
        {
            var now = DateTimeOffset.UtcNow;

            // Se tiver BettingCloseTime, ela manda na regra
            if (match.BettingCloseTime.HasValue)
                return now <= match.BettingCloseTime.Value;

            // fallback: se não houver BettingCloseTime, usa StartTime
            return now < match.StartTime;
        }
    }
}