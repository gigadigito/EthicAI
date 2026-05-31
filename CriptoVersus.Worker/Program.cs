using System.Net;
using System.Net.Sockets;
using EthicAI.EntityModel;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Npgsql;
using BLL.NFTFutebol;
using BLL.GameRules;
using BLL.Positions;
using BLL.ArenaSentiment;
using CriptoVersus.Worker;
using BLL;
using BLL.Blockchain;

var builder = Host.CreateApplicationBuilder(args);




builder.Configuration
    .SetBasePath(Directory.GetCurrentDirectory())
    .AddJsonFile("appsettings.json", optional: false)
    .AddJsonFile($"appsettings.{builder.Environment.EnvironmentName}.json", optional: true)
    .AddUserSecrets<Program>(optional: true)
    .AddEnvironmentVariables();

CriptoVersus.Worker.EnvironmentIsolationGuard.AssertDevelopmentConfiguration(builder.Configuration, builder.Environment);


var env = builder.Environment.EnvironmentName;
var db = builder.Configuration.GetConnectionString("Default");
var cluster = builder.Configuration["CriptoVersusBlockchain:Cluster"];
var rpcUrl = builder.Configuration["CriptoVersusBlockchain:RpcUrl"];
var wallet = builder.Configuration["CriptoVersusBlockchain:CustodyWalletPublicKey"];
var interval = builder.Configuration["CriptoVersusWorker:IntervalSeconds"];

Console.ForegroundColor = ConsoleColor.Yellow;
Console.WriteLine("=================================");
Console.WriteLine($"WORKER ENV: {env}");
Console.WriteLine($"DB: {db}");
Console.WriteLine($"Cluster: {cluster}");
Console.WriteLine($"RpcUrl: {rpcUrl}");
Console.WriteLine($"Custody Wallet: {wallet}");
Console.WriteLine($"Worker Interval: {interval}");
Console.WriteLine("=================================");
Console.ResetColor();

builder.Services.AddHttpClient().ConfigureHttpClient(client =>
{
    client.Timeout = TimeSpan.FromSeconds(12);
});
builder.Services.AddMemoryCache();
builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddHttpClient<IArenaSentimentService, ArenaSentimentService>()
    .ConfigureHttpClient(client =>
    {
        client.Timeout = TimeSpan.FromSeconds(8);
    });
builder.Services.Configure<CriptoVersusWorkerOptions>(
    builder.Configuration.GetSection("CriptoVersusWorker"));
builder.Services.Configure<DataRetentionOptions>(
    builder.Configuration.GetSection(DataRetentionOptions.SectionName));
builder.Services.Configure<ArenaSentimentOptions>(
    builder.Configuration.GetSection(ArenaSentimentOptions.ConfigSection));
builder.Services.Configure<CriptoVersusBlockchainOptions>(
    builder.Configuration.GetSection(CriptoVersusBlockchainOptions.SectionName));

