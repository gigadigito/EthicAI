using System.Net.Sockets;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace CriptoVersus.Worker
{
    public class Worker : BackgroundService
    {
        private readonly ILogger<Worker> _logger;
        private readonly IServiceProvider _sp;

        public Worker(ILogger<Worker> logger, IServiceProvider sp)
        {
            _logger = logger;
            _sp = sp;
        }

        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            _logger.LogInformation("✅ CriptoVersus Worker started.");

            // ✅ Aguarda Postgres ficar acessível (DNS + porta)
            await WaitForPostgresAsync(stoppingToken);

            while (!stoppingToken.IsCancellationRequested)
            {
                try
                {
                    await RunCycleAsync(stoppingToken);

                    // não rode colado (evita stress no DNS/pool)
                    await Task.Delay(TimeSpan.FromSeconds(30), stoppingToken);
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "❌ Erro no ciclo do Worker");

                    var wait = IsDnsOrNetworkTransient(ex)
                        ? TimeSpan.FromSeconds(45)
                        : TimeSpan.FromSeconds(15);

                    _logger.LogWarning("⏳ Aguardando {sec}s para tentar novamente...", wait.TotalSeconds);
                    await Task.Delay(wait, stoppingToken);
                }
            }
        }

        private static bool IsDnsOrNetworkTransient(Exception ex)
        {
            for (var e = ex; e != null; e = e.InnerException)
            {
                if (e is SocketException) return true;
            }
            return false;
        }

        private async Task WaitForPostgresAsync(CancellationToken ct)
        {
            const string host = "postgres";
            const int port = 5432;

            var deadline = DateTime.UtcNow.AddMinutes(3);
            var attempt = 0;

            while (!ct.IsCancellationRequested && DateTime.UtcNow < deadline)
            {
                attempt++;

                try
                {
                    // resolve DNS + testa porta
                    using var tcp = new TcpClient();
                    var connectTask = tcp.ConnectAsync(host, port);

                    var completed = await Task.WhenAny(connectTask, Task.Delay(TimeSpan.FromSeconds(3), ct));
                    if (completed != connectTask)
                        throw new TimeoutException("Timeout conectando no Postgres.");

                    _logger.LogInformation("✅ Postgres acessível em {host}:{port} (tentativa {attempt})", host, port, attempt);
                    return;
                }
                catch (Exception ex)
                {
                    _logger.LogWarning("⏳ Postgres ainda não está pronto ({host}:{port}) tentativa {attempt}: {msg}",
                        host, port, attempt, ex.Message);

                    await Task.Delay(TimeSpan.FromSeconds(Math.Min(10, 2 + attempt)), ct);
                }
            }

            _logger.LogWarning("⚠️ Timeout aguardando Postgres. O worker vai continuar e tentar no ciclo mesmo assim.");
        }

        private async Task RunCycleAsync(CancellationToken ct)
        {
            // <-- aqui fica o seu pipeline Binance + MatchService (já existente)
            await Task.CompletedTask;
        }
    }
}
