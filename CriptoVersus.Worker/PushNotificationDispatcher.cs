using BLL.Push;
using DAL.NftFutebol;
using EthicAI.EntityModel;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using WebPush;

namespace CriptoVersus.Worker;

public sealed class PushNotificationDispatcher
{
    private readonly EthicAIDbContext _db;
    private readonly ILogger _logger;
    private readonly string _vapidPublicKey;
    private readonly string _vapidPrivateKey;
    private readonly string _vapidSubject;
    private readonly int _maxRetryAttempts;
    private readonly int _pushTtlSeconds;
    private readonly VapidDetails _vapidDetails;
    private readonly TimeSpan _stuckProcessingThreshold = TimeSpan.FromMinutes(5);

    public PushNotificationDispatcher(
        EthicAIDbContext db,
        ILogger logger,
        string vapidPublicKey,
        string vapidPrivateKey,
        string vapidSubject,
        int maxRetryAttempts = 3,
        int pushTtlSeconds = 3600)
    {
        _db = db;
        _logger = logger;
        _vapidPublicKey = vapidPublicKey;
        _vapidPrivateKey = vapidPrivateKey;
        _vapidSubject = vapidSubject;
        _maxRetryAttempts = maxRetryAttempts;
        _pushTtlSeconds = pushTtlSeconds;
        _vapidDetails = new VapidDetails(_vapidSubject, _vapidPublicKey, _vapidPrivateKey);
    }

    public async Task<int> DispatchPendingAlertsAsync(CancellationToken ct)
    {
        await RecoverStuckDeliveriesAsync(ct);

        var eligible = await _db.MatchAlertDelivery
            .Where(d => d.Status == "PENDING" && d.NextAttemptAt <= DateTime.UtcNow)
            .OrderBy(d => d.NextAttemptAt)
            .Take(50)
            .ToListAsync(ct);

        if (eligible.Count == 0)
            return 0;

        var deliveryIds = eligible.Select(d => d.MatchAlertDeliveryId).ToList();

        var claimed = await _db.MatchAlertDelivery
            .Where(d => deliveryIds.Contains(d.MatchAlertDeliveryId) && d.Status == "PENDING")
            .ExecuteUpdateAsync(s => s
                .SetProperty(d => d.Status, "PROCESSING")
                .SetProperty(d => d.LastAttemptAt, DateTime.UtcNow)
                .SetProperty(d => d.Attempts, d => d.Attempts + 1), ct);

        if (claimed == 0)
            return 0;

        var toProcess = await _db.MatchAlertDelivery
            .Where(d => deliveryIds.Contains(d.MatchAlertDeliveryId) && d.Status == "PROCESSING")
            .Include(d => d.PushSubscription)
            .Include(d => d.Match)
                .ThenInclude(m => m.TeamA)
            .Include(d => d.Match)
                .ThenInclude(m => m.TeamB)
            .ToListAsync(ct);

        var sentCount = 0;

        using var pushClient = new WebPushClient();

        foreach (var delivery in toProcess)
        {
            try
            {
                if (delivery.PushSubscription is null || !delivery.PushSubscription.IsActive)
                {
                    delivery.Status = "FAILED";
                    continue;
                }

                var payload = BuildPayload(delivery);
                var wpSubscription = new WebPush.PushSubscription(
                    delivery.PushSubscription.Endpoint,
                    delivery.PushSubscription.P256dh,
                    delivery.PushSubscription.Auth);

                await pushClient.SendNotificationAsync(wpSubscription, payload, _vapidDetails, ct);

                delivery.Status = "SENT";
                delivery.SentAt = DateTime.UtcNow;
                sentCount++;

                _logger.LogInformation(
                    "[PUSH_DISPATCH] Sent alert. deliveryId={DeliveryId} matchId={MatchId} type={AlertType}",
                    delivery.MatchAlertDeliveryId, delivery.MatchId, delivery.AlertType);
            }
            catch (WebPushException ex) when (ex.StatusCode is System.Net.HttpStatusCode.NotFound or System.Net.HttpStatusCode.Gone)
            {
                delivery.Status = "FAILED";
                if (delivery.PushSubscription is not null)
                {
                    delivery.PushSubscription.IsActive = false;
                    delivery.PushSubscription.UpdatedAt = DateTime.UtcNow;
                }

                _logger.LogWarning(
                    "[PUSH_DISPATCH] Invalid subscription deactivated. deliveryId={DeliveryId} status={Status}",
                    delivery.MatchAlertDeliveryId, ex.StatusCode);
            }
            catch (Exception ex)
            {
                if (delivery.Attempts >= _maxRetryAttempts)
                {
                    delivery.Status = "FAILED";
                    _logger.LogWarning(ex,
                        "[PUSH_DISPATCH] Delivery failed permanently. deliveryId={DeliveryId} attempts={Attempts}",
                        delivery.MatchAlertDeliveryId, delivery.Attempts);
                }
                else
                {
                    delivery.Status = "PENDING";
                    delivery.NextAttemptAt = CalculateNextAttempt(delivery.Attempts);
                    _logger.LogWarning(ex,
                        "[PUSH_DISPATCH] Delivery retry scheduled. deliveryId={DeliveryId} nextAttempt={NextAttempt}",
                        delivery.MatchAlertDeliveryId, delivery.NextAttemptAt);
                }
            }
        }

        await _db.SaveChangesAsync(ct);
        return sentCount;
    }

