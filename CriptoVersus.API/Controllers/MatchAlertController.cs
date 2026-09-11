using DTOs;
using EthicAI.EntityModel;
using DAL.NftFutebol;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace CriptoVersus.API.Controllers
{
    [ApiController]
    [Route("api/matches/{matchId:int}/alerts")]
    public class MatchAlertController : ControllerBase
    {
        private readonly IDbContextFactory<EthicAIDbContext> _dbFactory;
        private readonly ILogger<MatchAlertController> _logger;

        public MatchAlertController(IDbContextFactory<EthicAIDbContext> dbFactory, ILogger<MatchAlertController> logger)
        {
            _dbFactory = dbFactory;
            _logger = logger;
        }

        [AllowAnonymous]
        [HttpPost]
        public async Task<ActionResult<MatchAlertSubscribeResponseDto>> Subscribe(
            int matchId,
            [FromBody] MatchAlertSubscribeRequestDto request,
            CancellationToken ct = default)
        {
            if (request.PushSubscriptionId <= 0)
                return BadRequest(new MatchAlertSubscribeResponseDto { Success = false, Error = "PushSubscriptionId is required." });

            await using var db = await _dbFactory.CreateDbContextAsync(ct);

            var subscription = await db.PushSubscription
                .FirstOrDefaultAsync(s => s.PushSubscriptionId == request.PushSubscriptionId && s.IsActive, ct);

            if (subscription is null)
                return NotFound(new MatchAlertSubscribeResponseDto { Success = false, Error = "Push subscription not found or inactive." });

            var matchExists = await db.Match.AnyAsync(m => m.MatchId == matchId, ct);
            if (!matchExists)
                return NotFound(new MatchAlertSubscribeResponseDto { Success = false, Error = "Match not found." });

            var existing = await db.MatchAlertSubscription
                .FirstOrDefaultAsync(s => s.PushSubscriptionId == request.PushSubscriptionId
                                      && s.MatchId == matchId
                                      && s.IsActive, ct);

            if (existing is not null)
            {
                existing.IsNotifyScore = request.NotifyScore;
                existing.IsNotifyComeback = request.NotifyComeback;
                existing.IsNotifyFinished = request.NotifyFinished;
                existing.Culture = request.Culture ?? "en";
                await db.SaveChangesAsync(ct);

                return Ok(new MatchAlertSubscribeResponseDto
                {
                    Success = true,
                    AlertSubscriptionId = existing.MatchAlertSubscriptionId
                });
            }

            var alertSub = new MatchAlertSubscription
            {
                PushSubscriptionId = request.PushSubscriptionId,
                MatchId = matchId,
                IsNotifyScore = request.NotifyScore,
                IsNotifyComeback = request.NotifyComeback,
                IsNotifyFinished = request.NotifyFinished,
                Culture = request.Culture ?? "en",
                CreatedAt = DateTime.UtcNow,
                IsActive = true
            };

            db.MatchAlertSubscription.Add(alertSub);
            await db.SaveChangesAsync(ct);

            _logger.LogInformation(
                "[MATCH_ALERT] Alert subscription created. SubscriptionId={SubscriptionId} MatchId={MatchId}",
                alertSub.MatchAlertSubscriptionId, matchId);

            return Ok(new MatchAlertSubscribeResponseDto
            {
                Success = true,
                AlertSubscriptionId = alertSub.MatchAlertSubscriptionId
            });
        }

        [AllowAnonymous]
        [HttpDelete]
        public async Task<ActionResult<MatchAlertSubscribeResponseDto>> Unsubscribe(
            int matchId,
            [FromQuery] long pushSubscriptionId,
            CancellationToken ct = default)
        {
            if (pushSubscriptionId <= 0)
                return BadRequest(new MatchAlertSubscribeResponseDto { Success = false, Error = "PushSubscriptionId query parameter is required." });

            await using var db = await _dbFactory.CreateDbContextAsync(ct);

            var count = await db.MatchAlertSubscription
                .Where(s => s.PushSubscriptionId == pushSubscriptionId
                         && s.MatchId == matchId
                         && s.IsActive)
                .ExecuteUpdateAsync(s => s
                    .SetProperty(s => s.IsActive, false), ct);

            return Ok(new MatchAlertSubscribeResponseDto
            {
                Success = true,
                AlertSubscriptionId = count > 0 ? 0 : null,
                Error = count == 0 ? "No active subscription found." : null
            });
        }

        [AllowAnonymous]
        [HttpGet]
        public async Task<ActionResult<MatchAlertStatusDto>> GetStatus(
            int matchId,
            [FromQuery] long pushSubscriptionId,
            CancellationToken ct = default)
        {
            if (pushSubscriptionId <= 0)
                return BadRequest(new MatchAlertStatusDto { MatchId = matchId, HasActiveSubscription = false });

            await using var db = await _dbFactory.CreateDbContextAsync(ct);

            var sub = await db.MatchAlertSubscription
                .FirstOrDefaultAsync(s => s.PushSubscriptionId == pushSubscriptionId
                                      && s.MatchId == matchId
                                      && s.IsActive, ct);

            return Ok(new MatchAlertStatusDto
            {
                MatchId = matchId,
                HasActiveSubscription = sub is not null,
                NotifyScore = sub?.IsNotifyScore ?? false,
                NotifyComeback = sub?.IsNotifyComeback ?? false,
                NotifyFinished = sub?.IsNotifyFinished ?? false,
                PushSubscriptionId = sub?.PushSubscriptionId
            });
        }
    }
}
