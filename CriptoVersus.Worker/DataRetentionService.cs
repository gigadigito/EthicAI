using EthicAI.EntityModel;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace CriptoVersus.Worker;

public sealed class DataRetentionService
{
    private readonly EthicAIDbContext _db;
    private readonly ILogger<DataRetentionService> _logger;
    private readonly DataRetentionOptions _options;
    private readonly TimeProvider _timeProvider;

    public DataRetentionService(
        EthicAIDbContext db,
        ILogger<DataRetentionService> logger,
        IOptions<DataRetentionOptions> options,
        TimeProvider timeProvider)
    {
        _db = db;
        _logger = logger;
        _options = options.Value;
        _timeProvider = timeProvider;
    }

    public async Task<DataRetentionRunSummary> RunOnceAsync(CancellationToken ct)
    {
        if (!_options.Enabled)
        {
            _logger.LogInformation("Data retention skipped because it is disabled.");
            return DataRetentionRunSummary.Disabled;
        }

        var nowUtc = _timeProvider.GetUtcNow().UtcDateTime;
        var rawCutoffUtc = nowUtc.AddDays(-Math.Max(_options.RawSnapshotRetentionDays, 1));
        var aggregateCutoffUtc = nowUtc.AddDays(-Math.Max(_options.HourlyAggregateRetentionDays, 1));
        var batchSize = Math.Max(_options.BatchSize, 1);

        _logger.LogInformation(
            "Data retention started. dryRun={DryRun} rawCutoffUtc={RawCutoffUtc:o} aggregateCutoffUtc={AggregateCutoffUtc:o} batchSize={BatchSize}",
            _options.DryRun,
            rawCutoffUtc,
            aggregateCutoffUtc,
            batchSize);

        var totalSnapshotsScanned = 0;
        var totalAggregateGroups = 0;
        var totalSnapshotsDeleted = 0;
        var totalHourlyAggregatesDeleted = 0;
        DateTime? lastCapturedAtUtc = null;
        long? lastSnapshotId = null;

        while (!ct.IsCancellationRequested)
        {
            var batch = await LoadEligibleRawSnapshotsAsync(
                rawCutoffUtc,
                batchSize,
                lastCapturedAtUtc,
                lastSnapshotId,
                ct);
            if (batch.Count == 0)
                break;

            totalSnapshotsScanned += batch.Count;

            var groupedAggregates = BuildHourlyAggregates(batch, nowUtc);
            totalAggregateGroups += groupedAggregates.Count;

            if (_options.DryRun)
            {
                _logger.LogInformation(
                    "Data retention dry-run batch. snapshotsEligible={SnapshotsEligible} aggregateGroups={AggregateGroups} earliestCapturedAtUtc={EarliestCapturedAtUtc:o} latestCapturedAtUtc={LatestCapturedAtUtc:o}",
                    batch.Count,
                    groupedAggregates.Count,
                    batch[0].CapturedAtUtc,
                    batch[^1].CapturedAtUtc);

                lastCapturedAtUtc = batch[^1].CapturedAtUtc;
                lastSnapshotId = batch[^1].MatchMetricSnapshotId;
                continue;
            }

            await using var transaction = _db.Database.IsRelational()
                ? await _db.Database.BeginTransactionAsync(ct)
                : null;

            if (_db.Database.IsNpgsql())
            {
                foreach (var aggregate in groupedAggregates)
                    await UpsertAggregateWithPostgresAsync(aggregate, ct);
            }
            else
            {
                await UpsertAggregateWithEfFallbackAsync(groupedAggregates, ct);
            }

            var deletedSnapshotCount = await DeleteRawSnapshotsAsync(batch.Select(x => x.MatchMetricSnapshotId).ToArray(), ct);
            totalSnapshotsDeleted += deletedSnapshotCount;

            if (transaction is not null)
                await transaction.CommitAsync(ct);

            _logger.LogInformation(
                "Data retention batch committed. aggregateGroups={AggregateGroups} rawSnapshotsDeleted={RawSnapshotsDeleted}",
                groupedAggregates.Count,
                deletedSnapshotCount);
        }

        totalHourlyAggregatesDeleted = await DeleteExpiredHourlyAggregatesAsync(aggregateCutoffUtc, batchSize, ct);

        var summary = new DataRetentionRunSummary(
            Enabled: true,
            DryRun: _options.DryRun,
            SnapshotsScanned: totalSnapshotsScanned,
            AggregateGroupsUpserted: totalAggregateGroups,
            RawSnapshotsDeleted: totalSnapshotsDeleted,
            HourlyAggregatesDeleted: totalHourlyAggregatesDeleted);

        _logger.LogInformation(
            "Data retention finished. dryRun={DryRun} snapshotsScanned={SnapshotsScanned} aggregateGroupsUpserted={AggregateGroupsUpserted} rawSnapshotsDeleted={RawSnapshotsDeleted} hourlyAggregatesDeleted={HourlyAggregatesDeleted}",
            summary.DryRun,
            summary.SnapshotsScanned,
            summary.AggregateGroupsUpserted,
            summary.RawSnapshotsDeleted,
            summary.HourlyAggregatesDeleted);

        return summary;
    }

