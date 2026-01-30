using CriptoVersus.API.Hubs;
using CriptoVersus.API.Services;
using EthicAI.EntityModel;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.EntityFrameworkCore;
using Microsoft.OpenApi.Models;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddControllers();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(c =>
{
    c.SwaggerDoc("v1", new OpenApiInfo
    {
        Title = "CriptoVersus API",
        Version = "v1"
    });
});
builder.Services.AddSignalR();

builder.Services.AddHostedService<PostgresChangeListener>();

var connStr = builder.Configuration.GetConnectionString("Default");
if (string.IsNullOrWhiteSpace(connStr))
    throw new InvalidOperationException("ConnectionString não encontrada em ConnectionStrings:Default/EthicAI/Postgres");

builder.Services.AddDbContextFactory<EthicAIDbContext>(opt => opt.UseNpgsql(connStr));

var app = builder.Build();

/* ✅ ESSENCIAL atrás de proxy (NPM) + Docker */
var fwdOptions = new ForwardedHeadersOptions
{
    ForwardedHeaders =
        ForwardedHeaders.XForwardedFor |
        ForwardedHeaders.XForwardedProto |
        ForwardedHeaders.XForwardedHost,

    // evita “simetria” quebrar se vier só proto/for etc
    RequireHeaderSymmetry = false,

    // boa prática: limite de proxies na cadeia
    ForwardLimit = 2
};

// ✅ Em Docker, o proxy vem de uma rede 172.x e NÃO é loopback.
// Se você não limpar isso, o ASP.NET pode ignorar X-Forwarded-*
fwdOptions.KnownNetworks.Clear();
fwdOptions.KnownProxies.Clear();

app.UseForwardedHeaders(fwdOptions);

// Se você usa HTTPS só no NPM (terminação TLS), normalmente NÃO precisa
// app.UseHttpsRedirection();

app.UseSwagger();
app.UseSwaggerUI(c =>
{
    c.SwaggerEndpoint("/swagger/v1/swagger.json", "CriptoVersus API v1");
    c.RoutePrefix = "swagger";
});

app.UseRouting();

app.UseAuthorization();

app.MapControllers();
app.MapHub<DashboardHub>("/hubs/dashboard");

app.Run();
