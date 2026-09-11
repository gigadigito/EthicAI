namespace DTOs;

public sealed class PushSubscribeRequestDto
{
    public string Endpoint { get; set; } = string.Empty;
    public string P256dh { get; set; } = string.Empty;
    public string Auth { get; set; } = string.Empty;
    public string ClientId { get; set; } = string.Empty;
}

public sealed class PushSubscribeResponseDto
{
    public bool Success { get; set; }
    public long? SubscriptionId { get; set; }
    public string? Error { get; set; }
}

public sealed class PushUnsubscribeRequestDto
{
    public string? Endpoint { get; set; }
    public string? ClientId { get; set; }
}

public sealed class PushUnsubscribeResponseDto
{
    public bool Success { get; set; }
    public int DeactivatedCount { get; set; }
    public string? Error { get; set; }
}

public sealed class MatchAlertSubscribeRequestDto
{
    public long PushSubscriptionId { get; set; }
    public bool NotifyScore { get; set; } = true;
    public bool NotifyComeback { get; set; } = true;
    public bool NotifyFinished { get; set; } = true;
    public string Culture { get; set; } = "en";
}

public sealed class MatchAlertSubscribeResponseDto
{
    public bool Success { get; set; }
    public long? AlertSubscriptionId { get; set; }
    public string? Error { get; set; }
}

public sealed class MatchAlertStatusDto
{
    public int MatchId { get; set; }
    public bool HasActiveSubscription { get; set; }
    public bool NotifyScore { get; set; }
    public bool NotifyComeback { get; set; }
    public bool NotifyFinished { get; set; }
    public long? PushSubscriptionId { get; set; }
}

public sealed class PushNotificationPayloadDto
{
    public string Title { get; set; } = string.Empty;
    public string Body { get; set; } = string.Empty;
    public string Icon { get; set; } = string.Empty;
    public string Badge { get; set; } = string.Empty;
    public string Url { get; set; } = string.Empty;
    public string AlertType { get; set; } = string.Empty;
    public int MatchId { get; set; }
    public string? Tag { get; set; }
}
