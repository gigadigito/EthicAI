using BLL;
using BLL.Blockchain;
using BLL.ArenaSentiment;
using BLL.Positions;
using DTOs;
using CriptoVersus.API.Hubs;
using CriptoVersus.API.Services;
using CriptoVersus.API.Swagger;
using EthicAI.EntityModel;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.StaticFiles;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using Microsoft.OpenApi.Models;
using Microsoft.Extensions.FileProviders;
using System.Text;

var builder = WebApplication.CreateBuilder(args);

// 🔥 LOG DE SEGURANÇA COMPLETO
var env = builder.Environment.EnvironmentName;
var db = builder.Configuration.GetConnectionString("Default");
var workerInterval = builder.Configuration["CriptoVersusWorker:IntervalSeconds"];
var blockchainMode = builder.Configuration["CriptoVersusBlockchain:Mode"];
var adminWallet = builder.Configuration["CriptoVersus:AdminWallet"];
var custodyWallet = builder.Configuration["CriptoVersusBlockchain:CustodyWalletPublicKey"];


Console.ForegroundColor = ConsoleColor.Green;
Console.WriteLine("=================================");
Console.WriteLine($"ENV: {env}");
Console.WriteLine($"DB: {db}");
Console.WriteLine($"Worker Interval: {workerInterval}");
Console.WriteLine($"Blockchain Mode: {blockchainMode}");
Console.WriteLine($"Admin Wallet: {adminWallet}");
Console.WriteLine($"Custody Wallet: {custodyWallet}");
Console.WriteLine("=================================");
Console.ResetColor();

CriptoVersus.API.EnvironmentIsolationGuard.AssertDevelopmentConfiguration(builder.Configuration, builder.Environment);


builder.Services.AddScoped<ILedgerService, LedgerService>();
builder.Services.AddHttpClient<IArenaSentimentService, ArenaSentimentService>();
builder.Services.AddHttpClient<ITokenMarketSnapshotService, TokenMarketSnapshotService>(client =>
{
    client.BaseAddress = new Uri("https://api.dexscreener.com/");
    client.Timeout = TimeSpan.FromSeconds(12);
});
builder.Services.AddScoped<IPositionOrchestrationService, PositionOrchestrationService>();
builder.Services.AddHttpClient<IOffChainCustodyTransferVerifier, OffChainCustodyTransferVerifier>();
builder.Services.AddHttpClient<IOnChainWithdrawalVerifier, OnChainWithdrawalVerifier>();
builder.Services.AddScoped<ISystemBalanceWithdrawalService, SystemBalanceWithdrawalService>();
builder.Services.AddScoped<ICustodySolTransferService, CustodySolTransferService>();
builder.Services.AddScoped<IMatchScoreRebuildService, MatchScoreRebuildService>();
builder.Services.AddScoped<ITvHotMatchService, TvHotMatchService>();
builder.Services.AddScoped<IAudioAssetResolverService, AudioAssetResolverService>();
builder.Services.AddScoped<IAudioNarrativeResolverService, AudioNarrativeResolverService>();
builder.Services.AddScoped<IAudioGenerationQueueService, AudioGenerationQueueService>();
builder.Services.AddScoped<IAudioStorageService, AudioStorageService>();
builder.Services.AddScoped<IAudioAssetAdminService, AudioAssetAdminService>();
builder.Services.AddSingleton<IAudioWorkerAuthenticationService, AudioWorkerAuthenticationService>();
builder.Services.AddScoped<IProceduralAudioSeedService, ProceduralAudioSeedService>();
builder.Services.AddHttpClient<ITvAiNarrationService, TvAiNarrationService>();
builder.Services.AddScoped<ISocialAutomationService, SocialAutomationService>();
builder.Services.AddSingleton<ISocialVsRenderService, SocialVsRenderService>();
builder.Services.AddSingleton<ISocialComposeFinalService, SocialComposeFinalService>();
builder.Services.AddSingleton<BLL.NFTFutebol.IMatchScoringEngine, BLL.NFTFutebol.MatchScoringEngine>();
builder.Services.AddHttpContextAccessor();
builder.Services.AddHttpClient(nameof(SocialVsRenderService));
builder.Services.AddHttpClient(nameof(SocialComposeFinalService));
builder.Services.Configure<CriptoVersusBlockchainOptions>(
    builder.Configuration.GetSection(CriptoVersusBlockchainOptions.SectionName));
builder.Services.Configure<ArenaSentimentOptions>(
    builder.Configuration.GetSection(ArenaSentimentOptions.ConfigSection));
builder.Services.Configure<SocialAutomationOptions>(
    builder.Configuration.GetSection(SocialAutomationOptions.SectionName));
builder.Services.Configure<CriptoVersusAiOptions>(
    builder.Configuration.GetSection(CriptoVersusAiOptions.SectionName));
builder.Services.Configure<AudioGenerationOptions>(
    builder.Configuration.GetSection(AudioGenerationOptions.SectionName));
builder.Services.Configure<ProceduralAudioFeatureOptions>(
    builder.Configuration.GetSection(ProceduralAudioFeatureOptions.SectionName));
builder.Services.AddScoped<IFundMigrationService, FundMigrationService>();
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
builder.Services.Configure<MatchScoreRebuildOptions>(
    builder.Configuration.GetSection("CriptoVersusWorker:Scoring"));
builder.Services.AddControllers();
builder.Services.AddEndpointsApiExplorer();

