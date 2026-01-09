using System.Globalization;
using System.Net.Http.Json;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.DependencyInjection;
using BLL.NFTFutebol;
using static BLL.BinanceService;

namespace CriptoVersus.Worker;

public sealed class Worker : BackgroundService
{
    private readonly ILogger<Worker> _logger;
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly IHttpClientFactory _httpClientFactory;

    private const int INTERVAL_SECONDS = 30;
    private const int TOP_GAINERS = 6;
    private const int DESIRED_MATCHES = 3;

    public Worker(
        ILogger<Worker> logger,
        IServiceScopeFactory scopeFactory,
        IHttpClientFactory httpClientFactory)
    {
        _logger = logger;
        _scopeFactory = scopeFactory;
        _httpClientFactory = httpClientFactory;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("🟢 CriptoVersus Worker iniciado");

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await RunCycleAsync(stoppingToken);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "❌ Erro no ciclo do Worker");

                // Backoff maior quando for erro de rede/DNS
                var wait = ex is System.Net.Sockets.SocketException
                           || ex.InnerException is System.Net.Sockets.SocketException
                           ? TimeSpan.FromSeconds(30)
                           : TimeSpan.FromSeconds(10);

                await Task.Delay(wait, stoppingToken);
            }

            await Task.Delay(TimeSpan.FromSeconds(INTERVAL_SECONDS), stoppingToken);
        }
    }

    private async Task RunCycleAsync(CancellationToken ct)
    {
        using var scope = _scopeFactory.CreateScope();
        var matchService = scope.ServiceProvider.GetRequiredService<MatchService>();

        var http = _httpClientFactory.CreateClient();
        var response = await http.GetFromJsonAsync<List<Crypto>>(
            "https://api.binance.com/api/v3/ticker/24hr",
            ct);

        if (response == null || response.Count == 0)
        {
            _logger.LogWarning("⚠️ Binance retornou lista vazia");
            return;
        }

        var topGainers = response
            .Where(c => c.Symbol != null && c.Symbol.EndsWith("USDT"))
            .OrderByDescending(c =>
                double.TryParse(c.PriceChangePercent, NumberStyles.Any, CultureInfo.InvariantCulture, out var v)
                    ? v
                    : double.MinValue)
            .Take(TOP_GAINERS)
            .ToList();

        var currencies = await matchService.SaveCurrenciesAsync(topGainers);

        var existingMatches = await matchService.GetUpcomingPendingMatchesAsync(DESIRED_MATCHES);

        if (existingMatches.Count < DESIRED_MATCHES)
        {
            await matchService.CreateMatchesAsync(currencies);

            _logger.LogInformation(
                "🎮 Jogos criados. Existentes={Existing}, Alvo={Target}",
                existingMatches.Count,
                DESIRED_MATCHES);
        }
        else
        {
            _logger.LogInformation("✅ Jogos suficientes. Total={Total}", existingMatches.Count);
        }
    }
}
