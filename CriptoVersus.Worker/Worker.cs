using System.Globalization;
using System.Net.Sockets;
using System.Net.Http.Json;
using BLL.NFTFutebol;
using EthicAI.EntityModel;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using static BLL.BinanceService;

namespace CriptoVersus.Worker
{
    public class Worker : BackgroundService
    {
        private readonly ILogger<Worker> _logger;
        private readonly IServiceProvider _sp;
        private readonly IHttpClientFactory _httpClientFactory;

        public Worker(ILogger<Worker> logger, IServiceProvider sp, IHttpClientFactory httpClientFactory)
        {
            _logger = logger;
            _sp = sp;
            _httpClientFactory = httpClientFactory;
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
                    await Task.Delay(TimeSpan.FromSeconds(60), stoppingToken);
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
            // ✅ Scope por ciclo (DbContext/MatchService ficam limpos e corretos)
            using var scope = _sp.CreateScope();
            var matchService = scope.ServiceProvider.GetRequiredService<MatchService>();

            // ✅ 1) Buscar Binance 24hr
            var http = _httpClientFactory.CreateClient();
            http.Timeout = TimeSpan.FromSeconds(20);

            _logger.LogInformation("📡 Binance: buscando ticker 24hr...");
            var response = await http.GetFromJsonAsync<List<Crypto>>(
                "https://api.binance.com/api/v3/ticker/24hr",
                ct);

            if (response == null || response.Count == 0)
            {
                _logger.LogWarning("⚠️ Binance retornou vazio.");
                return;
            }

            // ✅ 2) Top 6 gainers (USDT)
            var topGainers = response
                .Where(c => !string.IsNullOrWhiteSpace(c.Symbol) && c.Symbol.EndsWith("USDT", StringComparison.OrdinalIgnoreCase))
                .OrderByDescending(c =>
                {
                    // PriceChangePercent vem string
                    return decimal.TryParse(c.PriceChangePercent, NumberStyles.Any, CultureInfo.InvariantCulture, out var p)
                        ? p
                        : decimal.MinValue;
                })
                .Take(6)
                .ToList();

            if (topGainers.Count < 6)
            {
                _logger.LogWarning("⚠️ Top gainers < 6 (veio {count}). Abortando ciclo.", topGainers.Count);
                return;
            }

            _logger.LogInformation("🏆 Top gainers: {list}",
                string.Join(", ", topGainers.Select(x => $"{x.Symbol}({x.PriceChangePercent}%)")));

            // ✅ 3) SaveCurrenciesAsync(topGainers)
            _logger.LogInformation("💾 Salvando/atualizando moedas...");
            var currencies = await matchService.SaveCurrenciesAsync(topGainers);

            // ✅ 4) Verificar quantos jogos existem pendentes/andamento
            var upcoming = await matchService.GetUpcomingPendingMatchesAsync(3);
            var missing = Math.Max(0, 3 - (upcoming?.Count ?? 0));

            _logger.LogInformation("🎮 Matches pendentes/andamento: {count}. Faltando: {missing}.",
                upcoming?.Count ?? 0, missing);

            // ✅ 5) Se tiver menos que 3, criar os que faltam
            // Estratégia simples e segura: cria 3 com as 6 moedas do momento
            // (Se já existirem 3, não cria nada.)
            if (missing > 0)
            {
                _logger.LogInformation("➕ Criando partidas (modelo 3 matches) com as 6 moedas atuais...");
                var created = await matchService.CreateMatchesAsync(currencies);

                _logger.LogInformation("✅ Partidas criadas: {count}", created?.Count ?? 0);
            }

            // ✅ 6) (Opcional) Atualizar placar de jogos em andamento (bem básico)
            // OBS: sua regra final de score/encerramento ainda pode mudar,
            // então aqui só recalcula score "instantâneo" usando PercentageChange atual.
            try
            {
                var ongoing = await matchService.GetOngoingMatchesAsync();
                if (ongoing != null && ongoing.Count > 0)
                {
                    _logger.LogInformation("⏱️ Atualizando score de {count} partida(s) em andamento...", ongoing.Count);

                    foreach (var m in ongoing)
                    {
                        var a = m.TeamA?.Currency?.PercentageChange ?? 0;
                        var b = m.TeamB?.Currency?.PercentageChange ?? 0;

                        // score simples (mesma ideia do CreateMatchesAsync)
                        var scoreA = (int)Math.Floor(a / 10);
                        var scoreB = (int)Math.Floor(b / 10);

                        await matchService.UpdateMatchScoreAsync(m.MatchId, scoreA, scoreB);
                    }
                }
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "⚠️ Falha ao atualizar scores de partidas em andamento (ignorado).");
            }

            _logger.LogInformation("✅ Ciclo finalizado.");
        }
    }
}
