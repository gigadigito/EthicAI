using CriptoVersus.API.Contracts;
using CriptoVersus.API.Services;
using DAL.NftFutebol;
using DTOs;
using EthicAI.EntityModel;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace CriptoVersus.API.Controllers;

[ApiController]
[Route("api/social")]
public sealed class SocialController : ControllerBase
{
    private readonly ISocialAutomationService _socialAutomationService;
    private readonly ISocialVsRenderService _socialVsRenderService;
    private readonly ISocialComposeFinalService _socialComposeFinalService;
    private readonly EthicAIDbContext _db;
    private readonly IConfiguration _configuration;

    public SocialController(
        EthicAIDbContext db,
        IConfiguration configuration,
        ISocialAutomationService socialAutomationService,
        ISocialVsRenderService socialVsRenderService,
        ISocialComposeFinalService socialComposeFinalService)
    {
        _db = db;
        _configuration = configuration;
        _socialAutomationService = socialAutomationService;
        _socialVsRenderService = socialVsRenderService;
        _socialComposeFinalService = socialComposeFinalService;
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
    [HttpGet("coin-profile/{symbol}")]
    public async Task<ActionResult<CoinSocialProfileDto>> GetCoinProfile(string symbol, CancellationToken ct)
    {
        var normalizedSymbol = NormalizeSymbol(symbol);
        if (string.IsNullOrWhiteSpace(normalizedSymbol))
            return BadRequest(new { message = "Symbol obrigatorio." });

        var entity = await _db.CoinSocialProfile
            .AsNoTracking()
            .FirstOrDefaultAsync(x => x.Symbol == normalizedSymbol, ct);

        if (entity is null)
            return NotFound(new { message = $"Perfil social nao encontrado para {normalizedSymbol}." });

        return Ok(ToDto(entity));
    }

    [AllowAnonymous]
    [HttpGet("coin-profiles")]
    public async Task<ActionResult<IReadOnlyList<CoinSocialProfileDto>>> GetCoinProfiles(
        [FromQuery] string? symbols,
        CancellationToken ct)
    {
        var normalizedSymbols = (symbols ?? string.Empty)
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(NormalizeSymbol)
            .Where(x => !string.IsNullOrWhiteSpace(x))
            .Distinct(StringComparer.Ordinal)
            .ToArray();

        if (normalizedSymbols.Length == 0)
            return Ok(Array.Empty<CoinSocialProfileDto>());

        var items = await _db.CoinSocialProfile
            .AsNoTracking()
            .Where(x => normalizedSymbols.Contains(x.Symbol))
            .OrderBy(x => x.Symbol)
            .Select(x => ToDto(x))
            .ToListAsync(ct);

        return Ok(items);
    }

    [AllowAnonymous]
    [HttpPost("coin-profile")]
    public async Task<ActionResult<CoinSocialProfileDto>> UpsertCoinProfile(
        [FromBody] UpsertCoinSocialProfileRequest request,
        CancellationToken ct)
    {
        if (!TryAuthorizeSocialWrite(out var error))
            return error;

        var normalizedSymbol = NormalizeSymbol(request.Symbol);
        if (string.IsNullOrWhiteSpace(normalizedSymbol))
            return BadRequest(new { message = "Symbol obrigatorio." });

        var nowUtc = DateTime.UtcNow;
        var entity = await _db.CoinSocialProfile
            .FirstOrDefaultAsync(x => x.Symbol == normalizedSymbol, ct);

        if (entity is null)
        {
            entity = new CoinSocialProfile
            {
                Symbol = normalizedSymbol,
                CreatedAtUtc = nowUtc
            };

            _db.CoinSocialProfile.Add(entity);
        }

        entity.Symbol = normalizedSymbol;
        entity.CoinGeckoId = TrimOrNull(request.CoinGeckoId);
        entity.ContractAddress = TrimOrNull(request.ContractAddress);
        entity.TwitterHandle = NormalizeTwitterHandle(request.TwitterHandle);
        entity.TelegramUrl = TrimOrNull(request.TelegramUrl);
        entity.WebsiteUrl = TrimOrNull(request.WebsiteUrl);
        entity.Source = TrimOrNull(request.Source);
        entity.LastCheckedUtc = nowUtc;
        entity.UpdatedAtUtc = nowUtc;

        await _db.SaveChangesAsync(ct);

        return Ok(ToDto(entity));
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

    [AllowAnonymous]
    [HttpPost("compose-final")]
    public async Task<IActionResult> ComposeFinal([FromBody] SocialComposeFinalRequest request, CancellationToken ct)
    {
        try
        {
            var bytes = await _socialComposeFinalService.ComposeAsync(request, ct);
            return File(bytes, "image/png");
        }
        catch (ArgumentException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    [AllowAnonymous]
    [HttpPost("compose-final-test")]
    public async Task<IActionResult> ComposeFinalTest([FromBody] SocialComposeFinalRequest request, CancellationToken ct)
    {
        try
        {
            var bytes = await _socialComposeFinalService.ComposeAsync(request, ct);
            return File(bytes, "image/png");
        }
        catch (ArgumentException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    private bool TryAuthorizeSocialWrite(out ActionResult error)
    {
        if (User.Identity?.IsAuthenticated == true)
        {
            error = Ok();
            return true;
        }

        var expectedKey = _configuration["SocialAutomation:ApiKey"];
        if (string.IsNullOrWhiteSpace(expectedKey))
        {
            error = Ok();
            return true;
        }

        if (!Request.Headers.TryGetValue("X-Social-Key", out var providedKey) ||
            !string.Equals(providedKey.ToString(), expectedKey, StringComparison.Ordinal))
        {
            error = Unauthorized(new { message = "Chave de automacao invalida. Informe X-Social-Key ou use JWT." });
            return false;
        }

        error = Ok();
        return true;
    }

    private static CoinSocialProfileDto ToDto(CoinSocialProfile entity) => new()
    {
        Symbol = entity.Symbol,
        CoinGeckoId = entity.CoinGeckoId,
        ContractAddress = entity.ContractAddress,
        TwitterHandle = entity.TwitterHandle,
        TelegramUrl = entity.TelegramUrl,
        WebsiteUrl = entity.WebsiteUrl,
        Source = entity.Source,
        LastCheckedUtc = entity.LastCheckedUtc
    };

    private static string NormalizeSymbol(string? symbol)
    {
        if (string.IsNullOrWhiteSpace(symbol))
            return string.Empty;

        return symbol.Trim()
            .ToUpperInvariant()
            .Replace("USDT", string.Empty, StringComparison.Ordinal);
    }

    private static string? NormalizeTwitterHandle(string? value)
    {
        var trimmed = TrimOrNull(value);
        if (trimmed is null)
            return null;

        return $"@{trimmed.TrimStart('@')}";
    }

    private static string? TrimOrNull(string? value)
        => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}
