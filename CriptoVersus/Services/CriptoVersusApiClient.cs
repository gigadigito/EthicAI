using DTOs;
using Blazored.SessionStorage;
using System.Collections.Concurrent;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;

namespace CriptoVersus.Web.Services;

public sealed class CriptoVersusApiClient
{
    private static readonly TimeSpan RequestTimeout = TimeSpan.FromSeconds(10);
    private static readonly TimeSpan CoinSocialProfileCacheDuration = TimeSpan.FromMinutes(10);
    private static readonly ConcurrentDictionary<string, CachedCoinSocialProfileResult> CoinSocialProfileCache = new();
    private readonly HttpClient _http;
    private readonly ISessionStorageService _sessionStorage;
    private readonly ILogger<CriptoVersusApiClient> _logger;

    public CriptoVersusApiClient(
        IHttpClientFactory factory,
        ISessionStorageService sessionStorage,
        ILogger<CriptoVersusApiClient> logger)
    {
        _http = factory.CreateClient("CriptoVersusApi");
        _sessionStorage = sessionStorage;
        _logger = logger;
    }

    public string BuildApiUrl(string? relativePath)
    {
        if (string.IsNullOrWhiteSpace(relativePath))
            return _http.BaseAddress?.ToString() ?? string.Empty;

        if (Uri.TryCreate(relativePath, UriKind.Absolute, out var absoluteUri))
            return absoluteUri.ToString();

        if (_http.BaseAddress is null)
            throw new InvalidOperationException("CriptoVersusApi BaseAddress is not configured.");

        return new Uri(_http.BaseAddress, relativePath.TrimStart('/')).ToString();
    }

    public string BuildBinanceIconUrl(string? symbol)
    {
        return EnvironmentIsolationGuard.BuildBinanceIconUrl(symbol);
    }

    public async Task<DashboardSnapshotDto?> GetDashboardSnapshotAsync(
      CancellationToken ct = default)
    {
        return await GetFromJsonWithBearerAsync<DashboardSnapshotDto>(
            "api/Dashboard/snapshot", ct);
    }
    public async Task<MatchDto?> GetMatchBySymbolsAsync(string symbolA, string symbolB)
    {
        var url =
            $"api/Matches/by-symbols?symbolA={Uri.EscapeDataString(symbolA)}&symbolB={Uri.EscapeDataString(symbolB)}";
  
        return await GetFromJsonWithBearerAsync<MatchDto>(url);
    }

    public async Task<MatchDto?> GetMatchByIdAsync(int matchId, CancellationToken ct = default)
        => await GetMatchByIdAsync(matchId, includeParticipants: true, ct);

    public async Task<MatchDto?> GetMatchByIdAsync(
        int matchId,
        bool includeParticipants,
        CancellationToken ct = default)
        => await GetFromJsonWithBearerAsync<MatchDto>(
            $"api/Matches/{matchId}?includeParticipants={includeParticipants.ToString().ToLowerInvariant()}",
            ct);

    public async Task<List<MatchMetricSnapshotDto>?> GetMatchMetricSnapshotsAsync(
        int matchId,
        int take = 500,
        CancellationToken ct = default)
    {
        var safeTake = Math.Clamp(take, 1, 1000);
        return await GetFromJsonWithBearerAsync<List<MatchMetricSnapshotDto>>(
            $"api/Matches/{matchId}/metric-snapshots?take={safeTake}",
            ct);
    }

    public async Task<List<MatchScoreEventDto>?> GetMatchScoreEventsAsync(
        int matchId,
        CancellationToken ct = default)
    {
        return await GetFromJsonWithBearerAsync<List<MatchScoreEventDto>>(
            $"api/Matches/{matchId}/score-events",
            ct);
    }

    public async Task<ArenaSentimentPairDto?> GetMatchArenaSentimentAsync(
        int matchId,
        CancellationToken ct = default)
    {
        return await GetFromJsonWithBearerAsync<ArenaSentimentPairDto>(
            $"api/Matches/{matchId}/arena-sentiment",
            ct);
    }

    public async Task<List<MatchDto>?> GetMatchesAsync(CancellationToken ct = default)
        => await GetMatchesAsync(includeParticipants: false, status: null, take: 50, ct);

    public async Task<List<MatchDto>?> GetMatchesAsync(
        bool includeParticipants,
        CancellationToken ct = default)
        => await GetMatchesAsync(includeParticipants, status: null, take: 50, ct);

