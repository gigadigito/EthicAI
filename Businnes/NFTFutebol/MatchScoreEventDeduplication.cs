using DAL.NftFutebol;
using EthicAI.EntityModel;
using Microsoft.EntityFrameworkCore;

namespace BLL.NFTFutebol;

public sealed record MatchScoreEventDuplicateMatch(
    long MatchScoreEventId,
    int MatchId,
    int TeamId,
    MatchScoringRuleType RuleType,
    string EventType,
    string? ReasonCode,
    DateTime EventTimeUtc);

public static class MatchScoreEventDeduplication
{
    public static async Task<MatchScoreEventDuplicateMatch?> FindDuplicateAsync(
        EthicAIDbContext db,
        int matchId,
        PendingMatchScoreEvent candidate,
        CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(db);
        ArgumentNullException.ThrowIfNull(candidate);

        var eventTimeUtc = EnsureUtc(candidate.EventTimeUtc);
        var reasonCode = candidate.ReasonCode ?? string.Empty;

        return await db.MatchScoreEvent
            .AsNoTracking()
            .Where(x =>
                x.MatchId == matchId &&
                x.TeamId == candidate.TeamId &&
                x.RuleType == candidate.RuleType &&
                x.EventType == candidate.EventType &&
                (x.ReasonCode ?? string.Empty) == reasonCode &&
                x.Points == candidate.Points &&
                x.TeamPercentageChange == candidate.TeamPercentageChange &&
                x.OpponentPercentageChange == candidate.OpponentPercentageChange &&
                x.TeamQuoteVolume == candidate.TeamQuoteVolume &&
                x.OpponentQuoteVolume == candidate.OpponentQuoteVolume &&
                x.MetricDelta == candidate.MetricDelta &&
                x.EventTimeUtc == eventTimeUtc &&
                x.WindowStartUtc == candidate.WindowStartUtc &&
                x.WindowEndUtc == candidate.WindowEndUtc)
            .Select(x => new MatchScoreEventDuplicateMatch(
                x.MatchScoreEventId,
                x.MatchId,
                x.TeamId,
                x.RuleType,
                x.EventType,
                x.ReasonCode,
                x.EventTimeUtc))
            .FirstOrDefaultAsync(ct);
    }

    private static DateTime EnsureUtc(DateTime value)
        => value.Kind == DateTimeKind.Unspecified
            ? DateTime.SpecifyKind(value, DateTimeKind.Utc)
            : value.ToUniversalTime();
}
