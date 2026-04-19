using DTOs;
using Blazored.SessionStorage;
using System.Net.Http.Headers;
using System.Net.Http.Json;

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
    public async Task<List<MatchDto>?> GetMatchesAsync(CancellationToken ct = default)
        => await GetFromJsonWithBearerAsync<List<MatchDto>>("api/Matches", ct);

    public async Task<WorkerStatusDto?> GetWorkerStatusAsync(CancellationToken ct = default)
        => await GetFromJsonWithBearerAsync<WorkerStatusDto>("api/Worker/status", ct);

    public async Task<MyWalletDto?> GetMyWalletAsync(CancellationToken ct = default)
        => await GetFromJsonWithBearerAsync<MyWalletDto>("api/wallet/me", ct);

    private async Task<T?> GetFromJsonWithBearerAsync<T>(
        string url,
        CancellationToken ct = default)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, url);
        await AddBearerTokenAsync(request);

        using var response = await _http.SendAsync(request, ct);
        response.EnsureSuccessStatusCode();

        return await response.Content.ReadFromJsonAsync<T>(cancellationToken: ct);
    }

    private async Task AddBearerTokenAsync(HttpRequestMessage request)
    {
        var token = await _sessionStorage.GetItemAsync<string>("authToken");
        if (!string.IsNullOrWhiteSpace(token))
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
    }
}
