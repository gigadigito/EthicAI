using CriptoVersus.API.Services;
using DAL.NftFutebol;
using DTOs;
using EthicAI.EntityModel;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;

namespace CriptoVersus.API.Tests;

public sealed class SocialWinRate24hServiceTests
{
    [Fact]
    public async Task GetAsync_CalculatesWinRateAndIgnoresDrawsInDecisions()
    {
        using var db = CreateDbContext();

        SeedCompletedMatch(db, 1, "BTCUSDT", "ETHUSDT", winnerIsA: true, scoreA: 2, scoreB: 1, endTimeUtc: DateTime.UtcNow.AddHours(-1));
        SeedCompletedMatch(db, 2, "BTC", "SOLUSDT", winnerIsA: false, scoreA: 1, scoreB: 2, endTimeUtc: DateTime.UtcNow.AddHours(-2));
        SeedCompletedMatch(db, 3, "BTCUSDT", "ADAUSDT", winnerIsA: true, scoreA: 3, scoreB: 1, endTimeUtc: DateTime.UtcNow.AddHours(-3));
        SeedCompletedMatch(db, 4, "BTC", "XRPUSDT", winnerIsA: null, scoreA: 1, scoreB: 1, endTimeUtc: DateTime.UtcNow.AddHours(-4));

        var service = CreateService(db);

        var result = await service.GetAsync();

        Assert.True(result.CanPost);
        Assert.Equal(4, result.TotalClosedMatches);
        var btc = Assert.Single(result.Assets, asset => asset.Symbol == "BTC");
        Assert.Equal(2, btc.Wins);
        Assert.Equal(1, btc.Losses);
        Assert.Equal(1, btc.Draws);
        Assert.Equal(3, btc.Decisions);
        Assert.Equal(4, btc.TotalMatches);
        Assert.Equal(66.7m, btc.WinRate);
    }

    [Fact]
    public async Task GetAsync_ExcludesMatchesOutsideWindowAndNonCompletedMatches()
    {
        using var db = CreateDbContext();

        SeedCompletedMatch(db, 1, "SOLUSDT", "ETHUSDT", winnerIsA: true, scoreA: 2, scoreB: 0, endTimeUtc: DateTime.UtcNow.AddHours(-1));
        SeedCompletedMatch(db, 2, "SOLUSDT", "ADAUSDT", winnerIsA: true, scoreA: 2, scoreB: 1, endTimeUtc: DateTime.UtcNow.AddHours(-2));
        SeedCompletedMatch(db, 3, "SOLUSDT", "XRPUSDT", winnerIsA: false, scoreA: 1, scoreB: 2, endTimeUtc: DateTime.UtcNow.AddHours(-3));
        SeedCompletedMatch(db, 4, "SOLUSDT", "BNBUSDT", winnerIsA: true, scoreA: 1, scoreB: 0, endTimeUtc: DateTime.UtcNow.AddHours(-25));
        SeedMatch(db, 5, "SOLUSDT", "TRXUSDT", MatchStatus.Ongoing, scoreA: 0, scoreB: 0, startTimeUtc: DateTime.UtcNow.AddHours(-1), endTimeUtc: null, winnerIsA: null);

        var service = CreateService(db);

        var result = await service.GetAsync();

        var sol = Assert.Single(result.Assets, asset => asset.Symbol == "SOL");
        Assert.Equal(3, sol.Decisions);
        Assert.Equal(3, sol.TotalMatches);
        Assert.Equal(66.7m, sol.WinRate);
        Assert.Equal(3, result.TotalClosedMatches);
    }

    [Fact]
    public async Task GetAsync_ReturnsStableEmptyResponseWhenNoMatchesExist()
    {
        using var db = CreateDbContext();
        var service = CreateService(db);

        var result = await service.GetAsync();

        Assert.False(result.CanPost);
        Assert.Equal("Not enough assets with valid decisions in the last 24 hours.", result.SkipReason);
        Assert.Empty(result.Assets);
        Assert.Equal(0, result.TotalClosedMatches);
        Assert.Equal(0, result.TotalAssets);
        Assert.Null(result.SuggestedText);
    }

