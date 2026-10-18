using Microsoft.Extensions.Configuration;
using Npgsql;

public enum MigrationConnectionSource
{
    EnvironmentMigrationConnection,
    EnvironmentDefaultConnection,
    ConfigurationFiles,
}

public sealed class MigrationConnectionException : InvalidOperationException
{
    public MigrationConnectionException(string message)
        : base(message)
    {
    }
}

/// <summary>
/// Connection target resolved for EF Core design-time work. The connection string itself is
/// never rendered in diagnostics; only <see cref="ToSafeSummary"/> is.
/// </summary>
public sealed class MigrationConnection
{
    public MigrationConnection(string connectionString, MigrationConnectionSource source)
    {
        if (string.IsNullOrWhiteSpace(connectionString))
            throw new MigrationConnectionException("The EF Core design-time connection string is empty.");

        NpgsqlConnectionStringBuilder builder;
        try
        {
            builder = new NpgsqlConnectionStringBuilder(connectionString);
        }
        catch (Exception ex) when (ex is ArgumentException or FormatException or InvalidOperationException or KeyNotFoundException)
        {
            // Deliberately not rethrowing the parser exception: its message can quote parts of
            // the raw connection string, including the password.
            throw new MigrationConnectionException(
                "The EF Core design-time connection string could not be parsed by NpgsqlConnectionStringBuilder. " +
                "Expected format: Host=<host>;Port=5432;Database=<database>;Username=<username>;Password=<password>. " +
                "The raw value is intentionally omitted from this message.");
        }

        var missing = new List<string>();
        if (string.IsNullOrWhiteSpace(builder.Host)) missing.Add("Host");
        if (string.IsNullOrWhiteSpace(builder.Database)) missing.Add("Database");
        if (string.IsNullOrWhiteSpace(builder.Username)) missing.Add("Username");
        if (missing.Count > 0)
            throw new MigrationConnectionException(
                $"The EF Core design-time connection string is incomplete. Required keywords: Host, Database, Username. Missing: {string.Join(", ", missing)}. " +
                "The raw value is intentionally omitted from this message.");

        string host = builder.Host!;
        ConnectionString = builder.ConnectionString;
        Source = source;
        Host = host;
        Database = builder.Database!;
        Username = builder.Username!;
        IsLocalTarget = IsLocalHost(host);
    }

    public string ConnectionString { get; }
    public MigrationConnectionSource Source { get; }
    public string Host { get; }
    public string Database { get; }
    public string Username { get; }
    public bool IsLocalTarget { get; }

    public string ToSafeSummary() => $"Host={Host};Database={Database};Username={Username}";

    private static bool IsLocalHost(string host)
    {
        foreach (var entry in host.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            var candidate = entry.ToLowerInvariant();
            if (candidate.StartsWith('/'))
                continue;

            if (candidate.StartsWith('[') && candidate.Contains(']'))
                candidate = candidate[..(candidate.IndexOf(']') + 1)];

            if (candidate is "localhost" or "127.0.0.1" or "::1" or "[::1]" or "0:0:0:0:0:0:0:1")
                continue;

            if ((candidate.StartsWith("localhost:") || candidate.StartsWith("127.0.0.1:")) &&
                candidate[(candidate.IndexOf(':') + 1)..].All(char.IsAsciiDigit))
                continue;

            return false;
        }

        return true;
    }
}

/// <summary>
/// Resolves the connection used by <see cref="EthicAIDbContextFactory"/> at design time and
/// guards destructive EF CLI operations against non-local targets.
/// </summary>
public static class MigrationConnectionResolver
{
    public const string MigrationConnectionVariable = "CRIPTOVERSUS_MIGRATION_CONNECTION";
    public const string DefaultConnectionVariable = "ConnectionStrings__Default";
    public const string AllowUpdateVariable = "CRIPTOVERSUS_MIGRATION_ALLOW_UPDATE";

    private static readonly string[] ReadOnlyOperations =
    {
        "migrations list",
        "migrations script",
        "migrations add",
        "migrations remove",
        "migrations optimize",
        "migrations haspendingmodelchanges",
        "dbcontext info",
        "dbcontext scaffold",
    };

