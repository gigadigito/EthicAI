using CriptoVersus.API.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace CriptoVersus.API.Controllers;

[ApiController]
[Route("api/tv")]
public sealed class TvController : ControllerBase
{
    private readonly ITvHotMatchService _tvHotMatchService;

    public TvController(ITvHotMatchService tvHotMatchService)
    {
        _tvHotMatchService = tvHotMatchService;
    }

    [AllowAnonymous]
    [HttpGet("hot-match")]
    public async Task<IActionResult> GetHotMatch(CancellationToken ct)
        => Ok(await _tvHotMatchService.GetHotMatchAsync(ct));
}
