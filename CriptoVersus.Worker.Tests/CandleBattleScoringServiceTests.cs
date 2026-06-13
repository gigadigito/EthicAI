using BLL.NFTFutebol;
using DAL.NftFutebol;
using EthicAI.EntityModel;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;

namespace CriptoVersus.Worker.Tests;

public sealed class CandleBattleScoringServiceTests
{
    [Fact]
    public async Task EvaluateAsync_BootstrapsState_WithoutRetroactiveGoal()
    {
        await using var db = CreateDbContext();
        SeedBaselineMatch(db);

        var service = CreateService(db);
        var match = await LoadMatchAsync(db, 45001);
        var state = match.ScoreState!;

        var result = await service.EvaluateAsync(match, state, DateTime.UtcNow);

        Assert.Empty(result.Events);
        Assert.Equal(1, result.CandleWinsA);
        Assert.Equal(0, result.CandleWinsB);
        Assert.Equal(match.ScoreA, result.ScoreA);
        Assert.Equal(match.ScoreB, result.ScoreB);
        Assert.Equal(match.TeamAId, result.LastLeaderTeamId);
        Assert.NotNull(result.LastProcessedAtUtc);
        Assert.Equal(1, state.CandleBattleWinsA);
        Assert.Equal(0, state.CandleBattleWinsB);
        Assert.Equal(match.TeamAId, state.LastCandleBattleLeaderTeamId);
    }

    [Fact]
    public async Task EvaluateAsync_AwardsGoalOnce_WhenLeaderChangesAfterTie()
    {
        await using var db = CreateDbContext();
        SeedBaselineMatch(db);

        var service = CreateService(db);
        var match = await LoadMatchAsync(db, 45001);
        var state = match.ScoreState!;

        var bootstrap = await service.EvaluateAsync(match, state, DateTime.UtcNow);
        Assert.Empty(bootstrap.Events);

        SeedPostBootstrapCandles(db);

        var beforeScoreA = match.ScoreA;
        var beforeScoreB = match.ScoreB;

        var firstLiveRun = await service.EvaluateAsync(match, state, DateTime.UtcNow);
        Assert.Single(firstLiveRun.Events);
        var scoreEvent = Assert.Single(firstLiveRun.Events);
        Assert.Equal(match.TeamBId, scoreEvent.TeamId);
        Assert.Equal(MatchScoringRuleType.CandleBattleLeadChange, scoreEvent.RuleType);
        Assert.Equal(beforeScoreA, firstLiveRun.ScoreA);
        Assert.Equal(beforeScoreB + 1, firstLiveRun.ScoreB);
        Assert.Equal(beforeScoreA, match.ScoreA);
        Assert.Equal(beforeScoreB + 1, match.ScoreB);

        var secondLiveRun = await service.EvaluateAsync(match, state, DateTime.UtcNow);
        Assert.Empty(secondLiveRun.Events);
        Assert.Equal(firstLiveRun.ScoreA, secondLiveRun.ScoreA);
        Assert.Equal(firstLiveRun.ScoreB, secondLiveRun.ScoreB);
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

    private static void SeedBaselineMatch(EthicAIDbContext db)
    {
        SeedCurrencyAndTeams(db);

        db.Match.Add(new Match
        {
            MatchId = 45001,
            TeamAId = 45010,
            TeamBId = 45020,
            ScoreA = 0,
            ScoreB = 0,
            Status = MatchStatus.Ongoing,
            ScoringRuleType = MatchScoringRuleType.CandleBattleLeadChange,
            StartTime = new DateTime(2026, 06, 13, 12, 0, 0, DateTimeKind.Utc)
        });

        db.MatchScoreState.Add(new MatchScoreState
        {
            MatchId = 45001,
            CreatedAtUtc = new DateTime(2026, 06, 13, 12, 0, 0, DateTimeKind.Utc),
            UpdatedAtUtc = new DateTime(2026, 06, 13, 12, 0, 0, DateTimeKind.Utc)
        });

        AddSnapshotGroup(db, 45001, new DateTime(2026, 06, 13, 12, 01, 0, DateTimeKind.Utc), 100m, 100m);
        AddSnapshotGroup(db, 45001, new DateTime(2026, 06, 13, 12, 02, 0, DateTimeKind.Utc), 101m, 99m);

        db.SaveChanges();
    }

    private static void SeedPostBootstrapCandles(EthicAIDbContext db)
    {
        AddSnapshotGroup(db, 45001, new DateTime(2026, 06, 13, 12, 03, 0, DateTimeKind.Utc), 100m, 105m);
        AddSnapshotGroup(db, 45001, new DateTime(2026, 06, 13, 12, 04, 0, DateTimeKind.Utc), 99m, 106m);
        db.SaveChanges();
    }

    private static void SeedCurrencyAndTeams(EthicAIDbContext db)
    {
        db.Currency.Add(new Currency
        {
            CurrencyId = 4501,
            Name = "AXL",
            Symbol = "AXL",
            PercentageChange = 0d,
            QuoteVolume = 0m,
            TradesCount = 0,
            LastUpdated = DateTime.UtcNow
        });

        db.Currency.Add(new Currency
        {
            CurrencyId = 4502,
            Name = "OPG",
            Symbol = "OPG",
            PercentageChange = 0d,
            QuoteVolume = 0m,
            TradesCount = 0,
            LastUpdated = DateTime.UtcNow
        });

        db.Team.Add(new Team { TeamId = 45010, CurrencyId = 4501 });
        db.Team.Add(new Team { TeamId = 45020, CurrencyId = 4502 });
    }

    private static void AddSnapshotGroup(EthicAIDbContext db, int matchId, DateTime capturedAtUtc, decimal priceA, decimal priceB)
    {
        db.MatchMetricSnapshot.Add(new MatchMetricSnapshot
        {
            MatchId = matchId,
            TeamId = 45010,
            CapturedAtUtc = capturedAtUtc,
            LastPrice = priceA,
            PercentageChange = 0m,
            QuoteVolume = 100m,
            TradeCount = 1
        });

        db.MatchMetricSnapshot.Add(new MatchMetricSnapshot
        {
            MatchId = matchId,
            TeamId = 45020,
            CapturedAtUtc = capturedAtUtc,
            LastPrice = priceB,
            PercentageChange = 0m,
            QuoteVolume = 100m,
            TradeCount = 1
        });
    }
}
