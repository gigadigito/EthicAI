using CriptoVersus.API.Services;
using DAL.NftFutebol;
using DTOs;
using EthicAI.EntityModel;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;

namespace CriptoVersus.API.Tests;

public sealed class MoneyFlowDispatcherTests
{
    [Fact]
    public async Task Dispatcher_ResolvesOneSymbolToActiveMatchGroupOnly()
    {
        var options = new DbContextOptionsBuilder<EthicAIDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString("N"))
            .Options;
        await using (var seed = new EthicAIDbContext(options))
        {
            var btc = new Currency { CurrencyId = 1, Symbol = "BTCUSDT" };
            var eth = new Currency { CurrencyId = 2, Symbol = "ETHUSDT" };
            seed.Currency.AddRange(btc, eth);
            var teamA = new Team { TeamId = 1, CurrencyId = 1, Currency = btc };
            var teamB = new Team { TeamId = 2, CurrencyId = 2, Currency = eth };
            seed.Team.AddRange(teamA, teamB);
            seed.Match.Add(new Match
            {
                MatchId = 101,
                Status = MatchStatus.Ongoing,
                TeamAId = 1,
                TeamBId = 2,
                TeamA = teamA,
                TeamB = teamB
            });
            await seed.SaveChangesAsync();
        }

        var apiOptions = Options.Create(new MoneyFlowTransportOptions
        {
            Enabled = true,
            TransportEnabled = true,
            QueueCapacity = 8,
            RegistryRefreshSeconds = 1
        });
        var metrics = new MoneyFlowMetrics();
        var hub = new CapturingHubContext();
        await using var registry = new MoneyFlowMatchRegistry(
            new TestDbContextFactory(options), apiOptions, metrics,
            NullLogger<MoneyFlowMatchRegistry>.Instance);
        using var dispatcher = new MoneyFlowDispatcher(hub, registry, apiOptions, metrics);

        await dispatcher.StartAsync(CancellationToken.None);
        var now = DateTimeOffset.UtcNow;
        await dispatcher.EnqueueAsync(new MoneyFlowTransportRequest
        {
            SourceId = "test-worker",
            Batches = [new MoneyFlowBatchDto
            {
                Symbol = "BTCUSDT", Sequence = 1, TradeCount = 1,
                WindowStartUtc = now.AddMilliseconds(-250), WindowEndUtc = now,
                EventTimeUtc = now, ReceivedAtUtc = now, PublishedAtUtc = now,
                FirstPrice = 100, LastPrice = 100, HighPrice = 100, LowPrice = 100,
                TotalBaseQuantity = 1, TakerBuyBaseQuantity = 1, TakerBuyQuote = 100
            }]
        }, CancellationToken.None);

        var delivered = await hub.Delivered.Task.WaitAsync(TimeSpan.FromSeconds(2));
        await dispatcher.StopAsync(CancellationToken.None);
        metrics.Dispose();

        Assert.Equal(global::CriptoVersus.API.Hubs.DashboardHub.MoneyFlowGroup(101), delivered.Group);
        Assert.Equal(global::CriptoVersus.API.Hubs.DashboardHub.MoneyFlowEventName, delivered.Method);
        Assert.IsType<MoneyFlowClientBatchDto>(delivered.Payload);
        Assert.Equal(101, ((MoneyFlowClientBatchDto)delivered.Payload!).MatchId);
    }

    private sealed class TestDbContextFactory(DbContextOptions<EthicAIDbContext> options) : IDbContextFactory<EthicAIDbContext>
    {
        public EthicAIDbContext CreateDbContext() => new(options);
        public Task<EthicAIDbContext> CreateDbContextAsync(CancellationToken ct = default) => Task.FromResult(new EthicAIDbContext(options));
    }

    private sealed class CapturingHubContext : IHubContext<global::CriptoVersus.API.Hubs.DashboardHub>
    {
        public TaskCompletionSource<DeliveredMessage> Delivered { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public IHubClients Clients { get; }
        public IGroupManager Groups { get; } = new NullGroupManager();

        public CapturingHubContext() => Clients = new CapturingHubClients(Delivered);
    }

    private sealed record DeliveredMessage(string Group, string Method, object? Payload);

    private sealed class CapturingHubClients(TaskCompletionSource<DeliveredMessage> delivered) : IHubClients
    {
        public IClientProxy All => throw new NotSupportedException();
        public IClientProxy AllExcept(IReadOnlyList<string> ids) => throw new NotSupportedException();
        public IClientProxy Client(string id) => throw new NotSupportedException();
        public IClientProxy Clients(IReadOnlyList<string> ids) => throw new NotSupportedException();
        public IClientProxy Group(string groupName) => new CapturingProxy(groupName, delivered);
        public IClientProxy GroupExcept(string groupName, IReadOnlyList<string> ids) => throw new NotSupportedException();
        public IClientProxy Groups(IReadOnlyList<string> names) => throw new NotSupportedException();
        public IClientProxy User(string id) => throw new NotSupportedException();
        public IClientProxy Users(IReadOnlyList<string> ids) => throw new NotSupportedException();
    }

    private sealed class CapturingProxy(string group, TaskCompletionSource<DeliveredMessage> delivered) : IClientProxy
    {
        public Task SendCoreAsync(string method, object?[] args, CancellationToken cancellationToken = default)
        {
            delivered.TrySetResult(new DeliveredMessage(group, method, args.FirstOrDefault()));
            return Task.CompletedTask;
        }
    }

    private sealed class NullGroupManager : IGroupManager
    {
        public Task AddToGroupAsync(string connectionId, string groupName, CancellationToken cancellationToken = default) => Task.CompletedTask;
        public Task RemoveFromGroupAsync(string connectionId, string groupName, CancellationToken cancellationToken = default) => Task.CompletedTask;
    }
}
