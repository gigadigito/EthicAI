using EthicAI.EntityModel;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddControllers();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

var connStr = builder.Configuration.GetConnectionString("Default");

if (string.IsNullOrWhiteSpace(connStr))
    throw new InvalidOperationException("ConnectionString não encontrada em ConnectionStrings:Default/EthicAI/Postgres");

builder.Services.AddDbContextFactory<EthicAIDbContext>(opt => opt.UseNpgsql(connStr));

var app = builder.Build();

/* 🔴 ISSO É ESSENCIAL */
app.UseForwardedHeaders(new ForwardedHeadersOptions
{
    ForwardedHeaders =
        ForwardedHeaders.XForwardedFor |
        ForwardedHeaders.XForwardedProto
});

/* Swagger SEM if de environment */
app.UseSwagger();
app.UseSwaggerUI(c =>
{
    c.SwaggerEndpoint("/swagger/v1/swagger.json", "CriptoVersus API v1");
    c.RoutePrefix = "swagger";
});

app.UseAuthorization();
app.MapControllers();
app.Run();
