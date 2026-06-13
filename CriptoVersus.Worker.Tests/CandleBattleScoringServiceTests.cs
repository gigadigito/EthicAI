using BLL.NFTFutebol;
using DAL.NftFutebol;
using EthicAI.EntityModel;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;

namespace CriptoVersus.Worker.Tests;

[Collection("CandleBattleScoringService")]
public sealed class CandleBattleScoringServiceTests
{
    [Fact]
    public async Task EvaluateAsync_BootstrapsWithoutRetroactiveGoal_AndMatchesTheRuleThreshold()
    {
        _priceA = 100m;
        _priceB = 100m;
        await using var db = CreateDbContext();
        SeedMatch(db, MatchScoringRuleType.CandleBattleDominance, 46001);

        var service = CreateService(db);
        var match = await LoadMatchAsync(db, 46001);

        AddTieGroup(db, 46001, new DateTime(2026, 06, 13, 12, 1, 0, DateTimeKind.Utc), ref _priceA, ref _priceB);

        var result = await service.EvaluateAsync(match, match.ScoreState!, DateTime.UtcNow);

        Assert.Empty(result.Events);
        Assert.Equal(0, result.ScoreA);
        Assert.Equal(0, result.ScoreB);
        Assert.Null(result.DominanceTeamId);
        Assert.Equal("CandleBattleDominance:46001:null:0:0", result.StateKey);
    }

    [Theory]
    [InlineData(MatchScoringRuleType.PercentThreshold)]
    [InlineData(MatchScoringRuleType.ArenaPressure)]
    public async Task EvaluateAsync_RunsIndependentlyOfMainRuleType(MatchScoringRuleType ruleType)
    {
        _priceA = 100m;
        _priceB = 100m;
        await using var db = CreateDbContext();
        SeedMatch(db, ruleType, 46002);

        var service = CreateService(db);
        var match = await LoadMatchAsync(db, 46002);

        AddTieGroup(db, 46002, new DateTime(2026, 06, 13, 12, 1, 0, DateTimeKind.Utc), ref _priceA, ref _priceB);
        var bootstrap = await service.EvaluateAsync(match, match.ScoreState!, DateTime.UtcNow);
        Assert.Empty(bootstrap.Events);

        AddWinnerGroup(db, 46002, new DateTime(2026, 06, 13, 12, 2, 0, DateTimeKind.Utc), CandleSide.Left, ref _priceA, ref _priceB);
        AddWinnerGroup(db, 46002, new DateTime(2026, 06, 13, 12, 3, 0, DateTimeKind.Utc), CandleSide.Left, ref _priceA, ref _priceB);
        AddWinnerGroup(db, 46002, new DateTime(2026, 06, 13, 12, 4, 0, DateTimeKind.Utc), CandleSide.Left, ref _priceA, ref _priceB);

        var result = await service.EvaluateAsync(match, match.ScoreState!, DateTime.UtcNow);

        Assert.Single(result.Events);
        Assert.Equal(1, result.ScoreA);
        Assert.Equal(0, result.ScoreB);
        Assert.Equal(match.TeamAId, result.DominanceTeamId);
    }

