using System.Text.Json;
using BLL.NFTFutebol;
using CriptoVersus.API.Controllers;
using DAL.NftFutebol;
using DTOs;
using EthicAI.EntityModel;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

namespace CriptoVersus.API.Tests;

public sealed class CandleBattlesTests
{
    private const long Start = 1767225600000;
    private static CandleBattlesCandleDto Candle(long time = Start, decimal close = 101m, string symbol = "AAAUSDT")
        => new(symbol, time, time + 300000, time + 301500, 100m, Math.Max(102m, close), Math.Min(99m, close), close, 120m, true);
    private static CandleBattlesCandleDto[] History(string symbol = "AAAUSDT")
        => Enumerable.Range(0, 20).Select(i => Candle(Start - (20 - i) * 300000L, 100m, symbol)).ToArray();
    [Fact]
    public void Strength_IsDecimalBoundedDeterministicAndScaleIndependent()
    {
        var a = Candle(); var h = History();
        var strength = CandleBattlesResolver.Strength(a, h);
        Assert.InRange(strength, 0m, 100m);
        Assert.Equal(strength, CandleBattlesResolver.Strength(a, h));
        static CandleBattlesCandleDto Scale(CandleBattlesCandleDto c) => c with { Open=c.Open*1000, High=c.High*1000, Low=c.Low*1000, Close=c.Close*1000, Volume=c.Volume*80 };
        Assert.Equal(strength, CandleBattlesResolver.Strength(Scale(a), h.Select(Scale).ToArray()));
    }
    [Fact]
    public void FormingPreviewUsesSameFormulaWithoutConfirmingOrAwardingARound()
    {
        var closed = Candle();
        var forming = closed with { Confirmed = false, UpdatedAt = Start + 1000 };
        Assert.Equal(CandleBattlesResolver.Strength(closed, History()), CandleBattlesResolver.PreviewStrength(forming, History()));
        Assert.False(forming.Confirmed);
        Assert.Equal(Start + 1000, forming.UpdatedAt);
        Assert.Throws<ArgumentException>(() => CandleBattlesResolver.Resolve(7, forming, closed, History(), History()));
    }
    [Fact]
    public void Resolver_PreservesDrawAndBothWinnersWithStableIntervalId()
    {
        var a = Candle(); var b = Candle(symbol: "BBBUSDT");
        var tie = CandleBattlesResolver.Resolve(7, a, b, History(), History("BBBUSDT"));
        Assert.Equal("draw", tie.Winner); Assert.Equal($"7:5m:{Start}", tie.Id);
        Assert.Equal("left", CandleBattlesResolver.Resolve(7, a with { Close=102m }, b, History(), History("BBBUSDT")).Winner);
        Assert.Equal("right", CandleBattlesResolver.Resolve(7, a, b with { Close=102m }, History(), History("BBBUSDT")).Winner);
    }

    [Theory]
    [InlineData(-8, -2, "right")]
    [InlineData(-10, 1, "right")]
    [InlineData(2, 7, "right")]
    [InlineData(-1, 0, "right")]
    [InlineData(0, 1, "right")]
    public void ResolverUsesPercentageChangeForAllCandleDirections(decimal leftPercent, decimal rightPercent, string expectedWinner)
    {
        var left = Candle() with { Close = 100m + leftPercent, High = Math.Max(100m, 100m + leftPercent) + 1m, Low = Math.Min(100m, 100m + leftPercent) - 1m };
        var right = Candle(symbol: "BBBUSDT") with { Close = 100m + rightPercent, High = Math.Max(100m, 100m + rightPercent) + 1m, Low = Math.Min(100m, 100m + rightPercent) - 1m };
        var result = CandleBattlesResolver.Resolve(7, left, right, History(), History("BBBUSDT"));
        Assert.Equal(leftPercent, CandleBattlesResolver.PercentageChange(left));
        Assert.Equal(rightPercent, CandleBattlesResolver.PercentageChange(right));
        Assert.Equal(expectedWinner, result.Winner);
    }

