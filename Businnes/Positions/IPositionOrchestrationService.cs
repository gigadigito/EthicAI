using DAL.NftFutebol;
using EthicAI.EntityModel;

namespace BLL.Positions;

public interface IPositionOrchestrationService
{
    string BuildBlockchainModeSnapshot();

    Task RecordLifecycleEventAsync(
        EthicAIDbContext db,
        UserTeamPosition position,
        PositionLifecycleEventType eventType,
        DateTime createdAtUtc,
        int? matchId = null,
        int? betId = null,
        decimal? amount = null,
        decimal? capitalBefore = null,
        decimal? capitalAfter = null,
        decimal? pnl = null,
        string? notes = null,
        CancellationToken ct = default);

    Task<bool> EnsureAllocationAsync(
        EthicAIDbContext db,
        UserTeamPosition position,
        Bet bet,
        DateTime createdAtUtc,
        PositionLifecycleEventType? lifecycleEventType,
        string? lifecycleNotes,
        CancellationToken ct);

    Task SyncSettlementAsync(
        EthicAIDbContext db,
        UserTeamPosition position,
        Bet bet,
        decimal capitalAfterSettlement,
        DateTime settledAtUtc,
        CancellationToken ct);
}
