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

// Adicione o servi�o de configura��o
builder.Configuration.AddJsonFile("appsettings.json");

// Configura��o do DbContext com SQL Server
builder.Services.AddDbContext<EthicAIDbContext>(options =>
          options.UseSqlServer(builder.Configuration.GetConnectionString("DefaultConnection")));


// Adiciona o servi�o UserService
builder.Services.AddScoped<UserService>();
builder.Services.AddScoped<SecretManager>();
builder.Services.AddScoped<GitHubService>();
builder.Services.AddScoped<IPreSaleService, PreSaleService>();

builder.Services.AddScoped<AuthenticationStateProvider, CustomAuthenticationStateProvider>();
builder.Services.AddScoped<CustomAuthenticationStateProvider>();

var app = builder.Build();

// Aplicar automaticamente as migra��es pendentes ao iniciar a aplica��o
using (var scope = app.Services.CreateScope())
{
    var services = scope.ServiceProvider;
    var context = services.GetRequiredService<EthicAIDbContext>();
    context.Database.Migrate(); // Aplica as migra��es pendentes
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
