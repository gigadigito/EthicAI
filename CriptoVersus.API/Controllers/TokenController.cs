using CriptoVersus.API.Contracts;
using CriptoVersus.API.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace CriptoVersus.API.Controllers;

[AllowAnonymous]
[ApiController]
[Route("api/token")]
public sealed class TokenController : ControllerBase
{
    private readonly ITokenMarketSnapshotService _tokenMarketSnapshotService;

    public TokenController(ITokenMarketSnapshotService tokenMarketSnapshotService)
    {
        _tokenMarketSnapshotService = tokenMarketSnapshotService;
    }

    [HttpGet("market")]
    [ProducesResponseType(typeof(TokenMarketSnapshotResponse), StatusCodes.Status200OK)]
    public async Task<ActionResult<TokenMarketSnapshotResponse>> GetMarket(
        [FromQuery] string? contractAddress,
        CancellationToken ct)
    {
        var snapshot = await _tokenMarketSnapshotService.GetSnapshotAsync(contractAddress, ct);
        return Ok(snapshot);
    }

    [HttpGet("market/debug")]
    [ProducesResponseType(typeof(TokenMarketDebugResponse), StatusCodes.Status200OK)]
    public async Task<ActionResult<TokenMarketDebugResponse>> GetMarketDebug(
        [FromQuery] string? contractAddress,
        CancellationToken ct)
    {
        var diagnostics = await _tokenMarketSnapshotService.GetDebugSnapshotAsync(contractAddress, ct);
        return Ok(diagnostics);
    }
}