    [Fact]
    public async Task EvaluateAsync_RewardsProgressiveDominance_AndResetsOnlyOnTie()
    {
        _priceA = 100m;
        _priceB = 100m;
        await using var db = CreateDbContext();
        SeedMatch(db, MatchScoringRuleType.CandleBattleDominance, 46003);

        var service = CreateService(db);
        var match = await LoadMatchAsync(db, 46003);

        AddTieGroup(db, 46003, new DateTime(2026, 06, 13, 12, 1, 0, DateTimeKind.Utc), ref _priceA, ref _priceB);
        var step0 = await service.EvaluateAsync(match, match.ScoreState!, DateTime.UtcNow);
        Assert.Empty(step0.Events);

        AddWinnerGroup(db, 46003, new DateTime(2026, 06, 13, 12, 2, 0, DateTimeKind.Utc), CandleSide.Left, ref _priceA, ref _priceB);
        var step1 = await service.EvaluateAsync(match, match.ScoreState!, DateTime.UtcNow);
        Assert.Empty(step1.Events);
        Assert.Equal(1, step1.CandleWinsA);
        Assert.Equal(0, step1.CandleWinsB);

        AddWinnerGroup(db, 46003, new DateTime(2026, 06, 13, 12, 3, 0, DateTimeKind.Utc), CandleSide.Left, ref _priceA, ref _priceB);
        var step2 = await service.EvaluateAsync(match, match.ScoreState!, DateTime.UtcNow);
        Assert.Empty(step2.Events);
        Assert.Equal(2, step2.CandleWinsA);
        Assert.Equal(0, step2.CandleWinsB);

        AddWinnerGroup(db, 46003, new DateTime(2026, 06, 13, 12, 4, 0, DateTimeKind.Utc), CandleSide.Left, ref _priceA, ref _priceB);
        var step3 = await service.EvaluateAsync(match, match.ScoreState!, DateTime.UtcNow);
        Assert.Single(step3.Events);
        Assert.Equal(match.TeamAId, step3.DominanceTeamId);
        Assert.Equal(1, step3.ScoreA);
        Assert.Equal(0, step3.ScoreB);

        AddWinnerGroup(db, 46003, new DateTime(2026, 06, 13, 12, 5, 0, DateTimeKind.Utc), CandleSide.Left, ref _priceA, ref _priceB);
        var step4 = await service.EvaluateAsync(match, match.ScoreState!, DateTime.UtcNow);
        Assert.Empty(step4.Events);
        Assert.Equal(4, step4.CandleWinsA);
        Assert.Equal(0, step4.CandleWinsB);

        AddWinnerGroup(db, 46003, new DateTime(2026, 06, 13, 12, 6, 0, DateTimeKind.Utc), CandleSide.Right, ref _priceA, ref _priceB);
        AddWinnerGroup(db, 46003, new DateTime(2026, 06, 13, 12, 7, 0, DateTimeKind.Utc), CandleSide.Right, ref _priceA, ref _priceB);
        var step5 = await service.EvaluateAsync(match, match.ScoreState!, DateTime.UtcNow);
        Assert.Empty(step5.Events);
        Assert.Equal(4, step5.CandleWinsA);
        Assert.Equal(2, step5.CandleWinsB);

        AddWinnerGroup(db, 46003, new DateTime(2026, 06, 13, 12, 8, 0, DateTimeKind.Utc), CandleSide.Right, ref _priceA, ref _priceB);
        AddWinnerGroup(db, 46003, new DateTime(2026, 06, 13, 12, 9, 0, DateTimeKind.Utc), CandleSide.Right, ref _priceA, ref _priceB);
        var step6 = await service.EvaluateAsync(match, match.ScoreState!, DateTime.UtcNow);
        Assert.Empty(step6.Events);
        Assert.Equal(4, step6.CandleWinsA);
        Assert.Equal(4, step6.CandleWinsB);
        Assert.Null(step6.DominanceTeamId);

        AddWinnerGroup(db, 46003, new DateTime(2026, 06, 13, 12, 10, 0, DateTimeKind.Utc), CandleSide.Right, ref _priceA, ref _priceB);
        AddWinnerGroup(db, 46003, new DateTime(2026, 06, 13, 12, 11, 0, DateTimeKind.Utc), CandleSide.Right, ref _priceA, ref _priceB);
        AddWinnerGroup(db, 46003, new DateTime(2026, 06, 13, 12, 12, 0, DateTimeKind.Utc), CandleSide.Right, ref _priceA, ref _priceB);
        var step7 = await service.EvaluateAsync(match, match.ScoreState!, DateTime.UtcNow);
        Assert.Single(step7.Events);
        Assert.Equal(match.TeamBId, step7.DominanceTeamId);
        Assert.Equal(1, step7.ScoreB);
    }

    [Fact]
    public async Task EvaluateAsync_DoesNotDuplicateTheSameState()
    {
        _priceA = 100m;
        _priceB = 100m;
        await using var db = CreateDbContext();
        SeedMatch(db, MatchScoringRuleType.CandleBattleDominance, 46004);

        var service = CreateService(db);
        var match = await LoadMatchAsync(db, 46004);

        AddTieGroup(db, 46004, new DateTime(2026, 06, 13, 12, 1, 0, DateTimeKind.Utc), ref _priceA, ref _priceB);
        var bootstrap = await service.EvaluateAsync(match, match.ScoreState!, DateTime.UtcNow);
        Assert.Empty(bootstrap.Events);

        AddWinnerGroup(db, 46004, new DateTime(2026, 06, 13, 12, 2, 0, DateTimeKind.Utc), CandleSide.Left, ref _priceA, ref _priceB);
        AddWinnerGroup(db, 46004, new DateTime(2026, 06, 13, 12, 3, 0, DateTimeKind.Utc), CandleSide.Left, ref _priceA, ref _priceB);
        AddWinnerGroup(db, 46004, new DateTime(2026, 06, 13, 12, 4, 0, DateTimeKind.Utc), CandleSide.Left, ref _priceA, ref _priceB);

        var first = await service.EvaluateAsync(match, match.ScoreState!, DateTime.UtcNow);
        Assert.Single(first.Events);

        var second = await service.EvaluateAsync(match, match.ScoreState!, DateTime.UtcNow);
        Assert.Empty(second.Events);
        Assert.Equal(first.ScoreA, second.ScoreA);
        Assert.Equal(first.ScoreB, second.ScoreB);
    }

