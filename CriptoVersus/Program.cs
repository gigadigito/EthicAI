
using Blazored.SessionStorage;
using BLL.Blockchain;
using CriptoVersus.Web.Components;
using CriptoVersus.Web.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.StaticFiles;
using Microsoft.Extensions.FileProviders;
using System.Globalization;

var builder = WebApplication.CreateBuilder(args);

var env = builder.Environment.EnvironmentName;
var apiBaseUrl = builder.Configuration["Api:InternalBaseUrl"]
    ?? builder.Configuration["Api:BaseUrl"];

Console.ForegroundColor = ConsoleColor.Cyan;
Console.WriteLine("=================================");
Console.WriteLine($"WEB ENV: {env}");
Console.WriteLine($"API BASE URL: {apiBaseUrl}");
Console.WriteLine("=================================");
Console.ResetColor();

if (string.IsNullOrWhiteSpace(apiBaseUrl))
    throw new InvalidOperationException("Api:BaseUrl não configurado.");


if (builder.Environment.IsDevelopment())
{
    var api = builder.Configuration["Api:BaseUrl"] ?? "";
    var cluster = builder.Configuration["CriptoVersusBlockchain:Cluster"] ?? "";
    var wallet = builder.Configuration["CriptoVersusBlockchain:CustodyWalletPublicKey"] ?? "";

    if (api.Contains("criptoversus.com"))
        throw new Exception("🚨 DEV apontando para API de PRODUÇÃO");

    if (cluster == "mainnet-beta")
        throw new Exception("🚨 DEV usando MAINNET");

    if (wallet.StartsWith("GHdFhv"))
        throw new Exception("🚨 DEV usando wallet de PRODUÇÃO");
}

// Add services to the container.
builder.Services.AddRazorComponents()
    .AddInteractiveServerComponents();
builder.Services.AddMemoryCache();
builder.Services.AddHttpContextAccessor();

builder.Services.AddSingleton<AppCultureService>();
builder.Services.AddSingleton<LocalizationService>();
builder.Services.AddSingleton<LocalizedMediaPathResolver>();
builder.Services.AddSingleton<PublishedVersionService>();
builder.Services.AddScoped<DashboardHubClient>();
builder.Services.AddScoped<WalletSessionState>();
builder.Services.AddScoped<BrowserTimeZoneService>();
builder.Services.AddScoped<MatchSlugHelper>();
builder.Services.AddScoped<RouteLocalizationService>();
builder.Services.AddScoped<MatchSeoService>();
builder.Services.AddScoped<RoadmapContentService>();
builder.Services.AddScoped<SitemapService>();
builder.Services.AddScoped<TvArenaCommentaryService>();
builder.Services.AddScoped<TvFieldPositionService>();
builder.Services.AddScoped<TvFieldStateService>();
builder.Services.AddScoped<DailyHotMatchesService>();
builder.Services.AddScoped<TokenMarketService>();
builder.Services.AddScoped<TeamInvestmentContextResolver>();
builder.Services.Configure<SitemapOptions>(
    builder.Configuration.GetSection(SitemapOptions.SectionName));
builder.Services.Configure<TvBroadcastOptions>(
    builder.Configuration.GetSection(TvBroadcastOptions.SectionName));
builder.Services.AddSingleton<MatchRouteRedirectResolver>();
builder.Services.AddScoped<IMatchRouteLookupService, ApiMatchRouteLookupService>();
builder.Services.Configure<CriptoVersusBlockchainOptions>(
    builder.Configuration.GetSection(CriptoVersusBlockchainOptions.SectionName));


builder.Services.AddServerSideBlazor()
    .AddCircuitOptions(o => o.DetailedErrors = true);

builder.Services.AddHttpClient("CriptoVersusApi", (sp, client) =>
{
    var cfg = sp.GetRequiredService<IConfiguration>();
    var baseUrl = cfg["Api:InternalBaseUrl"]?.TrimEnd('/')
        ?? cfg["Api:BaseUrl"]?.TrimEnd('/');
    client.BaseAddress = new Uri(baseUrl + "/");
    client.Timeout = TimeSpan.FromSeconds(10);
});

builder.Services.AddScoped<CriptoVersusApiClient>();
builder.Services.AddScoped<HotMatchService>();


builder.Services.AddBlazoredSessionStorage();
var app = builder.Build();
var mediaContentTypeProvider = CreateMediaContentTypeProvider();

CriptoVersusBlockchainStartupLogger.Log(
    app.Services.GetRequiredService<ILoggerFactory>().CreateLogger("CriptoVersus.Web.Blockchain"),
    app.Services.GetRequiredService<Microsoft.Extensions.Options.IOptions<CriptoVersusBlockchainOptions>>().Value,
    "CriptoVersus.Web");

// Configure the HTTP request pipeline.
if (!app.Environment.IsDevelopment())
{
    app.UseExceptionHandler("/Error", createScopeForErrors: true);
    // The default HSTS value is 30 days. You may want to change this for production scenarios, see https://aka.ms/aspnetcore-hsts.
    app.UseHsts();
}