    [Fact]
    public void EqualPercentageChangeUsesStrengthTieBreakerAndEqualStrengthDraws()
    {
        var left = Candle() with { Close = 102m, High = 103m, Low = 99m };
        var right = Candle(symbol: "BBBUSDT") with { Open = 200m, Close = 204m, High = 206m, Low = 198m };
        var result = CandleBattlesResolver.Resolve(7, left, right, History(), History("BBBUSDT"));
        Assert.Equal(2m, CandleBattlesResolver.PercentageChange(left));
        Assert.Equal(2m, CandleBattlesResolver.PercentageChange(right));
        Assert.Equal("right", result.Winner);

        var tieLeft = left with { High = 102m, Low = 100m };
        var tieRight = right with { High = 204m, Low = 200m };
        var scaledRightHistory = History("BBBUSDT").Select(c => c with { Open = 200m, High = 200m, Low = 200m, Close = 200m }).ToArray();
        Assert.Equal("draw", CandleBattlesResolver.Resolve(7, tieLeft, tieRight, History(), scaledRightHistory).Winner);
    }
    [Fact]
    public void IncompleteUnconfirmedInvalidOrMismatchedCandlesNeverResolve()
    {
        var a=Candle();var b=Candle(symbol:"BBBUSDT");
        Assert.Throws<ArgumentException>(()=>CandleBattlesResolver.Resolve(1,a with {Confirmed=false},b,History(),History("BBBUSDT")));
        Assert.Throws<ArgumentException>(()=>CandleBattlesResolver.Resolve(1,a,b with {OpenTime=Start+300000},History(),History("BBBUSDT")));
        Assert.Throws<ArgumentException>(()=>CandleBattlesResolver.Strength(a,History().Skip(1).ToArray()));
        Assert.Throws<ArgumentException>(()=>CandleBattlesResolver.Strength(a with {High=99},History()));
        var history=History();history[3]=history[3] with {OpenTime=0};
        Assert.Throws<ArgumentException>(()=>CandleBattlesResolver.Strength(a,history));
    }
    [Fact]
    public void KlineConfirmationUsesExchangeClockAndValidatesIntervalAndOhlc()
    {
        var json=$"[[{Start},\"100\",\"105\",\"95\",\"101\",\"3\",{Start+299999},\"303\"]]";
        var rows=JsonSerializer.Deserialize<List<List<JsonElement>>>(json);
        Assert.False(Assert.Single(BinanceKlineClient.Parse(rows,"AAAUSDT",5,Start+300000)).Confirmed);
        Assert.True(Assert.Single(BinanceKlineClient.Parse(rows,"AAAUSDT",5,Start+301500)).Confirmed);
        rows![0][2]=JsonSerializer.SerializeToElement("99");
        Assert.Empty(BinanceKlineClient.Parse(rows,"AAAUSDT",5,Start+301500));
    }
    [Fact]
    public void ArcadeSchemaHasUniqueIntervalAndDoesNotTouchFinancialTables()
    {
        var options=new DbContextOptionsBuilder<EthicAIDbContext>().UseNpgsql("Host=localhost;Database=arcade_test").Options;
        using var db=new EthicAIDbContext(options);
        var entity=db.Model.FindEntityType(typeof(CandleBattlesRound))!;
        Assert.Equal(new[]{"MatchId","OpenTimeUtc"},entity.FindPrimaryKey()!.Properties.Select(p=>p.Name));
        var previous=db.Database.GetMigrations().TakeWhile(id => id != "20261015000000_AddCandleBattlesArcade").Last();
        var script=db.GetService<IMigrator>().GenerateScript(previous, "20261015000000_AddCandleBattlesArcade");
        Assert.Contains("CREATE TABLE candle_battles_round",script);
        Assert.Contains("PRIMARY KEY",script);
        Assert.DoesNotContain("UPDATE match",script);
        Assert.DoesNotContain("DROP TABLE",script);
    }

