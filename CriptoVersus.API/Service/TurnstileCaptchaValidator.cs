using System.Net.Http.Json;
using Microsoft.Extensions.Options;

namespace CriptoVersus.API.Services;

public sealed class TurnstileCaptchaValidator : ICaptchaValidator
{
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly IOptions<CommunityCaptchaOptions> _options;
    private readonly ILogger<TurnstileCaptchaValidator> _logger;

    public TurnstileCaptchaValidator(
        IHttpClientFactory httpClientFactory,
        IOptions<CommunityCaptchaOptions> options,
        ILogger<TurnstileCaptchaValidator> logger)
    {
        _httpClientFactory = httpClientFactory;
        _options = options;
        _logger = logger;
    }

    public async Task<CaptchaValidationResult> ValidateAsync(string token, string? remoteIpAddress, CancellationToken ct = default)
    {
        var options = _options.Value;
        if (!options.Enabled)
            return CaptchaValidationResult.Unavailable("communityMatchesUnavailable");

        if (string.IsNullOrWhiteSpace(token))
            return CaptchaValidationResult.Invalid("invalidCaptcha");

        if (string.IsNullOrWhiteSpace(options.SiteKey) || string.IsNullOrWhiteSpace(options.SecretKey))
        {
            _logger.LogWarning("CAPTCHA configured as enabled but missing site or secret key.");
            return CaptchaValidationResult.Unavailable("communityMatchesUnavailable", "captcha-config-missing");
        }

        try
        {
            var client = _httpClientFactory.CreateClient(nameof(TurnstileCaptchaValidator));
            client.Timeout = TimeSpan.FromSeconds(Math.Max(1, options.TimeoutSeconds));

            var payload = new Dictionary<string, string>
            {
                ["secret"] = options.SecretKey,
                ["response"] = token
            };

            if (!string.IsNullOrWhiteSpace(remoteIpAddress))
                payload["remoteip"] = remoteIpAddress;

            using var content = new FormUrlEncodedContent(payload);
            using var response = await client.PostAsync(options.VerificationUrl, content, ct);
            if (!response.IsSuccessStatusCode)
            {
                _logger.LogWarning("Captcha verification returned HTTP {StatusCode}.", (int)response.StatusCode);
                return CaptchaValidationResult.Invalid("invalidCaptcha");
            }

            var verification = await response.Content.ReadFromJsonAsync<TurnstileVerificationResponse>(cancellationToken: ct);
            if (verification is null)
                return CaptchaValidationResult.Invalid("invalidCaptcha");

            if (verification.Success)
                return CaptchaValidationResult.Success();

            var errorCode = verification.ErrorCodes.FirstOrDefault() ?? "invalidCaptcha";
            return CaptchaValidationResult.Invalid(errorCode switch
            {
                "timeout-or-duplicate" => "captchaExpired",
                _ => "invalidCaptcha"
            });
        }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        {
            _logger.LogWarning("Captcha verification timed out.");
            return CaptchaValidationResult.Unavailable("communityMatchesUnavailable", "captcha-timeout");
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Captcha verification failed.");
            return CaptchaValidationResult.Unavailable("communityMatchesUnavailable", "captcha-error");
        }
    }

    private sealed class TurnstileVerificationResponse
    {
        public bool Success { get; set; }
        public string[] ErrorCodes { get; set; } = [];
        public double? Score { get; set; }
        public string? Action { get; set; }
    }
}