    internal static List<HourlyAggregateUpsertRow> BuildHourlyAggregates(
        IReadOnlyCollection<RawSnapshotRow> snapshots,
        DateTime nowUtc)
    {
        return snapshots
            .GroupBy(snapshot => new HourlyAggregateKey(
                snapshot.MatchId,
                snapshot.TeamId,
                snapshot.Symbol,
                BucketToHour(snapshot.CapturedAtUtc)))
            .Select(group =>
            {
                var percentageChanges = group.Select(x => x.PercentageChange).ToArray();
                var quoteVolumes = group.Select(x => x.QuoteVolume).ToArray();
                var tradeCounts = group.Select(x => x.TradeCount).ToArray();

                return new HourlyAggregateUpsertRow(
                    MatchId: group.Key.MatchId,
                    TeamId: group.Key.TeamId,
                    Symbol: group.Key.Symbol,
                    HourBucketUtc: group.Key.HourBucketUtc,
                    AveragePercentageChange: percentageChanges.Average(),
                    MinPercentageChange: percentageChanges.Min(),
                    MaxPercentageChange: percentageChanges.Max(),
                    AverageQuoteVolume: quoteVolumes.Average(),
                    MinQuoteVolume: quoteVolumes.Min(),
                    MaxQuoteVolume: quoteVolumes.Max(),
                    AverageTradeCount: tradeCounts.Average(x => Convert.ToDecimal(x)),
                    MinTradeCount: tradeCounts.Min(),
                    MaxTradeCount: tradeCounts.Max(),
                    SnapshotCount: group.Count(),
                    CreatedAtUtc: nowUtc,
                    UpdatedAtUtc: nowUtc);
            })
            .OrderBy(x => x.MatchId)
            .ThenBy(x => x.TeamId)
            .ThenBy(x => x.HourBucketUtc)
            .ToList();
    }

    private async Task<List<RawSnapshotRow>> LoadEligibleRawSnapshotsAsync(
        DateTime rawCutoffUtc,
        int batchSize,
        DateTime? lastCapturedAtUtc,
        long? lastSnapshotId,
        CancellationToken ct)
    {
        return await (
            from snapshot in _db.MatchMetricSnapshot.AsNoTracking()
            join team in _db.Team.AsNoTracking() on snapshot.TeamId equals team.TeamId
            join currency in _db.Currency.AsNoTracking() on team.CurrencyId equals currency.CurrencyId
            where snapshot.CapturedAtUtc < rawCutoffUtc
                && (!lastCapturedAtUtc.HasValue
                    || snapshot.CapturedAtUtc > lastCapturedAtUtc.Value
                    || (snapshot.CapturedAtUtc == lastCapturedAtUtc.Value
                        && snapshot.MatchMetricSnapshotId > lastSnapshotId))
            orderby snapshot.CapturedAtUtc, snapshot.MatchMetricSnapshotId
            select new RawSnapshotRow(
                snapshot.MatchMetricSnapshotId,
                snapshot.MatchId,
                snapshot.TeamId,
                currency.Symbol,
                snapshot.CapturedAtUtc,
                snapshot.PercentageChange,
                snapshot.QuoteVolume,
                snapshot.TradeCount))
            .Take(batchSize)
            .ToListAsync(ct);
    }

