using CriptoVersus.API.Contracts;
using CriptoVersus.API.Services;
using DTOs;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace CriptoVersus.API.Controllers;

[ApiController]
[Route("api/social")]
public sealed class SocialController : ControllerBase
{
    private readonly ISocialAutomationService _socialAutomationService;
    private readonly ISocialVsRenderService _socialVsRenderService;

    public SocialController(
        ISocialAutomationService socialAutomationService,
        ISocialVsRenderService socialVsRenderService)
    {
        _socialAutomationService = socialAutomationService;
        _socialVsRenderService = socialVsRenderService;
    }

    [AllowAnonymous]
    [HttpGet("hot-matches")]
    public async Task<ActionResult<IReadOnlyList<SocialHotMatchDto>>> GetHotMatches(CancellationToken ct)
    {
        var items = await _socialAutomationService.GetHotMatchesAsync(ct);
        return Ok(items);
    }

    [AllowAnonymous]
    [HttpGet("matches/{matchId:int}/goal-logs")]
    public async Task<ActionResult<IReadOnlyList<SocialGoalLogDto>>> GetGoalLogs(int matchId, CancellationToken ct)
    {
        var items = await _socialAutomationService.GetGoalLogsAsync(matchId, ct);
        return items is null ? NotFound() : Ok(items);
    }

    [AllowAnonymous]
    [HttpGet("matches/{matchId:int}/share-card")]
    public async Task<ActionResult<SocialShareCardDto>> GetShareCard(int matchId, CancellationToken ct)
    {
        var item = await _socialAutomationService.GetShareCardAsync(matchId, ct);
        return item is null ? NotFound() : Ok(item);
    }

    [AllowAnonymous]
    [HttpGet("matches/{matchId:int}/image")]
    public async Task<ActionResult<SocialMatchImageDto>> GetMatchImage(int matchId, CancellationToken ct)
    {
        var item = await _socialAutomationService.GetMatchImageAsync(matchId, ct);
        return item is null ? NotFound() : Ok(item);
    }

    [AllowAnonymous]
    [HttpPost("posts/register")]
    public async Task<ActionResult> RegisterPost([FromBody] RegisterSocialPostRequest request, CancellationToken ct)
    {
        var result = await _socialAutomationService.RegisterPostAsync(request, ct);

        if (result.NotFoundMatch)
            return NotFound(new { message = result.Error });

        if (!result.Success)
            return Conflict(new { message = result.Error });

        return Ok(new
        {
            id = result.Id,
            createdAtUtc = result.CreatedAtUtc
        });
    }

    [AllowAnonymous]
    [HttpPost("render-vs")]
    public async Task<IActionResult> RenderVs([FromBody] SocialVsRenderRequest request, CancellationToken ct)
    {
        try
        {
            var bytes = await _socialVsRenderService.RenderAsync(request, ct);
            return File(bytes, "image/png");
        }
        catch (ArgumentException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    [AllowAnonymous]
    [HttpGet("render-vs-test")]
    public async Task<IActionResult> RenderVsTest(
        [FromQuery(Name = "left")] string left,
        [FromQuery(Name = "right")] string right,
        [FromQuery] string? score,
        CancellationToken ct)
    {
        try
        {
            var bytes = await _socialVsRenderService.RenderAsync(new SocialVsRenderRequest
            {
                LeftSymbol = left,
                RightSymbol = right,
                Score = score
            }, ct);

            return File(bytes, "image/png");
        }
        catch (ArgumentException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }
}
