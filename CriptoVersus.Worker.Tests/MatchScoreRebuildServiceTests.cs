using BLL.NFTFutebol;
using CriptoVersus.API.Services;
using DAL.NftFutebol;
using EthicAI.EntityModel;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace CriptoVersus.Worker.Tests;

public sealed class MatchScoreRebuildServiceTests
{
    [Fact]
    public async Task RebuildAsync_RecalculatesScoreEventsWithCurrentRule()
    {
        await using var db = CreateDbContext();
        SeedPercentThresholdMatch(db);

        var service = CreateService(db);
        var result = await service.RebuildAsync(18022, CancellationToken.None);

        Assert.True(result.Success);
        Assert.Equal(5, result.OldEvents);
        Assert.Equal(2, result.NewEvents);
        Assert.Equal("4x4", result.ScoreBefore);
        Assert.Equal("2x0", result.ScoreAfter);
        Assert.Equal(2, result.ScoreA);
        Assert.Equal(0, result.ScoreB);
    }

    [Fact]
    public async Task RebuildAsync_DoesNotCreatePhantomEvent_WhenLinesOnlyTouch()
    {
        await using var db = CreateDbContext();
        SeedPercentageCrossoverTouchMatch(db);

        var service = CreateService(db);
        var result = await service.RebuildAsync(19001, CancellationToken.None);

        Assert.True(result.Success);
        Assert.Equal(0, result.NewEvents);
        Assert.Equal("0x0", result.ScoreAfter);

        var persistedEvents = await db.MatchScoreEvent
            .Where(x => x.MatchId == 19001)
            .OrderBy(x => x.EventSequence)
            .ToListAsync();

        Assert.Empty(persistedEvents);
    }

    private static MatchScoreRebuildService CreateService(EthicAIDbContext db)
    {
        return new MatchScoreRebuildService(
            db,
            new MatchScoringEngine(),
            Options.Create(new MatchScoreRebuildOptions
            {
                PercentThresholds = [2m, 8m, 16m]
            }));
    }

    private static EthicAIDbContext CreateDbContext()
    {
        var options = new DbContextOptionsBuilder<EthicAIDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString("N"))
            .Options;

