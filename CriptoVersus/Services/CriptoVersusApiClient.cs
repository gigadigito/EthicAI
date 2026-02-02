using DTOs;
using System.Net.Http.Json;

namespace CriptoVersus.Web.Services;

public sealed class CriptoVersusApiClient
{
    private readonly HttpClient _http;

    public CriptoVersusApiClient(IHttpClientFactory factory)
        => _http = factory.CreateClient("CriptoVersusApi");

    public async Task<DashboardSnapshotDto?> GetDashboardSnapshotAsync(
      CancellationToken ct = default)
    {
        return await _http.GetFromJsonAsync<DashboardSnapshotDto>(
            "api/Dashboard/snapshot", ct);
    }
    public async Task<MatchDto?> GetMatchBySymbolsAsync(string symbolA, string symbolB)
    {
        var url =
            $"api/match/by-symbols?symbolA={Uri.EscapeDataString(symbolA)}&symbolB={Uri.EscapeDataString(symbolB)}";

        return await _http.GetFromJsonAsync<MatchDto>(url);
    }
    public async Task<List<MatchDto>?> GetMatchesAsync(CancellationToken ct = default)
        => await _http.GetFromJsonAsync<List<MatchDto>>("api/Matches", ct);

    public async Task<WorkerStatusDto?> GetWorkerStatusAsync(CancellationToken ct = default)
        => await _http.GetFromJsonAsync<WorkerStatusDto>("api/Worker/status", ct);
}