    [Fact]
    public async Task EvaluateAsync_SkipsCompletedMatches()
    {
        _priceA = 100m;
        _priceB = 100m;
        await using var db = CreateDbContext();
        SeedMatch(db, MatchScoringRuleType.CandleBattleDominance, 46005, MatchStatus.Completed);

        var service = CreateService(db);
        var match = await LoadMatchAsync(db, 46005);

        var result = await service.EvaluateAsync(match, match.ScoreState!, DateTime.UtcNow);

        Assert.Empty(result.Events);
        Assert.Equal(0, result.ScoreA);
        Assert.Equal(0, result.ScoreB);
    }

    [Fact]
    public async Task EvaluateAsync_DoesNotCreateRetroactiveGoal_WhenFirstRunFindsAdvancedDominance()
    {
        _priceA = 100m;
        _priceB = 100m;
        await using var db = CreateDbContext();
        SeedMatch(db, MatchScoringRuleType.CandleBattleDominance, 46006);

        AddWinnerGroup(db, 46006, new DateTime(2026, 06, 13, 12, 1, 0, DateTimeKind.Utc), CandleSide.Left, ref _priceA, ref _priceB);
        AddWinnerGroup(db, 46006, new DateTime(2026, 06, 13, 12, 2, 0, DateTimeKind.Utc), CandleSide.Left, ref _priceA, ref _priceB);
        AddWinnerGroup(db, 46006, new DateTime(2026, 06, 13, 12, 3, 0, DateTimeKind.Utc), CandleSide.Left, ref _priceA, ref _priceB);
        AddWinnerGroup(db, 46006, new DateTime(2026, 06, 13, 12, 4, 0, DateTimeKind.Utc), CandleSide.Left, ref _priceA, ref _priceB);
        AddWinnerGroup(db, 46006, new DateTime(2026, 06, 13, 12, 5, 0, DateTimeKind.Utc), CandleSide.Left, ref _priceA, ref _priceB);
        AddWinnerGroup(db, 46006, new DateTime(2026, 06, 13, 12, 6, 0, DateTimeKind.Utc), CandleSide.Left, ref _priceA, ref _priceB);
        AddWinnerGroup(db, 46006, new DateTime(2026, 06, 13, 12, 7, 0, DateTimeKind.Utc), CandleSide.Left, ref _priceA, ref _priceB);
        AddWinnerGroup(db, 46006, new DateTime(2026, 06, 13, 12, 8, 0, DateTimeKind.Utc), CandleSide.Left, ref _priceA, ref _priceB);
        AddWinnerGroup(db, 46006, new DateTime(2026, 06, 13, 12, 9, 0, DateTimeKind.Utc), CandleSide.Left, ref _priceA, ref _priceB);
        AddWinnerGroup(db, 46006, new DateTime(2026, 06, 13, 12, 10, 0, DateTimeKind.Utc), CandleSide.Left, ref _priceA, ref _priceB);
        AddWinnerGroup(db, 46006, new DateTime(2026, 06, 13, 12, 11, 0, DateTimeKind.Utc), CandleSide.Right, ref _priceA, ref _priceB);
        AddWinnerGroup(db, 46006, new DateTime(2026, 06, 13, 12, 12, 0, DateTimeKind.Utc), CandleSide.Right, ref _priceA, ref _priceB);
        AddWinnerGroup(db, 46006, new DateTime(2026, 06, 13, 12, 13, 0, DateTimeKind.Utc), CandleSide.Right, ref _priceA, ref _priceB);
        AddWinnerGroup(db, 46006, new DateTime(2026, 06, 13, 12, 14, 0, DateTimeKind.Utc), CandleSide.Right, ref _priceA, ref _priceB);

        var service = CreateService(db);
        var match = await LoadMatchAsync(db, 46006);

        var result = await service.EvaluateAsync(match, match.ScoreState!, DateTime.UtcNow);

        Assert.Empty(result.Events);
        Assert.Equal(10, result.CandleWinsA);
        Assert.Equal(4, result.CandleWinsB);
        Assert.Equal(match.ScoreA, result.ScoreA);
        Assert.Equal(match.ScoreB, result.ScoreB);
    }

