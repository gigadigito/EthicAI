using System.Globalization;
using System.Net.Http.Headers;
using System.Text.Json;
using System.Net.Http.Json;
using System.Text;
using CriptoVersus.API.Contracts;

namespace CriptoVersus.API.Services;

public interface ITokenMarketSnapshotService
{
    Task<TokenMarketSnapshotResponse> GetSnapshotAsync(string? contractAddress, CancellationToken ct);
    Task<TokenMarketDebugResponse> GetDebugSnapshotAsync(string? contractAddress, CancellationToken ct);
}

public sealed class TokenMarketSnapshotService : ITokenMarketSnapshotService
{
    public const string OfficialContractAddress = "8t2EWhbCSgbRu2kWiRyp7qeCgokav1BAgYvZWTL6aYpR";
    public const string OfficialNetwork = "Solana";
    private const string DexScreenerChainId = "solana";
    private const string GeckoTerminalNetwork = "solana";

    private readonly HttpClient _httpClient;
    private readonly ILogger<TokenMarketSnapshotService> _logger;
    private readonly IConfiguration _configuration;

    public TokenMarketSnapshotService(HttpClient httpClient, ILogger<TokenMarketSnapshotService> logger, IConfiguration configuration)
    {
        _httpClient = httpClient;
        _logger = logger;
        _configuration = configuration;

        if (!_httpClient.DefaultRequestHeaders.UserAgent.Any())
            _httpClient.DefaultRequestHeaders.UserAgent.ParseAdd("CriptoVersus/1.0");

        if (!_httpClient.DefaultRequestHeaders.Accept.Any(h => string.Equals(h.MediaType, "application/json", StringComparison.OrdinalIgnoreCase)))
            _httpClient.DefaultRequestHeaders.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
    }

    public async Task<TokenMarketSnapshotResponse> GetSnapshotAsync(string? contractAddress, CancellationToken ct)
    {
        var result = await ProbeSourcesAsync(contractAddress, ct);
        return result.Snapshot;
    }

    public async Task<TokenMarketDebugResponse> GetDebugSnapshotAsync(string? contractAddress, CancellationToken ct)
    {
        var result = await ProbeSourcesAsync(contractAddress, ct);
        return new TokenMarketDebugResponse(
            ContractAddress: result.Snapshot.ContractAddress,
            CheckedAtUtc: result.CheckedAtUtc,
            FinalSource: result.Snapshot.Source,
            FinalStatus: result.FinalStatus,
            Attempts: result.Attempts
                .Select(static attempt => new TokenMarketDebugAttemptResponse(
                    attempt.Source,
                    attempt.Url,
                    attempt.HttpStatusCode,
                    attempt.Success,
                    attempt.HasData,
                    attempt.Message,
                    attempt.ElapsedMs))
                .ToArray());
    }

    private async Task<TokenMarketProbeResult> ProbeSourcesAsync(string? contractAddress, CancellationToken ct)
    {
        var resolvedAddress = string.IsNullOrWhiteSpace(contractAddress)
            ? OfficialContractAddress
            : contractAddress.Trim();
        var checkedAtUtc = DateTimeOffset.UtcNow;
        var attempts = new List<TokenMarketProbeAttempt>();

        try
        {
            var dexPairAttempt = await TryDexScreenerTokenPairsAsync(resolvedAddress, ct);
            attempts.Add(dexPairAttempt.Attempt);
            if (dexPairAttempt.Pair is not null)
                return new TokenMarketProbeResult(
                    MapDexScreenerPair(dexPairAttempt.Pair, resolvedAddress, "dexscreener"),
                    checkedAtUtc,
                    "live",
                    attempts);

            var dexLatestAttempt = await TryDexScreenerLatestTokensAsync(resolvedAddress, ct);
            attempts.Add(dexLatestAttempt.Attempt);
            if (dexLatestAttempt.Pair is not null)
                return new TokenMarketProbeResult(
                    MapDexScreenerPair(dexLatestAttempt.Pair, resolvedAddress, "dexscreener_latest"),
                    checkedAtUtc,
                    "live",
                    attempts);

            var geckoAttempt = await TryGeckoTerminalAsync(resolvedAddress, ct);
            attempts.Add(geckoAttempt.Attempt);
            if (geckoAttempt.Snapshot is not null)
                return new TokenMarketProbeResult(
                    geckoAttempt.Snapshot,
                    checkedAtUtc,
                    "live",
                    attempts);

            var birdeyeAttempt = await TryBirdeyeAsync(resolvedAddress, ct);
            attempts.Add(birdeyeAttempt.Attempt);
            if (birdeyeAttempt.Snapshot is not null)
                return new TokenMarketProbeResult(
                    birdeyeAttempt.Snapshot,
                    checkedAtUtc,
                    "live",
                    attempts);

            var birdeyeTradeAttempt = await TryBirdeyeTradeDataAsync(resolvedAddress, ct);
            attempts.Add(birdeyeTradeAttempt.Attempt);
            if (birdeyeTradeAttempt.Snapshot is not null)
                return new TokenMarketProbeResult(
                    birdeyeTradeAttempt.Snapshot,
                    checkedAtUtc,
                    "live",
                    attempts);

            var birdeyeMarketsAttempt = await TryBirdeyeMarketsAsync(resolvedAddress, ct);
            attempts.Add(birdeyeMarketsAttempt.Attempt);
            if (birdeyeMarketsAttempt.Snapshot is not null)
                return new TokenMarketProbeResult(
                    birdeyeMarketsAttempt.Snapshot,
                    checkedAtUtc,
                    "live",
                    attempts);

            var birdeyeSearchAttempt = await TryBirdeyeSearchAsync(resolvedAddress, ct);
            attempts.Add(birdeyeSearchAttempt.Attempt);
            if (birdeyeSearchAttempt.Snapshot is not null)
                return new TokenMarketProbeResult(
                    birdeyeSearchAttempt.Snapshot,
                    checkedAtUtc,
                    "live",
                    attempts);

            var heliusAttempt = await TryHeliusAsync(resolvedAddress, ct);
            attempts.Add(heliusAttempt.Attempt);
            if (heliusAttempt.Snapshot is not null)
                return new TokenMarketProbeResult(
                    heliusAttempt.Snapshot,
                    checkedAtUtc,
                    "live",
                    attempts);
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Token market multi-source lookup failed. Contract={ContractAddress}", resolvedAddress);
        }

        _logger.LogInformation("Returning unavailable snapshot. Contract={ContractAddress}", resolvedAddress);
        return new TokenMarketProbeResult(
            CreateUnavailable(resolvedAddress),
            checkedAtUtc,
            "unavailable",
            attempts);
    }

