using Npgsql;

namespace CriptoVersus.API;

internal static class EnvironmentIsolationGuard
{
    private static readonly string[] ProductionUrlMarkers =
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
            throw new InvalidOperationException("Development exige ConnectionStrings:Default configurada.");

        ValidateDevelopmentConnectionString(connectionString);
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
            || !IsLoopbackHost(host))
        {
            throw new InvalidOperationException(
                $"Unsafe Development database configuration detected: Host={host};Port={builder.Port};Database={database}");
        }
    }

    private static bool ContainsProductionMarker(string value)
        => ProductionUrlMarkers.Any(marker => value.Contains(marker, StringComparison.OrdinalIgnoreCase));

    private static bool IsLoopbackHost(string host)
        => host.Equals("localhost", StringComparison.OrdinalIgnoreCase)
            || host.Equals("127.0.0.1", StringComparison.OrdinalIgnoreCase)
            || host.Equals("::1", StringComparison.OrdinalIgnoreCase);
}
