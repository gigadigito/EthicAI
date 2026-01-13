using Microsoft.AspNetCore.SignalR;
using Npgsql;
using CriptoVersus.API.Hubs;

namespace CriptoVersus.API.Services;

public sealed class PostgresChangeListener : BackgroundService
{
    private readonly IConfiguration _cfg;
    private readonly ILogger<PostgresChangeListener> _log;
    private readonly IHubContext<DashboardHub> _hub;

    public PostgresChangeListener(
        IConfiguration cfg,
        ILogger<PostgresChangeListener> log,
        IHubContext<DashboardHub> hub)
    {
        _cfg = cfg;
        _log = log;
        _hub = hub;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var connStr = _cfg.GetConnectionString("Default");
        if (string.IsNullOrWhiteSpace(connStr))
            throw new InvalidOperationException("ConnectionStrings:Default não configurada.");

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await using var conn = new NpgsqlConnection(connStr);
                await conn.OpenAsync(stoppingToken);

                conn.Notification += async (_, e) =>
                {
                    // e.Payload = json texto
                    _log.LogInformation("NOTIFY {Channel}: {Payload}", e.Channel, e.Payload);

                    // evento único para o dashboard
                    await _hub.Clients.All.SendAsync(
                        "dashboard_changed",
                        e.Payload,
                        stoppingToken);
                };

                await using (var cmd = new NpgsqlCommand("LISTEN cripto_change;", conn))
                    await cmd.ExecuteNonQueryAsync(stoppingToken);

                // loop aguardando notificações
                while (!stoppingToken.IsCancellationRequested)
                    await conn.WaitAsync(stoppingToken);
            }
            catch (OperationCanceledException)
            {
                // encerrando
            }
            catch (Exception ex)
            {
                _log.LogError(ex, "Falha no listener do Postgres. Reconectando em 5s...");
                await Task.Delay(TimeSpan.FromSeconds(5), stoppingToken);
            }
        }
    }
}
