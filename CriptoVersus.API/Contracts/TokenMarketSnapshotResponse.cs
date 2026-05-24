namespace CriptoVersus.API.Contracts;

public sealed record TokenMarketSnapshotResponse(
    string ContractAddress,
    string Network,
    decimal BuyTaxPercent,
    decimal SellTaxPercent,
    decimal? CurrentPrice,
    decimal? MarketCap,
    int? Holders,
    decimal? Volume24h,
    decimal? Liquidity,
    DateTimeOffset UpdatedAtUtc,
    string Source);