if (!app.Environment.IsDevelopment())
{
    app.UseHttpsRedirection();
}
var appCultureService = app.Services.GetRequiredService<AppCultureService>();
app.Use(async (context, next) =>
{
    var routeCulture = appCultureService.DetectPreferredRouteCulture(context);
    var cultureCode = appCultureService.ToCultureCode(routeCulture);
    var cultureInfo = CultureInfo.GetCultureInfo(cultureCode);

    CultureInfo.CurrentCulture = cultureInfo;
    CultureInfo.CurrentUICulture = cultureInfo;

    if (app.Environment.IsDevelopment())
    {
        var logger = context.RequestServices.GetRequiredService<ILoggerFactory>().CreateLogger("CriptoVersus.Web.I18N");
        logger.LogDebug("[I18N_DEBUG] path={Path} routeCulture={RouteCulture} currentCulture={CurrentCulture} currentUICulture={CurrentUICulture}",
            context.Request.Path.Value,
            routeCulture,
            CultureInfo.CurrentCulture.Name,
            CultureInfo.CurrentUICulture.Name);
    }

    await next();
});
app.UseMiddleware<MatchRouteRedirectMiddleware>();

MapPublicAudioFiles(app, mediaContentTypeProvider);
app.UseStaticFiles(new StaticFileOptions
{
    ContentTypeProvider = mediaContentTypeProvider
});
app.UseAntiforgery();

app.MapGet("/healthz", () => Results.Text("OK", "text/plain"))
    .WithMetadata(new AllowAnonymousAttribute());

app.MapMethods("/sitemap.xml", ["GET", "HEAD"], async (HttpContext httpContext, SitemapService sitemapService, CancellationToken ct) =>
{
    var xml = await sitemapService.GetSitemapIndexXmlAsync(ct);
    httpContext.Response.ContentType = "application/xml; charset=utf-8";
    httpContext.Response.ContentLength = System.Text.Encoding.UTF8.GetByteCount(xml);

    if (HttpMethods.IsHead(httpContext.Request.Method))
        return Results.Empty;

    return Results.Content(xml, "application/xml; charset=utf-8");
});

app.MapMethods("/sitemap-pages.xml", ["GET", "HEAD"], async (HttpContext httpContext, SitemapService sitemapService, CancellationToken ct) =>
{
    var xml = await sitemapService.GetPagesSitemapXmlAsync(ct);
    httpContext.Response.ContentType = "application/xml; charset=utf-8";
    httpContext.Response.ContentLength = System.Text.Encoding.UTF8.GetByteCount(xml);

    if (HttpMethods.IsHead(httpContext.Request.Method))
        return Results.Empty;

    return Results.Content(xml, "application/xml; charset=utf-8");
});

app.MapMethods("/sitemap-matches-en.xml", ["GET", "HEAD"], async (HttpContext httpContext, SitemapService sitemapService, CancellationToken ct) =>
{
    var xml = await sitemapService.GetMatchSitemapXmlAsync("en", ct);
    httpContext.Response.ContentType = "application/xml; charset=utf-8";
    httpContext.Response.ContentLength = System.Text.Encoding.UTF8.GetByteCount(xml);

    if (HttpMethods.IsHead(httpContext.Request.Method))
        return Results.Empty;

    return Results.Content(xml, "application/xml; charset=utf-8");
});

app.MapMethods("/sitemap-matches-pt.xml", ["GET", "HEAD"], async (HttpContext httpContext, SitemapService sitemapService, CancellationToken ct) =>
{
    var xml = await sitemapService.GetMatchSitemapXmlAsync("pt", ct);
    httpContext.Response.ContentType = "application/xml; charset=utf-8";
    httpContext.Response.ContentLength = System.Text.Encoding.UTF8.GetByteCount(xml);

    if (HttpMethods.IsHead(httpContext.Request.Method))
        return Results.Empty;

    return Results.Content(xml, "application/xml; charset=utf-8");
});

app.MapMethods("/sitemap-matches-zh.xml", ["GET", "HEAD"], async (HttpContext httpContext, SitemapService sitemapService, CancellationToken ct) =>
{
    var xml = await sitemapService.GetMatchSitemapXmlAsync("zh", ct);
    httpContext.Response.ContentType = "application/xml; charset=utf-8";
    httpContext.Response.ContentLength = System.Text.Encoding.UTF8.GetByteCount(xml);

    if (HttpMethods.IsHead(httpContext.Request.Method))
        return Results.Empty;

    return Results.Content(xml, "application/xml; charset=utf-8");
});

app.MapGet("/robots.txt", async (SitemapService sitemapService, CancellationToken ct) =>
{
    var content = await sitemapService.GetRobotsTxtAsync(ct);
    return Results.Content(content, "text/plain; charset=utf-8");
});

app.MapMethods("/social-images/match/{matchId:int}/{slug}.svg", ["GET", "HEAD"], async (
    HttpContext httpContext,
    int matchId,
    CriptoVersusApiClient apiClient,
    MatchSeoService matchSeoService,
    CancellationToken ct) =>
{
    var match = await apiClient.GetMatchByIdAsync(matchId);
    if (match is null)
        return Results.NotFound();

    var svg = matchSeoService.BuildSocialImageSvg(match);
    httpContext.Response.Headers.CacheControl = "public,max-age=300";
    httpContext.Response.ContentType = "image/svg+xml; charset=utf-8";
    httpContext.Response.ContentLength = System.Text.Encoding.UTF8.GetByteCount(svg);

    if (HttpMethods.IsHead(httpContext.Request.Method))
        return Results.Empty;

    return Results.Text(svg, "image/svg+xml; charset=utf-8");
});

app.MapRazorComponents<App>()
    .AddInteractiveServerRenderMode();

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
            ContentTypeProvider = contentTypeProvider
        });

        audioApp.Run(context =>
        {
            context.Response.StatusCode = StatusCodes.Status404NotFound;
            return Task.CompletedTask;
        });
    });
}