static async Task<string> BuildConnectionStringWithResolvedHostAsync(
    IConfiguration cfg,
    ILogger logger,
    CancellationToken ct)
{
    var raw = cfg.GetConnectionString("Default");
    if (string.IsNullOrWhiteSpace(raw))
        throw new Exception("ConnectionStrings:Default não encontrado.");

    var csb = new NpgsqlConnectionStringBuilder(raw);

    var host = csb.Host;
    if (string.IsNullOrWhiteSpace(host))
        throw new Exception("ConnectionStrings:Default sem Host.");

    // Se já veio IP, não mexe
    if (IPAddress.TryParse(host, out _))
        return csb.ConnectionString;

    IPAddress? ip = null;

    // retry DNS no startup (30 tentativas)
    for (var i = 1; i <= 30 && !ct.IsCancellationRequested; i++)
    {
        try
        {
            var addrs = await Dns.GetHostAddressesAsync(host, ct);

            ip = addrs.FirstOrDefault(a => a.AddressFamily == AddressFamily.InterNetwork)
                 ?? addrs.FirstOrDefault();

            if (ip != null)
                break;
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "DNS ainda não resolveu {host} (tentativa {i}/30)", host, i);
        }

        await Task.Delay(TimeSpan.FromSeconds(2), ct);
    }

    if (ip == null)
        throw new Exception($"Não foi possível resolver IP para host '{host}'.");

    csb.Host = ip.ToString();

    // Ajustes bons pra VPS
    csb.Pooling = true;
    csb.KeepAlive = 30;
    csb.Timeout = 15;
    csb.CommandTimeout = 60;

    logger.LogInformation("✅ Resolved {host} -> {ip}. Usando Host=IP para evitar DNS no runtime.", host, csb.Host);
    return csb.ConnectionString;
}
builder.Services.AddScoped<ILedgerService, LedgerService>();
builder.Services.AddScoped<IPositionOrchestrationService, PositionOrchestrationService>();
builder.Services.AddScoped<IFundMigrationService, FundMigrationService>();
builder.Services.AddScoped<DataRetentionService>();
builder.Services.AddScoped<OffChainCustodyFundsService>();
builder.Services.AddScoped<HybridContractCustodyFundsService>();
builder.Services.AddScoped<FullOnChainFundsService>();
builder.Services.AddScoped<ICriptoVersusFundsService>(sp =>
{
    var options = sp.GetRequiredService<Microsoft.Extensions.Options.IOptions<CriptoVersusBlockchainOptions>>().Value;
    return options.Mode switch
    {
        BlockchainOperationMode.OffChainCustody => sp.GetRequiredService<OffChainCustodyFundsService>(),
        BlockchainOperationMode.FullOnChain => sp.GetRequiredService<FullOnChainFundsService>(),
        _ => sp.GetRequiredService<HybridContractCustodyFundsService>()
    };
});

builder.Services.AddDbContext<EthicAIDbContext>((sp, options) =>
{
    var logger = sp.GetRequiredService<ILoggerFactory>().CreateLogger("Db");

    using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(90));
    var cs = BuildConnectionStringWithResolvedHostAsync(builder.Configuration, logger, cts.Token)
        .GetAwaiter()
        .GetResult();

    options.UseNpgsql(cs, npgsql =>
    {
        npgsql.EnableRetryOnFailure(
            maxRetryCount: 8,
            maxRetryDelay: TimeSpan.FromSeconds(10),
            errorCodesToAdd: null
        );
    });
});

// ✅ Game Rules (DI) - REGISTRADO DE VERDADE
builder.Services.AddSingleton<IMatchRuleEngine>(sp =>
    new MatchRuleEngine(
        outOfGainersConfirmCycles: RuleConstants.DefaultOutOfGainersConfirmCycles,
        cancelIfInvalidAtStart: true,
        rulesetVersion: RuleConstants.DefaultRulesetVersion
    ));

// Services do domínio
builder.Services.AddScoped<MatchService>();
builder.Services.AddSingleton<IMatchScoringEngine, MatchScoringEngine>();

// Worker
builder.Services.AddHostedService<Worker>();
builder.Services.AddHostedService<DataRetentionWorker>();

var host = builder.Build();

using (var scope = host.Services.CreateScope())
{
    var context = scope.ServiceProvider.GetRequiredService<EthicAIDbContext>();
    context.Database.Migrate();
}

host.Services.GetRequiredService<ILoggerFactory>()
    .CreateLogger("Startup")
    .LogInformation("✅ Worker host iniciado. Env={env}", builder.Environment.EnvironmentName);

CriptoVersusBlockchainStartupLogger.Log(
    host.Services.GetRequiredService<ILoggerFactory>().CreateLogger("CriptoVersus.Worker.Blockchain"),
    host.Services.GetRequiredService<Microsoft.Extensions.Options.IOptions<CriptoVersusBlockchainOptions>>().Value,
    "CriptoVersus.Worker");

await host.RunAsync();
