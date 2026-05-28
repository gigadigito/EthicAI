using CriptoVersus.Worker;
using DAL;
using DAL.NftFutebol;
using EthicAI.EntityModel;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;

namespace CriptoVersus.Worker.Tests;

public sealed class DataRetentionServiceTests
{
    [Fact]
    public async Task RunOnceAsync_AggregatesSnapshotsByHour()
    {
        using var db = CreateDbContext();
        SeedCoreGraph(db);

        var nowUtc = new DateTime(2026, 05, 28, 12, 0, 0, DateTimeKind.Utc);
        db.MatchMetricSnapshot.AddRange(
            CreateSnapshot(1, 1, new DateTime(2026, 04, 01, 10, 05, 0, DateTimeKind.Utc), 1m, 100m, 10),
            CreateSnapshot(1, 1, new DateTime(2026, 04, 01, 10, 25, 0, DateTimeKind.Utc), 3m, 300m, 30),
            CreateSnapshot(1, 1, new DateTime(2026, 04, 01, 11, 05, 0, DateTimeKind.Utc), 5m, 500m, 50));
        await db.SaveChangesAsync();

        var service = CreateService(db, nowUtc, dryRun: false);
        var summary = await service.RunOnceAsync(CancellationToken.None);

        var aggregates = await db.MatchMetricHourlyAggregate
            .OrderBy(x => x.HourBucketUtc)
            .ToListAsync();

        Assert.Equal(3, summary.SnapshotsScanned);
        Assert.Equal(2, summary.AggregateGroupsUpserted);
        Assert.Equal(3, summary.RawSnapshotsDeleted);
        Assert.Equal(2, aggregates.Count);

        var tenAm = aggregates[0];
        Assert.Equal(new DateTime(2026, 04, 01, 10, 0, 0, DateTimeKind.Utc), tenAm.HourBucketUtc);
        Assert.Equal("BTCUSDT", tenAm.Symbol);
        Assert.Equal(2m, tenAm.AveragePercentageChange);
        Assert.Equal(1m, tenAm.MinPercentageChange);
        Assert.Equal(3m, tenAm.MaxPercentageChange);
        Assert.Equal(200m, tenAm.AverageQuoteVolume);
        Assert.Equal(100m, tenAm.MinQuoteVolume);
        Assert.Equal(300m, tenAm.MaxQuoteVolume);
        Assert.Equal(20m, tenAm.AverageTradeCount);
        Assert.Equal(10, tenAm.MinTradeCount);
        Assert.Equal(30, tenAm.MaxTradeCount);
        Assert.Equal(2, tenAm.SnapshotCount);
    }

    [Fact]
    public async Task RunOnceAsync_DoesNotDeleteRecentSnapshots()
    {
        using var db = CreateDbContext();
        SeedCoreGraph(db);

        var nowUtc = new DateTime(2026, 05, 28, 12, 0, 0, DateTimeKind.Utc);
        db.MatchMetricSnapshot.AddRange(
            CreateSnapshot(1, 1, nowUtc.AddDays(-40), 1m, 100m, 10),
            CreateSnapshot(1, 1, nowUtc.AddDays(-5), 2m, 200m, 20));
        await db.SaveChangesAsync();

        var service = CreateService(db, nowUtc, dryRun: false);
        await service.RunOnceAsync(CancellationToken.None);

        Assert.Single(await db.MatchMetricSnapshot.ToListAsync());
        Assert.Single(await db.MatchMetricHourlyAggregate.ToListAsync());
        Assert.Equal(nowUtc.AddDays(-5), (await db.MatchMetricSnapshot.SingleAsync()).CapturedAtUtc);
    }

    [Fact]
    public async Task RunOnceAsync_DoesNotTouchProtectedTables()
    {
        using var db = CreateDbContext();
        SeedCoreGraph(db);
        SeedProtectedRecords(db);

        var nowUtc = new DateTime(2026, 05, 28, 12, 0, 0, DateTimeKind.Utc);
        db.MatchMetricSnapshot.Add(CreateSnapshot(1, 1, nowUtc.AddDays(-40), 1m, 100m, 10));
        await db.SaveChangesAsync();

        var service = CreateService(db, nowUtc, dryRun: false);
        await service.RunOnceAsync(CancellationToken.None);

        Assert.Single(await db.Bet.ToListAsync());
        Assert.Single(await db.Ledger.ToListAsync());
        Assert.Single(await db.Match.ToListAsync());
        Assert.Single(await db.MatchScoreEvent.ToListAsync());
        Assert.Single(await db.SocialPostHistory.ToListAsync());
    }

    [Fact]
    public async Task RunOnceAsync_IsIdempotentAcrossRepeatedRuns()
    {
        using var db = CreateDbContext();
        SeedCoreGraph(db);

        var nowUtc = new DateTime(2026, 05, 28, 12, 0, 0, DateTimeKind.Utc);
        db.MatchMetricSnapshot.AddRange(
            CreateSnapshot(1, 1, nowUtc.AddDays(-40).AddMinutes(5), 1m, 100m, 10),
            CreateSnapshot(1, 1, nowUtc.AddDays(-40).AddMinutes(25), 3m, 300m, 30));
        await db.SaveChangesAsync();

        var service = CreateService(db, nowUtc, dryRun: false);
        await service.RunOnceAsync(CancellationToken.None);
        await service.RunOnceAsync(CancellationToken.None);

        var aggregates = await db.MatchMetricHourlyAggregate.ToListAsync();
        Assert.Single(aggregates);
        Assert.Equal(2, aggregates[0].SnapshotCount);
        Assert.Equal(2m, aggregates[0].AveragePercentageChange);
        Assert.Empty(await db.MatchMetricSnapshot.ToListAsync());
    }

