using EthicAI.EntityModel;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

public class EthicAIDbContextFactory : IDesignTimeDbContextFactory<EthicAIDbContext>
{
    public EthicAIDbContext CreateDbContext(string[] args)
    {
        return CreateDbContext(
            args,
            Environment.GetEnvironmentVariable,
            Environment.GetCommandLineArgs(),
            Directory.GetCurrentDirectory());
    }

    public EthicAIDbContext CreateDbContext(
        string[] args,
        Func<string, string?> getEnvironmentVariable,
        IReadOnlyList<string> processCommandLineArgs,
        string basePath)
    {
        var connection = MigrationConnectionResolver.Resolve(basePath, getEnvironmentVariable);
        MigrationConnectionResolver.EnsureDesignTimeOperationAuthorized(
            connection,
            getEnvironmentVariable,
            processCommandLineArgs,
            args);

        var operation = MigrationConnectionResolver.DetectDesignTimeOperation(
            (processCommandLineArgs ?? Array.Empty<string>()).Concat(args ?? Array.Empty<string>()));
        Console.Error.WriteLine(
            $"[EthicAIDbContextFactory] Design-time target: {connection.ToSafeSummary()}; " +
            $"source: {connection.Source}; operation: {operation ?? "not identified"}.");

        var optionsBuilder = new DbContextOptionsBuilder<EthicAIDbContext>();
        optionsBuilder.UseNpgsql(connection.ConnectionString);

        return new EthicAIDbContext(optionsBuilder.Options);
    }
}
