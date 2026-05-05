using Npgsql;

namespace CriptoVersus.Worker;

internal static class EnvironmentIsolationGuard
{
    private static readonly string[] ProductionMarkers =
    [
        "criptoversus.com",
        "api.criptoversus.com",
        "duckdns"
    ];

    public static void AssertDevelopmentConfiguration(IConfiguration configuration, IHostEnvironment environment)
    {
        if (!environment.IsDevelopment())
            return;

        var connectionString = configuration.GetConnectionString("Default");
        if (string.IsNullOrWhiteSpace(connectionString))
            throw new InvalidOperationException("Development exige ConnectionStrings:Default configurada para o worker.");

        var builder = new NpgsqlConnectionStringBuilder(connectionString);
        var host = builder.Host?.Trim() ?? string.Empty;
        var database = builder.Database?.Trim() ?? string.Empty;

        if (ProductionMarkers.Any(marker => connectionString.Contains(marker, StringComparison.OrdinalIgnoreCase))
            || host.Equals("postgres", StringComparison.OrdinalIgnoreCase)
            || database.Equals("appdb", StringComparison.OrdinalIgnoreCase)
            || builder.Port == 15432
            || !IsLoopbackHost(host))
        {
            throw new InvalidOperationException(
                $"Unsafe Development database configuration detected for worker: Host={host};Port={builder.Port};Database={database}");
        }
    }

    private static bool IsLoopbackHost(string host)
        => host.Equals("localhost", StringComparison.OrdinalIgnoreCase)
            || host.Equals("127.0.0.1", StringComparison.OrdinalIgnoreCase)
            || host.Equals("::1", StringComparison.OrdinalIgnoreCase);
}
