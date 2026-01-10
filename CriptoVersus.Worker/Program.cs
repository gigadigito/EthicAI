using Microsoft.EntityFrameworkCore;
using EthicAI.Data;
using BLL.NFTFutebol;
using CriptoVersus.Worker;
using Npgsql;
using System.Net;
using System.Net.Sockets;
using Microsoft.Extensions.Logging;
using EthicAI.EntityModel;

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

    // ✅ troca Host=postgres por Host=<ip>
    csb.Host = ip.ToString();

    // (opcional) ajustes bons pra VPS
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
            maxRetryDelay: TimeSpan.FromSeconds(10),lote
            errorCodesToAdd: null
        );
    });
});

builder.Services.AddScoped<MatchService>();
builder.Services.AddHostedService<Worker>();

var app = builder.Build();
await app.RunAsync();