        return new EthicAIDbContext(options);
    }

    private static void SeedPercentThresholdMatch(EthicAIDbContext db)
    {
        SeedCurrenciesAndTeams(db, 101, "CHIPUSDT", 201, "FETUSDT");

        db.Match.Add(new Match
        {
            MatchId = 18022,
            TeamAId = 1010,
            TeamBId = 2010,
            ScoreA = 4,
            ScoreB = 4,
            Status = MatchStatus.Completed,
            ScoringRuleType = MatchScoringRuleType.PercentThreshold,
            StartTime = new DateTime(2026, 06, 02, 15, 0, 0, DateTimeKind.Utc),
            EndTime = new DateTime(2026, 06, 02, 16, 30, 0, DateTimeKind.Utc)
        });

        db.MatchScoreState.Add(new MatchScoreState
        {
            MatchId = 18022,
            CreatedAtUtc = new DateTime(2026, 06, 02, 15, 0, 0, DateTimeKind.Utc),
            UpdatedAtUtc = new DateTime(2026, 06, 02, 15, 0, 0, DateTimeKind.Utc)
        });

        db.MatchMetricSnapshot.AddRange(
            Snapshot(18022, 1010, new DateTime(2026, 06, 02, 15, 30, 0, DateTimeKind.Utc), 0.5m),
            Snapshot(18022, 2010, new DateTime(2026, 06, 02, 15, 30, 0, DateTimeKind.Utc), 0.2m),
            Snapshot(18022, 1010, new DateTime(2026, 06, 02, 15, 31, 0, DateTimeKind.Utc), 2.4m),
            Snapshot(18022, 2010, new DateTime(2026, 06, 02, 15, 31, 0, DateTimeKind.Utc), 0.2m),
            Snapshot(18022, 1010, new DateTime(2026, 06, 02, 15, 32, 0, DateTimeKind.Utc), 8.5m),
            Snapshot(18022, 2010, new DateTime(2026, 06, 02, 15, 32, 0, DateTimeKind.Utc), 0.1m),
            Snapshot(18022, 1010, new DateTime(2026, 06, 02, 15, 33, 0, DateTimeKind.Utc), 8.5m),
            Snapshot(18022, 2010, new DateTime(2026, 06, 02, 15, 33, 0, DateTimeKind.Utc), 8.5m));

        db.MatchScoreEvent.AddRange(
            LegacyEvent(18022, 1010, 1, new DateTime(2026, 06, 02, 15, 31, 0, DateTimeKind.Utc)),
            LegacyEvent(18022, 2010, 2, new DateTime(2026, 06, 02, 15, 31, 30, DateTimeKind.Utc)),
            LegacyEvent(18022, 1010, 3, new DateTime(2026, 06, 02, 15, 32, 0, DateTimeKind.Utc)),
            LegacyEvent(18022, 2010, 4, new DateTime(2026, 06, 02, 15, 32, 30, DateTimeKind.Utc)),
            LegacyEvent(18022, 1010, 5, new DateTime(2026, 06, 02, 15, 33, 0, DateTimeKind.Utc)));

        db.Bet.Add(new Bet
        {
            BetId = 1,
            MatchId = 18022,
            TeamId = 1010,
            UserId = 1,
            Position = 1,
            Amount = 10m,
            BetTime = new DateTime(2026, 06, 02, 15, 0, 0, DateTimeKind.Utc),
            SettledAt = new DateTimeOffset(new DateTime(2026, 06, 02, 16, 31, 0, DateTimeKind.Utc)),
            PayoutAmount = 18m,
            IsWinner = true
        });

        db.SaveChanges();
    }

    private static void SeedPercentageCrossoverTouchMatch(EthicAIDbContext db)
    {
        SeedCurrenciesAndTeams(db, 301, "CHZUSDT", 401, "XAUTUSDT");

        db.Match.Add(new Match
        {
            MatchId = 19001,
            TeamAId = 3010,
            TeamBId = 4010,
            ScoreA = 9,
            ScoreB = 9,
            Status = MatchStatus.Ongoing,
            ScoringRuleType = MatchScoringRuleType.PercentageCrossover,
            StartTime = new DateTime(2026, 06, 02, 15, 0, 0, DateTimeKind.Utc)
        });

        db.MatchScoreState.Add(new MatchScoreState
        {
            MatchId = 19001,
            CreatedAtUtc = new DateTime(2026, 06, 02, 15, 0, 0, DateTimeKind.Utc),
            UpdatedAtUtc = new DateTime(2026, 06, 02, 15, 0, 0, DateTimeKind.Utc)
        });

        db.MatchMetricSnapshot.AddRange(
            Snapshot(19001, 3010, new DateTime(2026, 06, 02, 15, 30, 0, DateTimeKind.Utc), 0.5m),
            Snapshot(19001, 4010, new DateTime(2026, 06, 02, 15, 30, 0, DateTimeKind.Utc), 1.5m),
            Snapshot(19001, 3010, new DateTime(2026, 06, 02, 15, 31, 0, DateTimeKind.Utc), 1.0m),
            Snapshot(19001, 4010, new DateTime(2026, 06, 02, 15, 31, 0, DateTimeKind.Utc), 1.0m));

        db.SaveChanges();
    }

    private static void SeedCurrenciesAndTeams(EthicAIDbContext db, int currencyAId, string symbolA, int currencyBId, string symbolB)
    {
        db.Currency.Add(new Currency
        {
            CurrencyId = currencyAId,
            Name = symbolA,
            Symbol = symbolA,
            PercentageChange = 0,
            QuoteVolume = 0m,
            TradesCount = 0,
            LastUpdated = new DateTime(2026, 06, 02, 15, 0, 0, DateTimeKind.Utc)
        });

        db.Currency.Add(new Currency
        {
            CurrencyId = currencyBId,
            Name = symbolB,
            Symbol = symbolB,
            PercentageChange = 0,
            QuoteVolume = 0m,
            TradesCount = 0,
            LastUpdated = new DateTime(2026, 06, 02, 15, 0, 0, DateTimeKind.Utc)
        });

        db.Team.Add(new Team { TeamId = currencyAId * 10, CurrencyId = currencyAId });
        db.Team.Add(new Team { TeamId = currencyBId * 10, CurrencyId = currencyBId });
    }

    private static MatchMetricSnapshot Snapshot(int matchId, int teamId, DateTime capturedAtUtc, decimal percentageChange)
    {
        return new MatchMetricSnapshot
        {
            MatchId = matchId,
            TeamId = teamId,
            CapturedAtUtc = capturedAtUtc,
            PercentageChange = percentageChange,
            QuoteVolume = 100m + percentageChange,
            TradeCount = 10
        };
    }

    private static MatchScoreEvent LegacyEvent(int matchId, int teamId, int sequence, DateTime eventTimeUtc)
    {
        return new MatchScoreEvent
        {
            MatchId = matchId,
            TeamId = teamId,
            RuleType = MatchScoringRuleType.PercentageCrossover,
            EventType = "LEGACY_EVENT",
            ReasonCode = "LEGACY_EVENT",
            Points = 1,
            EventSequence = sequence,
            Description = "legacy",
            EventTimeUtc = eventTimeUtc
        };
    }
}
