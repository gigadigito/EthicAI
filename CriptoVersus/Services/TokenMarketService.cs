using System.Net;
using System.Net.Http.Json;

namespace CriptoVersus.Web.Services;

public sealed class TokenMarketService
{
    public const string OfficialContractAddress = "Hc61Hz6a7sUpbwvzwQXAxbKr5ziQrRmUmxjXMmddpump";
    public const string OfficialPumpFunUrl = "https://pump.fun/coin/Hc61Hz6a7sUpbwvzwQXAxbKr5ziQrRmUmxjXMmddpump?clip=20260627_212331%3A2330257_20260627_212301";
    public const string OfficialNetwork = "Solana";

    private readonly HttpClient _http;

    public TokenMarketService(IHttpClientFactory factory)
    {
        _http = factory.CreateClient("CriptoVersusApi");
    }

    public async Task<TokenMarketSnapshotResult> GetSnapshotAsync(CancellationToken ct = default)
    {
        try
        {
            using var response = await _http.GetAsync(
                $"api/token/market?contractAddress={Uri.EscapeDataString(OfficialContractAddress)}",
                ct);

            if (response.IsSuccessStatusCode)
            {
                var payload = await response.Content.ReadFromJsonAsync<TokenMarketApiResponse>(cancellationToken: ct);
                if (payload is not null)
                {
                    var snapshot = Map(payload);
                    if (string.Equals(payload.Source, "fallback", StringComparison.OrdinalIgnoreCase)
                        || string.Equals(payload.Source, "unavailable", StringComparison.OrdinalIgnoreCase))
                        return TokenMarketSnapshotResult.Fallback(snapshot, hasError: false, reasonCode: "backend_fallback");

                    return TokenMarketSnapshotResult.Live(snapshot);
                }
            }

            if (response.StatusCode == HttpStatusCode.NotFound || response.StatusCode == HttpStatusCode.NoContent)
                return TokenMarketSnapshotResult.Fallback(CreateFallbackSnapshot(), hasError: false, reasonCode: "api_unavailable");

            return TokenMarketSnapshotResult.Fallback(
                CreateFallbackSnapshot(),
                hasError: true,
                reasonCode: $"http_{(int)response.StatusCode}");
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch
        {
            return TokenMarketSnapshotResult.Fallback(CreateFallbackSnapshot(), hasError: true, reasonCode: "request_failed");
        }
    }

    public static TokenMarketSnapshot CreateFallbackSnapshot()
        => new(
            ContractAddress: OfficialContractAddress,
            Network: OfficialNetwork,
            BuyTaxPercent: 0m,
            SellTaxPercent: 0m,
            CurrentPriceUsd: null,
            MarketCapUsd: null,
            Holders: null,
            Volume24hUsd: null,
            LiquidityUsd: null,
            UpdatedAtUtc: DateTimeOffset.UtcNow,
            Source: "unavailable");

    private static TokenMarketSnapshot Map(TokenMarketApiResponse payload)
        => new(
            ContractAddress: string.IsNullOrWhiteSpace(payload.ContractAddress) ? OfficialContractAddress : payload.ContractAddress.Trim(),
            Network: string.IsNullOrWhiteSpace(payload.Network) ? OfficialNetwork : payload.Network.Trim(),
            BuyTaxPercent: payload.BuyTaxPercent,
            SellTaxPercent: payload.SellTaxPercent,
            CurrentPriceUsd: payload.CurrentPriceUsd ?? payload.CurrentPrice,
            MarketCapUsd: payload.MarketCapUsd ?? payload.MarketCap,
            Holders: payload.Holders,
            Volume24hUsd: payload.Volume24hUsd ?? payload.Volume24h,
            LiquidityUsd: payload.LiquidityUsd ?? payload.Liquidity,
            UpdatedAtUtc: payload.UpdatedAtUtc,
            Source: payload.Source);

    private sealed class TokenMarketApiResponse
    {
        public string? ContractAddress { get; set; }
        public string? Network { get; set; }
        public string? Source { get; set; }
        public decimal BuyTaxPercent { get; set; }
        public decimal SellTaxPercent { get; set; }
        public decimal? CurrentPrice { get; set; }
        public decimal? CurrentPriceUsd { get; set; }
        public decimal? MarketCap { get; set; }
        public decimal? MarketCapUsd { get; set; }
        public int? Holders { get; set; }
        public decimal? Volume24h { get; set; }
        public decimal? Volume24hUsd { get; set; }
        public decimal? Liquidity { get; set; }
        public decimal? LiquidityUsd { get; set; }
        public DateTimeOffset? UpdatedAtUtc { get; set; }
    }
}

public sealed record TokenMarketSnapshot(
    string ContractAddress,
    string Network,
    decimal BuyTaxPercent,
    decimal SellTaxPercent,
    decimal? CurrentPriceUsd,
    decimal? MarketCapUsd,
    int? Holders,
    decimal? Volume24hUsd,
    decimal? LiquidityUsd,
    DateTimeOffset? UpdatedAtUtc,
    string? Source);

public sealed record TokenMarketSnapshotResult(
    TokenMarketSnapshot Snapshot,
    bool IsFallback,
    bool HasError,
    string? ReasonCode)
{
    public static TokenMarketSnapshotResult Live(TokenMarketSnapshot snapshot)
        => new(snapshot, false, false, null);

    public static TokenMarketSnapshotResult Fallback(TokenMarketSnapshot snapshot, bool hasError, string? reasonCode)
        => new(snapshot, true, hasError, reasonCode);
}