    public static MigrationConnection Resolve(string basePath, Func<string, string?> getEnvironmentVariable)
    {
        ArgumentNullException.ThrowIfNull(getEnvironmentVariable);

        var fromMigrationVariable = Normalize(getEnvironmentVariable(MigrationConnectionVariable));
        if (fromMigrationVariable is not null)
            return new MigrationConnection(fromMigrationVariable, MigrationConnectionSource.EnvironmentMigrationConnection);

        var fromDefaultVariable = Normalize(getEnvironmentVariable(DefaultConnectionVariable));
        if (fromDefaultVariable is not null)
            return new MigrationConnection(fromDefaultVariable, MigrationConnectionSource.EnvironmentDefaultConnection);

        var fromConfiguration = ReadConfigurationConnectionString(basePath);
        if (fromConfiguration is not null)
            return new MigrationConnection(fromConfiguration, MigrationConnectionSource.ConfigurationFiles);

        throw new MigrationConnectionException(
            "No EF Core design-time connection is configured. Configure one of the following, in priority order: " +
            $"1) environment variable {MigrationConnectionVariable}; " +
            $"2) environment variable {DefaultConnectionVariable}; " +
            "3) ConnectionStrings:Default in appsettings.json (current directory or CriptoVersus.Worker/appsettings.json). " +
            "Example shape (placeholders only): Host=<host>;Port=5432;Database=<database>;Username=<username>;Password=<password>. " +
            "Real credentials must never be stored in source code, documentation, or logs.");
    }

    public static void EnsureDesignTimeOperationAuthorized(
        MigrationConnection connection,
        Func<string, string?> getEnvironmentVariable,
        IEnumerable<string>? processCommandLineArgs,
        IEnumerable<string>? designArgs = null)
    {
        ArgumentNullException.ThrowIfNull(connection);
        ArgumentNullException.ThrowIfNull(getEnvironmentVariable);

        if (connection.IsLocalTarget)
            return;

        var operation = DetectDesignTimeOperation(Concat(processCommandLineArgs, designArgs));
        if (operation is not null && ReadOnlyOperations.Contains(operation))
            return;

        if (IsTruthy(getEnvironmentVariable(AllowUpdateVariable)))
            return;

        throw new MigrationConnectionException(
            "Blocked EF Core design-time operation against non-local target " +
            $"{connection.ToSafeSummary()} (source: {connection.Source}). " +
            $"Detected operation: '{operation ?? "not identified"}'. " +
            "Read-only commands such as 'dotnet ef migrations list' and 'dotnet ef migrations script' need no confirmation. " +
            $"'dotnet ef database update' against a non-local target requires explicit operational confirmation via {AllowUpdateVariable}=true. " +
            "Do not expose credentials in commands, logs, or source files.");
    }

    public static string? DetectDesignTimeOperation(IEnumerable<string>? commandLineArgs)
    {
        if (commandLineArgs is null)
            return null;

        string[] tokens = commandLineArgs
            .Where(arg => !string.IsNullOrWhiteSpace(arg))
            .Select(NormalizeToken)
            .ToArray();

        for (var i = 0; i < tokens.Length - 1; i++)
        {
            var pair = tokens[i] + " " + tokens[i + 1];
            if (ReadOnlyOperations.Contains(pair) || pair is "database update" or "database drop")
                return pair;
        }

        return null;
    }

    private static string? ReadConfigurationConnectionString(string? basePath)
    {
        if (string.IsNullOrWhiteSpace(basePath))
            return null;

        var configuration = new ConfigurationBuilder()
            .SetBasePath(basePath)
            .AddJsonFile("appsettings.json", optional: true)
            .AddJsonFile(Path.Combine(basePath, "..", "CriptoVersus.Worker", "appsettings.json"), optional: true)
            .AddJsonFile(Path.Combine(basePath, "CriptoVersus.Worker", "appsettings.json"), optional: true)
            .Build();

        return Normalize(configuration.GetConnectionString("Default"));
    }

    private static IEnumerable<string> Concat(IEnumerable<string>? first, IEnumerable<string>? second)
    {
        foreach (var arg in first ?? Enumerable.Empty<string>())
            yield return arg;
        foreach (var arg in second ?? Enumerable.Empty<string>())
            yield return arg;
    }

    private static string NormalizeToken(string token)
    {
        var trimmed = token.Trim().ToLowerInvariant();
        return trimmed.Replace("-", string.Empty, StringComparison.Ordinal)
            .Replace("_", string.Empty, StringComparison.Ordinal);
    }

    private static string? Normalize(string? value)
    {
        var trimmed = value?.Trim();
        return string.IsNullOrEmpty(trimmed) ? null : trimmed;
    }

    private static bool IsTruthy(string? value)
    {
        var normalized = Normalize(value);
        return normalized is not null &&
               (normalized.Equals("true", StringComparison.OrdinalIgnoreCase) ||
                normalized.Equals("1", StringComparison.OrdinalIgnoreCase) ||
                normalized.Equals("yes", StringComparison.OrdinalIgnoreCase));
    }
}
