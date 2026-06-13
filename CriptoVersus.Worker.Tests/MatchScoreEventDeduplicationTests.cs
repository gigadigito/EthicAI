using BLL.NFTFutebol;
using DAL.NftFutebol;
using EthicAI.EntityModel;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace CriptoVersus.Worker.Tests;

public sealed class MatchScoreEventDeduplicationTests
{
    [Fact]
    public async Task FindDuplicateAsync_FindsExactLogicalDuplicate()
    {
        await using var db = CreateDbContext();
        db.MatchScoreEvent.Add(new MatchScoreEvent
        {
            MatchId = 22028,
            TeamId = 11,
            RuleType = MatchScoringRuleType.CandleBattleDominance,
            EventType = "CANDLE_BATTLE_DOMINANCE",
            ReasonCode = "CANDLE_BATTLE_DOMINANCE",
            Points = 1,
            EventSequence = 7,
            EventTimeUtc = new DateTime(2026, 06, 13, 12, 4, 0, DateTimeKind.Utc)
        });
        await db.SaveChangesAsync();

        var duplicate = await MatchScoreEventDeduplication.FindDuplicateAsync(
            db,
            22028,
            new PendingMatchScoreEvent
            {
                TeamId = 11,
                RuleType = MatchScoringRuleType.CandleBattleDominance,
                EventType = "CANDLE_BATTLE_DOMINANCE",
                ReasonCode = "CANDLE_BATTLE_DOMINANCE",
                Points = 1,
                EventTimeUtc = new DateTime(2026, 06, 13, 12, 4, 0, DateTimeKind.Utc)
            });

        Assert.NotNull(duplicate);
        Assert.Equal(22028, duplicate!.MatchId);
        Assert.Equal(11, duplicate.TeamId);
    }

    [Fact]
    public async Task FindDuplicateAsync_DoesNotTreatDifferentReasonAsDuplicate()
    {
        await using var db = CreateDbContext();
        db.MatchScoreEvent.Add(new MatchScoreEvent
        {
            MatchId = 22028,
            TeamId = 11,
            RuleType = MatchScoringRuleType.CandleBattleDominance,
            EventType = "CANDLE_BATTLE_DOMINANCE",
            ReasonCode = "CANDLE_BATTLE_DOMINANCE",
            Points = 1,
            EventSequence = 7,
            EventTimeUtc = new DateTime(2026, 06, 13, 12, 4, 0, DateTimeKind.Utc)
        });
        await db.SaveChangesAsync();

        var duplicate = await MatchScoreEventDeduplication.FindDuplicateAsync(
            db,
            22028,
            new PendingMatchScoreEvent
            {
                TeamId = 11,
                RuleType = MatchScoringRuleType.CandleBattleDominance,
                EventType = "CANDLE_BATTLE_DOMINANCE",
                ReasonCode = "CANDLE_BATTLE_DOMINANCE_V2",
                Points = 1,
                EventTimeUtc = new DateTime(2026, 06, 13, 12, 4, 0, DateTimeKind.Utc)
            });

        Assert.Null(duplicate);
    }

    private static EthicAIDbContext CreateDbContext()
    {
        var options = new DbContextOptionsBuilder<EthicAIDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString("N"))
            .Options;

        return new EthicAIDbContext(options);
    }
}
