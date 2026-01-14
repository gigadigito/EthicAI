using System.Net;
using System.Net.Sockets;
using EthicAI.EntityModel;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Npgsql;
using BLL.NFTFutebol;
using BLL.GameRules;
using CriptoVersus.Worker;

var builder = Host.CreateApplicationBuilder(args);

builder.Configuration
    .SetBasePath(Directory.GetCurrentDirectory())
    .AddJsonFile("appsettings.json", optional: false)
    .AddJsonFile($"appsettings.{builder.Environment.EnvironmentName}.json", optional: true)
    .AddUserSecrets<Program>(optional: true)
    .AddEnvironmentVariables();

builder.Services.AddHttpClient();

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

// Worker
builder.Services.AddHostedService<Worker>();

var host = builder.Build();

host.Services.GetRequiredService<ILoggerFactory>()
    .CreateLogger("Startup")
    .LogInformation("✅ Worker host iniciado. Env={env}", builder.Environment.EnvironmentName);

await host.RunAsync();