    public async Task<List<MatchDto>?> GetMatchesAsync(
        bool includeParticipants,
        string? status = null,
        int take = 50,
        CancellationToken ct = default)
    {
        var safeTake = Math.Clamp(take, 1, 200);
        var path = $"api/Matches?includeParticipants={includeParticipants.ToString().ToLowerInvariant()}&take={safeTake}";
        if (!string.IsNullOrWhiteSpace(status))
            path += $"&status={Uri.EscapeDataString(status)}";

        return await GetFromJsonWithBearerAsync<List<MatchDto>>(path, ct);
    }

    public async Task<List<MatchDto>?> GetMatchesAsync(
        string? status,
        int take,
        CancellationToken ct = default)
        => await GetFromJsonWithBearerAsync<List<MatchDto>>(
            $"api/Matches?includeParticipants=false&take={Math.Clamp(take, 1, 200)}{(string.IsNullOrWhiteSpace(status) ? string.Empty : $"&status={Uri.EscapeDataString(status)}")}",
            ct);

    public async Task<List<SocialHotMatchDto>?> GetSocialHotMatchesAsync(CancellationToken ct = default)
        => await GetFromJsonWithBearerAsync<List<SocialHotMatchDto>>("api/social/hot-matches", ct);

    public async Task<TvHotMatchDto?> GetTvHotMatchAsync(CancellationToken ct = default)
        => await GetFromJsonWithBearerAsync<TvHotMatchDto>("api/tv/hot-match", ct);

    public async Task<TvNarrationResponse?> GenerateTvNarrationAsync(
        int matchId,
        TvNarrationRequest request,
        CancellationToken ct = default)
        => await PostAsJsonWithBearerAsync<TvNarrationResponse>($"api/tv/narration/{matchId}", request, ct);

    public async Task<WorkerStatusDto?> GetWorkerStatusAsync(CancellationToken ct = default)
        => await GetFromJsonWithBearerAsync<WorkerStatusDto>("api/Worker/status", ct);

    public async Task<MyWalletDto?> GetMyWalletAsync(CancellationToken ct = default)
        => await GetFromJsonWithBearerAsync<MyWalletDto>("api/wallet/me", ct);

    public async Task<WalletActionResultDto?> ClaimAvailableReturnsAsync(
        ClaimAvailableReturnsRequest? request = null,
        CancellationToken ct = default)
        => await PostAsJsonWithBearerAsync<WalletActionResultDto>("api/wallet/claim", request ?? new ClaimAvailableReturnsRequest(), ct);

    public async Task<WalletActionResultDto?> WithdrawSystemBalanceAsync(
        WithdrawSystemBalanceRequest request,
        CancellationToken ct = default)
        => await PostAsJsonWithBearerAsync<WalletActionResultDto>("api/wallet/withdraw", request, ct);

    public async Task<TeamPositionDto?> RequestClosePositionAsync(
        int positionId,
        CancellationToken ct = default)
        => await PostAsJsonWithBearerAsync<TeamPositionDto>($"api/positions/{positionId}/close", new { }, ct);

    public async Task<TeamPositionDto?> CreateOrIncreasePositionAsync(
        CreateTeamPositionRequest request,
        CancellationToken ct = default)
        => await PostAsJsonWithBearerAsync<TeamPositionDto>("api/positions", request, ct);

    public async Task<OpenDirectPositionResultDto?> OpenDirectPositionAsync(
        OpenDirectPositionRequest request,
        CancellationToken ct = default)
        => await PostAsJsonWithBearerAsync<OpenDirectPositionResultDto>("api/wallet/open-position-direct", request, ct);

    public async Task<List<PositionAssetOptionDto>?> GetPositionAssetsAsync(
        string? search = null,
        int take = 40,
        CancellationToken ct = default)
    {
        var safeTake = Math.Clamp(take, 1, 60);
        var queries = new[]
        {
            string.IsNullOrWhiteSpace(search)
                ? $"api/wallet/position-assets?take={safeTake}"
                : $"api/wallet/position-assets?take={safeTake}&search={Uri.EscapeDataString(search)}",
            string.IsNullOrWhiteSpace(search)
                ? $"api/positions/assets?take={safeTake}"
                : $"api/positions/assets?take={safeTake}&search={Uri.EscapeDataString(search)}"
        };

        foreach (var query in queries)
        {
            try
            {
                return await GetFromJsonWithBearerAsync<List<PositionAssetOptionDto>>(query, ct);
            }
            catch (HttpRequestException ex) when (IsRoutingFallbackStatus(ex.StatusCode))
            {
                continue;
            }
        }

        return await BuildPositionAssetsFallbackFromMatchesAsync(search, safeTake, ct);
    }

