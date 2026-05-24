namespace DAL.NftFutebol;

public sealed class CoinSocialProfile
{
    public long Id { get; set; }
    public string Symbol { get; set; } = string.Empty;
    public string? CoinGeckoId { get; set; }
    public string? ContractAddress { get; set; }
    public string? TwitterHandle { get; set; }
    public string? TelegramUrl { get; set; }
    public string? WebsiteUrl { get; set; }
    public string? Source { get; set; }
    public DateTime? LastCheckedUtc { get; set; }
    public DateTime CreatedAtUtc { get; set; }
    public DateTime UpdatedAtUtc { get; set; }
}