    [Theory]
    [InlineData("pt")][InlineData("en")][InlineData("zh")][InlineData("es")][InlineData("de")][InlineData("fr")][InlineData("it")][InlineData("ja")]
    public void LanguageSwitcherPreservesArcadeRouteAndMatch(string culture)
    {
        var routes=new CriptoVersus.Web.Services.RouteLocalizationService(new CriptoVersus.Web.Services.AppCultureService());
        Assert.Equal($"/{culture}/tv/candle/7/aaa-vs-bbb",routes.BuildLocalizedPathForCurrentPage(culture,"en/tv/candle/7/aaa-vs-bbb"));
        Assert.Equal($"/{culture}/games/candle-battles/demo",routes.BuildLocalizedPathForCurrentPage(culture,"en/games/candle-battles/demo"));
    }
    [Fact]
    public async Task ApiHistoryUsesIndependentScoresAndPaginatesPersistedOutcomes()
    {
        var options=new DbContextOptionsBuilder<EthicAIDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options;
        await using var db=new EthicAIDbContext(options);
        db.Match.Add(new Match {MatchId=7,ScoreA=99,ScoreB=88,Status=MatchStatus.Ongoing,
            StartTime=DateTimeOffset.FromUnixTimeMilliseconds(Start+42_000).UtcDateTime,
            TeamA=new Team {TeamId=1,Currency=new Currency {CurrencyId=1,Symbol="AAAUSDT"}},
            TeamB=new Team {TeamId=2,Currency=new Currency {CurrencyId=2,Symbol="BBBUSDT"}}});
        foreach(var i in Enumerable.Range(0,3))db.Add(new CandleBattlesRound {MatchId=7,OpenTimeUtc=DateTimeOffset.FromUnixTimeMilliseconds(Start+i*300000).UtcDateTime,
            Winner=i==0?"left":i==1?"draw":"right",RuleVersion=CandleBattlesResolver.Version,
            LeftCandleJson=JsonSerializer.Serialize(Candle(Start+i*300000)),RightCandleJson=JsonSerializer.Serialize(Candle(Start+i*300000,symbol:"BBBUSDT"))});
        db.Add(new CandleBattlesRound {MatchId=7,OpenTimeUtc=DateTimeOffset.FromUnixTimeMilliseconds(Start+18*300000).UtcDateTime,
            Winner="left",RuleVersion=CandleBattlesResolver.Version,
            LeftCandleJson=JsonSerializer.Serialize(Candle(Start+18*300000)),RightCandleJson=JsonSerializer.Serialize(Candle(Start+18*300000,symbol:"BBBUSDT"))});
        await db.SaveChangesAsync();
        var controller=new CandleBattlesController(db);
        var result=Assert.IsType<OkObjectResult>((await controller.Get(7,take:2)).Result);
        var feed=Assert.IsType<CandleBattlesFeedDto>(result.Value);
        Assert.Equal(1,feed.ScoreLeft);Assert.Equal(1,feed.ScoreRight);Assert.Equal(2,feed.Rounds.Count);Assert.True(feed.HasMore);
        Assert.Equal(Start+42_000,feed.MatchStartTime);
        Assert.Equal(18,feed.ExpectedRounds);
        var second=Assert.IsType<CandleBattlesFeedDto>(Assert.IsType<OkObjectResult>((await controller.Get(7,feed.NextCursor,2)).Result).Value);
        Assert.Single(second.Rounds);Assert.False(second.HasMore);Assert.Equal("right",second.Rounds[0].Winner);
        Assert.Equal(99,(await db.Match.SingleAsync()).ScoreA);
        Assert.IsType<BadRequestResult>((await controller.Get(7,take:501)).Result);
    }

    [Fact]
    public async Task CompletedMatchWithoutArcadeHistoryReturnsTerminalUnavailableFeed()
    {
        var options = new DbContextOptionsBuilder<EthicAIDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options;
        await using var db = new EthicAIDbContext(options);
        db.Match.Add(new Match { MatchId = 71, Status = MatchStatus.Completed,
            StartTime = DateTimeOffset.FromUnixTimeMilliseconds(Start).UtcDateTime,
            EndTime = DateTimeOffset.FromUnixTimeMilliseconds(Start + 18 * 300000).UtcDateTime,
            TeamA = new Team { TeamId = 71, Currency = new Currency { CurrencyId = 71, Symbol = "AAAUSDT" } },
            TeamB = new Team { TeamId = 72, Currency = new Currency { CurrencyId = 72, Symbol = "BBBUSDT" } } });
        await db.SaveChangesAsync();
        var feed = Assert.IsType<CandleBattlesFeedDto>(Assert.IsType<OkObjectResult>(
            (await new CandleBattlesController(db).Get(71)).Result).Value);
        Assert.True(feed.Finished);
        Assert.Equal("unavailable", feed.Status);
        Assert.Empty(feed.Rounds);
        Assert.Equal(0, feed.ScoreLeft + feed.ScoreRight);
    }

