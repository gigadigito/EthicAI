namespace CriptoVersus.API.Services;

public sealed class CommunityCaptchaOptions
{
    public const string SectionName = "Captcha";

    public bool Enabled { get; set; } = false;
    public string Provider { get; set; } = "turnstile";
    public string SiteKey { get; set; } = string.Empty;
    public string SecretKey { get; set; } = string.Empty;
    public string VerificationUrl { get; set; } = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
    public double? MinimumScore { get; set; }
    public int TimeoutSeconds { get; set; } = 8;
}
