using System.Diagnostics;
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
    IHttpClientFactory httpClientFactory,
    ILogger<CandleBattlesWorker> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var seconds = Math.Clamp(options.Value.CandleBattlesIntervalSeconds, 1, 60);
        var recoveryInterval = TimeSpan.FromSeconds(seconds);
        var recoveryDueUtc = DateTime.UtcNow;
        var confirmationDueUtc = NextConfirmationDueUtc(DateTime.UtcNow);
        logger.LogInformation("Candle Battles confirmation worker started with {IntervalSeconds}s recovery cadence.", seconds);
        while (!stoppingToken.IsCancellationRequested)
        {
            var dueUtc = recoveryDueUtc <= confirmationDueUtc ? recoveryDueUtc : confirmationDueUtc;
            var delay = dueUtc - DateTime.UtcNow;
            if (delay > TimeSpan.Zero)
            {
                try { await Task.Delay(delay, stoppingToken); }
                catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
            }

            var boundaryDue = confirmationDueUtc <= recoveryDueUtc;
            var startedAtUtc = DateTime.UtcNow;
            var stopwatch = Stopwatch.StartNew();
            try
            {
                using var scope = scopeFactory.CreateScope();
                var service = scope.ServiceProvider.GetRequiredService<CandleBattlesRoundService>();
                var persistedRounds = await service.ProcessAsync(startedAtUtc, _ => Task.CompletedTask, stoppingToken);
                if (persistedRounds > 0)
                    await NotifyDashboardChangedAsync(stoppingToken);
                logger.LogInformation(
                    "[CANDLE_BATTLE_TIMING] worker_attempt_started_at_utc={StartedAtUtc} worker_attempt_completed_at_utc={CompletedAtUtc} persisted_rounds={PersistedRounds} elapsed_ms={ElapsedMs} trigger={Trigger}",
                    startedAtUtc, DateTime.UtcNow, persistedRounds, stopwatch.ElapsedMilliseconds,
                    boundaryDue ? "utc-confirmation-boundary" : "recovery");
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { }
            catch (Exception ex)
            {
                logger.LogWarning(ex, "Candle Battle confirmation cycle failed; the next cycle will retry.");
            }

            var completedAtUtc = DateTime.UtcNow;
            while (recoveryDueUtc <= completedAtUtc) recoveryDueUtc = recoveryDueUtc.Add(recoveryInterval);
            if (confirmationDueUtc <= completedAtUtc) confirmationDueUtc = NextConfirmationDueUtc(completedAtUtc);
        }
    }

    private static DateTime NextConfirmationDueUtc(DateTime nowUtc)
    {
        const long periodMs = 300_000;
        const long confirmationDelayMs = 1_500;
        var nowMs = new DateTimeOffset(nowUtc, TimeSpan.Zero).ToUnixTimeMilliseconds();
        var nextCloseMs = (nowMs / periodMs + 1) * periodMs;
        return DateTimeOffset.FromUnixTimeMilliseconds(nextCloseMs + confirmationDelayMs).UtcDateTime;
    }

    private async Task NotifyDashboardChangedAsync(CancellationToken ct)
    {
        var notifyUrl = options.Value.DashboardNotifyUrl?.Trim();
        if (string.IsNullOrWhiteSpace(notifyUrl)) return;

        try
        {
            using var client = httpClientFactory.CreateClient();
            client.Timeout = TimeSpan.FromSeconds(5);
            using var request = new HttpRequestMessage(HttpMethod.Post, notifyUrl);
            using var response = await client.SendAsync(request, ct);
            response.EnsureSuccessStatusCode();
            logger.LogDebug("[CANDLE_BATTLE_TIMING] dashboard_event_published_at_utc={PublishedAtUtc}", DateTime.UtcNow);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested) { }
        catch (Exception ex)
        {
            // The one-second Web recovery poll remains authoritative if the
            // best-effort invalidation request cannot reach the API.
            logger.LogWarning(ex, "Candle Battle result was persisted but dashboard invalidation failed; Web polling will recover it.");
        }
    }
}