    private async Task<DexProbePairResult> TryDexScreenerTokenPairsAsync(string contractAddress, CancellationToken ct)
    {
        var relativeUrl = $"token-pairs/v1/{DexScreenerChainId}/{Uri.EscapeDataString(contractAddress)}";
        var requestUrl = new Uri(_httpClient.BaseAddress!, relativeUrl).ToString();
        var startedAt = DateTimeOffset.UtcNow;

        try
        {
            using var response = await _httpClient.GetAsync(relativeUrl, ct);
            var statusCode = (int)response.StatusCode;
            if (!response.IsSuccessStatusCode)
            {
                var attempt = CreateAttempt("DexScreener token-pairs", requestUrl, statusCode, false, false, "HTTP failure", startedAt);
                LogAttempt(attempt);
                return new DexProbePairResult(null, attempt);
            }

            var payload = await response.Content.ReadFromJsonAsync<List<DexScreenerPairDto>>(cancellationToken: ct);
            var pair = SelectBestDexScreenerPair(payload, contractAddress);
            var hasData = pair is not null;
            var attemptSuccess = CreateAttempt(
                "DexScreener token-pairs",
                requestUrl,
                statusCode,
                true,
                hasData,
                hasData ? "Pair found" : "DexScreener token-pairs empty",
                startedAt);
            LogAttempt(attemptSuccess);
            return new DexProbePairResult(pair, attemptSuccess);
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "DexScreener token-pairs request failed. Contract={ContractAddress}", contractAddress);
            var attempt = CreateAttempt("DexScreener token-pairs", requestUrl, null, false, false, "Request failed", startedAt);
            LogAttempt(attempt);
            return new DexProbePairResult(null, attempt);
        }
    }

    private async Task<DexProbePairResult> TryDexScreenerLatestTokensAsync(string contractAddress, CancellationToken ct)
    {
        var relativeUrl = $"latest/dex/tokens/{Uri.EscapeDataString(contractAddress)}";
        var requestUrl = new Uri(_httpClient.BaseAddress!, relativeUrl).ToString();
        var startedAt = DateTimeOffset.UtcNow;

        try
        {
            using var response = await _httpClient.GetAsync(relativeUrl, ct);

            if (!response.IsSuccessStatusCode)
            {
                var attempt = CreateAttempt("DexScreener latest/dex/tokens", requestUrl, (int)response.StatusCode, false, false, "HTTP failure", startedAt);
                LogAttempt(attempt);
                return new DexProbePairResult(null, attempt);
            }

            await using var stream = await response.Content.ReadAsStreamAsync(ct);
            using var document = await JsonDocument.ParseAsync(stream, cancellationToken: ct);
            if (!document.RootElement.TryGetProperty("pairs", out var pairsElement) || pairsElement.ValueKind != JsonValueKind.Array)
            {
                var attempt = CreateAttempt("DexScreener latest/dex/tokens", requestUrl, (int)response.StatusCode, true, false, "DexScreener latest/dex/tokens empty", startedAt);
                LogAttempt(attempt);
                return new DexProbePairResult(null, attempt);
            }

            var pairs = JsonSerializer.Deserialize<List<DexScreenerPairDto>>(pairsElement.GetRawText());
            var pair = SelectBestDexScreenerPair(pairs, contractAddress);
            var hasData = pair is not null;
            var successAttempt = CreateAttempt(
                "DexScreener latest/dex/tokens",
                requestUrl,
                (int)response.StatusCode,
                true,
                hasData,
                hasData ? "Pair found" : "DexScreener latest/dex/tokens empty",
                startedAt);
            LogAttempt(successAttempt);
            return new DexProbePairResult(pair, successAttempt);
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "DexScreener latest/dex/tokens request failed. Contract={ContractAddress}", contractAddress);
            var attempt = CreateAttempt("DexScreener latest/dex/tokens", requestUrl, null, false, false, "Request failed", startedAt);
            LogAttempt(attempt);
            return new DexProbePairResult(null, attempt);
        }
    }

    private async Task<GeckoProbeResult> TryGeckoTerminalAsync(string contractAddress, CancellationToken ct)
    {
        var requestUrl = $"https://api.coingecko.com/api/v3/onchain/networks/{GeckoTerminalNetwork}/tokens/{Uri.EscapeDataString(contractAddress)}/pools";
        var startedAt = DateTimeOffset.UtcNow;

        try
        {
            using var response = await _httpClient.GetAsync(requestUrl, ct);

            if (response.StatusCode == System.Net.HttpStatusCode.Forbidden)
            {
                var blockedAttempt = CreateAttempt("GeckoTerminal", requestUrl, (int)response.StatusCode, false, false, "GeckoTerminal blocked or requires headers/rate limit", startedAt);
                LogAttempt(blockedAttempt);
                return new GeckoProbeResult(null, blockedAttempt);
            }

            if (!response.IsSuccessStatusCode)
            {
                var attempt = CreateAttempt("GeckoTerminal", requestUrl, (int)response.StatusCode, false, false, "HTTP failure", startedAt);
                LogAttempt(attempt);
                return new GeckoProbeResult(null, attempt);
            }

            await using var stream = await response.Content.ReadAsStreamAsync(ct);
            using var document = await JsonDocument.ParseAsync(stream, cancellationToken: ct);
            if (!document.RootElement.TryGetProperty("data", out var dataElement) || dataElement.ValueKind != JsonValueKind.Array)
            {
                var attempt = CreateAttempt("GeckoTerminal", requestUrl, (int)response.StatusCode, true, false, "GeckoTerminal empty", startedAt);
                LogAttempt(attempt);
                return new GeckoProbeResult(null, attempt);
            }

            var bestPool = dataElement
                .EnumerateArray()
                .OrderByDescending(pool => ReadDecimal(pool, "attributes", "reserve_in_usd") ?? 0m)
                .ThenByDescending(pool => ReadDecimal(pool, "attributes", "volume_usd", "h24") ?? 0m)
                .FirstOrDefault();

            if (bestPool.ValueKind == JsonValueKind.Undefined)
            {
                var attempt = CreateAttempt("GeckoTerminal", requestUrl, (int)response.StatusCode, true, false, "GeckoTerminal empty", startedAt);
                LogAttempt(attempt);
                return new GeckoProbeResult(null, attempt);
            }

            var attributes = bestPool.GetProperty("attributes");
            var price = ReadDecimal(attributes, "base_token_price_usd");
            var marketCap = ReadDecimal(attributes, "market_cap_usd") ?? ReadDecimal(attributes, "fdv_usd");
            var volume24h = ReadDecimal(attributes, "volume_usd", "h24");
            var liquidity = ReadDecimal(attributes, "reserve_in_usd");

            if (price is null && marketCap is null && volume24h is null && liquidity is null)
            {
                var attempt = CreateAttempt("GeckoTerminal", requestUrl, (int)response.StatusCode, true, false, "GeckoTerminal empty", startedAt);
                LogAttempt(attempt);
                return new GeckoProbeResult(null, attempt);
            }

            var snapshot = new TokenMarketSnapshotResponse(
                ContractAddress: contractAddress,
                Network: OfficialNetwork,
                BuyTaxPercent: 0m,
                SellTaxPercent: 0m,
                CurrentPrice: price,
                MarketCap: marketCap,
                Holders: null,
                Volume24h: volume24h,
                Liquidity: liquidity,
                UpdatedAtUtc: DateTimeOffset.UtcNow,
                Source: "geckoterminal");
            var successAttempt = CreateAttempt("GeckoTerminal", requestUrl, (int)response.StatusCode, true, true, "Pool found", startedAt);
            LogAttempt(successAttempt);
            return new GeckoProbeResult(snapshot, successAttempt);
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "GeckoTerminal request failed. Contract={ContractAddress}", contractAddress);
            var attempt = CreateAttempt("GeckoTerminal", requestUrl, null, false, false, "Request failed", startedAt);
            LogAttempt(attempt);
            return new GeckoProbeResult(null, attempt);
        }
    }

    private async Task<ExternalSnapshotProbeResult> TryBirdeyeAsync(string contractAddress, CancellationToken ct)
    {
        const string source = "Birdeye";
        var requestUrl = $"https://public-api.birdeye.so/defi/v3/token/market-data?address={Uri.EscapeDataString(contractAddress)}&ui_amount_mode=scaled";
        var startedAt = DateTimeOffset.UtcNow;
        var apiKey = ResolveApiKey("BIRDEYE_API_KEY", "Birdeye:ApiKey", "TokenMarket:Birdeye:ApiKey");

        if (string.IsNullOrWhiteSpace(apiKey))
        {
            var skipped = CreateAttempt(source, requestUrl, null, false, false, "Skipped: API key not configured", startedAt);
            LogAttempt(skipped);
            return new ExternalSnapshotProbeResult(null, skipped);
        }

        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, requestUrl);
            request.Headers.TryAddWithoutValidation("x-chain", "solana");
            request.Headers.TryAddWithoutValidation("X-API-KEY", apiKey);

            using var response = await _httpClient.SendAsync(request, ct);
            if (!response.IsSuccessStatusCode)
            {
                var attempt = CreateAttempt(source, requestUrl, (int)response.StatusCode, false, false, "HTTP failure", startedAt);
                LogAttempt(attempt);
                return new ExternalSnapshotProbeResult(null, attempt);
            }

            await using var stream = await response.Content.ReadAsStreamAsync(ct);
            using var document = await JsonDocument.ParseAsync(stream, cancellationToken: ct);
            var apiSuccess = document.RootElement.TryGetProperty("success", out var successElement)
                && successElement.ValueKind == JsonValueKind.True;
            var data = document.RootElement.TryGetProperty("data", out var dataElement) ? dataElement : default;
            if (data.ValueKind != JsonValueKind.Object)
            {
                var emptyAttempt = CreateAttempt(
                    source,
                    requestUrl,
                    (int)response.StatusCode,
                    apiSuccess,
                    false,
                    BuildBirdeyeEmptyMessage(document.RootElement, data, apiSuccess),
                    startedAt);
                LogAttempt(emptyAttempt);
                return new ExternalSnapshotProbeResult(null, emptyAttempt);
            }

            var price = ReadDecimal(data, "price")
                ?? ReadDecimal(data, "priceUsd")
                ?? ReadDecimal(data, "value", "price")
                ?? ReadDecimal(data, "market_data", "price");
            var marketCap = ReadDecimal(data, "market_cap")
                ?? ReadDecimal(data, "marketcap")
                ?? ReadDecimal(data, "marketCap")
                ?? ReadDecimal(data, "fdv")
                ?? ReadDecimal(data, "value", "marketCap")
                ?? ReadDecimal(data, "market_data", "marketcap");
            var holders = ReadInt(data, "holder")
                ?? ReadInt(data, "holders")
                ?? ReadInt(data, "holderCount")
                ?? ReadInt(data, "value", "holders");
            var volume24h = ReadDecimal(data, "volume_24h")
                ?? ReadDecimal(data, "volume24h")
                ?? ReadDecimal(data, "v24h")
                ?? ReadDecimal(data, "volume", "h24")
                ?? ReadDecimal(data, "trade_data", "volume24h")
                ?? ReadDecimal(data, "value", "volume24h");
            var liquidity = ReadDecimal(data, "liquidity")
                ?? ReadDecimal(data, "liquidityUsd")
                ?? ReadDecimal(data, "liquidity_usd")
                ?? ReadDecimal(data, "value", "liquidity")
                ?? ReadDecimal(data, "trade_data", "liquidity");

            var snapshot = new TokenMarketSnapshotResponse(
                ContractAddress: contractAddress,
                Network: OfficialNetwork,
                BuyTaxPercent: 0m,
                SellTaxPercent: 0m,
                CurrentPrice: price,
                MarketCap: marketCap,
                Holders: holders,
                Volume24h: volume24h,
                Liquidity: liquidity,
                UpdatedAtUtc: DateTimeOffset.UtcNow,
                Source: "birdeye");

            var hasData = snapshot.CurrentPrice is not null
                || snapshot.MarketCap is not null
                || snapshot.Volume24h is not null
                || snapshot.Liquidity is not null
                || snapshot.Holders is not null;

            var detailMessage = hasData
                ? BuildPresenceMessage("Birdeye data found", price, marketCap, volume24h, liquidity, holders)
                : BuildBirdeyeEmptyMessage(document.RootElement, data, apiSuccess);
            var successAttempt = CreateAttempt(source, requestUrl, (int)response.StatusCode, apiSuccess, hasData, detailMessage, startedAt);
            LogAttempt(successAttempt);
            return new ExternalSnapshotProbeResult(hasData ? snapshot : null, successAttempt);
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Birdeye request failed. Contract={ContractAddress}", contractAddress);
            var attempt = CreateAttempt(source, requestUrl, null, false, false, "Request failed", startedAt);
            LogAttempt(attempt);
            return new ExternalSnapshotProbeResult(null, attempt);
        }
    }

    private async Task<ExternalSnapshotProbeResult> TryBirdeyeTradeDataAsync(string contractAddress, CancellationToken ct)
    {
        const string source = "Birdeye Trade Data";
        var requestUrl = $"https://public-api.birdeye.so/defi/v3/token/trade-data/single?address={Uri.EscapeDataString(contractAddress)}";
        var startedAt = DateTimeOffset.UtcNow;
        var apiKey = ResolveApiKey("BIRDEYE_API_KEY", "Birdeye:ApiKey", "TokenMarket:Birdeye:ApiKey");

        if (string.IsNullOrWhiteSpace(apiKey))
        {
            var skipped = CreateAttempt(source, requestUrl, null, false, false, "Skipped: API key not configured", startedAt);
            LogAttempt(skipped);
            return new ExternalSnapshotProbeResult(null, skipped);
        }

        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, requestUrl);
            request.Headers.TryAddWithoutValidation("X-API-KEY", apiKey);
            request.Headers.TryAddWithoutValidation("x-chain", "solana");
            request.Headers.TryAddWithoutValidation("accept", "application/json");

            using var response = await _httpClient.SendAsync(request, ct);
            if (!response.IsSuccessStatusCode)
            {
                var attempt = CreateAttempt(source, requestUrl, (int)response.StatusCode, false, false, "HTTP failure", startedAt);
                LogAttempt(attempt);
                return new ExternalSnapshotProbeResult(null, attempt);
            }

            await using var stream = await response.Content.ReadAsStreamAsync(ct);
            using var document = await JsonDocument.ParseAsync(stream, cancellationToken: ct);
            var apiSuccess = document.RootElement.TryGetProperty("success", out var successElement)
                && successElement.ValueKind == JsonValueKind.True;
            var data = document.RootElement.TryGetProperty("data", out var dataElement) ? dataElement : default;
            if (data.ValueKind != JsonValueKind.Object)
            {
                var emptyAttempt = CreateAttempt(
                    source,
                    requestUrl,
                    (int)response.StatusCode,
                    apiSuccess,
                    false,
                    $"Birdeye trade-data empty (success={apiSuccess}; rootKeys={DescribeObjectKeys(document.RootElement)}; dataState={DescribeJsonState(data)})",
                    startedAt);
                LogAttempt(emptyAttempt);
                return new ExternalSnapshotProbeResult(null, emptyAttempt);
            }

            var price = ReadDecimal(data, "price")
                ?? ReadDecimal(data, "priceUsd")
                ?? ReadDecimal(data, "current_price")
                ?? ReadDecimal(data, "value", "price");
            var volume24h = ReadDecimal(data, "volume24h")
                ?? ReadDecimal(data, "volume_24h")
                ?? ReadDecimal(data, "v24h")
                ?? ReadDecimal(data, "volume", "h24")
                ?? ReadDecimal(data, "trade_24h")
                ?? ReadDecimal(data, "value", "volume24h");
            var liquidity = ReadDecimal(data, "liquidity")
                ?? ReadDecimal(data, "liquidityUsd")
                ?? ReadDecimal(data, "liquidity_usd")
                ?? ReadDecimal(data, "value", "liquidity");
            var marketCap = ReadDecimal(data, "market_cap")
                ?? ReadDecimal(data, "marketCap")
                ?? ReadDecimal(data, "fdv")
                ?? ReadDecimal(data, "value", "marketCap");
            var holders = ReadInt(data, "holder")
                ?? ReadInt(data, "holders")
                ?? ReadInt(data, "holderCount");

            var snapshot = new TokenMarketSnapshotResponse(
                ContractAddress: contractAddress,
                Network: OfficialNetwork,
                BuyTaxPercent: 0m,
                SellTaxPercent: 0m,
                CurrentPrice: price,
                MarketCap: marketCap,
                Holders: holders,
                Volume24h: volume24h,
                Liquidity: liquidity,
                UpdatedAtUtc: DateTimeOffset.UtcNow,
                Source: "birdeye_trade");

            var hasData = snapshot.CurrentPrice is not null
                || snapshot.MarketCap is not null
                || snapshot.Volume24h is not null
                || snapshot.Liquidity is not null
                || snapshot.Holders is not null;
            var message = hasData
                ? BuildPresenceMessage("Birdeye trade-data found", price, marketCap, volume24h, liquidity, holders)
                : $"Birdeye trade-data empty (dataKeys={DescribeObjectKeys(data)})";
            var successAttempt = CreateAttempt(source, requestUrl, (int)response.StatusCode, apiSuccess, hasData, message, startedAt);
            LogAttempt(successAttempt);
            return new ExternalSnapshotProbeResult(hasData ? snapshot : null, successAttempt);
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Birdeye trade-data request failed. Contract={ContractAddress}", contractAddress);
            var attempt = CreateAttempt(source, requestUrl, null, false, false, "Request failed", startedAt);
            LogAttempt(attempt);
            return new ExternalSnapshotProbeResult(null, attempt);
        }
    }

    private async Task<ExternalSnapshotProbeResult> TryBirdeyeMarketsAsync(string contractAddress, CancellationToken ct)
    {
        const string source = "Birdeye Markets";
        var requestUrl = $"https://public-api.birdeye.so/defi/v2/markets?address={Uri.EscapeDataString(contractAddress)}&sort_by=liquidity&sort_type=desc&offset=0&limit=1";
        var startedAt = DateTimeOffset.UtcNow;
        var apiKey = ResolveApiKey("BIRDEYE_API_KEY", "Birdeye:ApiKey", "TokenMarket:Birdeye:ApiKey");

        if (string.IsNullOrWhiteSpace(apiKey))
        {
            var skipped = CreateAttempt(source, requestUrl, null, false, false, "Skipped: API key not configured", startedAt);
            LogAttempt(skipped);
            return new ExternalSnapshotProbeResult(null, skipped);
        }

        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, requestUrl);
            request.Headers.TryAddWithoutValidation("X-API-KEY", apiKey);
            request.Headers.TryAddWithoutValidation("x-chain", "solana");
            request.Headers.TryAddWithoutValidation("accept", "application/json");

            using var response = await _httpClient.SendAsync(request, ct);
            if (!response.IsSuccessStatusCode)
            {
                var attempt = CreateAttempt(source, requestUrl, (int)response.StatusCode, false, false, "HTTP failure", startedAt);
                LogAttempt(attempt);
                return new ExternalSnapshotProbeResult(null, attempt);
            }

            await using var stream = await response.Content.ReadAsStreamAsync(ct);
            using var document = await JsonDocument.ParseAsync(stream, cancellationToken: ct);
            var apiSuccess = document.RootElement.TryGetProperty("success", out var successElement)
                ? successElement.ValueKind == JsonValueKind.True
                : true;

            var items = FindBirdeyeMarketsItems(document.RootElement);
            var market = items.FirstOrDefault();
            if (market.ValueKind == JsonValueKind.Undefined)
            {
                var emptyAttempt = CreateAttempt(
                    source,
                    requestUrl,
                    (int)response.StatusCode,
                    apiSuccess,
                    false,
                    $"Birdeye markets empty (rootKeys={DescribeObjectKeys(document.RootElement)})",
                    startedAt);
                LogAttempt(emptyAttempt);
                return new ExternalSnapshotProbeResult(null, emptyAttempt);
            }

            var price = ReadDecimal(market, "price")
                ?? ReadDecimal(market, "priceUsd")
                ?? ReadDecimal(market, "lastPrice")
                ?? ReadDecimal(market, "value", "price");
            var volume24h = ReadDecimal(market, "volume24h")
                ?? ReadDecimal(market, "v24h")
                ?? ReadDecimal(market, "volume", "h24");
            var liquidity = ReadDecimal(market, "liquidity")
                ?? ReadDecimal(market, "liquidityUsd")
                ?? ReadDecimal(market, "liquidity", "usd");
            var marketCap = ReadDecimal(market, "market_cap")
                ?? ReadDecimal(market, "marketCap")
                ?? ReadDecimal(market, "fdv");

            var snapshot = new TokenMarketSnapshotResponse(
                ContractAddress: contractAddress,
                Network: OfficialNetwork,
                BuyTaxPercent: 0m,
                SellTaxPercent: 0m,
                CurrentPrice: price,
                MarketCap: marketCap,
                Holders: null,
                Volume24h: volume24h,
                Liquidity: liquidity,
                UpdatedAtUtc: DateTimeOffset.UtcNow,
                Source: "birdeye_markets");

            var hasData = snapshot.CurrentPrice is not null
                || snapshot.MarketCap is not null
                || snapshot.Volume24h is not null
                || snapshot.Liquidity is not null;
            var message = hasData
                ? BuildPresenceMessage("Birdeye markets found", price, marketCap, volume24h, liquidity, null)
                : $"Birdeye markets empty (itemKeys={DescribeObjectKeys(market)})";
            var successAttempt = CreateAttempt(source, requestUrl, (int)response.StatusCode, apiSuccess, hasData, message, startedAt);
            LogAttempt(successAttempt);
            return new ExternalSnapshotProbeResult(hasData ? snapshot : null, successAttempt);
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Birdeye markets request failed. Contract={ContractAddress}", contractAddress);
            var attempt = CreateAttempt(source, requestUrl, null, false, false, "Request failed", startedAt);
            LogAttempt(attempt);
            return new ExternalSnapshotProbeResult(null, attempt);
        }
    }

    private async Task<ExternalSnapshotProbeResult> TryBirdeyeSearchAsync(string contractAddress, CancellationToken ct)
    {
        const string source = "Birdeye Search";
        var requestUrl = $"https://public-api.birdeye.so/defi/v3/search?chain=solana&keyword={Uri.EscapeDataString(contractAddress)}&target=all&search_mode=exact";
        var startedAt = DateTimeOffset.UtcNow;
        var apiKey = ResolveApiKey("BIRDEYE_API_KEY", "Birdeye:ApiKey", "TokenMarket:Birdeye:ApiKey");

        if (string.IsNullOrWhiteSpace(apiKey))
        {
            var skipped = CreateAttempt(source, requestUrl, null, false, false, "Skipped: API key not configured", startedAt);
            LogAttempt(skipped);
            return new ExternalSnapshotProbeResult(null, skipped);
        }

        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, requestUrl);
            request.Headers.TryAddWithoutValidation("x-chain", "solana");
            request.Headers.TryAddWithoutValidation("X-API-KEY", apiKey);

            using var response = await _httpClient.SendAsync(request, ct);
            if (!response.IsSuccessStatusCode)
            {
                var attempt = CreateAttempt(source, requestUrl, (int)response.StatusCode, false, false, "HTTP failure", startedAt);
                LogAttempt(attempt);
                return new ExternalSnapshotProbeResult(null, attempt);
            }

            await using var stream = await response.Content.ReadAsStreamAsync(ct);
            using var document = await JsonDocument.ParseAsync(stream, cancellationToken: ct);
            var apiSuccess = document.RootElement.TryGetProperty("success", out var successElement)
                && successElement.ValueKind == JsonValueKind.True;

            if (!document.RootElement.TryGetProperty("data", out var dataElement) || dataElement.ValueKind != JsonValueKind.Object)
            {
                var emptyAttempt = CreateAttempt(
                    source,
                    requestUrl,
                    (int)response.StatusCode,
                    apiSuccess,
                    false,
                    $"Birdeye search empty (success={apiSuccess}; rootKeys={DescribeObjectKeys(document.RootElement)})",
                    startedAt);
                LogAttempt(emptyAttempt);
                return new ExternalSnapshotProbeResult(null, emptyAttempt);
            }

            var items = FindBirdeyeSearchItems(dataElement);
            var match = items.FirstOrDefault(item =>
                string.Equals(ReadString(item, "address"), contractAddress, StringComparison.OrdinalIgnoreCase)
                || string.Equals(ReadString(item, "value", "address"), contractAddress, StringComparison.OrdinalIgnoreCase));

            if (match.ValueKind == JsonValueKind.Undefined)
            {
                var emptyAttempt = CreateAttempt(
                    source,
                    requestUrl,
                    (int)response.StatusCode,
                    apiSuccess,
                    false,
                    $"Birdeye search empty (dataKeys={DescribeObjectKeys(dataElement)})",
                    startedAt);
                LogAttempt(emptyAttempt);
                return new ExternalSnapshotProbeResult(null, emptyAttempt);
            }

            var price = ReadDecimal(match, "price")
                ?? ReadDecimal(match, "priceUsd")
                ?? ReadDecimal(match, "value", "price");
            var marketCap = ReadDecimal(match, "market_cap")
                ?? ReadDecimal(match, "marketcap")
                ?? ReadDecimal(match, "fdv")
                ?? ReadDecimal(match, "value", "marketCap");
            var holders = ReadInt(match, "holder")
                ?? ReadInt(match, "holders")
                ?? ReadInt(match, "holderCount");
            var volume24h = ReadDecimal(match, "volume_24h")
                ?? ReadDecimal(match, "volume24h")
                ?? ReadDecimal(match, "v24h");
            var liquidity = ReadDecimal(match, "liquidity")
                ?? ReadDecimal(match, "liquidityUsd")
                ?? ReadDecimal(match, "liquidity_usd");

            var snapshot = new TokenMarketSnapshotResponse(
                ContractAddress: contractAddress,
                Network: OfficialNetwork,
                BuyTaxPercent: 0m,
                SellTaxPercent: 0m,
                CurrentPrice: price,
                MarketCap: marketCap,
                Holders: holders,
                Volume24h: volume24h,
                Liquidity: liquidity,
                UpdatedAtUtc: DateTimeOffset.UtcNow,
                Source: "birdeye_search");

            var hasData = snapshot.CurrentPrice is not null
                || snapshot.MarketCap is not null
                || snapshot.Volume24h is not null
                || snapshot.Liquidity is not null
                || snapshot.Holders is not null;
            var message = hasData
                ? BuildPresenceMessage("Birdeye search data found", price, marketCap, volume24h, liquidity, holders)
                : $"Birdeye search match found but no market fields (itemKeys={DescribeObjectKeys(match)})";
            var successAttempt = CreateAttempt(source, requestUrl, (int)response.StatusCode, apiSuccess, hasData, message, startedAt);
            LogAttempt(successAttempt);
            return new ExternalSnapshotProbeResult(hasData ? snapshot : null, successAttempt);
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Birdeye search request failed. Contract={ContractAddress}", contractAddress);
            var attempt = CreateAttempt(source, requestUrl, null, false, false, "Request failed", startedAt);
            LogAttempt(attempt);
            return new ExternalSnapshotProbeResult(null, attempt);
        }
    }

    private async Task<ExternalSnapshotProbeResult> TryHeliusAsync(string contractAddress, CancellationToken ct)
    {
        const string source = "Helius";
        var apiKey = ResolveApiKey("HELIUS_API_KEY", "Helius:ApiKey", "TokenMarket:Helius:ApiKey");
        var requestUrl = string.IsNullOrWhiteSpace(apiKey)
            ? "https://mainnet.helius-rpc.com/?api-key=CONFIGURE_KEY"
            : $"https://mainnet.helius-rpc.com/?api-key={Uri.EscapeDataString(apiKey)}";
        var debugUrl = "https://mainnet.helius-rpc.com/?api-key=REDACTED";
        var startedAt = DateTimeOffset.UtcNow;

        if (string.IsNullOrWhiteSpace(apiKey))
        {
            var skipped = CreateAttempt(source, debugUrl, null, false, false, "Skipped: API key not configured", startedAt);
            LogAttempt(skipped);
            return new ExternalSnapshotProbeResult(null, skipped);
        }

        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Post, requestUrl);
            request.Content = new StringContent(
                JsonSerializer.Serialize(new
                {
                    jsonrpc = "2.0",
                    id = "criptoversus-token-market",
                    method = "getAsset",
                    @params = new
                    {
                        id = contractAddress
                    }
                }),
                Encoding.UTF8,
                "application/json");

            using var response = await _httpClient.SendAsync(request, ct);
            if (!response.IsSuccessStatusCode)
            {
                var attempt = CreateAttempt(source, debugUrl, (int)response.StatusCode, false, false, "HTTP failure", startedAt);
                LogAttempt(attempt);
                return new ExternalSnapshotProbeResult(null, attempt);
            }

            await using var stream = await response.Content.ReadAsStreamAsync(ct);
            using var document = await JsonDocument.ParseAsync(stream, cancellationToken: ct);
            if (!document.RootElement.TryGetProperty("result", out var resultElement) || resultElement.ValueKind != JsonValueKind.Object)
            {
                var emptyAttempt = CreateAttempt(source, debugUrl, (int)response.StatusCode, true, false, "Helius empty", startedAt);
                LogAttempt(emptyAttempt);
                return new ExternalSnapshotProbeResult(null, emptyAttempt);
            }

            var tokenInfo = resultElement.TryGetProperty("token_info", out var tokenInfoElement) ? tokenInfoElement : default;
            var price = ReadDecimal(tokenInfo, "price_info", "price_per_token");
            var supplyRaw = ReadDecimal(tokenInfo, "supply");
            var decimals = ReadInt(tokenInfo, "decimals");
            var normalizedSupply = supplyRaw.HasValue && decimals.HasValue
                ? supplyRaw.Value / (decimal)Math.Pow(10, decimals.Value)
                : (decimal?)null;
            var marketCap = price.HasValue && normalizedSupply.HasValue
                ? (decimal?)(price.Value * normalizedSupply.Value)
                : null;

            var snapshot = new TokenMarketSnapshotResponse(
                ContractAddress: contractAddress,
                Network: OfficialNetwork,
                BuyTaxPercent: 0m,
                SellTaxPercent: 0m,
                CurrentPrice: price,
                MarketCap: marketCap,
                Holders: null,
                Volume24h: null,
                Liquidity: null,
                UpdatedAtUtc: DateTimeOffset.UtcNow,
                Source: "helius");

            var hasData = snapshot.CurrentPrice is not null || snapshot.MarketCap is not null;
            var successAttempt = CreateAttempt(source, debugUrl, (int)response.StatusCode, true, hasData, hasData ? "Token price data found" : "Helius empty", startedAt);
            LogAttempt(successAttempt);
            return new ExternalSnapshotProbeResult(hasData ? snapshot : null, successAttempt);
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Helius request failed. Contract={ContractAddress}", contractAddress);
            var attempt = CreateAttempt(source, debugUrl, null, false, false, "Request failed", startedAt);
            LogAttempt(attempt);
            return new ExternalSnapshotProbeResult(null, attempt);
        }
    }

    private static DexScreenerPairDto? SelectBestDexScreenerPair(IEnumerable<DexScreenerPairDto?>? pairs, string contractAddress)
        => pairs?
            .Where(static pair => pair is not null)
            .OrderByDescending(pair => string.Equals(pair?.BaseToken?.Address, contractAddress, StringComparison.OrdinalIgnoreCase))
            .ThenByDescending(pair => pair?.Liquidity?.Usd ?? 0m)
            .ThenByDescending(pair => pair?.Volume?.H24 ?? 0m)
            .FirstOrDefault();

    private static TokenMarketSnapshotResponse MapDexScreenerPair(DexScreenerPairDto pair, string requestedAddress, string source)
    {
        var resolvedContract = string.IsNullOrWhiteSpace(pair.BaseToken?.Address)
            ? requestedAddress
            : pair.BaseToken.Address.Trim();

        var marketCap = pair.MarketCap ?? pair.Fdv;
        var price = TryParseDecimal(pair.PriceUsd);

        return new TokenMarketSnapshotResponse(
            ContractAddress: resolvedContract,
            Network: OfficialNetwork,
            BuyTaxPercent: 0m,
            SellTaxPercent: 0m,
            CurrentPrice: price,
            MarketCap: marketCap,
            Holders: null,
            Volume24h: pair.Volume?.H24,
            Liquidity: pair.Liquidity?.Usd,
            UpdatedAtUtc: DateTimeOffset.UtcNow,
            Source: source);
    }

    private static TokenMarketSnapshotResponse CreateUnavailable(string contractAddress)
        => new(
            ContractAddress: contractAddress,
            Network: OfficialNetwork,
            BuyTaxPercent: 0m,
            SellTaxPercent: 0m,
            CurrentPrice: null,
            MarketCap: null,
            Holders: null,
            Volume24h: null,
            Liquidity: null,
            UpdatedAtUtc: DateTimeOffset.UtcNow,
            Source: "unavailable");

    private static decimal? TryParseDecimal(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
            return null;

        return decimal.TryParse(value, NumberStyles.Float, CultureInfo.InvariantCulture, out var parsed)
            ? parsed
            : null;
    }

    private sealed class DexScreenerPairDto
    {
        public string? PriceUsd { get; set; }
        public decimal? Fdv { get; set; }
        public decimal? MarketCap { get; set; }
        public DexScreenerVolumeDto? Volume { get; set; }
        public DexScreenerLiquidityDto? Liquidity { get; set; }
        public DexScreenerTokenDto? BaseToken { get; set; }
    }

    private sealed class DexScreenerTokenDto
    {
        public string? Address { get; set; }
    }

    private sealed class DexScreenerVolumeDto
    {
        public decimal? H24 { get; set; }
    }

    private sealed class DexScreenerLiquidityDto
    {
        public decimal? Usd { get; set; }
    }

    private static decimal? ReadDecimal(JsonElement element, params string[] path)
    {
        var current = element;
        foreach (var segment in path)
        {
            if (!current.TryGetProperty(segment, out current))
                return null;
        }

        return current.ValueKind switch
        {
            JsonValueKind.Number when current.TryGetDecimal(out var number) => number,
            JsonValueKind.String when decimal.TryParse(current.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var parsed) => parsed,
            _ => null
        };
    }

    private static int? ReadInt(JsonElement element, params string[] path)
    {
        var current = element;
        foreach (var segment in path)
        {
            if (current.ValueKind != JsonValueKind.Object || !current.TryGetProperty(segment, out current))
                return null;
        }

        return current.ValueKind switch
        {
            JsonValueKind.Number when current.TryGetInt32(out var intValue) => intValue,
            JsonValueKind.Number when current.TryGetDecimal(out var decimalValue) => (int)decimalValue,
            JsonValueKind.String when int.TryParse(current.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsed) => parsed,
            _ => null
        };
    }

    private TokenMarketProbeAttempt CreateAttempt(
        string source,
        string url,
        int? httpStatusCode,
        bool success,
        bool hasData,
        string message,
        DateTimeOffset startedAt)
        => new(
            source,
            url,
            httpStatusCode,
            success,
            hasData,
            message,
            Math.Max(0, (long)(DateTimeOffset.UtcNow - startedAt).TotalMilliseconds));

    private void LogAttempt(TokenMarketProbeAttempt attempt)
    {
        _logger.LogInformation(
            "Token market attempt. Source={Source} Success={Success} HasData={HasData} StatusCode={StatusCode} ElapsedMs={ElapsedMs} Message={Message} Url={Url}",
            attempt.Source,
            attempt.Success,
            attempt.HasData,
            attempt.HttpStatusCode,
            attempt.ElapsedMs,
            attempt.Message,
            attempt.Url);
    }

    private string? ResolveApiKey(params string[] keys)
    {
        foreach (var key in keys)
        {
            var value = key.Contains(':', StringComparison.Ordinal)
                ? _configuration[key]
                : Environment.GetEnvironmentVariable(key) ?? _configuration[key];

            if (!string.IsNullOrWhiteSpace(value))
                return value.Trim();
        }

        return null;
    }

    private static string BuildPresenceMessage(
        string prefix,
        decimal? price,
        decimal? marketCap,
        decimal? volume24h,
        decimal? liquidity,
        int? holders)
    {
        var parts = new List<string>();

        if (price.HasValue)
            parts.Add("price");
        if (marketCap.HasValue)
            parts.Add("marketCap");
        if (volume24h.HasValue)
            parts.Add("volume24h");
        if (liquidity.HasValue)
            parts.Add("liquidity");
        if (holders.HasValue)
            parts.Add("holders");

        return parts.Count == 0
            ? prefix
            : $"{prefix}: {string.Join(", ", parts)}";
    }

    private static string BuildBirdeyeEmptyMessage(JsonElement root, JsonElement? data, bool apiSuccess)
    {
        var rootKeys = DescribeObjectKeys(root);
        var dataState = DescribeJsonState(data);
        var dataKeys = data.HasValue && data.Value.ValueKind == JsonValueKind.Object
            ? DescribeObjectKeys(data.Value)
            : "none";

        return $"Birdeye empty (success={apiSuccess}; rootKeys={rootKeys}; dataState={dataState}; dataKeys={dataKeys})";
    }

    private static string DescribeObjectKeys(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object)
            return "none";

        var keys = element.EnumerateObject()
            .Select(static property => property.Name)
            .Take(8)
            .ToArray();

        return keys.Length == 0 ? "none" : string.Join("|", keys);
    }

    private static string DescribeJsonState(JsonElement? element)
    {
        if (!element.HasValue)
            return "missing";

        return element.Value.ValueKind switch
        {
            JsonValueKind.Null => "null",
            JsonValueKind.Undefined => "undefined",
            JsonValueKind.Object when !element.Value.EnumerateObject().Any() => "empty-object",
            JsonValueKind.Object => "object",
            JsonValueKind.Array when !element.Value.EnumerateArray().Any() => "empty-array",
            JsonValueKind.Array => "array",
            _ => element.Value.ValueKind.ToString().ToLowerInvariant()
        };
    }

    private static IEnumerable<JsonElement> FindBirdeyeSearchItems(JsonElement dataElement)
    {
        if (dataElement.ValueKind != JsonValueKind.Object)
            return Enumerable.Empty<JsonElement>();

        foreach (var property in dataElement.EnumerateObject())
        {
            if (property.Value.ValueKind == JsonValueKind.Array)
                return property.Value.EnumerateArray().ToArray();
        }

        return Enumerable.Empty<JsonElement>();
    }

    private static IEnumerable<JsonElement> FindBirdeyeMarketsItems(JsonElement rootElement)
    {
        if (!rootElement.TryGetProperty("data", out var dataElement))
            return Enumerable.Empty<JsonElement>();

        if (dataElement.ValueKind == JsonValueKind.Array)
            return dataElement.EnumerateArray().ToArray();

        if (dataElement.ValueKind != JsonValueKind.Object)
            return Enumerable.Empty<JsonElement>();

        foreach (var property in dataElement.EnumerateObject())
        {
            if (property.Value.ValueKind == JsonValueKind.Array)
                return property.Value.EnumerateArray().ToArray();
        }

        return Enumerable.Empty<JsonElement>();
    }

    private static string? ReadString(JsonElement element, params string[] path)
    {
        var current = element;
        foreach (var segment in path)
        {
            if (current.ValueKind != JsonValueKind.Object || !current.TryGetProperty(segment, out current))
                return null;
        }

        return current.ValueKind == JsonValueKind.String
            ? current.GetString()
            : null;
    }

    private sealed record DexProbePairResult(DexScreenerPairDto? Pair, TokenMarketProbeAttempt Attempt);
    private sealed record GeckoProbeResult(TokenMarketSnapshotResponse? Snapshot, TokenMarketProbeAttempt Attempt);
    private sealed record ExternalSnapshotProbeResult(TokenMarketSnapshotResponse? Snapshot, TokenMarketProbeAttempt Attempt);
    private sealed record TokenMarketProbeResult(TokenMarketSnapshotResponse Snapshot, DateTimeOffset CheckedAtUtc, string FinalStatus, IReadOnlyList<TokenMarketProbeAttempt> Attempts);
    private sealed record TokenMarketProbeAttempt(string Source, string Url, int? HttpStatusCode, bool Success, bool HasData, string Message, long ElapsedMs);
}
