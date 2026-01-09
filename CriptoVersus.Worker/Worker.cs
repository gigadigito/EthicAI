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
        _logger.LogInformation("✅ CriptoVersus Worker started.");

        // pequeno atraso inicial para garantir rede/DNS ok
        await Task.Delay(TimeSpan.FromSeconds(5), stoppingToken);

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await RunCycleAsync(stoppingToken);

                // ciclo normal (não rode colado)
                await Task.Delay(TimeSpan.FromSeconds(30), stoppingToken);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "❌ Erro no ciclo do Worker");

                // backoff maior para falha de DNS/rede
                var wait = IsDnsOrNetworkTransient(ex)
                    ? TimeSpan.FromSeconds(45)
                    : TimeSpan.FromSeconds(15);

                _logger.LogWarning("⏳ Aguardando {wait}s antes de tentar novamente...", wait.TotalSeconds);
                await Task.Delay(wait, stoppingToken);
            }
        }
    }

    private static bool IsDnsOrNetworkTransient(Exception ex)
    {
        // pega a chain inteira
        for (var e = ex; e != null; e = e.InnerException)
        {
            if (e is System.Net.Sockets.SocketException) return true;

            if (e.GetType().FullName?.Contains("NpgsqlException") == true) return true;
        }
        return false;
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
