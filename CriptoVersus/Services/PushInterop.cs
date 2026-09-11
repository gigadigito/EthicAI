using Microsoft.JSInterop;

namespace CriptoVersus.Web.Services;

public sealed class PushInterop
{
    private readonly IJSRuntime _js;

    public PushInterop(IJSRuntime js)
    {
        _js = js;
    }

    public async Task<bool> IsPushSupportedAsync()
    {
        try
        {
            return await _js.InvokeAsync<bool>("CvPush.isPushSupported");
        }
        catch (JSDisconnectedException)
        {
            return false;
        }
    }

    public async Task<string> GetPermissionStateAsync()
    {
        try
        {
            return await _js.InvokeAsync<string>("CvPush.getPermissionState");
        }
        catch (JSDisconnectedException)
        {
            return "denied";
        }
    }

    public async Task<bool> InitializeAsync()
    {
        try
        {
            return await _js.InvokeAsync<bool>("CvPush.init");
        }
        catch (JSDisconnectedException)
        {
            return false;
        }
    }

    public async Task<bool> SubscribeAsync()
    {
        try
        {
            var result = await _js.InvokeAsync<object?>("CvPush.subscribe");
            return result is not null;
        }
        catch (JSDisconnectedException)
        {
            return false;
        }
    }

    public async Task<bool> UnsubscribeAsync()
    {
        try
        {
            return await _js.InvokeAsync<bool>("CvPush.unsubscribe");
        }
        catch (JSDisconnectedException)
        {
            return false;
        }
    }

    public async Task<bool> IsSubscribedAsync()
    {
        try
        {
            return await _js.InvokeAsync<bool>("CvPush.isSubscribed");
        }
        catch (JSDisconnectedException)
        {
            return false;
        }
    }

    public async Task<string?> GetClientIdAsync()
    {
        try
        {
            return await _js.InvokeAsync<string?>("CvPush.getClientId");
        }
        catch (JSDisconnectedException)
        {
            return null;
        }
    }

    public async Task<MatchAlertResult> SubscribeMatchAlertAsync(int matchId, bool notifyScore, bool notifyComeback, bool notifyFinished, string culture)
    {
        try
        {
            return await _js.InvokeAsync<MatchAlertResult>(
                "CvPush.subscribeMatchAlert",
                matchId,
                new { notifyScore, notifyComeback, notifyFinished, culture });
        }
        catch (JSDisconnectedException)
        {
            return new MatchAlertResult { Success = false, Error = "Disconnected" };
        }
    }

    public async Task<MatchAlertResult> UnsubscribeMatchAlertAsync(int matchId)
    {
        try
        {
            return await _js.InvokeAsync<MatchAlertResult>(
                "CvPush.unsubscribeMatchAlert",
                matchId);
        }
        catch (JSDisconnectedException)
        {
            return new MatchAlertResult { Success = false, Error = "Disconnected" };
        }
    }

    public async Task<MatchAlertStatus> GetMatchAlertStatusAsync(int matchId)
    {
        try
        {
            return await _js.InvokeAsync<MatchAlertStatus>(
                "CvPush.getMatchAlertStatus",
                matchId);
        }
        catch (JSDisconnectedException)
        {
            return new MatchAlertStatus { HasActiveSubscription = false };
        }
    }
}

public sealed class MatchAlertResult
{
    public bool Success { get; set; }
    public long? AlertSubscriptionId { get; set; }
    public string? Error { get; set; }
}

public sealed class MatchAlertStatus
{
    public int MatchId { get; set; }
    public bool HasActiveSubscription { get; set; }
    public bool NotifyScore { get; set; }
    public bool NotifyComeback { get; set; }
    public bool NotifyFinished { get; set; }
    public long? PushSubscriptionId { get; set; }
}
