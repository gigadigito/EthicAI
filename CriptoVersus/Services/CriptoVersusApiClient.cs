using DTOs;
using Blazored.SessionStorage;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;

namespace CriptoVersus.Web.Services;

public sealed class CriptoVersusApiClient
{
    private readonly HttpClient _http;
    private readonly ISessionStorageService _sessionStorage;

    public CriptoVersusApiClient(
        IHttpClientFactory factory,
        ISessionStorageService sessionStorage)
    {
        _http = factory.CreateClient("CriptoVersusApi");
        _sessionStorage = sessionStorage;
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
        => await GetFromJsonWithBearerAsync<MatchDto>($"api/Matches/{matchId}", ct);

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

    public async Task<List<MatchDto>?> GetMatchesAsync(CancellationToken ct = default)
        => await GetFromJsonWithBearerAsync<List<MatchDto>>("api/Matches", ct);

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

    private async Task<T?> GetFromJsonWithBearerAsync<T>(
        string url,
        CancellationToken ct = default)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, url);
        await AddBearerTokenAsync(request);

        using var response = await _http.SendAsync(request, ct);
        await EnsureSuccessOrThrowAsync(response, ct);

        return await response.Content.ReadFromJsonAsync<T>(cancellationToken: ct);
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

        using var response = await _http.SendAsync(request, ct);
        await EnsureSuccessOrThrowAsync(response, ct);

        return await response.Content.ReadFromJsonAsync<T>(cancellationToken: ct);
    }

    private static async Task EnsureSuccessOrThrowAsync(HttpResponseMessage response, CancellationToken ct)
    {
        if (response.IsSuccessStatusCode)
            return;

        var body = await response.Content.ReadAsStringAsync(ct);
        var message = TryReadApiMessage(body)
            ?? $"HTTP {(int)response.StatusCode} calling {response.RequestMessage?.RequestUri}";

        throw new InvalidOperationException(message);
    }

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
        var token = await _sessionStorage.GetItemAsync<string>("authToken");
        if (!string.IsNullOrWhiteSpace(token))
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
    }
}
