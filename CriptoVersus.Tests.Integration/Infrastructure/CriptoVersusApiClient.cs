namespace CriptoVersus.Tests.Integration.Infrastructure;

public sealed class CriptoVersusApiClient : IDisposable
{
    private readonly HttpClient _httpClient;
    private readonly JsonSerializerOptions _jsonOptions = new(JsonSerializerDefaults.Web);
    private readonly IntegrationTestSettings _settings;

    public CriptoVersusApiClient(IntegrationTestSettings settings)
    {
        _settings = settings;
        _httpClient = new HttpClient
        {
            BaseAddress = new Uri(settings.BaseUrl.TrimEnd('/') + "/")
        };
        _httpClient.DefaultRequestHeaders.Add("X-Test-Key", settings.TestApiKey);
    }

    public async Task<TestWallet> CreateSessionAsync(string wallet, decimal initialBalance, CancellationToken ct = default)
    {
        var request = new InternalTestSessionRequest(wallet, initialBalance, $"Integration {wallet}", $"{wallet}@example.test");
        var response = await _httpClient.PostAsJsonAsync("api/internal-test/session", request, _jsonOptions, ct);
        var payload = await ReadRequiredAsync<InternalTestSessionResponse>(response, ct);
        return new TestWallet(payload.Wallet, payload.Token, payload.UserId, payload.SystemBalance);
    }

    public async Task<InternalTestMatchResponse> CreateMatchAsync(CancellationToken ct = default)
    {
        var response = await _httpClient.PostAsJsonAsync("api/internal-test/matches", new InternalTestCreateMatchRequest(), _jsonOptions, ct);
        return await ReadRequiredAsync<InternalTestMatchResponse>(response, ct);
    }

    public async Task<BetCreateResponse> PlaceBetAsync(string token, int matchId, int teamId, decimal amount, CancellationToken ct = default)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, $"api/match/{matchId}/bet")
        {
            Content = JsonContent.Create(new BetCreateRequest
            {
                TeamId = teamId,
                Amount = amount
            })
        };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var response = await _httpClient.SendAsync(request, ct);
        return await ReadRequiredAsync<BetCreateResponse>(response, ct);
    }

    public async Task<MyWalletDto> GetMyWalletAsync(string token, CancellationToken ct = default)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, "api/wallet/me");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var response = await _httpClient.SendAsync(request, ct);
        return await ReadRequiredAsync<MyWalletDto>(response, ct);
    }

    public async Task<WalletActionResultDto> ClaimAsync(string token, CancellationToken ct = default)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, "api/wallet/claim")
        {
            Content = JsonContent.Create(new ClaimAvailableReturnsRequest())
        };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var response = await _httpClient.SendAsync(request, ct);
        return await ReadRequiredAsync<WalletActionResultDto>(response, ct);
    }

    public async Task<UserMatchHistoryPageDto> GetWalletHistoryAsync(string token, int userId, int teamId, CancellationToken ct = default)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, $"api/users/{userId}/wallet-history/{teamId}/matches?page=1&pageSize=100&status=all");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var response = await _httpClient.SendAsync(request, ct);
        return await ReadRequiredAsync<UserMatchHistoryPageDto>(response, ct);
    }

    public async Task<MatchDto> GetMatchAsync(int matchId, CancellationToken ct = default)
    {
        var response = await _httpClient.GetAsync($"api/matches/{matchId}", ct);
        return await ReadRequiredAsync<MatchDto>(response, ct);
    }

    public async Task<InternalTestSettlementResponse> ScoreAndSettleAsync(int matchId, int scoreA, int scoreB, CancellationToken ct = default)
    {
        var response = await _httpClient.PostAsJsonAsync(
            $"api/internal-test/matches/{matchId}/score-and-settle",
            new InternalTestScoreAndSettleRequest { ScoreA = scoreA, ScoreB = scoreB },
            _jsonOptions,
            ct);

        return await ReadRequiredAsync<InternalTestSettlementResponse>(response, ct);
    }

    public async Task<IReadOnlyList<InternalTestLedgerEntryDto>> GetLedgerAsync(string wallet, CancellationToken ct = default)
    {
        var response = await _httpClient.GetAsync($"api/internal-test/users/{Uri.EscapeDataString(wallet)}/ledger", ct);
        return await ReadRequiredAsync<List<InternalTestLedgerEntryDto>>(response, ct);
    }

    private async Task<T> ReadRequiredAsync<T>(HttpResponseMessage response, CancellationToken ct)
    {
        var body = await response.Content.ReadAsStringAsync(ct);
        if (!response.IsSuccessStatusCode)
            throw new InvalidOperationException($"HTTP {(int)response.StatusCode} calling {response.RequestMessage?.RequestUri}: {body}");

        var value = JsonSerializer.Deserialize<T>(body, _jsonOptions);
        return value ?? throw new InvalidOperationException($"Resposta vazia ou invalida para {typeof(T).Name} em {response.RequestMessage?.RequestUri}");
    }

    public void Dispose()
        => _httpClient.Dispose();
}
