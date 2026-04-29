using Microsoft.Extensions.Configuration;

namespace CriptoVersus.Tests.Integration.Infrastructure;

public sealed class IntegrationTestSettings
{
    public string BaseUrl { get; init; } = "https://criptoversus-api.duckdns.org";
    public string TestApiKey { get; init; } = string.Empty;
    public string WalletPrefix { get; init; } = "test-wallet-";
    public decimal DefaultStake { get; init; } = 10m;
    public decimal InitialBalance { get; init; } = 1000m;
    public bool RunProductionIntegrationTests { get; init; }
    public decimal HouseFeeRate { get; init; } = 0.01m;
    public decimal LoserRefundRate { get; init; } = 0.94m;

    public static IntegrationTestSettings Load()
    {
        var configuration = new ConfigurationBuilder()
            .SetBasePath(AppContext.BaseDirectory)
            .AddJsonFile("appsettings.Test.json", optional: true)
            .AddEnvironmentVariables()
            .Build();

        var settings = configuration.GetSection("CriptoVersusApi").Get<IntegrationTestSettings>() ?? new IntegrationTestSettings();
        return settings.Validate();
    }

    private IntegrationTestSettings Validate()
    {
        if (string.IsNullOrWhiteSpace(BaseUrl))
            throw new InvalidOperationException("CriptoVersusApi:BaseUrl nao configurada.");

        return this;
    }
}
