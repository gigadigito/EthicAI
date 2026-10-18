using EthicAI.EntityModel;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace EthicAI.test;

public sealed class EthicAIDbContextFactoryTests
{
    private const string PasswordMarker = "SuperSecretMarker-DoNotLeak";

    private static readonly IReadOnlyList<string> NoCommandLineArgs = new[] { "dotnet-ef.dll" };

    private static Func<string, string?> Env(params (string Key, string? Value)[] values)
    {
        var map = new Dictionary<string, string?>(StringComparer.OrdinalIgnoreCase);
        foreach (var (key, value) in values)
            map[key] = value;
        return key => map.TryGetValue(key, out var value) ? value : null;
    }

    private static string NewEmptyBasePath()
    {
        var path = Path.Combine(Path.GetTempPath(), "cv-factory-tests-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(path);
        return path;
    }

    private static EthicAIDbContextFactory NewFactory() => new();

    [Fact]
    public void Factory_IsDiscoverableAsDesignTimeDbContextFactory()
    {
        Assert.True(typeof(IDesignTimeDbContextFactory<EthicAIDbContext>)
            .IsAssignableFrom(typeof(EthicAIDbContextFactory)));
    }

    [Fact]
    public void CreateDbContext_UsesNpgsqlProvider_WithResolvedConnection()
    {
        var context = NewFactory().CreateDbContext(
            Array.Empty<string>(),
            Env((MigrationConnectionResolver.MigrationConnectionVariable,
                $"Host=localhost;Port=5432;Database=design_probe;Username=probe_user;Password={PasswordMarker}")),
            NoCommandLineArgs,
            NewEmptyBasePath());

        Assert.Equal("Npgsql.EntityFrameworkCore.PostgreSQL", context.Database.ProviderName);
        var connectionString = context.Database.GetDbConnection().ConnectionString;
        Assert.Contains("Database=design_probe", connectionString);
        Assert.Contains("Host=localhost", connectionString);
    }

    [Fact]
    public void CreateDbContext_PrefersMigrationConnectionVariable()
    {
        var context = NewFactory().CreateDbContext(
            Array.Empty<string>(),
            Env(
                (MigrationConnectionResolver.MigrationConnectionVariable,
                    "Host=localhost;Database=design_probe;Username=probe_user"),
                (MigrationConnectionResolver.DefaultConnectionVariable,
                    "Host=localhost;Database=design_other;Username=other_user")),
            NoCommandLineArgs,
            NewEmptyBasePath());

        Assert.Contains("Database=design_probe", context.Database.GetDbConnection().ConnectionString);
    }

    [Fact]
    public void CreateDbContext_ThrowsClearError_WhenNoConnectionIsConfigured()
    {
        var exception = Assert.Throws<MigrationConnectionException>(() =>
            NewFactory().CreateDbContext(
                Array.Empty<string>(),
                Env(),
                NoCommandLineArgs,
                NewEmptyBasePath()));

        Assert.Contains(MigrationConnectionResolver.MigrationConnectionVariable, exception.Message);
        Assert.DoesNotContain(PasswordMarker, exception.ToString());
    }

    [Fact]
    public void CreateDbContext_DiscoversSocialPublicationControlMigration()
    {
        var context = NewFactory().CreateDbContext(
            Array.Empty<string>(),
            Env((MigrationConnectionResolver.MigrationConnectionVariable,
                "Host=localhost;Database=design_probe;Username=probe_user")),
            NoCommandLineArgs,
            NewEmptyBasePath());

        var migrations = context.Database.GetMigrations().ToArray();

        Assert.Contains("20261015000000_AddCandleBattlesArcade", migrations);
        Assert.Contains("20261017000000_AddSocialPublicationControl", migrations);
        Assert.Equal("20261017000000_AddSocialPublicationControl", migrations[^1]);
    }

    [Theory]
    [InlineData("migrations", "list")]
    [InlineData("migrations", "script")]
    public void CreateDbContext_AllowsReadOnlyCommands_OnRemoteTarget(string group, string verb)
    {
        var exception = Record.Exception(() =>
            NewFactory().CreateDbContext(
                Array.Empty<string>(),
                Env((MigrationConnectionResolver.MigrationConnectionVariable,
                    $"Host=192.0.2.1;Database=design_remote;Username=probe_user;Password={PasswordMarker}")),
                new[] { "dotnet-ef.dll", group, verb, "--no-connect" },
                NewEmptyBasePath()));

        Assert.Null(exception);
    }

    [Fact]
    public void CreateDbContext_BlocksDatabaseUpdate_OnRemoteTargetWithoutConfirmation()
    {
        var exception = Assert.Throws<MigrationConnectionException>(() =>
            NewFactory().CreateDbContext(
                Array.Empty<string>(),
                Env((MigrationConnectionResolver.MigrationConnectionVariable,
                    $"Host=192.0.2.1;Database=design_remote;Username=probe_user;Password={PasswordMarker}")),
                new[] { "dotnet-ef.dll", "database", "update" },
                NewEmptyBasePath()));

        Assert.Contains(MigrationConnectionResolver.AllowUpdateVariable, exception.Message);
        Assert.DoesNotContain(PasswordMarker, exception.Message);
        Assert.DoesNotContain(PasswordMarker, exception.ToString());
    }

    [Fact]
    public void CreateDbContext_AllowsDatabaseUpdate_OnRemoteTargetWithExplicitConfirmation()
    {
        var exception = Record.Exception(() =>
            NewFactory().CreateDbContext(
                Array.Empty<string>(),
                Env(
                    (MigrationConnectionResolver.MigrationConnectionVariable,
                        "Host=192.0.2.1;Database=design_remote;Username=probe_user"),
                    (MigrationConnectionResolver.AllowUpdateVariable, "true")),
                new[] { "dotnet-ef.dll", "database", "update" },
                NewEmptyBasePath()));

        Assert.Null(exception);
    }

    [Fact]
    public void CreateDbContext_AllowsDatabaseUpdate_OnLocalTargetWithoutConfirmation()
    {
        var exception = Record.Exception(() =>
            NewFactory().CreateDbContext(
                Array.Empty<string>(),
                Env((MigrationConnectionResolver.MigrationConnectionVariable,
                    "Host=localhost;Database=design_probe;Username=probe_user")),
                new[] { "dotnet-ef.dll", "database", "update" },
                NewEmptyBasePath()));

        Assert.Null(exception);
    }

    [Fact]
    public void CreateDbContext_BlocksUnidentifiedCommand_OnRemoteTarget()
    {
        var exception = Assert.Throws<MigrationConnectionException>(() =>
            NewFactory().CreateDbContext(
                Array.Empty<string>(),
                Env((MigrationConnectionResolver.MigrationConnectionVariable,
                    "Host=192.0.2.1;Database=design_remote;Username=probe_user")),
                new[] { "dotnet-ef.dll", "--verbose" },
                NewEmptyBasePath()));

        Assert.Contains(MigrationConnectionResolver.AllowUpdateVariable, exception.Message);
    }
}
