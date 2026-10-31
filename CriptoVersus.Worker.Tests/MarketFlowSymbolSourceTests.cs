using CriptoVersus.Worker.MarketFlow;
using DAL.NftFutebol;
using EthicAI.EntityModel;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;

namespace CriptoVersus.Worker.Tests;

public sealed class MarketFlowSymbolSourceTests
{
    [Fact]
    public async Task NoOngoingMatches_ReturnsOnlyExplicitSymbols()
    {
        await using var host = await CreateHostAsync();
        await SeedAsync(host, (MatchStatus.Completed, "OLDUSDT", "DONEUSDT"));

        var source = CreateSource(host, new MarketFlowOptions { Symbols = ["BTCUSDT"] });

        Assert.Equal(["BTCUSDT"], await source.GetSymbolsAsync(CancellationToken.None));
    }

    [Fact]
    public async Task NoOngoingMatchesAndNoExplicitSymbols_ReturnsEmpty()
    {
        await using var host = await CreateHostAsync();

        var source = CreateSource(host, new MarketFlowOptions());

        Assert.Empty(await source.GetSymbolsAsync(CancellationToken.None));
    }

    [Fact]
    public async Task SingleMatchWithTwoSymbols_ReturnsBoth()
    {
        await using var host = await CreateHostAsync();
        await SeedAsync(host, (MatchStatus.Ongoing, "NEARUSDT", "ZROUSDT"));

        var source = CreateSource(host, new MarketFlowOptions());

        Assert.Equal(["NEARUSDT", "ZROUSDT"], await source.GetSymbolsAsync(CancellationToken.None));
    }

    [Fact]
    public async Task SharedSymbols_AreDeduplicated()
    {
        await using var host = await CreateHostAsync();
        await SeedAsync(host,
            (MatchStatus.Ongoing, "BTCUSDT", "ETHUSDT"),
            (MatchStatus.Ongoing, "BTCUSDT", "SOLUSDT"),
            (MatchStatus.Ongoing, "ETHUSDT", "SOLUSDT"));

        var source = CreateSource(host, new MarketFlowOptions());

        Assert.Equal(["BTCUSDT", "ETHUSDT", "SOLUSDT"], await source.GetSymbolsAsync(CancellationToken.None));
    }

    [Fact]
    public async Task NewMatch_IsPickedUpOnNextRefresh()
    {
        await using var host = await CreateHostAsync();
        await SeedAsync(host, (MatchStatus.Ongoing, "BTCUSDT", "ETHUSDT"));

        var source = CreateSource(host, new MarketFlowOptions());
        Assert.Equal(["BTCUSDT", "ETHUSDT"], await source.GetSymbolsAsync(CancellationToken.None));

        await SeedAsync(host, (MatchStatus.Ongoing, "SOLUSDT", "XRPUSDT"));

        Assert.Equal(["BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT"], await source.GetSymbolsAsync(CancellationToken.None));
    }

    [Fact]
    public async Task EndedMatch_IsDroppedOnNextRefresh()
    {
        await using var host = await CreateHostAsync();
        await SeedAsync(host,
            (MatchStatus.Ongoing, "BTCUSDT", "ETHUSDT"),
            (MatchStatus.Ongoing, "SOLUSDT", "XRPUSDT"));

        var source = CreateSource(host, new MarketFlowOptions());
        Assert.Equal(4, (await source.GetSymbolsAsync(CancellationToken.None)).Count);

        using (var scope = host.Provider.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<EthicAIDbContext>();
            var ended = db.Match.Include(m => m.TeamA).Include(m => m.TeamB)
                .Single(m => m.TeamA.Currency.Symbol == "SOLUSDT");
            ended.Status = MatchStatus.Completed;
            await db.SaveChangesAsync();
        }

        Assert.Equal(["BTCUSDT", "ETHUSDT"], await source.GetSymbolsAsync(CancellationToken.None));
    }

    [Fact]
    public async Task SymbolSwap_ReplacesOldSymbols()
    {
        await using var host = await CreateHostAsync();
        await SeedAsync(host, (MatchStatus.Ongoing, "BTCUSDT", "ETHUSDT"));

        var source = CreateSource(host, new MarketFlowOptions());
        Assert.Equal(["BTCUSDT", "ETHUSDT"], await source.GetSymbolsAsync(CancellationToken.None));

        using (var scope = host.Provider.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<EthicAIDbContext>();
            var match = db.Match.Single();
            db.Remove(match);
            await db.SaveChangesAsync();
            db.Add(new Match { TeamA = Team("SOLUSDT"), TeamB = Team("XRPUSDT"), Status = MatchStatus.Ongoing });
            await db.SaveChangesAsync();
        }

        Assert.Equal(["SOLUSDT", "XRPUSDT"], await source.GetSymbolsAsync(CancellationToken.None));
    }