    [Fact]
    public async Task GetAsync_AppliesMinimumDecisions()
    {
        using var db = CreateDbContext();

        SeedCompletedMatch(db, 1, "NEARUSDT", "ETHUSDT", winnerIsA: true, scoreA: 1, scoreB: 0, endTimeUtc: DateTime.UtcNow.AddHours(-1));
        SeedCompletedMatch(db, 2, "NEARUSDT", "ADAUSDT", winnerIsA: false, scoreA: 1, scoreB: 2, endTimeUtc: DateTime.UtcNow.AddHours(-2));

        var service = CreateService(db);

        var result = await service.GetAsync();

        Assert.False(result.CanPost);
        Assert.Empty(result.Assets);
        Assert.Equal(0, result.TotalAssets);
        Assert.Equal("Not enough assets with valid decisions in the last 24 hours.", result.SkipReason);
    }

    [Fact]
    public async Task GetAsync_SortsByWinRateWinsDecisionsAndSymbol()
    {
        using var db = CreateDbContext();

        SeedWins(db, "ZZZUSDT", 4, 0, startMatchId: 100);
        SeedWins(db, "AAAUSDT", 3, 0, startMatchId: 200);
        SeedWins(db, "MMMUSDT", 2, 1, startMatchId: 300);

        var service = CreateService(db);

        var result = await service.GetAsync();
        var symbols = result.Assets.Select(x => x.Symbol).ToArray();

        Assert.Equal(new[] { "ZZZ", "AAA", "MMM" }, symbols);
        Assert.Equal(100m, result.Assets[0].WinRate);
        Assert.Equal(100m, result.Assets[1].WinRate);
        Assert.True(result.Assets[0].Wins > result.Assets[1].Wins);
    }

    [Fact]
    public async Task GetAsync_SortsAlphabeticallyWhenMetricsTie()
    {
        using var db = CreateDbContext();

        SeedWins(db, "BBBUSDT", 3, 0, startMatchId: 100);
        SeedWins(db, "AAAUSDT", 3, 0, startMatchId: 200);

        var service = CreateService(db);

        var result = await service.GetAsync();
        var symbols = result.Assets.Select(x => x.Symbol).ToArray();

        Assert.Equal(new[] { "AAA", "BBB" }, symbols);
    }

    [Fact]
    public async Task GetAsync_LimitsToTenAssets()
    {
        using var db = CreateDbContext();

        for (var index = 0; index < 11; index++)
        {
            var symbol = $"T{index:00}USDT";
            SeedWins(db, symbol, 3, 0, startMatchId: 1000 + (index * 10));
        }

        var service = CreateService(db);

        var result = await service.GetAsync();

        Assert.Equal(10, result.Assets.Count);
        Assert.Equal("T00", result.Assets[0].Symbol);
        Assert.Equal("T09", result.Assets[9].Symbol);
    }

    [Fact]
    public async Task GetAsync_NormalizesSymbolVariantsIntoOneBucket()
    {
        using var db = CreateDbContext();

        SeedCompletedMatch(db, 1, "BTCUSDT", "ETHUSDT", winnerIsA: true, scoreA: 2, scoreB: 0, endTimeUtc: DateTime.UtcNow.AddHours(-1));
        SeedCompletedMatch(db, 2, "BTC", "SOLUSDT", winnerIsA: true, scoreA: 1, scoreB: 0, endTimeUtc: DateTime.UtcNow.AddHours(-2));
        SeedCompletedMatch(db, 3, "BTCUSDT", "ADAUSDT", winnerIsA: false, scoreA: 1, scoreB: 2, endTimeUtc: DateTime.UtcNow.AddHours(-3));

        var service = CreateService(db);

        var result = await service.GetAsync();
        var btc = Assert.Single(result.Assets, asset => asset.Symbol == "BTC");

        Assert.Equal(3, btc.Decisions);
        Assert.Equal(1, btc.Losses);
        Assert.Equal(2, btc.Wins);
    }