    public async Task<UserMatchHistoryPageDto?> GetWalletHistoryMatchesAsync(
        int userId,
        int teamId,
        int page = 1,
        int pageSize = 10,
        string status = "all",
        CancellationToken ct = default)
    {
        var url = $"api/users/{userId}/wallet-history/{teamId}/matches?page={page}&pageSize={pageSize}&status={Uri.EscapeDataString(status)}";
        return await GetFromJsonWithBearerAsync<UserMatchHistoryPageDto>(url, ct);
    }

    public async Task<AdminSystemDto?> GetAdminSystemAsync(CancellationToken ct = default)
        => await GetFromJsonWithBearerAsync<AdminSystemDto>("api/admin/system", ct);

    public async Task<TokenomicsDto?> GetTokenomicsAsync(CancellationToken ct = default)
        => await GetFromJsonWithBearerAsync<TokenomicsDto>("api/tokenomics", ct);

    public async Task<StatsOverviewDto?> GetStatsOverviewAsync(CancellationToken ct = default)
        => await GetStatsOverviewAsync(search: null, ct);

    public async Task<StatsOverviewDto?> GetStatsOverviewAsync(string? search, CancellationToken ct = default)
        => await GetFromJsonWithBearerAsync<StatsOverviewDto>(
            string.IsNullOrWhiteSpace(search)
                ? "api/stats/overview"
                : $"api/stats/overview?search={Uri.EscapeDataString(search)}",
            ct);

    public async Task<List<StatsArenaTeamDto>?> GetStatsTeamsAsync(CancellationToken ct = default)
        => await GetStatsTeamsAsync(search: null, ct);

    public async Task<List<StatsArenaTeamDto>?> GetStatsTeamsAsync(string? search, CancellationToken ct = default)
        => await GetFromJsonWithBearerAsync<List<StatsArenaTeamDto>>(
            string.IsNullOrWhiteSpace(search)
                ? "api/stats/teams"
                : $"api/stats/teams?search={Uri.EscapeDataString(search)}",
            ct);

    public async Task<StatsArenaTeamDetailDto?> GetStatsTeamDetailAsync(string slug, CancellationToken ct = default)
        => await GetFromJsonWithBearerAsync<StatsArenaTeamDetailDto>($"api/stats/teams/{Uri.EscapeDataString(slug)}", ct);

    public async Task<CoinSocialProfileDto?> GetCoinSocialProfileAsync(
        string? symbol = null,
        string? coinGeckoId = null,
        CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(symbol) && string.IsNullOrWhiteSpace(coinGeckoId))
            return null;

        var cacheKey = BuildCoinSocialProfileCacheKey(symbol, coinGeckoId);
        if (CoinSocialProfileCache.TryGetValue(cacheKey, out var cached)
            && (DateTimeOffset.UtcNow - cached.CachedAtUtc) <= CoinSocialProfileCacheDuration)
        {
            return cached.Profile;
        }

        var query = new List<string>();
        if (!string.IsNullOrWhiteSpace(symbol))
            query.Add($"symbol={Uri.EscapeDataString(symbol)}");
        if (!string.IsNullOrWhiteSpace(coinGeckoId))
            query.Add($"coingecko_id={Uri.EscapeDataString(coinGeckoId)}");