    private static CandleBattleScoringService CreateService(EthicAIDbContext db)
        => new(db, NullLogger<CandleBattleScoringService>.Instance);

    private static EthicAIDbContext CreateDbContext()
    {
        var options = new DbContextOptionsBuilder<EthicAIDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString("N"))
            .Options;

        return new EthicAIDbContext(options);
    }

    private static async Task<Match> LoadMatchAsync(EthicAIDbContext db, int matchId)
    {
        return await db.Match
            .Include(x => x.TeamA).ThenInclude(t => t.Currency)
            .Include(x => x.TeamB).ThenInclude(t => t.Currency)
            .Include(x => x.ScoreState)
            .SingleAsync(x => x.MatchId == matchId);
    }

    private static void SeedMatch(EthicAIDbContext db, MatchScoringRuleType ruleType, int matchId, MatchStatus status = MatchStatus.Ongoing)
    {
        SeedCurrencyAndTeams(db);

        db.Match.Add(new Match
        {
            MatchId = matchId,
            TeamAId = 46010,
            TeamBId = 46020,
            ScoreA = 0,
            ScoreB = 0,
            Status = status,
            ScoringRuleType = ruleType,
            StartTime = new DateTime(2026, 06, 13, 12, 0, 0, DateTimeKind.Utc)
        });

        db.MatchScoreState.Add(new MatchScoreState
        {
            MatchId = matchId,
            CreatedAtUtc = new DateTime(2026, 06, 13, 12, 0, 0, DateTimeKind.Utc),
            UpdatedAtUtc = new DateTime(2026, 06, 13, 12, 0, 0, DateTimeKind.Utc)
        });

        db.SaveChanges();
    }

    private static void SeedCurrencyAndTeams(EthicAIDbContext db)
    {
        db.Currency.Add(new Currency
        {
            CurrencyId = 4601,
            Name = "AXL",
            Symbol = "AXL",
            PercentageChange = 0d,
            QuoteVolume = 0m,
            TradesCount = 0,
            LastUpdated = DateTime.UtcNow
        });

        db.Currency.Add(new Currency
        {
            CurrencyId = 4602,
            Name = "OPG",
            Symbol = "OPG",
            PercentageChange = 0d,
            QuoteVolume = 0m,
            TradesCount = 0,
            LastUpdated = DateTime.UtcNow
        });

        db.Team.Add(new Team { TeamId = 46010, CurrencyId = 4601 });
        db.Team.Add(new Team { TeamId = 46020, CurrencyId = 4602 });
    }

    private static void AddTieGroup(EthicAIDbContext db, int matchId, DateTime capturedAtUtc, ref decimal priceA, ref decimal priceB)
    {
        priceA = Math.Round(priceA * 1.05m, 8);
        priceB = Math.Round(priceB * 1.05m, 8);
        AddSnapshotGroup(db, matchId, capturedAtUtc, priceA, priceB);
    }

    private static void AddWinnerGroup(EthicAIDbContext db, int matchId, DateTime capturedAtUtc, CandleSide side, ref decimal priceA, ref decimal priceB)
    {
        switch (side)
        {
            case CandleSide.Left:
                priceA = Math.Round(priceA * 1.10m, 8);
                break;
            case CandleSide.Right:
                priceB = Math.Round(priceB * 1.10m, 8);
                break;
        }

        AddSnapshotGroup(db, matchId, capturedAtUtc, priceA, priceB);
    }

    private static void AddSnapshotGroup(EthicAIDbContext db, int matchId, DateTime capturedAtUtc, decimal priceA, decimal priceB)
    {
        db.MatchMetricSnapshot.Add(new MatchMetricSnapshot
        {
            MatchId = matchId,
            TeamId = 46010,
            CapturedAtUtc = capturedAtUtc,
            LastPrice = priceA,
            PercentageChange = 0m,
            QuoteVolume = 100m,
            TradeCount = 1
        });

        db.MatchMetricSnapshot.Add(new MatchMetricSnapshot
        {
            MatchId = matchId,
            TeamId = 46020,
            CapturedAtUtc = capturedAtUtc,
            LastPrice = priceB,
            PercentageChange = 0m,
            QuoteVolume = 100m,
            TradeCount = 1
        });

        db.SaveChanges();
    }

    private enum CandleSide
    {
        Left,
        Right
    }

    private static decimal _priceA = 100m;
    private static decimal _priceB = 100m;
}

[CollectionDefinition("CandleBattleScoringService", DisableParallelization = true)]
public sealed class CandleBattleScoringServiceCollectionDefinition
{
}
