namespace DTOs;

public sealed class TokenMarketSnapshotDto
{
    public string ContractAddress { get; set; } = string.Empty;
    public string Network { get; set; } = string.Empty;
    public decimal BuyTaxPercent { get; set; }
    public decimal SellTaxPercent { get; set; }
    public decimal? CurrentPrice { get; set; }
    public decimal? MarketCap { get; set; }
    public int? Holders { get; set; }
    public decimal? Volume24h { get; set; }
    public decimal? Liquidity { get; set; }
    public DateTimeOffset UpdatedAtUtc { get; set; }
    public string Source { get; set; } = string.Empty;
}
