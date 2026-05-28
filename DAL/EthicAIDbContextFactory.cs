using EthicAI.EntityModel;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;
using Microsoft.Extensions.Configuration;
using System.IO;

public class EthicAIDbContextFactory : IDesignTimeDbContextFactory<EthicAIDbContext>
{
    public EthicAIDbContext CreateDbContext(string[] args)
    {
        var basePath = Directory.GetCurrentDirectory();
        var solutionRootAppsettings = Path.Combine(basePath, "..", "CriptoVersus.Worker", "appsettings.json");

        IConfigurationRoot configuration = new ConfigurationBuilder()
            .SetBasePath(basePath)
            .AddJsonFile("appsettings.json", optional: true)
            .AddJsonFile(solutionRootAppsettings, optional: true)
            .Build();

        var optionsBuilder = new DbContextOptionsBuilder<EthicAIDbContext>();

        var connectionString = configuration.GetConnectionString("Default");
        if (string.IsNullOrWhiteSpace(connectionString))
            connectionString = "Host=localhost;Port=5432;Database=criptoversus_design;Username=postgres;Password=postgres";

        optionsBuilder.UseNpgsql(connectionString);

        return new EthicAIDbContext(optionsBuilder.Options);
    }
}