    [Fact]
    public async Task ApiNormalizesLegacyStrengthWinnersFromStoredPercentageReturns()
    {
        var options = new DbContextOptionsBuilder<EthicAIDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options;
        await using var db = new EthicAIDbContext(options);
        db.Match.Add(new Match { MatchId = 8, ScoreA = 0, ScoreB = 0, Status = MatchStatus.Ongoing,
            TeamA = new Team { TeamId = 11, Currency = new Currency { CurrencyId = 11, Symbol = "AAAUSDT" } },
            TeamB = new Team { TeamId = 12, Currency = new Currency { CurrencyId = 12, Symbol = "BBBUSDT" } } });

        var firstLeft = Candle() with { Close = 98m, High = 101m, Low = 97m };
        var firstRight = Candle(symbol: "BBBUSDT") with { Close = 100m, High = 101m, Low = 99m };
        var secondLeft = Candle(Start + 300000) with { Close = 102m, High = 103m, Low = 99m };
        var secondRight = Candle(Start + 300000, symbol: "BBBUSDT") with { Close = 100m, High = 101m, Low = 99m };
        db.AddRange(
            new CandleBattlesRound { MatchId = 8, OpenTimeUtc = DateTimeOffset.FromUnixTimeMilliseconds(Start).UtcDateTime,
                Winner = "left", RuleVersion = CandleBattlesResolver.LegacyStrengthVersion,
                LeftCandleJson = JsonSerializer.Serialize(firstLeft), RightCandleJson = JsonSerializer.Serialize(firstRight) },
            new CandleBattlesRound { MatchId = 8, OpenTimeUtc = DateTimeOffset.FromUnixTimeMilliseconds(Start + 300000).UtcDateTime,
                Winner = "right", RuleVersion = CandleBattlesResolver.LegacyStrengthVersion,
                LeftCandleJson = JsonSerializer.Serialize(secondLeft), RightCandleJson = JsonSerializer.Serialize(secondRight) });
        await db.SaveChangesAsync();

        var result = Assert.IsType<OkObjectResult>((await new CandleBattlesController(db).Get(8, take: 10)).Result);
        var feed = Assert.IsType<CandleBattlesFeedDto>(result.Value);
        Assert.Equal(1, feed.ScoreLeft);
        Assert.Equal(1, feed.ScoreRight);
        Assert.Equal(new[] { "right", "left" }, feed.Rounds.Select(r => r.Winner));
        Assert.All(feed.Rounds, r => Assert.Equal(CandleBattlesResolver.Version, r.RuleVersion));
    }

    [Fact]
    public void ExtremeValidPricesAndVolumesSaturateWithoutOverflow()
    {
        var tiny = .00000000000000000001m;
        var huge = 100000000000000000000m;
        var h=History().Select(c=>c with {Open=tiny,High=tiny,Low=tiny,Close=tiny,Volume=tiny}).ToArray();
        var c=Candle() with {Open=tiny,Low=tiny,High=huge,Close=huge,Volume=huge};
        Assert.Equal(100m,CandleBattlesResolver.Strength(c,h));
        var maxHistory=History().Select(x=>x with {Open=decimal.MaxValue,High=decimal.MaxValue,Low=decimal.MaxValue,Close=decimal.MaxValue,Volume=decimal.MaxValue}).ToArray();
        Assert.InRange(CandleBattlesResolver.Strength(maxHistory[0] with {OpenTime=Start,CloseTime=Start+300000,UpdatedAt=Start+301500},maxHistory),0m,100m);
    }

    [Fact]
    public async Task SharedKlineTransportPreservesVolumeSemanticsAndEncodesUnicodeSymbols()
    {
        var handler = new KlineHandler();
        var client = new BinanceKlineClient(new HttpClient(handler));
        Assert.Equal(303m, await client.GetQuoteVolumeAsync("测试USDT", 5, Start, Start+300000, default));
        Assert.Contains("%E6%B5%8B", handler.RequestUri!.AbsoluteUri);
        Assert.Empty(await client.GetAsync("测试USDT", 5, Start, Start+300000, 1, Start+301500, default));
    }
    private sealed class KlineHandler : HttpMessageHandler
    {
        public Uri? RequestUri { get; private set; }
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            RequestUri=request.RequestUri;
            return Task.FromResult(new HttpResponseMessage(System.Net.HttpStatusCode.OK)
            {
                Content=new StringContent($"[[{Start},\"invalid-ohlc\",\"105\",\"95\",\"101\",\"3\",{Start+299999},\"303\"]]",System.Text.Encoding.UTF8,"application/json")
            });
        }
    }
}
