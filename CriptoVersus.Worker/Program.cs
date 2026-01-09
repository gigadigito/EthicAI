using Microsoft.EntityFrameworkCore;
using EthicAI.Data;
using BLL.NFTFutebol;
using CriptoVersus.Worker;
using EthicAI.EntityModel;

var builder = Host.CreateApplicationBuilder(args);

builder.Configuration
    .SetBasePath(Directory.GetCurrentDirectory())
    .AddJsonFile("appsettings.json", optional: false)
    .AddJsonFile($"appsettings.{builder.Environment.EnvironmentName}.json", optional: true)
    .AddUserSecrets<Program>(optional: true)
    .AddEnvironmentVariables();

// ✅ HttpClientFactory
builder.Services.AddHttpClient();

// ✅ DbContext
builder.Services.AddDbContext<EthicAIDbContext>(options =>
    options.UseNpgsql(builder.Configuration.GetConnectionString("Default")));

// ✅ Registra o MatchService (BLL)
builder.Services.AddScoped<MatchService>();

// ✅ Registra o Worker (template)
builder.Services.AddHostedService<Worker>();

var app = builder.Build();

// opcional: migrate
using (var scope = app.Services.CreateScope())
{
    var ctx = scope.ServiceProvider.GetRequiredService<EthicAIDbContext>();
    ctx.Database.Migrate();
}

await app.RunAsync();
