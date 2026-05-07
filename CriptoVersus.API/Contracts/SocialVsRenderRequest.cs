namespace CriptoVersus.API.Contracts;

public sealed class SocialVsRenderRequest
{
    public string LeftSymbol { get; set; } = string.Empty;
    public string RightSymbol { get; set; } = string.Empty;
    public string? Score { get; set; }
}
