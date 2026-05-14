using CriptoVersus.API.Services;
using DTOs;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace CriptoVersus.API.Controllers;

[ApiController]
[Route("api/tv")]
public sealed class TvController : ControllerBase
{
    private readonly ITvHotMatchService _tvHotMatchService;
    private readonly ITvAiNarrationService _tvAiNarrationService;

    public TvController(ITvHotMatchService tvHotMatchService, ITvAiNarrationService tvAiNarrationService)
    {
        _tvHotMatchService = tvHotMatchService;
        _tvAiNarrationService = tvAiNarrationService;
    }

    [AllowAnonymous]
    [HttpGet("hot-match")]
    public async Task<IActionResult> GetHotMatch(CancellationToken ct)
        => Ok(await _tvHotMatchService.GetHotMatchAsync(ct));

    [AllowAnonymous]
    [HttpPost("narration/{matchId:int}")]
    public async Task<IActionResult> GenerateNarration(int matchId, [FromBody] TvNarrationRequest? request, CancellationToken ct)
        => Ok(await _tvAiNarrationService.GenerateNarrationAsync(matchId, request ?? new TvNarrationRequest(), ct));
}