    [Fact]
    public async Task InvalidSymbols_AreNormalised()
    {
        await using var host = await CreateHostAsync();
        await SeedAsync(host, (MatchStatus.Ongoing, " btcusdt ", "eth"));

        var source = CreateSource(host, new MarketFlowOptions());

        Assert.Equal(["BTCUSDT", "ETHUSDT"], await source.GetSymbolsAsync(CancellationToken.None));
    }

    [Fact]
    public async Task BlankSymbols_AreIgnored()
    {
        await using var host = await CreateHostAsync();
        await SeedAsync(host, (MatchStatus.Ongoing, "   ", "BTCUSDT"));

        var source = CreateSource(host, new MarketFlowOptions());

        Assert.Equal(["BTCUSDT"], await source.GetSymbolsAsync(CancellationToken.None));
    }

    [Fact]
    public async Task MaxSymbols_IsRespectedAndExplicitSymbolsArePreserved()
    {
        await using var host = await CreateHostAsync();
        await SeedAsync(host,
            (MatchStatus.Ongoing, "AAAUSDT", "BBBUSDT"),
            (MatchStatus.Ongoing, "CCCUSDT", "DDDUSDT"));

        var source = CreateSource(host, new MarketFlowOptions
        {
            MaxSymbols = 3,
            Symbols = ["ZZZUSDT"]
        });

        var symbols = await source.GetSymbolsAsync(CancellationToken.None);

        Assert.Equal(3, symbols.Count);
        Assert.Contains("ZZZUSDT", symbols);
    }

    [Fact]
    public async Task MaxSymbols_IsDeterministicAcrossRefreshes()
    {
        await using var host = await CreateHostAsync();
        await SeedAsync(host,
            (MatchStatus.Ongoing, "AAAUSDT", "BBBUSDT"),
            (MatchStatus.Ongoing, "CCCUSDT", "DDDUSDT"));

        var source = CreateSource(host, new MarketFlowOptions { MaxSymbols = 2 });

        var first = await source.GetSymbolsAsync(CancellationToken.None);
        var second = await source.GetSymbolsAsync(CancellationToken.None);

        Assert.Equal(first, second);
    }

    [Fact]
    public async Task DuplicateSymbols_AcrossExplicitAndMatch_AreCountedOnce()
    {
        await using var host = await CreateHostAsync();
        await SeedAsync(host, (MatchStatus.Ongoing, "BTCUSDT", "ETHUSDT"));

        var source = CreateSource(host, new MarketFlowOptions
        {
            MaxSymbols = 2,
            Symbols = ["BTCUSDT", "btcusdt"]
        });

        var symbols = await source.GetSymbolsAsync(CancellationToken.None);

        Assert.Equal(["BTCUSDT", "ETHUSDT"], symbols);
    }

    private static async Task<SymbolSourceHost> CreateHostAsync()
    {
        var services = new ServiceCollection();
        var dbOptions = new DbContextOptionsBuilder<EthicAIDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString("N"))
            .Options;
        services.AddSingleton(new EthicAIDbContext(dbOptions));
        var provider = services.BuildServiceProvider();
        return new SymbolSourceHost(provider);
    }

    private static async Task SeedAsync(SymbolSourceHost host, params (MatchStatus Status, string SymbolA, string SymbolB)[] matches)
    {
        using var scope = host.Provider.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<EthicAIDbContext>();
        foreach (var (status, symbolA, symbolB) in matches)
            db.Add(new Match { TeamA = Team(symbolA), TeamB = Team(symbolB), Status = status });
        await db.SaveChangesAsync();
    }

    private static ActiveMatchMarketFlowSymbolSource CreateSource(SymbolSourceHost host, MarketFlowOptions options)
        => new(host.Provider.GetRequiredService<IServiceScopeFactory>(),
            Options.Create(options),
            NullLogger<ActiveMatchMarketFlowSymbolSource>.Instance);

    private static Team Team(string symbol)
        => new()
        {
            Currency = new Currency
            {
                Name = symbol,
                Symbol = symbol,
                LastUpdated = DateTime.UtcNow
            }
        };

    private sealed class SymbolSourceHost(ServiceProvider provider) : IAsyncDisposable
    {
        public ServiceProvider Provider { get; } = provider;

        public async ValueTask DisposeAsync() => await Provider.DisposeAsync();
    }
}
