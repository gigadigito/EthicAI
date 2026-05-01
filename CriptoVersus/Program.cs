
using Blazored.SessionStorage;
using BLL.Blockchain;
using CriptoVersus.Web.Components;
using CriptoVersus.Web.Services;

var builder = WebApplication.CreateBuilder(args);

// Add services to the container.
builder.Services.AddRazorComponents()
    .AddInteractiveServerComponents();

builder.Services.AddScoped<DashboardHubClient>();
builder.Services.AddScoped<WalletSessionState>();
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

app.UseStaticFiles();
app.UseAntiforgery();

app.MapRazorComponents<App>()
    .AddInteractiveServerRenderMode();

app.Run();
