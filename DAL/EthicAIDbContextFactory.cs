using EthicAI.EntityModel;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;
using Microsoft.Extensions.Configuration;
using System.IO;

public class EthicAIDbContextFactory : IDesignTimeDbContextFactory<EthicAIDbContext>
{
    public EthicAIDbContext CreateDbContext(string[] args)
    {
        // Build configuration from appsettings.json
        IConfigurationRoot configuration = new ConfigurationBuilder()
            .SetBasePath(Directory.GetCurrentDirectory())
            .AddJsonFile("appsettings.json")
            .Build();

        var optionsBuilder = new DbContextOptionsBuilder<EthicAIDbContext>();

        // Use the connection string from the configuration
        var connectionString = configuration.GetConnectionString("Default");
        optionsBuilder.UseNpgsql(connectionString);

        // Use the correct constructor that accepts DbContextOptions
        return new EthicAIDbContext(optionsBuilder.Options);
    }
}
