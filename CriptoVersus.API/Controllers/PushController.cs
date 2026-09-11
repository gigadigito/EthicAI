using DTOs;
using EthicAI.EntityModel;
using DAL.NftFutebol;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace CriptoVersus.API.Controllers
{
    [ApiController]
    [Route("api/push")]
    public class PushController : ControllerBase
    {
        private readonly IDbContextFactory<EthicAIDbContext> _dbFactory;
        private readonly ILogger<PushController> _logger;

        public PushController(IDbContextFactory<EthicAIDbContext> dbFactory, ILogger<PushController> logger)
        {
            _dbFactory = dbFactory;
            _logger = logger;
        }

        [AllowAnonymous]
        [HttpPost("subscribe")]
        public async Task<ActionResult<PushSubscribeResponseDto>> Subscribe(
            [FromBody] PushSubscribeRequestDto request,
            CancellationToken ct = default)
        {
            if (string.IsNullOrWhiteSpace(request.Endpoint))
                return BadRequest(new PushSubscribeResponseDto { Success = false, Error = "Endpoint is required." });

            if (string.IsNullOrWhiteSpace(request.P256dh))
                return BadRequest(new PushSubscribeResponseDto { Success = false, Error = "P256dh key is required." });

            if (string.IsNullOrWhiteSpace(request.Auth))
                return BadRequest(new PushSubscribeResponseDto { Success = false, Error = "Auth key is required." });

            if (string.IsNullOrWhiteSpace(request.ClientId))
                return BadRequest(new PushSubscribeResponseDto { Success = false, Error = "ClientId is required." });

            await using var db = await _dbFactory.CreateDbContextAsync(ct);

            var existing = await db.PushSubscription
                .FirstOrDefaultAsync(s => s.Endpoint == request.Endpoint && s.IsActive, ct);

            if (existing is not null)
            {
                existing.P256dh = request.P256dh;
                existing.Auth = request.Auth;
                existing.ClientId = request.ClientId;
                existing.UpdatedAt = DateTime.UtcNow;
                await db.SaveChangesAsync(ct);

                return Ok(new PushSubscribeResponseDto
                {
                    Success = true,
                    SubscriptionId = existing.PushSubscriptionId
                });
            }

            var subscription = new PushSubscription
            {
                Endpoint = request.Endpoint,
                P256dh = request.P256dh,
                Auth = request.Auth,
                ClientId = request.ClientId,
                CreatedAt = DateTime.UtcNow,
                UpdatedAt = DateTime.UtcNow,
                IsActive = true
            };

            db.PushSubscription.Add(subscription);
            await db.SaveChangesAsync(ct);

            _logger.LogInformation(
                "[PUSH] New subscription registered. SubscriptionId={SubscriptionId} ClientId={ClientId}",
                subscription.PushSubscriptionId, request.ClientId);

            return Ok(new PushSubscribeResponseDto
            {
                Success = true,
                SubscriptionId = subscription.PushSubscriptionId
            });
        }

        [AllowAnonymous]
        [HttpDelete("subscribe")]
        public async Task<ActionResult<PushUnsubscribeResponseDto>> Unsubscribe(
            [FromBody] PushUnsubscribeRequestDto request,
            CancellationToken ct = default)
        {
            if (string.IsNullOrWhiteSpace(request.Endpoint) && string.IsNullOrWhiteSpace(request.ClientId))
                return BadRequest(new PushUnsubscribeResponseDto { Success = false, Error = "Endpoint or ClientId is required." });

            await using var db = await _dbFactory.CreateDbContextAsync(ct);

            var query = db.PushSubscription.Where(s => s.IsActive);

            if (!string.IsNullOrWhiteSpace(request.Endpoint))
                query = query.Where(s => s.Endpoint == request.Endpoint);
            else if (!string.IsNullOrWhiteSpace(request.ClientId))
                query = query.Where(s => s.ClientId == request.ClientId);

            var count = await query.ExecuteUpdateAsync(s => s
                .SetProperty(p => p.IsActive, false)
                .SetProperty(p => p.UpdatedAt, DateTime.UtcNow), ct);

            return Ok(new PushUnsubscribeResponseDto
            {
                Success = true,
                DeactivatedCount = count
            });
        }

        [AllowAnonymous]
        [HttpGet("vapid-public-key")]
        public ActionResult GetVapidPublicKey([FromServices] IConfiguration config)
        {
            var key = config["PushNotification:VapidPublicKey"];
            if (string.IsNullOrWhiteSpace(key))
                return NotFound(new { error = "Push notifications not configured." });

            return Ok(new { publicKey = key });
        }

        [AllowAnonymous]
        [HttpGet("lookup")]
        public async Task<ActionResult> LookupByClientId(
            [FromQuery] string clientId,
            CancellationToken ct = default)
        {
            if (string.IsNullOrWhiteSpace(clientId))
                return BadRequest(new { error = "ClientId is required." });

            await using var db = await _dbFactory.CreateDbContextAsync(ct);

            var subscription = await db.PushSubscription
                .Where(s => s.ClientId == clientId && s.IsActive)
                .OrderByDescending(s => s.UpdatedAt)
                .Select(s => new { subscriptionId = s.PushSubscriptionId })
                .FirstOrDefaultAsync(ct);

            if (subscription is null)
                return NotFound(new { error = "No active subscription found for this client." });

            return Ok(subscription);
        }
    }
}