    private async Task UpsertAggregateWithPostgresAsync(HourlyAggregateUpsertRow aggregate, CancellationToken ct)
    {
        await _db.Database.ExecuteSqlInterpolatedAsync($@"
INSERT INTO match_metric_hourly_aggregate
    (cd_match, cd_team, tx_symbol, dt_hour_bucket,
     nr_avg_percentage_change, nr_min_percentage_change, nr_max_percentage_change,
     nr_avg_quote_volume, nr_min_quote_volume, nr_max_quote_volume,
     nr_avg_trade_count, nr_min_trade_count, nr_max_trade_count,
     nr_snapshot_count, dt_created_at, dt_updated_at)
VALUES
    ({aggregate.MatchId}, {aggregate.TeamId}, {aggregate.Symbol}, {aggregate.HourBucketUtc},
     {aggregate.AveragePercentageChange}, {aggregate.MinPercentageChange}, {aggregate.MaxPercentageChange},
     {aggregate.AverageQuoteVolume}, {aggregate.MinQuoteVolume}, {aggregate.MaxQuoteVolume},
     {aggregate.AverageTradeCount}, {aggregate.MinTradeCount}, {aggregate.MaxTradeCount},
     {aggregate.SnapshotCount}, {aggregate.CreatedAtUtc}, {aggregate.UpdatedAtUtc})
ON CONFLICT (cd_match, cd_team, tx_symbol, dt_hour_bucket) DO UPDATE
SET nr_avg_percentage_change =
        ((match_metric_hourly_aggregate.nr_avg_percentage_change * match_metric_hourly_aggregate.nr_snapshot_count)
         + (EXCLUDED.nr_avg_percentage_change * EXCLUDED.nr_snapshot_count))
        / NULLIF(match_metric_hourly_aggregate.nr_snapshot_count + EXCLUDED.nr_snapshot_count, 0),
    nr_min_percentage_change = LEAST(match_metric_hourly_aggregate.nr_min_percentage_change, EXCLUDED.nr_min_percentage_change),
    nr_max_percentage_change = GREATEST(match_metric_hourly_aggregate.nr_max_percentage_change, EXCLUDED.nr_max_percentage_change),
    nr_avg_quote_volume =
        ((match_metric_hourly_aggregate.nr_avg_quote_volume * match_metric_hourly_aggregate.nr_snapshot_count)
         + (EXCLUDED.nr_avg_quote_volume * EXCLUDED.nr_snapshot_count))
        / NULLIF(match_metric_hourly_aggregate.nr_snapshot_count + EXCLUDED.nr_snapshot_count, 0),
    nr_min_quote_volume = LEAST(match_metric_hourly_aggregate.nr_min_quote_volume, EXCLUDED.nr_min_quote_volume),
    nr_max_quote_volume = GREATEST(match_metric_hourly_aggregate.nr_max_quote_volume, EXCLUDED.nr_max_quote_volume),
    nr_avg_trade_count =
        ((match_metric_hourly_aggregate.nr_avg_trade_count * match_metric_hourly_aggregate.nr_snapshot_count)
         + (EXCLUDED.nr_avg_trade_count * EXCLUDED.nr_snapshot_count))
        / NULLIF(match_metric_hourly_aggregate.nr_snapshot_count + EXCLUDED.nr_snapshot_count, 0),
    nr_min_trade_count = LEAST(match_metric_hourly_aggregate.nr_min_trade_count, EXCLUDED.nr_min_trade_count),
    nr_max_trade_count = GREATEST(match_metric_hourly_aggregate.nr_max_trade_count, EXCLUDED.nr_max_trade_count),
    nr_snapshot_count = match_metric_hourly_aggregate.nr_snapshot_count + EXCLUDED.nr_snapshot_count,
    dt_updated_at = EXCLUDED.dt_updated_at;", ct);
    }

    private async Task UpsertAggregateWithEfFallbackAsync(
        IReadOnlyCollection<HourlyAggregateUpsertRow> aggregates,
        CancellationToken ct)
    {
        var keys = aggregates
            .Select(x => new HourlyAggregateKey(x.MatchId, x.TeamId, x.Symbol, x.HourBucketUtc))
            .ToArray();

        var matchIds = keys.Select(x => x.MatchId).Distinct().ToArray();
        var teamIds = keys.Select(x => x.TeamId).Distinct().ToArray();
        var hourBuckets = keys.Select(x => x.HourBucketUtc).Distinct().ToArray();
        var symbols = keys.Select(x => x.Symbol).Distinct(StringComparer.OrdinalIgnoreCase).ToArray();

        var existing = await _db.MatchMetricHourlyAggregate
            .Where(x => matchIds.Contains(x.MatchId)
                && teamIds.Contains(x.TeamId)
                && hourBuckets.Contains(x.HourBucketUtc)
                && symbols.Contains(x.Symbol))
            .ToListAsync(ct);

        var existingByKey = existing.ToDictionary(
            x => new HourlyAggregateKey(x.MatchId, x.TeamId, x.Symbol, x.HourBucketUtc));

        foreach (var aggregate in aggregates)
        {
            var key = new HourlyAggregateKey(aggregate.MatchId, aggregate.TeamId, aggregate.Symbol, aggregate.HourBucketUtc);
            if (existingByKey.TryGetValue(key, out var current))
            {
                MergeAggregate(current, aggregate);
                continue;
            }

            _db.MatchMetricHourlyAggregate.Add(new DAL.NftFutebol.MatchMetricHourlyAggregate
            {
                MatchId = aggregate.MatchId,
                TeamId = aggregate.TeamId,
                Symbol = aggregate.Symbol,
                HourBucketUtc = aggregate.HourBucketUtc,
                AveragePercentageChange = aggregate.AveragePercentageChange,
                MinPercentageChange = aggregate.MinPercentageChange,
                MaxPercentageChange = aggregate.MaxPercentageChange,
                AverageQuoteVolume = aggregate.AverageQuoteVolume,
                MinQuoteVolume = aggregate.MinQuoteVolume,
                MaxQuoteVolume = aggregate.MaxQuoteVolume,
                AverageTradeCount = aggregate.AverageTradeCount,
                MinTradeCount = aggregate.MinTradeCount,
                MaxTradeCount = aggregate.MaxTradeCount,
                SnapshotCount = aggregate.SnapshotCount,
                CreatedAtUtc = aggregate.CreatedAtUtc,
                UpdatedAtUtc = aggregate.UpdatedAtUtc
            });
        }

        await _db.SaveChangesAsync(ct);
    }

    private static void MergeAggregate(DAL.NftFutebol.MatchMetricHourlyAggregate current, HourlyAggregateUpsertRow incoming)
    {
        var totalCount = current.SnapshotCount + incoming.SnapshotCount;
        current.AveragePercentageChange = WeightedAverage(
            current.AveragePercentageChange,
            current.SnapshotCount,
            incoming.AveragePercentageChange,
            incoming.SnapshotCount);
        current.MinPercentageChange = Math.Min(current.MinPercentageChange, incoming.MinPercentageChange);
        current.MaxPercentageChange = Math.Max(current.MaxPercentageChange, incoming.MaxPercentageChange);
        current.AverageQuoteVolume = WeightedAverage(
            current.AverageQuoteVolume,
            current.SnapshotCount,
            incoming.AverageQuoteVolume,
            incoming.SnapshotCount);
        current.MinQuoteVolume = Math.Min(current.MinQuoteVolume, incoming.MinQuoteVolume);
        current.MaxQuoteVolume = Math.Max(current.MaxQuoteVolume, incoming.MaxQuoteVolume);
        current.AverageTradeCount = WeightedAverage(
            current.AverageTradeCount,
            current.SnapshotCount,
            incoming.AverageTradeCount,
            incoming.SnapshotCount);
        current.MinTradeCount = Math.Min(current.MinTradeCount, incoming.MinTradeCount);
        current.MaxTradeCount = Math.Max(current.MaxTradeCount, incoming.MaxTradeCount);
        current.SnapshotCount = totalCount;
        current.UpdatedAtUtc = incoming.UpdatedAtUtc;
    }

    private async Task<int> DeleteRawSnapshotsAsync(long[] snapshotIds, CancellationToken ct)
    {
        if (_db.Database.IsRelational())
        {
            return await _db.MatchMetricSnapshot
                .Where(x => snapshotIds.Contains(x.MatchMetricSnapshotId))
                .ExecuteDeleteAsync(ct);
        }

        var entities = await _db.MatchMetricSnapshot
            .Where(x => snapshotIds.Contains(x.MatchMetricSnapshotId))
            .ToListAsync(ct);
        _db.MatchMetricSnapshot.RemoveRange(entities);
        await _db.SaveChangesAsync(ct);
        return entities.Count;
    }

    private async Task<int> DeleteExpiredHourlyAggregatesAsync(DateTime aggregateCutoffUtc, int batchSize, CancellationToken ct)
    {
        if (_options.DryRun)
        {
            var eligibleCount = await _db.MatchMetricHourlyAggregate
                .AsNoTracking()
                .CountAsync(x => x.HourBucketUtc < aggregateCutoffUtc, ct);

            if (eligibleCount > 0)
            {
                _logger.LogInformation(
                    "Data retention dry-run aggregate cleanup. hourlyAggregatesEligibleToDelete={HourlyAggregatesEligibleToDelete}",
                    eligibleCount);
            }

            return eligibleCount;
        }

        var deleted = 0;

        while (!ct.IsCancellationRequested)
        {
            var batchIds = await _db.MatchMetricHourlyAggregate
                .AsNoTracking()
                .Where(x => x.HourBucketUtc < aggregateCutoffUtc)
                .OrderBy(x => x.HourBucketUtc)
                .ThenBy(x => x.Id)
                .Select(x => x.Id)
                .Take(batchSize)
                .ToListAsync(ct);

            if (batchIds.Count == 0)
                break;

            var batchDeleted = _db.Database.IsRelational()
                ? await _db.MatchMetricHourlyAggregate.Where(x => batchIds.Contains(x.Id)).ExecuteDeleteAsync(ct)
                : await DeleteExpiredHourlyAggregatesWithFallbackAsync(batchIds, ct);

            deleted += batchDeleted;
        }

        return deleted;
    }

    private async Task<int> DeleteExpiredHourlyAggregatesWithFallbackAsync(List<long> batchIds, CancellationToken ct)
    {
        var entities = await _db.MatchMetricHourlyAggregate
            .Where(x => batchIds.Contains(x.Id))
            .ToListAsync(ct);
        _db.MatchMetricHourlyAggregate.RemoveRange(entities);
        await _db.SaveChangesAsync(ct);
        return entities.Count;
    }

    private static DateTime BucketToHour(DateTime value)
    {
        var utc = value.Kind switch
        {
            DateTimeKind.Utc => value,
            DateTimeKind.Unspecified => DateTime.SpecifyKind(value, DateTimeKind.Utc),
            _ => value.ToUniversalTime()
        };

        return new DateTime(utc.Year, utc.Month, utc.Day, utc.Hour, 0, 0, DateTimeKind.Utc);
    }

    private static decimal WeightedAverage(decimal currentAverage, int currentCount, decimal incomingAverage, int incomingCount)
    {
        var totalCount = currentCount + incomingCount;
        if (totalCount <= 0)
            return 0m;

        return ((currentAverage * currentCount) + (incomingAverage * incomingCount)) / totalCount;
    }

    internal sealed record RawSnapshotRow(
        long MatchMetricSnapshotId,
        int MatchId,
        int TeamId,
        string Symbol,
        DateTime CapturedAtUtc,
        decimal PercentageChange,
        decimal QuoteVolume,
        long TradeCount);

    internal sealed record HourlyAggregateKey(
        int MatchId,
        int TeamId,
        string Symbol,
        DateTime HourBucketUtc);

    internal sealed record HourlyAggregateUpsertRow(
        int MatchId,
        int TeamId,
        string Symbol,
        DateTime HourBucketUtc,
        decimal AveragePercentageChange,
        decimal MinPercentageChange,
        decimal MaxPercentageChange,
        decimal AverageQuoteVolume,
        decimal MinQuoteVolume,
        decimal MaxQuoteVolume,
        decimal AverageTradeCount,
        long MinTradeCount,
        long MaxTradeCount,
        int SnapshotCount,
        DateTime CreatedAtUtc,
        DateTime UpdatedAtUtc);
}

public sealed record DataRetentionRunSummary(
    bool Enabled,
    bool DryRun,
    int SnapshotsScanned,
    int AggregateGroupsUpserted,
    int RawSnapshotsDeleted,
    int HourlyAggregatesDeleted)
{
    public static readonly DataRetentionRunSummary Disabled = new(
        Enabled: false,
        DryRun: false,
        SnapshotsScanned: 0,
        AggregateGroupsUpserted: 0,
        RawSnapshotsDeleted: 0,
        HourlyAggregatesDeleted: 0);
}
