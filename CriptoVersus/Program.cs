
using Blazored.SessionStorage;
using BLL.Blockchain;
using CriptoVersus.Web.Components;
using CriptoVersus.Web.Services;

var builder = WebApplication.CreateBuilder(args);

var env = builder.Environment.EnvironmentName;
var apiBaseUrl = builder.Configuration["Api:BaseUrl"];

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

builder.Services.AddScoped<DashboardHubClient>();
builder.Services.AddScoped<WalletSessionState>();
builder.Services.AddScoped<BrowserTimeZoneService>();
builder.Services.AddScoped<MatchSlugHelper>();
builder.Services.AddScoped<RouteLocalizationService>();
builder.Services.AddScoped<MatchSeoService>();
builder.Services.AddScoped<RoadmapContentService>();
builder.Services.AddSingleton<MatchRouteRedirectResolver>();
builder.Services.AddScoped<IMatchRouteLookupService, ApiMatchRouteLookupService>();
builder.Services.Configure<CriptoVersusBlockchainOptions>(
    builder.Configuration.GetSection(CriptoVersusBlockchainOptions.SectionName));


builder.Services.AddServerSideBlazor()
    .AddCircuitOptions(o => o.DetailedErrors = true);

builder.Services.AddHttpClient("CriptoVersusApi", (sp, client) =>
{
    var cfg = sp.GetRequiredService<IConfiguration>();
    var baseUrl = cfg["Api:BaseUrl"]?.TrimEnd('/');
    client.BaseAddress = new Uri(baseUrl + "/");
});

builder.Services.AddScoped<CriptoVersusApiClient>();


builder.Services.AddBlazoredSessionStorage();
var app = builder.Build();

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





app.UseHttpsRedirection();
app.UseMiddleware<MatchRouteRedirectMiddleware>();

app.UseStaticFiles();
app.UseAntiforgery();

app.MapRazorComponents<App>()
    .AddInteractiveServerRenderMode();

app.Run();

