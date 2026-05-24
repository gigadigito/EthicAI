namespace DTOs;

public sealed class CoinSocialProfileDto
{
    public string Symbol { get; set; } = string.Empty;
    public string? CoinGeckoId { get; set; }
    public string? ContractAddress { get; set; }
    public string? TwitterHandle { get; set; }
    public string? TelegramUrl { get; set; }
    public string? WebsiteUrl { get; set; }
    public string? Source { get; set; }
    public DateTime? LastCheckedUtc { get; set; }
}

public sealed class UpsertCoinSocialProfileRequest
{
    public string Symbol { get; set; } = string.Empty;
    public string? CoinGeckoId { get; set; }
    public string? ContractAddress { get; set; }
    public string? TwitterHandle { get; set; }
    public string? TelegramUrl { get; set; }
    public string? WebsiteUrl { get; set; }
    public string? Source { get; set; }
    public DateTime? LastCheckedUtc { get; set; }
}
