using CriptoVersus.API.Services;
using DTOs;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace CriptoVersus.API.Controllers;

[ApiController]
[AllowAnonymous]
[Route("api/matches/{matchId:int}/whale-ocean")]
public sealed class WhaleOceanController(WhaleOceanScoreStore store) : ControllerBase
{
    [HttpGet("scoreboard")]
    public async Task<ActionResult<WhaleOceanScoreboardDto>> GetScoreboard(int matchId, CancellationToken ct)
    {
        if (matchId <= 0) return BadRequest();
        var scoreboard = await store.GetScoreboardAsync(matchId, ct);
        return scoreboard is null ? NotFound() : Ok(scoreboard);
    }
}
