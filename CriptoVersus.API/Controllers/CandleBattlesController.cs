using System.Text.Json;
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
        var scoreLeft = await all.CountAsync(r => r.Winner == "left", ct);
        var scoreRight = await all.CountAsync(r => r.Winner == "right", ct);
        var query = all;
        if (after.HasValue)
        {
            var open = DateTimeOffset.FromUnixTimeMilliseconds(after.Value).UtcDateTime;
            query = query.Where(r => r.OpenTimeUtc > open);
        }
        var records = await query.OrderBy(r => r.OpenTimeUtc).Take(take + 1).ToListAsync(ct);
        var rounds = records.Take(take).Select(r => new CandleBattlesRoundDto(
            $"{r.MatchId}:5m:{new DateTimeOffset(r.OpenTimeUtc).ToUnixTimeMilliseconds()}", r.MatchId,
            JsonSerializer.Deserialize<CandleBattlesCandleDto>(r.LeftCandleJson)!,
            JsonSerializer.Deserialize<CandleBattlesCandleDto>(r.RightCandleJson)!, r.Winner, r.RuleVersion, r.LeftStrength, r.RightStrength)).ToArray();
        var status = state?.Status ?? "waiting";
        if (state is { Complete: false } && state.UpdatedAtUtc < DateTime.UtcNow.AddMinutes(-2)) status = "delayed";
        return Ok(new CandleBattlesFeedDto(matchId, match.TeamA.Currency.Symbol, match.TeamB.Currency.Symbol,
            scoreLeft, scoreRight, state?.Complete ?? false, status,
            state?.LeftFormingJson is { } a ? JsonSerializer.Deserialize<CandleBattlesCandleDto>(a) : null,
            state?.RightFormingJson is { } b ? JsonSerializer.Deserialize<CandleBattlesCandleDto>(b) : null,
            rounds, records.Count > take, rounds.LastOrDefault()?.Left.OpenTime ?? after));
    }
}
