namespace DTOs;

public sealed class AssetPriceSnapshotDto
{
    public string QuerySymbol { get; set; } = string.Empty;
    public string AssetSymbol { get; set; } = string.Empty;
    public string MarketSymbol { get; set; } = string.Empty;
    public int TeamId { get; set; }
    public int MatchId { get; set; }
    public decimal? LastPriceUsdt { get; set; }
    public decimal PercentageChange { get; set; }
    public DateTime CapturedAtUtc { get; set; }
    public string Source { get; set; } = string.Empty;
}
