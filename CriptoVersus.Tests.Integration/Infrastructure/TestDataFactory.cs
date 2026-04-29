namespace CriptoVersus.Tests.Integration.Infrastructure;

public sealed class TestDataFactory
{
    private readonly CriptoVersusApiClient _apiClient;
    private readonly IntegrationTestSettings _settings;

    public TestDataFactory(CriptoVersusApiClient apiClient, IntegrationTestSettings settings)
    {
        _apiClient = apiClient;
        _settings = settings;
    }

    public async Task<PreparedScenario> CreateTwoSidedScenarioAsync(decimal? stakeA = null, decimal? stakeB = null, CancellationToken ct = default)
    {
        var match = await _apiClient.CreateMatchAsync(ct);
        var userA = await _apiClient.CreateSessionAsync(CreateWallet("user-a"), _settings.InitialBalance, ct);
        var userB = await _apiClient.CreateSessionAsync(CreateWallet("user-b"), _settings.InitialBalance, ct);

        var amountA = stakeA ?? _settings.DefaultStake;
        var amountB = stakeB ?? _settings.DefaultStake;

        await _apiClient.PlaceBetAsync(userA.Token, match.MatchId, match.TeamAId, amountA, ct);
        await _apiClient.PlaceBetAsync(userB.Token, match.MatchId, match.TeamBId, amountB, ct);

        return new PreparedScenario(userA, userB, match, amountA, amountB);
    }

    public async Task<PreparedScenario> CreateSingleSidedScenarioAsync(decimal? stakeA = null, CancellationToken ct = default)
    {
        var match = await _apiClient.CreateMatchAsync(ct);
        var userA = await _apiClient.CreateSessionAsync(CreateWallet("solo-a"), _settings.InitialBalance, ct);
        var amountA = stakeA ?? _settings.DefaultStake;

        await _apiClient.PlaceBetAsync(userA.Token, match.MatchId, match.TeamAId, amountA, ct);
        return new PreparedScenario(userA, null, match, amountA, 0m);
    }

    private string CreateWallet(string tag)
        => $"{_settings.WalletPrefix}{tag}-{Guid.NewGuid():N}";
}
