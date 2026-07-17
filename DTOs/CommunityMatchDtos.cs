namespace DTOs;

public sealed class CommunityMatchCreateRequestDto
{
    public string HomeSymbol { get; set; } = string.Empty;
    public string AwaySymbol { get; set; } = string.Empty;
    public string CaptchaToken { get; set; } = string.Empty;
}

public sealed class CommunityMatchCreateResponseDto
{
    public bool Created { get; set; }
    public bool AlreadyExists { get; set; }
    public int MatchId { get; set; }
    public string HomeSymbol { get; set; } = string.Empty;
    public string AwaySymbol { get; set; } = string.Empty;
    public string PublicUrl { get; set; } = string.Empty;
    public string Status { get; set; } = string.Empty;
    public string MessageCode { get; set; } = string.Empty;
    public int? RetryAfterSeconds { get; set; }
    public string? Message { get; set; }
}
