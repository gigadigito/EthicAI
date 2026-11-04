using BLL.NFTFutebol;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace CriptoVersus.Worker;

/// <summary>
/// Keeps Candle Battle confirmation delivery independent from the general
/// sixty-second worker cycle. It owns no scoring or settlement state; it only
/// advances the existing CandleBattlesRoundService against its shared tables.
/// </summary>
public sealed class CandleBattlesWorker(
    IServiceScopeFactory scopeFactory,
    IOptions<CriptoVersusWorkerOptions> options,
    ILogger<CandleBattlesWorker> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var seconds = Math.Clamp(options.Value.CandleBattlesIntervalSeconds, 1, 60);
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(seconds));
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                using var scope = scopeFactory.CreateScope();
                var service = scope.ServiceProvider.GetRequiredService<CandleBattlesRoundService>();
                await service.ProcessAsync(DateTime.UtcNow, _ => Task.CompletedTask, stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { }
            catch (Exception ex)
            {
                logger.LogWarning(ex, "Candle Battle confirmation cycle failed; the next cycle will retry.");
            }

            try { await timer.WaitForNextTickAsync(stoppingToken); }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { }
        }
    }
}
