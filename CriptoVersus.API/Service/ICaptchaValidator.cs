namespace CriptoVersus.API.Services;

public sealed record CaptchaValidationResult(bool IsValid, string MessageCode, bool IsUnavailable = false, string? Detail = null)
{
    public static CaptchaValidationResult Success() => new(true, string.Empty);
    public static CaptchaValidationResult Invalid(string messageCode) => new(false, messageCode);
    public static CaptchaValidationResult Unavailable(string messageCode, string? detail = null) => new(false, messageCode, true, detail);
}

public interface ICaptchaValidator
{
    Task<CaptchaValidationResult> ValidateAsync(string token, string? remoteIpAddress, CancellationToken ct = default);
}
