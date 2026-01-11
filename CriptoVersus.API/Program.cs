using EthicAI.EntityModel;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddControllers();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

var connStr =
    builder.Configuration.GetConnectionString("Default");


if (string.IsNullOrWhiteSpace(connStr))
    throw new InvalidOperationException("ConnectionString não encontrada em ConnectionStrings:Default/EthicAI/Postgres");

builder.Services.AddDbContextFactory<EthicAIDbContext>(opt => opt.UseNpgsql(connStr));

var app = builder.Build();


 app.UseSwagger();
 app.UseSwaggerUI();

app.UseHttpsRedirection();
app.UseAuthorization();
app.MapControllers();
app.Run();
