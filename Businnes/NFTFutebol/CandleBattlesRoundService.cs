using System.Text.Json;
using DAL.NftFutebol;
using DTOs;
using EthicAI.EntityModel;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace BLL.NFTFutebol;

public sealed class CandleBattlesRoundService(EthicAIDbContext db, BinanceKlineClient market, ILogger<CandleBattlesRoundService> logger)
{
    public async Task ProcessAsync(DateTime nowUtc, Func<CancellationToken, Task> heartbeat, CancellationToken ct)
    {
        using var budget = CancellationTokenSource.CreateLinkedTokenSource(ct);
        budget.CancelAfter(TimeSpan.FromSeconds(20));
        try { await ProcessCoreAsync(nowUtc, heartbeat, budget.Token); }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        {
            logger.LogWarning("Candle Battles cycle budget reached; pending cursors will resume next cycle.");
        }
    }

    private async Task ProcessCoreAsync(DateTime nowUtc, Func<CancellationToken, Task> heartbeat, CancellationToken ct)
    {
        // Enrol current matches only. Existing states retain their backlog across restarts and match completion.
        var recent = nowUtc.AddMinutes(-10);
        var discovered = await db.Match.AsNoTracking().Where(m => m.StartTime != null &&
            (m.Status == MatchStatus.Ongoing || (m.EndTime >= recent && m.Status == MatchStatus.Completed)))
            .Select(m => new { m.MatchId, m.StartTime }).ToListAsync(ct);
        foreach (var m in discovered)
        {
            var start = new DateTimeOffset(DateTime.SpecifyKind(m.StartTime!.Value, DateTimeKind.Utc)).ToUnixTimeMilliseconds();
            var next = DateTimeOffset.FromUnixTimeMilliseconds((start + 299_999) / 300_000 * 300_000).UtcDateTime;
            await db.Database.ExecuteSqlInterpolatedAsync($@"INSERT INTO candle_battles_state (""MatchId"", ""NextOpenUtc"", ""UpdatedAtUtc"", ""Complete"", ""Status"")
                VALUES ({m.MatchId}, {next}, {nowUtc}, false, 'waiting') ON CONFLICT (""MatchId"") DO NOTHING", ct);
        }
        var ids = await db.Set<CandleBattlesState>().AsNoTracking().Where(s => !s.Complete)
            .OrderBy(s => s.UpdatedAtUtc).ThenBy(s => s.MatchId).Take(100).Select(s => s.MatchId).ToListAsync(ct);
        if (ids.Count == 0) return;
        var serverTime = await market.GetServerTimeAsync(ct);
        foreach (var id in ids)
        {
            await heartbeat(ct);
            try { await ProcessMatchAsync(id, serverTime, nowUtc, ct); }
            catch (OperationCanceledException) when (ct.IsCancellationRequested) { throw; }
            catch (Exception ex)
            {
                db.ChangeTracker.Clear();
                logger.LogWarning("Candle Battles market/history unavailable for match {MatchId}: {ErrorType}", id, ex.GetType().Name);
                await db.Set<CandleBattlesState>().Where(s => s.MatchId == id).ExecuteUpdateAsync(s => s
                    .SetProperty(x => x.Status, "market-unavailable").SetProperty(x => x.UpdatedAtUtc, nowUtc), ct);
            }
        }
    }

    private async Task ProcessMatchAsync(int id, long serverTime, DateTime nowUtc, CancellationToken ct)
    {
        var match = await db.Match.AsNoTracking().Include(m => m.TeamA).ThenInclude(t => t.Currency)
            .Include(m => m.TeamB).ThenInclude(t => t.Currency).SingleAsync(m => m.MatchId == id, ct);
        var state = await db.Set<CandleBattlesState>().AsNoTracking().SingleAsync(s => s.MatchId == id, ct);
        var cursor = new DateTimeOffset(state.NextOpenUtc).ToUnixTimeMilliseconds();
        var end = match.EndTime.HasValue ? new DateTimeOffset(DateTime.SpecifyKind(match.EndTime.Value, DateTimeKind.Utc)).ToUnixTimeMilliseconds() : serverTime;
        end = Math.Min(end, serverTime);
        var from = cursor - CandleBattlesResolver.HistoryLength * 300_000L;
        var to = Math.Min(serverTime, cursor + 64 * 300_000L - 1);
        var aTask = market.GetAsync(match.TeamA.Currency.Symbol, 5, from, to, 85, serverTime, ct);
        var bTask = market.GetAsync(match.TeamB.Currency.Symbol, 5, from, to, 85, serverTime, ct);
        await Task.WhenAll(aTask, bTask);
        var a = aTask.Result; var b = bTask.Result;
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        // Serializes concurrent workers before reading the durable cursor; unique PK is a second guard.
        await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(20261015, {id})", ct);
        state = await db.Set<CandleBattlesState>().SingleAsync(s => s.MatchId == id, ct);
        if (new DateTimeOffset(state.NextOpenUtc).ToUnixTimeMilliseconds() != cursor) return;
        state.Status = "live";
        var formingA = WithPreviewStrength(a.LastOrDefault(x => !x.Confirmed), a);
        var formingB = WithPreviewStrength(b.LastOrDefault(x => !x.Confirmed), b);
        state.LeftFormingJson = formingA is null ? state.LeftFormingJson : JsonSerializer.Serialize(formingA);
        state.RightFormingJson = formingB is null ? state.RightFormingJson : JsonSerializer.Serialize(formingB);
        for (var i = 0; i < 64 && cursor + 300_000 <= end; i++)
        {
            var left = a.SingleOrDefault(x => x.OpenTime == cursor && x.Confirmed);
            var right = b.SingleOrDefault(x => x.OpenTime == cursor && x.Confirmed);
            if (left is null || right is null) { state.Status = "waiting-confirmation"; break; }
            var leftHistory = a.Where(x => x.OpenTime >= cursor - 20 * 300_000L && x.OpenTime < cursor).ToArray();
            var rightHistory = b.Where(x => x.OpenTime >= cursor - 20 * 300_000L && x.OpenTime < cursor).ToArray();
            var round = CandleBattlesResolver.Resolve(id, left, right, leftHistory, rightHistory);
            var openUtc = DateTimeOffset.FromUnixTimeMilliseconds(cursor).UtcDateTime;
            if (!await db.Set<CandleBattlesRound>().AnyAsync(r => r.MatchId == id && r.OpenTimeUtc == openUtc, ct))
                db.Add(new CandleBattlesRound { MatchId = id, OpenTimeUtc = openUtc,
                    LeftCandleJson = JsonSerializer.Serialize(left), RightCandleJson = JsonSerializer.Serialize(right),
                    LeftStrength = round.LeftStrength, RightStrength = round.RightStrength,
                    Winner = round.Winner, RuleVersion = round.RuleVersion, ConfirmedAtUtc = nowUtc });
            cursor += 300_000;
        }
        state.NextOpenUtc = DateTimeOffset.FromUnixTimeMilliseconds(cursor).UtcDateTime;
        state.Complete = match.EndTime.HasValue && match.EndTime.Value <= DateTimeOffset.FromUnixTimeMilliseconds(serverTime).UtcDateTime && cursor + 300_000 > end;
        if (state.Complete) state.Status = "finished";
        state.UpdatedAtUtc = nowUtc;
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        db.ChangeTracker.Clear();
    }

    private static CandleBattlesCandleDto? WithPreviewStrength(CandleBattlesCandleDto? candle, IReadOnlyList<CandleBattlesCandleDto> history)
    {
        if (candle is null) return null;
        var prior = history.Where(x => x.OpenTime < candle.OpenTime && x.OpenTime >= candle.OpenTime - 20 * 300_000L).ToArray();
        try { return candle with { Strength = CandleBattlesResolver.PreviewStrength(candle, prior) }; }
        catch (ArgumentException) { return candle; }
    }
}