    private async Task RecoverStuckDeliveriesAsync(CancellationToken ct)
    {
        var threshold = DateTime.UtcNow - _stuckProcessingThreshold;

        await _db.MatchAlertDelivery
            .Where(d => d.Status == "PROCESSING" && d.LastAttemptAt < threshold)
            .ExecuteUpdateAsync(s => s
                .SetProperty(d => d.Status, d => d.Attempts >= _maxRetryAttempts ? "FAILED" : "PENDING")
                .SetProperty(d => d.NextAttemptAt, d => d.Attempts >= _maxRetryAttempts
                    ? DateTime.UtcNow
                    : d.Attempts == 1
                        ? DateTime.UtcNow.AddSeconds(30)
                        : DateTime.UtcNow.AddSeconds(120)), ct);
    }

    private DateTime CalculateNextAttempt(int attempts)
    {
        return attempts switch
        {
            1 => DateTime.UtcNow.AddSeconds(30),
            2 => DateTime.UtcNow.AddSeconds(120),
            _ => DateTime.UtcNow.AddSeconds(300)
        };
    }

    private string BuildPayload(MatchAlertDelivery delivery)
    {
        var match = delivery.Match;
        var teamA = match.TeamA?.Currency?.Symbol ?? "A";
        var teamB = match.TeamB?.Currency?.Symbol ?? "B";
        var culture = delivery.PushSubscription?.ClientId is not null ? "en" : "en";

        var alertSub = _db.MatchAlertSubscription
            .FirstOrDefault(s => s.PushSubscriptionId == delivery.PushSubscriptionId && s.MatchId == delivery.MatchId);
        if (alertSub is not null)
            culture = alertSub.Culture;

        if (delivery.AlertType == "asset_playing")
        {
            AssetAlertSubscription? assetSub = null;

            if (TryParseAssetEventKey(delivery.EventKey, out var assetSubId, out var eventCurrencyId))
            {
                assetSub = _db.AssetAlertSubscription
                    .FirstOrDefault(s => s.AssetAlertSubscriptionId == assetSubId
                                       && s.CurrencyId == eventCurrencyId);
            }

            if (assetSub is null)
            {
                _logger.LogWarning(
                    "[PUSH_DISPATCH] AssetAlertSubscription not found for delivery {DeliveryId} eventKey={EventKey}",
                    delivery.MatchAlertDeliveryId, delivery.EventKey);
                delivery.Status = "FAILED";
                return string.Empty;
            }

            culture = assetSub.Culture;

            var symbol = assetSub.Symbol;
            var (title, body) = PushNotificationTexts.GetAssetPlaying(culture, symbol, teamA, teamB);
            var url = BuildMatchUrl(delivery.MatchId, teamA, teamB, culture, delivery.AlertType);

            return System.Text.Json.JsonSerializer.Serialize(new
            {
                title,
                body,
                icon = "/android-chrome-192x192.png",
                badge = "/android-chrome-192x192.png",
                url,
                alertType = delivery.AlertType,
                matchId = delivery.MatchId,
                tag = $"cv-asset-{delivery.MatchId}-{assetSub.CurrencyId}"
            });
        }

        var (matchTitle, matchBody) = PushNotificationTexts.Get(
            culture,
            delivery.AlertType,
            teamA,
            match.ScoreA,
            match.ScoreB,
            teamB,
            delivery.AlertType == "finished" ? ResolveWinnerName(match) : null);

        var matchUrl = BuildMatchUrl(delivery.MatchId, teamA, teamB, culture, delivery.AlertType);

        return System.Text.Json.JsonSerializer.Serialize(new
        {
            title = matchTitle,
            body = matchBody,
            icon = "/android-chrome-192x192.png",
            badge = "/android-chrome-192x192.png",
            url = matchUrl,
            alertType = delivery.AlertType,
            matchId = delivery.MatchId,
            tag = $"cv-match-{delivery.MatchId}-{delivery.AlertType}"
        });
    }

    private string BuildMatchUrl(int matchId, string teamA, string teamB, string culture, string alertType)
    {
        var slug = $"{teamA.ToLowerInvariant()}-vs-{teamB.ToLowerInvariant()}";
        var cultureSegment = culture.StartsWith("pt", StringComparison.OrdinalIgnoreCase) ? "pt"
            : culture.StartsWith("zh", StringComparison.OrdinalIgnoreCase) ? "zh"
            : "en";
        var segment = cultureSegment == "pt" ? "partida" : "match";
        return $"/{cultureSegment}/{segment}/{matchId}/{slug}?cv_source=push&alert={alertType}";
    }

    private static string? ResolveWinnerName(Match match)
    {
        if (match.ScoreA > match.ScoreB)
            return match.TeamA?.Currency?.Symbol;
        if (match.ScoreB > match.ScoreA)
            return match.TeamB?.Currency?.Symbol;
        return null;
    }

    public static bool TryParseAssetEventKey(string eventKey, out long assetAlertSubscriptionId, out int currencyId)
    {
        assetAlertSubscriptionId = 0;
        currencyId = 0;

        if (string.IsNullOrEmpty(eventKey))
            return false;

        var parts = eventKey.Split(':');
        if (parts.Length != 4 || parts[0] != "asset-playing")
            return false;

        return long.TryParse(parts[1], out assetAlertSubscriptionId)
            && int.TryParse(parts[2], out currencyId);
    }
}
