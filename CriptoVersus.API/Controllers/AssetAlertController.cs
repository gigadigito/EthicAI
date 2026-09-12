using DTOs;
using EthicAI.EntityModel;
using DAL.NftFutebol;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace CriptoVersus.API.Controllers
{
    [ApiController]
    [Route("api/assets/{currencyId:int}/alerts")]
    public class AssetAlertController : ControllerBase
    {
        private readonly IDbContextFactory<EthicAIDbContext> _dbFactory;
        private readonly ILogger<AssetAlertController> _logger;

        public AssetAlertController(IDbContextFactory<EthicAIDbContext> dbFactory, ILogger<AssetAlertController> logger)
        {
            _dbFactory = dbFactory;
            _logger = logger;
        }

        [AllowAnonymous]
        [HttpPost]
        public async Task<ActionResult<AssetAlertSubscribeResponseDto>> Subscribe(
            int currencyId,
            [FromBody] AssetAlertSubscribeRequestDto request,
            CancellationToken ct = default)
        {
            if (request.PushSubscriptionId <= 0)
                return BadRequest(new AssetAlertSubscribeResponseDto { Success = false, Error = "PushSubscriptionId is required." });

            await using var db = await _dbFactory.CreateDbContextAsync(ct);

            var subscription = await db.PushSubscription
                .FirstOrDefaultAsync(s => s.PushSubscriptionId == request.PushSubscriptionId && s.IsActive, ct);

            if (subscription is null)
                return NotFound(new AssetAlertSubscribeResponseDto { Success = false, Error = "Push subscription not found or inactive." });

            var currency = await db.Currency
                .FirstOrDefaultAsync(c => c.CurrencyId == currencyId, ct);

            if (currency is null)
                return NotFound(new AssetAlertSubscribeResponseDto { Success = false, Error = "Asset not found." });

            var existing = await db.AssetAlertSubscription
                .FirstOrDefaultAsync(s => s.PushSubscriptionId == request.PushSubscriptionId
                                      && s.CurrencyId == currencyId, ct);

            if (existing is not null)
            {
                existing.Culture = request.Culture ?? "en";
                existing.Symbol = currency.Symbol;

                if (!existing.IsActive)
                {
                    existing.IsActive = true;
                    existing.CreatedAt = DateTime.UtcNow;
                }

                await db.SaveChangesAsync(ct);

                return Ok(new AssetAlertSubscribeResponseDto
                {
                    Success = true,
                    AlertSubscriptionId = existing.AssetAlertSubscriptionId,
                    Active = true
                });
            }

            var alertSub = new AssetAlertSubscription
            {
                PushSubscriptionId = request.PushSubscriptionId,
                CurrencyId = currencyId,
                Symbol = currency.Symbol,
                Culture = request.Culture ?? "en",
                CreatedAt = DateTime.UtcNow,
                IsActive = true
            };

            db.AssetAlertSubscription.Add(alertSub);

            try
            {
                await db.SaveChangesAsync(ct);
            }
            catch (DbUpdateException)
            {
                db.Entry(alertSub).State = EntityState.Detached;

                var concurrent = await db.AssetAlertSubscription
                    .FirstOrDefaultAsync(s => s.PushSubscriptionId == request.PushSubscriptionId
                                          && s.CurrencyId == currencyId, ct);

                if (concurrent is not null)
                {
                    concurrent.Culture = request.Culture ?? "en";
                    concurrent.Symbol = currency.Symbol;

                    if (!concurrent.IsActive)
                    {
                        concurrent.IsActive = true;
                        concurrent.CreatedAt = DateTime.UtcNow;
                    }

                    await db.SaveChangesAsync(ct);

                    return Ok(new AssetAlertSubscribeResponseDto
                    {
                        Success = true,
                        AlertSubscriptionId = concurrent.AssetAlertSubscriptionId,
                        Active = true
                    });
                }

                throw;
            }

            _logger.LogInformation(
                "[ASSET_ALERT] Alert subscription created. SubscriptionId={SubscriptionId} CurrencyId={CurrencyId} Symbol={Symbol}",
                alertSub.AssetAlertSubscriptionId, currencyId, currency.Symbol);

            return Ok(new AssetAlertSubscribeResponseDto
            {
                Success = true,
                AlertSubscriptionId = alertSub.AssetAlertSubscriptionId,
                Active = true
            });
        }

        [AllowAnonymous]
        [HttpDelete]
        public async Task<ActionResult<AssetAlertSubscribeResponseDto>> Unsubscribe(
            int currencyId,
            [FromQuery] long pushSubscriptionId,
            CancellationToken ct = default)
        {
            if (pushSubscriptionId <= 0)
                return BadRequest(new AssetAlertSubscribeResponseDto { Success = false, Error = "PushSubscriptionId query parameter is required." });

            await using var db = await _dbFactory.CreateDbContextAsync(ct);

            var count = await db.AssetAlertSubscription
                .Where(s => s.PushSubscriptionId == pushSubscriptionId
                         && s.CurrencyId == currencyId
                         && s.IsActive)
                .ExecuteUpdateAsync(s => s
                    .SetProperty(s => s.IsActive, false), ct);

            return Ok(new AssetAlertSubscribeResponseDto
            {
                Success = true,
                Active = false,
                Error = count == 0 ? "No active subscription found." : null
            });
        }

        [AllowAnonymous]
        [HttpGet]
        public async Task<ActionResult<AssetAlertStatusDto>> GetStatus(
            int currencyId,
            [FromQuery] long pushSubscriptionId,
            CancellationToken ct = default)
        {
            if (pushSubscriptionId <= 0)
                return Ok(new AssetAlertStatusDto { CurrencyId = currencyId, HasActiveSubscription = false });

            await using var db = await _dbFactory.CreateDbContextAsync(ct);

            var sub = await db.AssetAlertSubscription
                .FirstOrDefaultAsync(s => s.PushSubscriptionId == pushSubscriptionId
                                      && s.CurrencyId == currencyId
                                      && s.IsActive, ct);

            return Ok(new AssetAlertStatusDto
            {
                CurrencyId = currencyId,
                Symbol = sub?.Symbol ?? "",
                HasActiveSubscription = sub is not null,
                AssetAlertSubscriptionId = sub?.AssetAlertSubscriptionId
            });
        }
    }
}
