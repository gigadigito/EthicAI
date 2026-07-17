using System.Net;
using CriptoVersus.API.Services;
using DTOs;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace CriptoVersus.API.Controllers;

[AllowAnonymous]
[ApiController]
[Route("api/matches")]
public sealed class CommunityMatchesController : ControllerBase
{
    private readonly ICommunityMatchService _service;
    private readonly ILogger<CommunityMatchesController> _logger;

    public CommunityMatchesController(ICommunityMatchService service, ILogger<CommunityMatchesController> logger)
    {
        _service = service;
        _logger = logger;
    }

    [HttpPost("community")]
    [ProducesResponseType(typeof(CommunityMatchCreateResponseDto), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(CommunityMatchCreateResponseDto), StatusCodes.Status201Created)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    [ProducesResponseType(StatusCodes.Status409Conflict)]
    [ProducesResponseType(StatusCodes.Status429TooManyRequests)]
    [ProducesResponseType(StatusCodes.Status503ServiceUnavailable)]
    public async Task<ActionResult<CommunityMatchCreateResponseDto>> CreateCommunityMatch(
        [FromBody] CommunityMatchCreateRequestDto request,
        CancellationToken ct)
    {
        var remoteIp = HttpContext.Connection.RemoteIpAddress?.ToString();
        var result = await _service.CreateAsync(request, User, remoteIp, ct);

        if (result.StatusCode == HttpStatusCode.OK || result.StatusCode == HttpStatusCode.Created)
        {
            if (result.Response is null)
                return StatusCode(StatusCodes.Status500InternalServerError, new { message = "Unable to create battle." });

            if (result.StatusCode == HttpStatusCode.Created || result.Response.Created)
                return StatusCode(StatusCodes.Status201Created, result.Response);

            return Ok(result.Response);
        }

        if (result.StatusCode == HttpStatusCode.TooManyRequests && result.RetryAfterSeconds.HasValue)
            Response.Headers.RetryAfter = result.RetryAfterSeconds.Value.ToString(System.Globalization.CultureInfo.InvariantCulture);

        _logger.LogInformation(
            "community match request rejected. Status={StatusCode} MessageCode={MessageCode} RetryAfterSeconds={RetryAfterSeconds}",
            (int)result.StatusCode,
            result.MessageCode,
            result.RetryAfterSeconds);

        return StatusCode((int)result.StatusCode, new
        {
            messageCode = result.MessageCode,
            message = result.MessageCode,
            detail = result.Detail,
            retryAfterSeconds = result.RetryAfterSeconds
        });
    }
}
