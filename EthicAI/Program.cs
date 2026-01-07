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

// 🔧 Configurações primeiro
builder.Configuration
    .SetBasePath(Directory.GetCurrentDirectory())
    .AddJsonFile("appsettings.json", optional: false)
    .AddJsonFile($"appsettings.{builder.Environment.EnvironmentName}.json", optional: true)
    .AddUserSecrets<Program>(optional: true) // 🔑 ISSO É O QUE FALTAVA
    .AddEnvironmentVariables();


// 🧪 Log do ambiente
Console.WriteLine($"🌱 ASPNETCORE_ENVIRONMENT: {builder.Environment.EnvironmentName}");

// Serviços
builder.Services.AddRazorPages();
builder.Services.AddServerSideBlazor();

builder.Services.AddMetaMaskBlazor();
builder.Services.AddBlazoredSessionStorage();
builder.Services.AddBlazoredToast();

builder.Services.AddHttpClient<GitHubService>();

builder.Services.AddDbContext<EthicAIDbContext>(options =>
    options.UseNpgsql(builder.Configuration.GetConnectionString("Default")));

builder.Services.AddScoped<UserService>();
builder.Services.AddScoped<SecretManager>();
builder.Services.AddScoped<PostService>();
builder.Services.AddScoped<BinanceService>();
builder.Services.AddScoped<MatchService>();
builder.Services.AddScoped<IPreSaleService, PreSaleService>();

builder.Services.AddScoped<AuthenticationStateProvider, CustomAuthenticationStateProvider>();
builder.Services.AddScoped<CustomAuthenticationStateProvider>();

var app = builder.Build();

// 🚀 Migrações automáticas
using (var scope = app.Services.CreateScope())
{
    var context = scope.ServiceProvider.GetRequiredService<EthicAIDbContext>();
    context.Database.Migrate();
}

// Pipeline
if (!app.Environment.IsDevelopment())
{
    app.UseExceptionHandler("/Error");
    app.UseHsts();
}

app.UseHttpsRedirection();
app.UseStaticFiles();
app.UseRouting();

app.MapBlazorHub();
app.MapFallbackToPage("/_Host");

app.Run();

