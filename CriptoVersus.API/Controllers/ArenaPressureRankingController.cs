using CriptoVersus.API.Services;
using DTOs;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace CriptoVersus.API.Controllers;

[ApiController]
[Route("api/arena-pressure/rankings")]
public sealed class ArenaPressureRankingController(IArenaPressureRankingService service) : ControllerBase
{
    [Authorize(Policy = SocialAutomationDefaults.PolicyName)]
    [HttpGet("today")]
    [ProducesResponseType(typeof(ArenaPressureRankingResponseDto), StatusCodes.Status200OK)]
    public async Task<ActionResult<ArenaPressureRankingResponseDto>> GetToday(
        [FromQuery] int page = 1, [FromQuery] int pageSize = 20, CancellationToken ct = default)
        => Ok(await service.GetTodayAsync(page, pageSize, ct));
}
