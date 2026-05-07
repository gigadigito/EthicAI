namespace CriptoVersus.API.Contracts;

public sealed class SocialComposeFinalRequest
{
    public string BackgroundImageBase64 { get; set; } = string.Empty;
    public string LeftSymbol { get; set; } = string.Empty;
    public string RightSymbol { get; set; } = string.Empty;
    public string? Score { get; set; }
}
