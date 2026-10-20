using System.Text.Json;
using BLL.NFTFutebol;
using CriptoVersus.API.Services;
using DAL.NftFutebol;
using DTOs;
using EthicAI.EntityModel;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace CriptoVersus.API.Controllers;

[ApiController]
[Route("api/matches/{matchId:int}/candle-battles")]
public sealed class CandleBattlesController(EthicAIDbContext db) : ControllerBase
{
    [HttpGet, AllowAnonymous]
    public async Task<ActionResult<CandleBattlesFeedDto>> Get(int matchId, [FromQuery] long? after = null,
        [FromQuery] int take = 200, CancellationToken ct = default)
    {
        if (take is < 1 or > 500 || after is < 0 or > 253402300799999) return BadRequest();
        var match = await db.Match.AsNoTracking().Include(m => m.TeamA).ThenInclude(t => t.Currency)
            .Include(m => m.TeamB).ThenInclude(t => t.Currency).SingleOrDefaultAsync(m => m.MatchId == matchId, ct);
        if (match is null) return NotFound();
        var state = await db.Set<CandleBattlesState>().AsNoTracking().SingleOrDefaultAsync(x => x.MatchId == matchId, ct);
        var all = db.Set<CandleBattlesRound>().AsNoTracking().Where(r => r.MatchId == matchId);
        if (match.StartTime.HasValue)
        {
            var startMs = new DateTimeOffset(DateTime.SpecifyKind(match.StartTime.Value, DateTimeKind.Utc)).ToUnixTimeMilliseconds();
            var firstMs = CandleBattlesResolver.FirstOpen(startMs);
            var lastCloseMs = CandleBattlesResolver.LastClose(startMs);
            if (match.EndTime.HasValue)
                lastCloseMs = Math.Min(lastCloseMs, new DateTimeOffset(DateTime.SpecifyKind(match.EndTime.Value, DateTimeKind.Utc)).ToUnixTimeMilliseconds());
            var firstUtc = DateTimeOffset.FromUnixTimeMilliseconds(firstMs).UtcDateTime;
            var lastOpenUtc = DateTimeOffset.FromUnixTimeMilliseconds(lastCloseMs - CandleBattlesResolver.PeriodMs).UtcDateTime;
            all = all.Where(r => r.OpenTimeUtc >= firstUtc && r.OpenTimeUtc <= lastOpenUtc);
        }
        var legacy = await all.Where(r => r.RuleVersion != CandleBattlesResolver.Version).ToListAsync(ct);
        var scoreLeft = await all.CountAsync(r => r.RuleVersion == CandleBattlesResolver.Version && r.Winner == "left", ct)
            + legacy.Count(r => CandleBattlesRoundProjection.EffectiveWinner(r) == "left");
        var scoreRight = await all.CountAsync(r => r.RuleVersion == CandleBattlesResolver.Version && r.Winner == "right", ct)
            + legacy.Count(r => CandleBattlesRoundProjection.EffectiveWinner(r) == "right");
        var query = all;
        if (after.HasValue)
        {
            var open = DateTimeOffset.FromUnixTimeMilliseconds(after.Value).UtcDateTime;
            query = query.Where(r => r.OpenTimeUtc > open);
        }
        var records = await query.OrderBy(r => r.OpenTimeUtc).Take(take + 1).ToListAsync(ct);
        var rounds = records.Take(take).Select(CandleBattlesRoundProjection.ToDto).ToArray();
        var finished = state?.Complete ?? match.Status is MatchStatus.Completed or MatchStatus.Cancelled;
        var status = state?.Status ?? (finished ? "unavailable" : "waiting");
        if (state is { Complete: false } && state.UpdatedAtUtc < DateTime.UtcNow.AddMinutes(-2)) status = "delayed";
        return Ok(new CandleBattlesFeedDto(matchId, match.TeamA.Currency.Symbol, match.TeamB.Currency.Symbol,
            scoreLeft, scoreRight, finished, status,
            state?.LeftFormingJson is { } a ? JsonSerializer.Deserialize<CandleBattlesCandleDto>(a) : null,
            state?.RightFormingJson is { } b ? JsonSerializer.Deserialize<CandleBattlesCandleDto>(b) : null,
            rounds, records.Count > take, rounds.LastOrDefault()?.Left.OpenTime ?? after,
            match.StartTime.HasValue ? new DateTimeOffset(DateTime.SpecifyKind(match.StartTime.Value, DateTimeKind.Utc)).ToUnixTimeMilliseconds() : null,
            match.EndTime.HasValue ? new DateTimeOffset(DateTime.SpecifyKind(match.EndTime.Value, DateTimeKind.Utc)).ToUnixTimeMilliseconds() : null,
            CandleBattlesResolver.ExpectedRounds, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()));
    }

}