    [Fact]
    public async Task GetAsync_BuildsSuggestedTextWithCashtagsOnlyOnTopTwoAssets()
    {
        using var db = CreateDbContext();

        SeedWins(db, "UTKUSDT", 3, 1, startMatchId: 100);
        SeedWins(db, "JTOUSDT", 3, 2, startMatchId: 200);
        SeedWins(db, "ALLOUSDT", 4, 3, startMatchId: 300);

        var service = CreateService(db);

        var result = await service.GetAsync();

        Assert.True(result.CanPost);
        Assert.NotNull(result.SuggestedText);
        Assert.Contains("$UTK", result.SuggestedText);
        Assert.Contains("$JTO", result.SuggestedText);
        Assert.Contains("ALLO", result.SuggestedText);
        Assert.DoesNotContain("$ALLO", result.SuggestedText);
    }

    private static SocialWinRate24hService CreateService(EthicAIDbContext db)
    {
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["CriptoVersus:PublicBaseUrl"] = "https://www.criptoversus.com"
            })
            .Build();

        return new SocialWinRate24hService(
            db,
            configuration,
            NullLogger<SocialWinRate24hService>.Instance);
    }

    private static EthicAIDbContext CreateDbContext()
    {
        var options = new DbContextOptionsBuilder<EthicAIDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString("N"))
            .Options;

        return new EthicAIDbContext(options);
    }

    private static void SeedWins(EthicAIDbContext db, string symbol, int wins, int losses, int startMatchId)
    {
        var total = wins + losses;
        for (var index = 0; index < total; index++)
        {
            var winnerIsA = index < wins;
            SeedCompletedMatch(
                db,
                startMatchId + index,
                symbol,
                $"OPP{startMatchId + index}USDT",
                winnerIsA,
                scoreA: winnerIsA ? 2 : 0,
                scoreB: winnerIsA ? 0 : 2,
                endTimeUtc: DateTime.UtcNow.AddHours(-(index + 1)));
        }
    }

    private static void SeedCompletedMatch(
        EthicAIDbContext db,
        int matchId,
        string symbolA,
        string symbolB,
        bool? winnerIsA,
        int scoreA,
        int scoreB,
        DateTime endTimeUtc)
        => SeedMatch(db, matchId, symbolA, symbolB, MatchStatus.Completed, scoreA, scoreB, DateTime.UtcNow.AddHours(-1), endTimeUtc, winnerIsA);

    private static void SeedMatch(
        EthicAIDbContext db,
        int matchId,
        string symbolA,
        string symbolB,
        MatchStatus status,
        int scoreA,
        int scoreB,
        DateTime? startTimeUtc,
        DateTime? endTimeUtc,
        bool? winnerIsA)
    {
        var baseId = matchId * 1000;
        var currencyA = CreateCurrency(baseId + 1, symbolA);
        var currencyB = CreateCurrency(baseId + 2, symbolB);
        var teamA = new Team { TeamId = baseId + 11, CurrencyId = currencyA.CurrencyId, Currency = currencyA };
        var teamB = new Team { TeamId = baseId + 12, CurrencyId = currencyB.CurrencyId, Currency = currencyB };

        db.Currency.AddRange(currencyA, currencyB);
        db.Team.AddRange(teamA, teamB);
        db.Match.Add(new Match
        {
            MatchId = matchId,
            TeamAId = teamA.TeamId,
            TeamBId = teamB.TeamId,
            TeamA = teamA,
            TeamB = teamB,
            ScoreA = scoreA,
            ScoreB = scoreB,
            Status = status,
            StartTime = startTimeUtc ?? DateTime.UtcNow.AddHours(-1),
            EndTime = endTimeUtc,
            WinnerTeamId = status == MatchStatus.Completed
                ? winnerIsA is null
                    ? null
                    : winnerIsA.Value ? teamA.TeamId : teamB.TeamId
                : null
        });

        db.SaveChanges();
    }

    private static Currency CreateCurrency(int currencyId, string symbol)
        => new()
        {
            CurrencyId = currencyId,
            Name = symbol,
            Symbol = symbol,
            PercentageChange = 0,
            QuoteVolume = 0m,
            TradesCount = 0,
            LastUpdated = DateTime.UtcNow
        };
}

