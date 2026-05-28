using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace CriptoVersus.Worker;

public sealed class DataRetentionWorker : BackgroundService
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<DataRetentionWorker> _logger;
    private readonly DataRetentionOptions _options;
    private readonly TimeProvider _timeProvider;

    public DataRetentionWorker(
        IServiceScopeFactory scopeFactory,
        ILogger<DataRetentionWorker> logger,
        IOptions<DataRetentionOptions> options,
        TimeProvider timeProvider)
    {
        _scopeFactory = scopeFactory;
        _logger = logger;
        _options = options.Value;
        _timeProvider = timeProvider;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!_options.Enabled)
        {
            _logger.LogInformation("Data retention worker is disabled.");
            return;
        }

        var runAtHourUtc = Math.Clamp(_options.RunAtHourUtc, 0, 23);

        while (!stoppingToken.IsCancellationRequested)
        {
            var delay = ComputeDelayUntilNextRun(_timeProvider.GetUtcNow(), runAtHourUtc);
            var nextRunUtc = _timeProvider.GetUtcNow().Add(delay);

            _logger.LogInformation(
                "Next data retention run scheduled. nextRunUtc={NextRunUtc:o} dryRun={DryRun}",
                nextRunUtc,
                _options.DryRun);

            if (delay > TimeSpan.Zero)
                await Task.Delay(delay, stoppingToken);

            try
            {
                using var scope = _scopeFactory.CreateScope();
                var service = scope.ServiceProvider.GetRequiredService<DataRetentionService>();
                var summary = await service.RunOnceAsync(stoppingToken);

                _logger.LogInformation(
                    "Data retention worker cycle completed. enabled={Enabled} dryRun={DryRun} snapshotsScanned={SnapshotsScanned} rawSnapshotsDeleted={RawSnapshotsDeleted}",
                    summary.Enabled,
                    summary.DryRun,
                    summary.SnapshotsScanned,
                    summary.RawSnapshotsDeleted);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Data retention worker failed. The main worker will continue running.");
            }
        }
    }

    internal static TimeSpan ComputeDelayUntilNextRun(DateTimeOffset nowUtc, int runAtHourUtc)
    {
        var todayRun = new DateTimeOffset(
            nowUtc.Year,
            nowUtc.Month,
            nowUtc.Day,
            runAtHourUtc,
            0,
            0,
            TimeSpan.Zero);

        var nextRun = todayRun > nowUtc ? todayRun : todayRun.AddDays(1);
        return nextRun - nowUtc;
    }
}
