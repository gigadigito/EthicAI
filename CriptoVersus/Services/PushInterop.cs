using Microsoft.JSInterop;

namespace CriptoVersus.Web.Services;

public sealed class PushInterop
{
    private readonly IJSRuntime _js;
    private readonly ILogger<PushInterop> _logger;

    public PushInterop(IJSRuntime js, ILogger<PushInterop> logger)
    {
        _js = js;
        _logger = logger;
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
            return new MatchAlertResult { Success = false, ErrorCode = "circuit_disconnected", Error = "Disconnected" };
        }
        catch (JSException ex)
        {
            _logger.LogWarning(ex, "Match alert JavaScript activation failed for match {MatchId}.", matchId);
            return new MatchAlertResult { Success = false, ErrorCode = "js_interop_failed", Error = ex.Message };
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
            return new MatchAlertResult { Success = false, ErrorCode = "circuit_disconnected", Error = "Disconnected" };
        }
        catch (JSException ex)
        {
            _logger.LogWarning(ex, "Match alert JavaScript unsubscribe failed for match {MatchId}.", matchId);
            return new MatchAlertResult { Success = false, ErrorCode = "js_interop_failed", Error = ex.Message };
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
        catch (JSException ex)
        {
            _logger.LogWarning(ex, "Match alert JavaScript status read failed for match {MatchId}.", matchId);
            return new MatchAlertStatus { HasActiveSubscription = false };
        }
    }

    public async Task<AssetAlertResult> SubscribeAssetAlertAsync(int currencyId, string culture)
    {
        try
        {
            return await _js.InvokeAsync<AssetAlertResult>(
                "CvPush.subscribeAssetAlert",
                currencyId,
                new { culture });
        }
        catch (JSDisconnectedException)
        {
            return new AssetAlertResult { Success = false, ErrorCode = "circuit_disconnected", Error = "Disconnected" };
        }
        catch (JSException ex)
        {
            _logger.LogWarning(ex, "Asset alert JavaScript activation failed for currency {CurrencyId}.", currencyId);
            return new AssetAlertResult { Success = false, ErrorCode = "js_interop_failed", Error = ex.Message };
        }
    }

    public async Task<AssetAlertResult> UnsubscribeAssetAlertAsync(int currencyId)
    {
        try
        {
            return await _js.InvokeAsync<AssetAlertResult>(
                "CvPush.unsubscribeAssetAlert",
                currencyId);
        }
        catch (JSDisconnectedException)
        {
            return new AssetAlertResult { Success = false, ErrorCode = "circuit_disconnected", Error = "Disconnected" };
        }
        catch (JSException ex)
        {
            _logger.LogWarning(ex, "Asset alert JavaScript unsubscribe failed for currency {CurrencyId}.", currencyId);
            return new AssetAlertResult { Success = false, ErrorCode = "js_interop_failed", Error = ex.Message };
        }
    }

    public async Task<AssetAlertStatus> GetAssetAlertStatusAsync(int currencyId)
    {
        try
        {
            return await _js.InvokeAsync<AssetAlertStatus>(
                "CvPush.getAssetAlertStatus",
                currencyId);
        }
        catch (JSDisconnectedException)
        {
            return new AssetAlertStatus { HasActiveSubscription = false };
        }
        catch (JSException ex)
        {
            _logger.LogWarning(ex, "Asset alert JavaScript status read failed for currency {CurrencyId}.", currencyId);
            return new AssetAlertStatus { HasActiveSubscription = false };
        }
    }
}

public sealed class MatchAlertResult
{
    public bool Success { get; set; }
    public long? AlertSubscriptionId { get; set; }
    public string? Error { get; set; }
    public string? ErrorCode { get; set; }
    public int? HttpStatus { get; set; }
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

public sealed class AssetAlertResult
{
    public bool Success { get; set; }
    public long? AlertSubscriptionId { get; set; }
    public bool Active { get; set; }
    public string? Error { get; set; }
    public string? ErrorCode { get; set; }
}

public sealed class AssetAlertStatus
{
    public int CurrencyId { get; set; }
    public string Symbol { get; set; } = string.Empty;
    public bool HasActiveSubscription { get; set; }
    public long? AssetAlertSubscriptionId { get; set; }
}