var jwtKey = builder.Configuration["Jwt:Key"];
if (string.IsNullOrWhiteSpace(jwtKey))
    throw new InvalidOperationException("Jwt:Key não configurado.");

var jwtIssuer = builder.Configuration["Jwt:Issuer"];
var jwtAudience = builder.Configuration["Jwt:Audience"];

builder.Services
    .AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuerSigningKey = true,
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtKey)),
            ValidateIssuer = !string.IsNullOrWhiteSpace(jwtIssuer),
            ValidIssuer = jwtIssuer,
            ValidateAudience = !string.IsNullOrWhiteSpace(jwtAudience),
            ValidAudience = jwtAudience,
            ValidateLifetime = true,
            ClockSkew = TimeSpan.FromMinutes(1)
        };
    });

builder.Services.AddAuthorization(options =>
{
    options.FallbackPolicy = new AuthorizationPolicyBuilder()
        .RequireAuthenticatedUser()
        .Build();
});

builder.Services.AddSwaggerGen(c =>
{
    c.SwaggerDoc("v1", new OpenApiInfo
    {
        Title = "CriptoVersus API",
        Version = "v1"
    });

    c.AddSecurityDefinition("Bearer", new OpenApiSecurityScheme
    {
        Name = "Authorization",
        Type = SecuritySchemeType.Http,
        Scheme = "bearer",
        BearerFormat = "JWT",
        In = ParameterLocation.Header,
        Description = "Informe o token JWT no formato: Bearer {token}"
    });

    c.AddSecurityRequirement(new OpenApiSecurityRequirement
    {
        {
            new OpenApiSecurityScheme
            {
                Reference = new OpenApiReference
                {
                    Type = ReferenceType.SecurityScheme,
                    Id = "Bearer"
                }
            },
            Array.Empty<string>()
        }
    });

    c.OperationFilter<AuthorizationOperationFilter>();
});
builder.Services.AddSignalR();

builder.Services.AddMemoryCache();

builder.Services.AddHostedService<PostgresChangeListener>();

var connStr = builder.Configuration.GetConnectionString("Default");
if (string.IsNullOrWhiteSpace(connStr))
    throw new InvalidOperationException("ConnectionString não encontrada em ConnectionStrings:Default/EthicAI/Postgres");

builder.Services.AddDbContextFactory<EthicAIDbContext>(opt => opt.UseNpgsql(connStr));

var app = builder.Build();

var mediaContentTypeProvider = CreateMediaContentTypeProvider();

using (var scope = app.Services.CreateScope())
{
    var dbContextFactory = scope.ServiceProvider.GetRequiredService<IDbContextFactory<EthicAIDbContext>>();
    using var context = dbContextFactory.CreateDbContext();
    context.Database.Migrate();
    var seedService = scope.ServiceProvider.GetRequiredService<IProceduralAudioSeedService>();
    await seedService.EnsureSeedAsync();
}

var blockchainOptions = app.Services
    .GetRequiredService<Microsoft.Extensions.Options.IOptions<CriptoVersusBlockchainOptions>>()
    .Value;
CriptoVersusBlockchainStartupLogger.Log(
    app.Services.GetRequiredService<ILoggerFactory>().CreateLogger("CriptoVersus.API.Blockchain"),
    blockchainOptions,
    "CriptoVersus.API");

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

MapPublicAudioFiles(app, mediaContentTypeProvider);
app.UseStaticFiles(new StaticFileOptions
{
    ContentTypeProvider = mediaContentTypeProvider
});
app.UseRouting();
app.UseAuthentication();
app.UseAuthorization();

app.MapControllers();
app.MapHub<DashboardHub>("/hubs/dashboard").AllowAnonymous();

app.Run();

static FileExtensionContentTypeProvider CreateMediaContentTypeProvider()
{
    var provider = new FileExtensionContentTypeProvider();
    provider.Mappings[".mp3"] = "audio/mpeg";
    provider.Mappings[".wav"] = "audio/wav";
    return provider;
}

static void MapPublicAudioFiles(WebApplication app, FileExtensionContentTypeProvider contentTypeProvider)
{
    var webRootPath = app.Environment.WebRootPath;
    if (string.IsNullOrWhiteSpace(webRootPath))
        return;

    var audioRoot = Path.Combine(webRootPath, "audio");
    Directory.CreateDirectory(audioRoot);

    app.Map("/audio", audioApp =>
    {
        audioApp.UseStaticFiles(new StaticFileOptions
        {
            RequestPath = string.Empty,
            FileProvider = new PhysicalFileProvider(audioRoot),
            ContentTypeProvider = contentTypeProvider,
            OnPrepareResponse = context =>
            {
                var headers = context.Context.Response.Headers;
                headers["Access-Control-Allow-Origin"] = "*";
                headers["Access-Control-Allow-Methods"] = "GET, HEAD, OPTIONS";
                headers["Access-Control-Allow-Headers"] = "Origin, Range, Accept, Content-Type";
                headers["Access-Control-Expose-Headers"] = "Accept-Ranges, Content-Length, Content-Range, Content-Type";
                headers["Cross-Origin-Resource-Policy"] = "cross-origin";
                headers["Accept-Ranges"] = "bytes";
            }
        });

        audioApp.Run(context =>
        {
            context.Response.StatusCode = StatusCodes.Status404NotFound;
            return Task.CompletedTask;
        });
    });
}
