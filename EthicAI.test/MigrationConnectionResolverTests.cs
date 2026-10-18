namespace EthicAI.test;

public sealed class MigrationConnectionResolverTests
{
    private const string PasswordMarker = "SuperSecretMarker-DoNotLeak";

    private static Func<string, string?> Env(params (string Key, string? Value)[] values)
    {
        var map = new Dictionary<string, string?>(StringComparer.OrdinalIgnoreCase);
        foreach (var (key, value) in values)
            map[key] = value;
        return key => map.TryGetValue(key, out var value) ? value : null;
    }

    private static string NewEmptyBasePath()
    {
        var path = Path.Combine(Path.GetTempPath(), "cv-migration-tests-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(path);
        return path;
    }

    private static void WriteAppsettings(string basePath, string connectionString)
    {
        File.WriteAllText(
            Path.Combine(basePath, "appsettings.json"),
            $"{{ \"ConnectionStrings\": {{ \"Default\": \"{connectionString}\" }} }}");
    }

    [Fact]
    public void Resolve_PrefersMigrationConnectionVariable()
    {
        var basePath = NewEmptyBasePath();
        try
        {
            WriteAppsettings(basePath, "Host=file-host;Database=design_file;Username=file_user");

            var connection = MigrationConnectionResolver.Resolve(
                basePath,
                Env(
                    (MigrationConnectionResolver.MigrationConnectionVariable,
                        "Host=env-migration;Database=design_env_migration;Username=env_user"),
                    (MigrationConnectionResolver.DefaultConnectionVariable,
                        "Host=env-default;Database=design_env_default;Username=default_user")));

            Assert.Equal(MigrationConnectionSource.EnvironmentMigrationConnection, connection.Source);
            Assert.Equal("env-migration", connection.Host);
            Assert.Equal("design_env_migration", connection.Database);
            Assert.Equal("env_user", connection.Username);
        }
        finally
        {
            Directory.Delete(basePath, recursive: true);
        }
    }

    [Fact]
    public void Resolve_FallsBackToConnectionStringsDefaultVariable()
    {
        var basePath = NewEmptyBasePath();
        try
        {
            WriteAppsettings(basePath, "Host=file-host;Database=design_file;Username=file_user");

            var connection = MigrationConnectionResolver.Resolve(
                basePath,
                Env((MigrationConnectionResolver.DefaultConnectionVariable,
                    "Host=env-default;Database=design_env_default;Username=default_user")));

            Assert.Equal(MigrationConnectionSource.EnvironmentDefaultConnection, connection.Source);
            Assert.Equal("env-default", connection.Host);
            Assert.Equal("design_env_default", connection.Database);
            Assert.Equal("default_user", connection.Username);
        }
        finally
        {
            Directory.Delete(basePath, recursive: true);
        }
    }

    [Fact]
    public void Resolve_ReadsAppsettingsJson_WhenNoEnvironmentVariableIsSet()
    {
        var basePath = NewEmptyBasePath();
        try
        {
            WriteAppsettings(basePath, "Host=file-host;Database=design_file;Username=file_user");

            var connection = MigrationConnectionResolver.Resolve(basePath, Env());

            Assert.Equal(MigrationConnectionSource.ConfigurationFiles, connection.Source);
            Assert.Equal("file-host", connection.Host);
            Assert.Equal("design_file", connection.Database);
            Assert.Equal("file_user", connection.Username);
        }
        finally
        {
            Directory.Delete(basePath, recursive: true);
        }
    }

    [Fact]
    public void Resolve_PrefersDefaultConnectionVariable_OverConfigurationFile()
    {
        var basePath = NewEmptyBasePath();
        try
        {
            WriteAppsettings(basePath, "Host=file-host;Database=design_file;Username=file_user");

            var connection = MigrationConnectionResolver.Resolve(
                basePath,
                Env((MigrationConnectionResolver.DefaultConnectionVariable,
                    "Host=env-default;Database=design_env_default;Username=default_user")));

            Assert.Equal(MigrationConnectionSource.EnvironmentDefaultConnection, connection.Source);
            Assert.Equal("env-default", connection.Host);
        }
        finally
        {
            Directory.Delete(basePath, recursive: true);
        }
    }

    [Fact]
    public void Resolve_IgnoresBlankEnvironmentValues_AndReadsConfigurationFile()
    {
        var basePath = NewEmptyBasePath();
        try
        {
            WriteAppsettings(basePath, "Host=file-host;Database=design_file;Username=file_user");

            var connection = MigrationConnectionResolver.Resolve(
                basePath,
                Env(
                    (MigrationConnectionResolver.MigrationConnectionVariable, "   "),
                    (MigrationConnectionResolver.DefaultConnectionVariable, "")));

            Assert.Equal(MigrationConnectionSource.ConfigurationFiles, connection.Source);
        }
        finally
        {
            Directory.Delete(basePath, recursive: true);
        }
    }

    [Fact]
    public void Resolve_ThrowsClearError_WhenNoConnectionIsConfigured()
    {
        var basePath = NewEmptyBasePath();
        try
        {
            var exception = Assert.Throws<MigrationConnectionException>(
                () => MigrationConnectionResolver.Resolve(basePath, Env()));

            Assert.Contains(MigrationConnectionResolver.MigrationConnectionVariable, exception.Message);
            Assert.Contains(MigrationConnectionResolver.DefaultConnectionVariable, exception.Message);
            Assert.Contains("ConnectionStrings:Default", exception.Message);
            Assert.Contains("Password=<password>", exception.Message);
            Assert.DoesNotContain("Password=postgres", exception.Message);
        }
        finally
        {
            Directory.Delete(basePath, recursive: true);
        }
    }

    [Fact]
    public void Resolve_DoesNotLeakPassword_WhenConnectionStringCannotBeParsed()
    {
        var exception = Assert.Throws<MigrationConnectionException>(
            () => MigrationConnectionResolver.Resolve(
                NewEmptyBasePath(),
                Env((MigrationConnectionResolver.MigrationConnectionVariable,
                    $"not-a-valid-connection-string;Password={PasswordMarker}"))));

        Assert.DoesNotContain(PasswordMarker, exception.Message);
        Assert.DoesNotContain(PasswordMarker, exception.ToString());
    }

    [Fact]
    public void Resolve_DoesNotLeakPassword_WhenRequiredKeywordsAreMissing()
    {
        var exception = Assert.Throws<MigrationConnectionException>(
            () => MigrationConnectionResolver.Resolve(
                NewEmptyBasePath(),
                Env((MigrationConnectionResolver.MigrationConnectionVariable,
                    $"Host=only-host;Password={PasswordMarker}"))));

        Assert.Contains("Missing: Database, Username", exception.Message);
        Assert.DoesNotContain(PasswordMarker, exception.Message);
        Assert.DoesNotContain(PasswordMarker, exception.ToString());
    }

    [Fact]
    public void ToSafeSummary_NeverContainsPassword()
    {
        var connection = MigrationConnectionResolver.Resolve(
            NewEmptyBasePath(),
            Env((MigrationConnectionResolver.MigrationConnectionVariable,
                $"Host=prod-host;Database=design_db;Username=design_user;Password={PasswordMarker}")));

        Assert.DoesNotContain(PasswordMarker, connection.ToSafeSummary());
        Assert.Equal("Host=prod-host;Database=design_db;Username=design_user", connection.ToSafeSummary());
    }

    [Theory]
    [InlineData(new[] { "dotnet-ef.dll", "migrations", "list", "--no-connect" }, "migrations list")]
    [InlineData(new[] { "dotnet-ef.dll", "migrations", "script", "--idempotent" }, "migrations script")]
    [InlineData(new[] { "dotnet-ef.dll", "migrations", "add", "Foo" }, "migrations add")]
    [InlineData(new[] { "dotnet-ef.dll", "database", "update" }, "database update")]
    [InlineData(new[] { "dotnet-ef.dll", "database", "drop" }, "database drop")]
    [InlineData(new[] { "dotnet-ef.dll", "migrations", "has-pending-model-changes" }, "migrations haspendingmodelchanges")]
    [InlineData(new[] { "dotnet-ef.dll", "dbcontext", "info" }, "dbcontext info")]
    public void DetectDesignTimeOperation_RecognizesEfCommands(string[] args, string expected)
    {
        Assert.Equal(expected, MigrationConnectionResolver.DetectDesignTimeOperation(args));
    }

    [Fact]
    public void DetectDesignTimeOperation_ReturnsNull_WhenCommandIsUnknown()
    {
        Assert.Null(MigrationConnectionResolver.DetectDesignTimeOperation(new[] { "dotnet-ef.dll", "--verbose" }));
        Assert.Null(MigrationConnectionResolver.DetectDesignTimeOperation(Array.Empty<string>()));
        Assert.Null(MigrationConnectionResolver.DetectDesignTimeOperation(null));
    }

    [Theory]
    [InlineData("migrations list")]
    [InlineData("migrations script")]
    public void EnsureDesignTimeOperationAuthorized_AllowsReadOnlyOperations_OnRemoteTarget(string command)
    {
        var connection = RemoteConnection();

        var exception = Record.Exception(() =>
            MigrationConnectionResolver.EnsureDesignTimeOperationAuthorized(
                connection,
                Env(),
                new[] { "dotnet-ef.dll", command.Split(' ')[0], command.Split(' ')[1] }));

        Assert.Null(exception);
    }

    [Fact]
    public void EnsureDesignTimeOperationAuthorized_BlocksDatabaseUpdate_OnRemoteTargetWithoutConfirmation()
    {
        var connection = RemoteConnection();

        var exception = Assert.Throws<MigrationConnectionException>(() =>
            MigrationConnectionResolver.EnsureDesignTimeOperationAuthorized(
                connection,
                Env(),
                new[] { "dotnet-ef.dll", "database", "update" }));

        Assert.Contains(MigrationConnectionResolver.AllowUpdateVariable, exception.Message);
        Assert.Contains("database update", exception.Message);
        Assert.DoesNotContain(PasswordMarker, exception.ToString());
    }

    [Fact]
    public void EnsureDesignTimeOperationAuthorized_AllowsDatabaseUpdate_OnRemoteTargetWithExplicitConfirmation()
    {
        var connection = RemoteConnection();

        var exception = Record.Exception(() =>
            MigrationConnectionResolver.EnsureDesignTimeOperationAuthorized(
                connection,
                Env((MigrationConnectionResolver.AllowUpdateVariable, "true")),
                new[] { "dotnet-ef.dll", "database", "update" }));

        Assert.Null(exception);
    }

    [Fact]
    public void EnsureDesignTimeOperationAuthorized_AllowsDatabaseUpdate_OnLocalTarget()
    {
        var connection = MigrationConnectionResolver.Resolve(
            NewEmptyBasePath(),
            Env((MigrationConnectionResolver.MigrationConnectionVariable,
                $"Host=localhost;Database=design_local;Username=design_user;Password={PasswordMarker}")));

        var exception = Record.Exception(() =>
            MigrationConnectionResolver.EnsureDesignTimeOperationAuthorized(
                connection,
                Env(),
                new[] { "dotnet-ef.dll", "database", "update" }));

        Assert.Null(exception);
    }

    [Fact]
    public void EnsureDesignTimeOperationAuthorized_BlocksUnidentifiedOperation_OnRemoteTarget()
    {
        var connection = RemoteConnection();

        var exception = Assert.Throws<MigrationConnectionException>(() =>
            MigrationConnectionResolver.EnsureDesignTimeOperationAuthorized(
                connection,
                Env(),
                new[] { "dotnet-ef.dll" }));

        Assert.Contains(MigrationConnectionResolver.AllowUpdateVariable, exception.Message);
    }

    private static MigrationConnection RemoteConnection()
    {
        return MigrationConnectionResolver.Resolve(
            NewEmptyBasePath(),
            Env((MigrationConnectionResolver.MigrationConnectionVariable,
                $"Host=192.0.2.1;Database=design_remote;Username=design_user;Password={PasswordMarker}")));
    }
}