    [Fact]
    public async Task RunOnceAsync_DryRunDoesNotChangeDatabase()
    {
        using var db = CreateDbContext();
        SeedCoreGraph(db);

        var nowUtc = new DateTime(2026, 05, 28, 12, 0, 0, DateTimeKind.Utc);
        db.MatchMetricSnapshot.Add(CreateSnapshot(1, 1, nowUtc.AddDays(-40), 1m, 100m, 10));
        await db.SaveChangesAsync();

        var service = CreateService(db, nowUtc, dryRun: true);
        var summary = await service.RunOnceAsync(CancellationToken.None);

        Assert.True(summary.DryRun);
        Assert.Single(await db.MatchMetricSnapshot.ToListAsync());
        Assert.Empty(await db.MatchMetricHourlyAggregate.ToListAsync());
    }

    private static DataRetentionService CreateService(EthicAIDbContext db, DateTime nowUtc, bool dryRun)
    {
        return new DataRetentionService(
            db,
            NullLogger<DataRetentionService>.Instance,
            Options.Create(new DataRetentionOptions
            {
                Enabled = true,
                DryRun = dryRun,
                RawSnapshotRetentionDays = 30,
                HourlyAggregateRetentionDays = 365,
                BatchSize = 10
            }),
            new FixedTimeProvider(nowUtc));
    }

    private static EthicAIDbContext CreateDbContext()
    {
        var options = new DbContextOptionsBuilder<EthicAIDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString("N"))
            .Options;
        return new EthicAIDbContext(options);
    }

    private static void SeedCoreGraph(EthicAIDbContext db)
    {
        db.User.Add(new User
        {
            UserID = 1,
            Wallet = "wallet-1",
            Name = "Tester",
            DtCreate = new DateTime(2026, 01, 01, 0, 0, 0, DateTimeKind.Utc),
            DtUpdate = new DateTime(2026, 01, 01, 0, 0, 0, DateTimeKind.Utc)
        });

        db.Currency.Add(new Currency
        {
            CurrencyId = 1,
            Name = "Bitcoin",
            Symbol = "BTCUSDT",
            PercentageChange = 0,
            QuoteVolume = 0,
            TradesCount = 0,
            LastUpdated = new DateTime(2026, 01, 01, 0, 0, 0, DateTimeKind.Utc)
        });

        db.Team.Add(new Team
        {
            TeamId = 1,
            CurrencyId = 1
        });

        db.Match.Add(new Match
        {
            MatchId = 1,
            TeamAId = 1,
            TeamBId = 1,
            ScoreA = 0,
            ScoreB = 0,
            Status = MatchStatus.Completed
        });

        db.SaveChanges();
    }

    private static void SeedProtectedRecords(EthicAIDbContext db)
    {
        db.Bet.Add(new Bet
        {
            BetId = 1,
            MatchId = 1,
            TeamId = 1,
            UserId = 1,
            Position = 1,
            Amount = 10m,
            BetTime = new DateTime(2026, 01, 01, 0, 0, 0, DateTimeKind.Utc),
            Claimed = false
        });

        db.Ledger.Add(new Ledger
        {
            Id = 1,
            UserId = 1,
            Type = "BET",
            Amount = 10m,
            BalanceBefore = 100m,
            BalanceAfter = 90m,
            CreatedAt = new DateTime(2026, 01, 01, 0, 0, 0, DateTimeKind.Utc)
        });

        db.MatchScoreEvent.Add(new MatchScoreEvent
        {
            MatchScoreEventId = 1,
            MatchId = 1,
            TeamId = 1,
            RuleType = MatchScoringRuleType.PercentThreshold,
            EventType = "GOAL",
            Points = 1,
            EventSequence = 1,
            Description = "Goal event",
            EventTimeUtc = new DateTime(2026, 01, 01, 0, 0, 0, DateTimeKind.Utc)
        });

        db.SocialPostHistory.Add(new SocialPostHistory
        {
            Id = 1,
            MatchId = 1,
            Platform = "x",
            PostText = "published",
            CreatedAt = new DateTime(2026, 01, 01, 0, 0, 0, DateTimeKind.Utc)
        });

        db.SaveChanges();
    }

    private static MatchMetricSnapshot CreateSnapshot(
        int matchId,
        int teamId,
        DateTime capturedAtUtc,
        decimal percentageChange,
        decimal quoteVolume,
        long tradeCount)
    {
        return new MatchMetricSnapshot
        {
            MatchId = matchId,
            TeamId = teamId,
            CapturedAtUtc = capturedAtUtc,
            PercentageChange = percentageChange,
            QuoteVolume = quoteVolume,
            TradeCount = tradeCount
        };
    }

    private sealed class FixedTimeProvider : TimeProvider
    {
        private readonly DateTimeOffset _utcNow;

        public FixedTimeProvider(DateTime utcNow)
        {
            _utcNow = new DateTimeOffset(utcNow, TimeSpan.Zero);
        }

        public override DateTimeOffset GetUtcNow() => _utcNow;
    }
}
