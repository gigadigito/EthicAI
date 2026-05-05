using Npgsql;
using System.Net;

namespace CriptoVersus.API;

internal static class EnvironmentIsolationGuard
{
    private const string ProductionWallet = "GHdFhvPhr7NP7UQxWAbCHiQpj9WrRw8SywbBE2Mvfnnd";
    private static readonly string[] ProductionMarkers = ["criptoversus.com", "api.criptoversus.com", "duckdns"];

    public static void AssertDevelopmentConfiguration(IConfiguration configuration, IHostEnvironment environment)
    {
        if (!environment.IsDevelopment())
            return;

        var connectionString = configuration.GetConnectionString("Default");
        if (string.IsNullOrWhiteSpace(connectionString))
            throw new InvalidOperationException("Development exige ConnectionStrings:Default configurada.");

        ValidateDevelopmentConnectionString(connectionString);
        ValidateBlockchainSettings(configuration);
    }

    private static void ValidateDevelopmentConnectionString(string connectionString)
    {
        var builder = new NpgsqlConnectionStringBuilder(connectionString);
        var host = builder.Host?.Trim() ?? string.Empty;
        var database = builder.Database?.Trim() ?? string.Empty;
        var normalized = connectionString.Trim();

        if (ContainsProductionMarker(normalized)
            || host.Equals("postgres", StringComparison.OrdinalIgnoreCase)
            || database.Equals("appdb", StringComparison.OrdinalIgnoreCase)
            || builder.Port == 15432
            || IsPublicIpAddress(host)
            || !IsLoopbackHost(host))
        {
            throw new InvalidOperationException(
                $"Unsafe Development database configuration detected: Host={host};Port={builder.Port};Database={database}");
        }
    }

    private static void ValidateBlockchainSettings(IConfiguration configuration)
    {
        ValidateEquals(configuration["CriptoVersusBlockchain:Cluster"], "mainnet-beta", "CriptoVersusBlockchain:Cluster");
        ValidateContains(configuration["CriptoVersusBlockchain:RpcUrl"], "mainnet", "CriptoVersusBlockchain:RpcUrl");
        ValidateEquals(configuration["CriptoVersusBlockchain:CustodyWalletPublicKey"], ProductionWallet, "CriptoVersusBlockchain:CustodyWalletPublicKey");
        ValidateEquals(configuration["CriptoVersus:AdminWallet"], ProductionWallet, "CriptoVersus:AdminWallet");
        ValidateEquals(configuration["OnChainBetting:AuthorityWallet"], ProductionWallet, "OnChainBetting:AuthorityWallet");
    }

    private static bool ContainsProductionMarker(string value)
        => ProductionMarkers.Any(marker => value.Contains(marker, StringComparison.OrdinalIgnoreCase));

    private static bool IsLoopbackHost(string host)
        => host.Equals("localhost", StringComparison.OrdinalIgnoreCase)
            || host.Equals("127.0.0.1", StringComparison.OrdinalIgnoreCase)
            || host.Equals("::1", StringComparison.OrdinalIgnoreCase);

    private static bool IsPublicIpAddress(string host)
    {
        if (!IPAddress.TryParse(host, out var ip))
            return false;

        if (IPAddress.IsLoopback(ip))
            return false;

        if (ip.AddressFamily == System.Net.Sockets.AddressFamily.InterNetwork)
        {
            var bytes = ip.GetAddressBytes();
            return !(bytes[0] == 10
                || (bytes[0] == 172 && bytes[1] >= 16 && bytes[1] <= 31)
                || (bytes[0] == 192 && bytes[1] == 168)
                || (bytes[0] == 169 && bytes[1] == 254));
        }

        return !ip.IsIPv6LinkLocal && !ip.IsIPv6SiteLocal && !ip.IsIPv6UniqueLocal;
    }

    private static void ValidateEquals(string? actual, string forbiddenValue, string settingName)
    {
        if (string.Equals(actual?.Trim(), forbiddenValue, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException($"Unsafe Development setting detected in {settingName}: {actual}");
    }

    private static void ValidateContains(string? actual, string forbiddenFragment, string settingName)
    {
        if (!string.IsNullOrWhiteSpace(actual)
            && actual.Contains(forbiddenFragment, StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException($"Unsafe Development setting detected in {settingName}: {actual}");
        }
    }
}