        try
        {
            var profile = await GetFromJsonWithBearerAsync<CoinSocialProfileDto>($"api/coin-social-profile?{string.Join("&", query)}", ct);
            CoinSocialProfileCache[cacheKey] = new CachedCoinSocialProfileResult(DateTimeOffset.UtcNow, profile);
            return profile;
        }
        catch (HttpRequestException ex) when (ex.StatusCode == HttpStatusCode.NotFound)
        {
            CoinSocialProfileCache[cacheKey] = new CachedCoinSocialProfileResult(DateTimeOffset.UtcNow, null);
            return null;
        }
    }

    private static string BuildCoinSocialProfileCacheKey(string? symbol, string? coinGeckoId)
        => $"{symbol?.Trim().ToUpperInvariant() ?? string.Empty}|{coinGeckoId?.Trim().ToLowerInvariant() ?? string.Empty}";

    private async Task<T?> GetFromJsonWithBearerAsync<T>(
        string url,
        CancellationToken ct = default)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, url);
        await AddBearerTokenAsync(request);
        using var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeoutCts.CancelAfter(RequestTimeout);

        try
        {
            using var response = await _http.SendAsync(request, timeoutCts.Token);
            await EnsureSuccessOrThrowAsync(response, timeoutCts.Token);
            return await response.Content.ReadFromJsonAsync<T>(cancellationToken: timeoutCts.Token);
        }
        catch (OperationCanceledException ex) when (!ct.IsCancellationRequested && timeoutCts.IsCancellationRequested)
        {
            _logger.LogWarning(ex, "Timed out calling GET {Url} after {TimeoutSeconds}s.", url, RequestTimeout.TotalSeconds);
            throw new TimeoutException($"Timed out calling GET {url}.", ex);
        }
    }

    private async Task<T?> PostAsJsonWithBearerAsync<T>(
        string url,
        object payload,
        CancellationToken ct = default)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, url)
        {
            Content = JsonContent.Create(payload)
        };

        await AddBearerTokenAsync(request);
        using var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeoutCts.CancelAfter(RequestTimeout);

        try
        {
            using var response = await _http.SendAsync(request, timeoutCts.Token);
            await EnsureSuccessOrThrowAsync(response, timeoutCts.Token);
            return await response.Content.ReadFromJsonAsync<T>(cancellationToken: timeoutCts.Token);
        }
        catch (OperationCanceledException ex) when (!ct.IsCancellationRequested && timeoutCts.IsCancellationRequested)
        {
            _logger.LogWarning(ex, "Timed out calling POST {Url} after {TimeoutSeconds}s.", url, RequestTimeout.TotalSeconds);
            throw new TimeoutException($"Timed out calling POST {url}.", ex);
        }
    }

    private static async Task EnsureSuccessOrThrowAsync(HttpResponseMessage response, CancellationToken ct)
    {
        if (response.IsSuccessStatusCode)
            return;

        var body = await response.Content.ReadAsStringAsync(ct);
        var message = TryReadApiMessage(body)
            ?? $"HTTP {(int)response.StatusCode} calling {response.RequestMessage?.RequestUri}";

        throw new HttpRequestException(message, null, response.StatusCode);
    }

    private async Task<List<PositionAssetOptionDto>> BuildPositionAssetsFallbackFromMatchesAsync(
        string? search,
        int take,
        CancellationToken ct)
    {
        var matches = await GetMatchesAsync(ct) ?? [];
        var normalizedSearch = search?.Trim();
        const int advancedLiveThresholdMinutes = 15;
        var assetMap = new Dictionary<int, PositionAssetOptionDto>();

        foreach (var match in matches)
        {
            AddMatchAsset(
                assetMap,
                match.TeamAId,
                match.TeamA,
                match.PctA,
                match.Status,
                match.MatchId,
                match.ElapsedMinutes,
                match.StartTime,
                match.BettingCloseTime);

            AddMatchAsset(
                assetMap,
                match.TeamBId,
                match.TeamB,
                match.PctB,
                match.Status,
                match.MatchId,
                match.ElapsedMinutes,
                match.StartTime,
                match.BettingCloseTime);
        }

        return assetMap.Values
            .Where(x =>
                string.IsNullOrWhiteSpace(normalizedSearch) ||
                x.Symbol.Contains(normalizedSearch, StringComparison.OrdinalIgnoreCase) ||
                x.CurrencyName.Contains(normalizedSearch, StringComparison.OrdinalIgnoreCase))
            .Select(x =>
            {
                if (x.HasLiveMatch && (x.MatchElapsedMinutes ?? 0) >= advancedLiveThresholdMinutes)
                {
                    x.CanInvestNow = false;
                    x.AccessReasonCode = "ADVANCED_LIVE_MATCH";
                    x.AccessMessage = $"Nao e possivel aumentar exposicao agora: a partida #{x.MatchId} esta em fase avancada. Status={x.MatchStatus}, tempo decorrido={x.MatchElapsedMinutes} min, limite de entrada={advancedLiveThresholdMinutes} min.";
                }
                else if (x.HasLiveMatch || x.HasUpcomingMatch)
                {
                    x.CanInvestNow = true;
                    x.AccessMessage = x.MatchId.HasValue
                        ? $"Partida {(x.HasLiveMatch ? "em andamento" : "pendente")} na partida #{x.MatchId}. Entrada liberada no momento."
                        : "Ativo disponivel para abrir posicao agora.";
                }
                else
                {
                    x.CanInvestNow = true;
                    x.AccessMessage = "Ativo disponivel para abrir posicao agora.";
                }

                return x;
            })
            .OrderByDescending(x => x.CanInvestNow)
            .ThenByDescending(x => x.HasLiveMatch)
            .ThenByDescending(x => x.HasUpcomingMatch)
            .ThenByDescending(x => Math.Abs(x.PercentageChange ?? 0m))
            .ThenBy(x => x.Symbol)
            .Take(take)
            .ToList();
    }

    private static void AddMatchAsset(
        Dictionary<int, PositionAssetOptionDto> assetMap,
        int teamId,
        string symbol,
        decimal? percentageChange,
        string? matchStatus,
        int matchId,
        int elapsedMinutes,
        DateTime? startTime,
        DateTimeOffset? bettingCloseTime)
    {
        if (teamId <= 0 || string.IsNullOrWhiteSpace(symbol))
            return;

        var normalizedSymbol = symbol.Trim().ToUpperInvariant();
        var hasLiveMatch = string.Equals(matchStatus, "Ongoing", StringComparison.OrdinalIgnoreCase);
        var hasUpcomingMatch = string.Equals(matchStatus, "Pending", StringComparison.OrdinalIgnoreCase);
        var trendDirection = (percentageChange ?? 0m) > 0m
            ? "up"
            : (percentageChange ?? 0m) < 0m
                ? "down"
                : "flat";

        if (!assetMap.TryGetValue(teamId, out var current))
        {
            assetMap[teamId] = new PositionAssetOptionDto
            {
                TeamId = teamId,
                Symbol = normalizedSymbol,
                CurrencyName = normalizedSymbol,
                PercentageChange = percentageChange,
                LastUpdatedUtc = startTime,
                CurrentPriceDisplay = null,
                HasLiveMatch = hasLiveMatch,
                HasUpcomingMatch = hasUpcomingMatch,
                IsRankingAsset = false,
                IsWorkerAsset = false,
                HasOpenPosition = false,
                TrendDirection = trendDirection,
                MatchStatus = matchStatus,
                MatchId = matchId,
                MatchElapsedMinutes = elapsedMinutes,
                MatchStartTimeUtc = startTime,
                EntryCutoffUtc = bettingCloseTime
            };
            return;
        }

        current.HasLiveMatch |= hasLiveMatch;
        current.HasUpcomingMatch |= hasUpcomingMatch;

        if (current.MatchId is null || hasLiveMatch || (!current.HasLiveMatch && hasUpcomingMatch))
        {
            current.MatchStatus = matchStatus;
            current.MatchId = matchId;
            current.MatchElapsedMinutes = elapsedMinutes;
            current.MatchStartTimeUtc = startTime;
            current.EntryCutoffUtc = bettingCloseTime;
        }

        if (percentageChange.HasValue && (!current.PercentageChange.HasValue || Math.Abs(percentageChange.Value) > Math.Abs(current.PercentageChange.Value)))
        {
            current.PercentageChange = percentageChange;
            current.TrendDirection = trendDirection;
        }
    }

    private static bool IsRoutingFallbackStatus(HttpStatusCode? statusCode)
        => statusCode is HttpStatusCode.NotFound or HttpStatusCode.MethodNotAllowed;

    private static string? TryReadApiMessage(string body)
    {
        if (string.IsNullOrWhiteSpace(body))
            return null;

        try
        {
            using var document = JsonDocument.Parse(body);
            var root = document.RootElement;

            var message = root.TryGetProperty("message", out var messageElement)
                ? messageElement.GetString()
                : null;
            var detail = root.TryGetProperty("detail", out var detailElement)
                ? detailElement.GetString()
                : null;

            return string.IsNullOrWhiteSpace(detail)
                ? message
                : string.IsNullOrWhiteSpace(message)
                    ? detail
                    : $"{message}: {detail}";
        }
        catch
        {
            return body;
        }
    }

    private async Task AddBearerTokenAsync(HttpRequestMessage request)
    {
        try
        {
            var token = await _sessionStorage.GetItemAsync<string>("authToken");
            if (!string.IsNullOrWhiteSpace(token))
                request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        }
        catch (Exception ex) when (InteropSafety.IsDeferredInteropException(ex))
        {
            // Em prerender/middleware server-side nao ha SessionStorage disponivel.
            // Nesses cenarios seguimos sem bearer e deixamos a rota publica responder.
        }
    }

    private sealed record CachedCoinSocialProfileResult(DateTimeOffset CachedAtUtc, CoinSocialProfileDto? Profile);
}
