using BLL.Blockchain;
using DAL.NftFutebol;
using EthicAI.EntityModel;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace BLL.Positions;

public sealed class PositionOrchestrationService : IPositionOrchestrationService
{
    private readonly CriptoVersusBlockchainOptions _blockchainOptions;

    public PositionOrchestrationService(IOptions<CriptoVersusBlockchainOptions> blockchainOptions)
    {
        _blockchainOptions = blockchainOptions.Value;
    }

    public string BuildBlockchainModeSnapshot()
        => _blockchainOptions.Mode.ToString();

    public async Task RecordLifecycleEventAsync(
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
        CancellationToken ct = default)
    {
        db.PositionLifecycleEvent.Add(new PositionLifecycleEvent
        {
            PositionId = position.PositionId,
            MatchId = matchId,
            BetId = betId,
            EventType = eventType,
            Amount = RoundMoney(amount),
            CapitalBefore = RoundMoney(capitalBefore),
            CapitalAfter = RoundMoney(capitalAfter),
            PnL = RoundMoney(pnl),
            Notes = string.IsNullOrWhiteSpace(notes) ? null : notes.Trim(),
            CreatedAt = createdAtUtc
        });

        await db.SaveChangesAsync(ct);
    }

    public async Task<bool> EnsureAllocationAsync(
        EthicAIDbContext db,
        UserTeamPosition position,
        Bet bet,
        DateTime createdAtUtc,
        PositionLifecycleEventType? lifecycleEventType,
        string? lifecycleNotes,
        CancellationToken ct)
    {
        var allocation = await db.PositionAllocation
            .FirstOrDefaultAsync(
                x => x.PositionId == position.PositionId && x.MatchId == bet.MatchId,
                ct);

        var created = false;
        if (allocation is null)
        {
            allocation = new PositionAllocation
            {
                PositionId = position.PositionId,
                MatchId = bet.MatchId,
                BetId = bet.BetId > 0 ? bet.BetId : null,
                AllocatedAmount = RoundMoney(bet.Amount) ?? 0m,
                ResultAmount = null,
                PnL = null,
                Status = PositionAllocationStatus.Active,
                CreatedAt = createdAtUtc,
                SettledAt = null
            };

            db.PositionAllocation.Add(allocation);
            created = true;
        }
        else
        {
            allocation.BetId = bet.BetId > 0 ? bet.BetId : allocation.BetId;
            allocation.AllocatedAmount = RoundMoney(bet.Amount) ?? 0m;
            allocation.Status = PositionAllocationStatus.Active;
        }

        await db.SaveChangesAsync(ct);

        if (created && lifecycleEventType.HasValue)
        {
            await RecordLifecycleEventAsync(
                db,
                position,
                lifecycleEventType.Value,
                createdAtUtc,
                matchId: bet.MatchId,
                betId: bet.BetId > 0 ? bet.BetId : null,
                amount: bet.Amount,
                capitalBefore: position.CurrentCapital,
                capitalAfter: position.CurrentCapital,
                notes: lifecycleNotes,
                ct: ct);
        }

        return created;
    }

    public async Task SyncSettlementAsync(
        EthicAIDbContext db,
        UserTeamPosition position,
        Bet bet,
        decimal capitalAfterSettlement,
        DateTime settledAtUtc,
        CancellationToken ct)
    {
        var allocation = await db.PositionAllocation
            .FirstOrDefaultAsync(
                x => x.PositionId == position.PositionId && x.MatchId == bet.MatchId,
                ct);

        var stake = RoundMoney(bet.Amount) ?? 0m;
        var resultAmount = RoundMoney(capitalAfterSettlement) ?? 0m;
        var pnl = RoundMoney(resultAmount - stake) ?? 0m;

        if (allocation is null)
        {
            allocation = new PositionAllocation
            {
                PositionId = position.PositionId,
                MatchId = bet.MatchId,
                BetId = bet.BetId,
                AllocatedAmount = stake,
                CreatedAt = bet.BetTime,
                Status = PositionAllocationStatus.Settled,
                ResultAmount = resultAmount,
                PnL = pnl,
                SettledAt = settledAtUtc
            };

            db.PositionAllocation.Add(allocation);
        }
        else
        {
            allocation.BetId = bet.BetId;
            allocation.AllocatedAmount = stake;
            allocation.ResultAmount = resultAmount;
            allocation.PnL = pnl;
            allocation.Status = PositionAllocationStatus.Settled;
            allocation.SettledAt = settledAtUtc;
        }

        position.TotalPnL = RoundMoney(position.TotalPnL + pnl) ?? 0m;
        if (pnl > 0m)
            position.TotalWins++;
        else if (pnl < 0m)
            position.TotalLosses++;

        await db.SaveChangesAsync(ct);

        await RecordLifecycleEventAsync(
            db,
            position,
            PositionLifecycleEventType.MatchSettled,
            settledAtUtc,
            matchId: bet.MatchId,
            betId: bet.BetId,
            amount: stake,
            capitalBefore: stake,
            capitalAfter: resultAmount,
            pnl: pnl,
            notes: pnl > 0m ? "Winning settlement applied." : pnl < 0m ? "Losing settlement applied." : "Flat settlement applied.",
            ct: ct);
    }

    private static decimal? RoundMoney(decimal? value)
        => value.HasValue
            ? Math.Round(value.Value, 8, MidpointRounding.ToZero)
            : null;
}
