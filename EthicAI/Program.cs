using Blazored.SessionStorage;
using Ethereum.MetaMask.Blazor;
using Microsoft.AspNetCore.Components;
using Microsoft.AspNetCore.Components.Web;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using EthicAI.Data;
using EthicAI.EntityModel;
using BLL;
using EthicAI.Services;
using Microsoft.AspNetCore.Components.Authorization;
using Blazored.Toast;
using BLL.NFTFutebol;

var builder = WebApplication.CreateBuilder(args);

// Add services to the container.
builder.Services.AddRazorPages();
builder.Services.AddServerSideBlazor();
builder.Services.AddSingleton<WeatherForecastService>();
builder.Services.AddHttpClient<GitHubService>();
//builder.Services.AddScoped<MetaMaskInterop>();
builder.Services.AddMetaMaskBlazor();
builder.Services.AddBlazoredSessionStorage();
builder.Services.AddBlazoredToast();



// ✅ 1. Carrega as configurações ANTES dos serviços
builder.Configuration
    .SetBasePath(Directory.GetCurrentDirectory())
    .AddJsonFile("appsettings.json", optional: false, reloadOnChange: true)
    .AddJsonFile($"appsettings.{builder.Environment.EnvironmentName}.json", optional: true, reloadOnChange: true)
    .AddEnvironmentVariables();

// 🧪 Log para ver qual ambiente está rodando
Console.WriteLine($"🌱 ASPNETCORE_ENVIRONMENT: {builder.Environment.EnvironmentName}");

// 🧪 Log para ver a string de conexão final
Console.WriteLine("📡 Connection: " + builder.Configuration.GetConnectionString("DefaultConnection"));

// ✅ 2. Registra o DbContext após carregar as configurações
builder.Services.AddDbContext<EthicAIDbContext>(options =>
    options.UseNpgsql(builder.Configuration.GetConnectionString("DefaultConnection")));

foreach (var kvp in builder.Configuration.AsEnumerable())
{
    if (kvp.Key.Contains("ConnectionStrings"))
        Console.WriteLine($"🔍 Config: {kvp.Key} = {kvp.Value}");
}


// Adicione o serviço de configuração
// Altere de AddTransient para AddScoped
builder.Services.AddScoped<EthicAIDbContext>();


// Adiciona o serviço UserService
builder.Services.AddScoped<UserService>();
builder.Services.AddScoped<SecretManager>();
builder.Services.AddScoped<PostService>();

builder.Services.AddScoped<BinanceService>();
builder.Services.AddScoped<GitHubService>();
builder.Services.AddScoped<MatchService>();


builder.Services.AddScoped<IPreSaleService, PreSaleService>();

builder.Services.AddScoped<AuthenticationStateProvider, CustomAuthenticationStateProvider>();
builder.Services.AddScoped<CustomAuthenticationStateProvider>();

var app = builder.Build();

// Aplicar automaticamente as migrações pendentes ao iniciar a aplicação
using (var scope = app.Services.CreateScope())
{
    var services = scope.ServiceProvider;
    var context = services.GetRequiredService<EthicAIDbContext>();
    context.Database.Migrate(); // Aplica as migrações pendentes
}

// Configure the HTTP request pipeline.
if (!app.Environment.IsDevelopment())
{
    app.UseExceptionHandler("/Error");
    // The default HSTS value is 30 days. You may want to change this for production scenarios, see https://aka.ms/aspnetcore-hsts.
    app.UseHsts();
}

app.UseHttpsRedirection();
app.UseStaticFiles();
app.UseRouting();

app.MapBlazorHub();
app.MapFallbackToPage("/_Host");

app.Run();
