using BLL.ArenaSentiment;
using CriptoVersus.API.Controllers;
using CriptoVersus.API.Hubs;
using CriptoVersus.API.Services;
using DAL.NftFutebol;
using DTOs;
using EthicAI.EntityModel;
using Microsoft.AspNetCore.SignalR;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;

namespace CriptoVersus.API.Tests;

public sealed class MatchMetricSnapshotsEndpointTests
{
    [Fact]
    public async Task GetMetricSnapshots_WhenRawSnapshotsExist_ReturnsRawSnapshots()
    {
        using var db = CreateDbContext();
        SeedMatchGraph(db, MatchStatus.Ongoing);

        db.MatchMetricSnapshot.AddRange(
            CreateRawSnapshot(1, 10, new DateTime(2026, 05, 28, 10, 15, 0, DateTimeKind.Utc), 125.50m, 1.25m, 100m, 10),
            CreateRawSnapshot(1, 10, new DateTime(2026, 05, 28, 10, 45, 0, DateTimeKind.Utc), 126.75m, 2.50m, 200m, 20));
        db.MatchMetricHourlyAggregate.Add(
            CreateAggregate(1, 10, "BTCUSDT", new DateTime(2026, 05, 28, 10, 0, 0, DateTimeKind.Utc), 99m, 999m, 999));
        await db.SaveChangesAsync();

        var controller = CreateController(db);
        var result = await controller.GetMetricSnapshots(1, take: 500, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var items = Assert.IsType<List<MatchMetricSnapshotDto>>(ok.Value);

        Assert.Equal(2, items.Count);
        Assert.Collection(
            items,
            first =>
            {
                Assert.Equal(new DateTime(2026, 05, 28, 10, 15, 0, DateTimeKind.Utc), first.CapturedAtUtc);
                Assert.Equal("BTCUSDT", first.TeamSymbol);
                Assert.Equal(125.50m, first.LastPrice);
                Assert.Equal(1.25m, first.PercentageChange);
                Assert.Equal(100m, first.QuoteVolume);
                Assert.Equal(10, first.TradeCount);
            },
            second =>
            {
                Assert.Equal(new DateTime(2026, 05, 28, 10, 45, 0, DateTimeKind.Utc), second.CapturedAtUtc);
                Assert.Equal(126.75m, second.LastPrice);
                Assert.Equal(2.50m, second.PercentageChange);
                Assert.Equal(200m, second.QuoteVolume);
                Assert.Equal(20, second.TradeCount);
            });
    }

    [Fact]
    public async Task GetMetricSnapshots_WhenRawSnapshotsAreMissing_ReturnsHourlyAggregates()
    {
        using var db = CreateDbContext();
        SeedMatchGraph(db, MatchStatus.Completed);

        db.MatchMetricHourlyAggregate.AddRange(
            CreateAggregate(1, 10, "BTCUSDT", new DateTime(2026, 04, 01, 10, 0, 0, DateTimeKind.Utc), 1.50m, 150m, 15.4m),
            CreateAggregate(1, 10, "BTCUSDT", new DateTime(2026, 04, 01, 11, 0, 0, DateTimeKind.Utc), 2.75m, 275m, 27.6m));
        await db.SaveChangesAsync();

        var controller = CreateController(db);
        var result = await controller.GetMetricSnapshots(1, take: 500, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var items = Assert.IsType<List<MatchMetricSnapshotDto>>(ok.Value);

        Assert.Equal(2, items.Count);
        Assert.Collection(
            items,
            first =>
            {
                Assert.Equal(new DateTime(2026, 04, 01, 10, 0, 0, DateTimeKind.Utc), first.CapturedAtUtc);
                Assert.Equal("BTCUSDT", first.TeamSymbol);
                Assert.Null(first.LastPrice);
                Assert.Equal(1.50m, first.PercentageChange);
                Assert.Equal(150m, first.QuoteVolume);
                Assert.Equal(15L, first.TradeCount);
            },
            second =>
            {
                Assert.Equal(new DateTime(2026, 04, 01, 11, 0, 0, DateTimeKind.Utc), second.CapturedAtUtc);
                Assert.Null(second.LastPrice);
                Assert.Equal(2.75m, second.PercentageChange);
                Assert.Equal(275m, second.QuoteVolume);
                Assert.Equal(28L, second.TradeCount);
            });
    }

    [Fact]
    public async Task GetMetricSnapshots_WhenNoRawOrAggregateDataExist_ReturnsEmptyList()
    {
        using var db = CreateDbContext();
        SeedMatchGraph(db, MatchStatus.Completed);

        var controller = CreateController(db);
        var result = await controller.GetMetricSnapshots(1, take: 500, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var items = Assert.IsType<List<MatchMetricSnapshotDto>>(ok.Value);

        Assert.Empty(items);
    }

    private static MatchesController CreateController(EthicAIDbContext db)
    {
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>())
            .Build();

        return new MatchesController(
            db,
            new NullDashboardHubContext(),
            new StubMatchScoreRebuildService(),
            configuration,
            new StubArenaSentimentService(),
            NullLogger<MatchesController>.Instance);
    }

    private static EthicAIDbContext CreateDbContext()
    {
        var options = new DbContextOptionsBuilder<EthicAIDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString("N"))
            .Options;

        return new EthicAIDbContext(options);
    }

    private static void SeedMatchGraph(EthicAIDbContext db, MatchStatus status)
    {
        db.Currency.Add(new Currency
        {
            CurrencyId = 100,
            Name = "Bitcoin",
            Symbol = "BTCUSDT",
            PercentageChange = 0,
            QuoteVolume = 0m,
            TradesCount = 0,
            LastUpdated = new DateTime(2026, 05, 28, 0, 0, 0, DateTimeKind.Utc)
        });

        db.Currency.Add(new Currency
        {
            CurrencyId = 200,
            Name = "Ethereum",
            Symbol = "ETHUSDT",
            PercentageChange = 0,
            QuoteVolume = 0m,
            TradesCount = 0,
            LastUpdated = new DateTime(2026, 05, 28, 0, 0, 0, DateTimeKind.Utc)
        });

        db.Team.Add(new Team { TeamId = 10, CurrencyId = 100 });
        db.Team.Add(new Team { TeamId = 20, CurrencyId = 200 });

        db.Match.Add(new Match
        {
            MatchId = 1,
            TeamAId = 10,
            TeamBId = 20,
            ScoreA = 1,
            ScoreB = 0,
            Status = status,
            StartTime = new DateTime(2026, 04, 01, 9, 0, 0, DateTimeKind.Utc),
            EndTime = status == MatchStatus.Completed
                ? new DateTime(2026, 04, 01, 12, 0, 0, DateTimeKind.Utc)
                : null
        });

        db.SaveChanges();
    }

    private static MatchMetricSnapshot CreateRawSnapshot(
        int matchId,
        int teamId,
        DateTime capturedAtUtc,
        decimal? lastPrice,
        decimal percentageChange,
        decimal quoteVolume,
        long tradeCount)
    {
        return new MatchMetricSnapshot
        {
            MatchId = matchId,
            TeamId = teamId,
            CapturedAtUtc = capturedAtUtc,
            LastPrice = lastPrice,
            PercentageChange = percentageChange,
            QuoteVolume = quoteVolume,
            TradeCount = tradeCount
        };
    }

    private static MatchMetricHourlyAggregate CreateAggregate(
        int matchId,
        int teamId,
        string symbol,
        DateTime hourBucketUtc,
        decimal averagePercentageChange,
        decimal averageQuoteVolume,
        decimal averageTradeCount)
    {
        return new MatchMetricHourlyAggregate
        {
            MatchId = matchId,
            TeamId = teamId,
            Symbol = symbol,
            HourBucketUtc = hourBucketUtc,
            AveragePercentageChange = averagePercentageChange,
            MinPercentageChange = averagePercentageChange,
            MaxPercentageChange = averagePercentageChange,
            AverageQuoteVolume = averageQuoteVolume,
            MinQuoteVolume = averageQuoteVolume,
            MaxQuoteVolume = averageQuoteVolume,
            AverageTradeCount = averageTradeCount,
            MinTradeCount = (long)Math.Floor(averageTradeCount),
            MaxTradeCount = (long)Math.Ceiling(averageTradeCount),
            SnapshotCount = 1,
            CreatedAtUtc = new DateTime(2026, 05, 28, 0, 0, 0, DateTimeKind.Utc),
            UpdatedAtUtc = new DateTime(2026, 05, 28, 0, 0, 0, DateTimeKind.Utc)
        };
    }

    private sealed class StubMatchScoreRebuildService : IMatchScoreRebuildService
    {
        public Task<MatchScoreRebuildResult> RebuildAsync(int matchId, CancellationToken ct)
            => throw new NotSupportedException();
    }

    private sealed class StubArenaSentimentService : IArenaSentimentService
    {
        public Task<ArenaPressureGoalResult> CalculateArenaPressureGoalAsync(int matchId, CancellationToken ct = default)
            => throw new NotSupportedException();

        public Task<ArenaSentimentDto> GetArenaSentimentAsync(string symbol, CancellationToken ct = default)
            => throw new NotSupportedException();

        public Task<ArenaSentimentPairDto> GetArenaSentimentForMatchAsync(string homeSymbol, string awaySymbol, CancellationToken ct = default)
            => throw new NotSupportedException();
    }

    private sealed class NullDashboardHubContext : IHubContext<DashboardHub>
    {
        public IHubClients Clients { get; } = new NullHubClients();
        public IGroupManager Groups { get; } = new NullGroupManager();
    }

    private sealed class NullHubClients : IHubClients
    {
        private static readonly IClientProxy Proxy = new NullClientProxy();

        public IClientProxy All => Proxy;
        public IClientProxy AllExcept(IReadOnlyList<string> excludedConnectionIds) => Proxy;
        public IClientProxy Client(string connectionId) => Proxy;
        public IClientProxy Clients(IReadOnlyList<string> connectionIds) => Proxy;
        public IClientProxy Group(string groupName) => Proxy;
        public IClientProxy GroupExcept(string groupName, IReadOnlyList<string> excludedConnectionIds) => Proxy;
        public IClientProxy Groups(IReadOnlyList<string> groupNames) => Proxy;
        public IClientProxy User(string userId) => Proxy;
        public IClientProxy Users(IReadOnlyList<string> userIds) => Proxy;
    }

    private sealed class NullClientProxy : IClientProxy
    {
        public Task SendCoreAsync(string method, object?[] args, CancellationToken cancellationToken = default)
            => Task.CompletedTask;
    }

    private sealed class NullGroupManager : IGroupManager
    {
        public Task AddToGroupAsync(string connectionId, string groupName, CancellationToken cancellationToken = default)
            => Task.CompletedTask;

        public Task RemoveFromGroupAsync(string connectionId, string groupName, CancellationToken cancellationToken = default)
            => Task.CompletedTask;
    }
}
