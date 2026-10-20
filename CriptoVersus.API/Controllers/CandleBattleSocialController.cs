using CriptoVersus.API.Services;
using DTOs;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace CriptoVersus.API.Controllers;

[ApiController]
[Route("api/social/candle-battle")]
public sealed class CandleBattleSocialController(
    ICandleBattleSocialService social,
    ICandleBattlePublicationService publication) : ControllerBase
{
    [AllowAnonymous, HttpGet("highlight")]
    [ProducesResponseType(typeof(CandleBattleHighlightResponse), StatusCodes.Status200OK)]
    public async Task<ActionResult<CandleBattleHighlightResponse>> GetHighlight(
        [FromQuery] int lookbackHours = 6, [FromQuery] string language = "pt-BR",
        [FromQuery] bool includeRounds = true, CancellationToken ct = default)
        => Ok(await social.GetHighlightAsync(lookbackHours, language, includeRounds, ct));

    [Authorize(Policy = SocialAutomationDefaults.PolicyName), HttpGet("highlights/candidates")]
    [ProducesResponseType(typeof(CandleBattleCandidatesResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    public async Task<ActionResult<CandleBattleCandidatesResponse>> GetCandidates(
        [FromQuery] int lookbackHours = 6, [FromQuery] int take = 10, CancellationToken ct = default)
        => Ok(await social.GetCandidatesAsync(lookbackHours, take, ct));

    [AllowAnonymous, HttpGet("{matchId:int}")]
    [ProducesResponseType(typeof(CandleBattleSocialResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<CandleBattleSocialResponse>> GetByMatchId(
        int matchId, [FromQuery] string language = "pt-BR",
        [FromQuery] bool includeRounds = true, CancellationToken ct = default)
    {
        if (matchId <= 0) return BadRequest(new { error = "matchId_invalido" });
        var result = await social.GetByMatchIdAsync(matchId, language, includeRounds, ct);
        return result is null ? NotFound() : Ok(result);
    }

    [Authorize(Policy = SocialAutomationDefaults.PolicyName), HttpPost("{matchId:int}/reserve")]
    [ProducesResponseType(typeof(PriceCrossoverPublicationResult), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status409Conflict)]
    public async Task<ActionResult<PriceCrossoverPublicationResult>> Reserve(
        int matchId, [FromBody] PriceCrossoverReserveRequest? request, CancellationToken ct = default)
    {
        if (matchId <= 0) return BadRequest(new { error = "matchId_invalido" });
        var battle = await social.GetByMatchIdAsync(matchId, "pt-BR", false, ct);
        if (battle is null) return NotFound();
        if (!battle.CanPost) return Conflict(new PriceCrossoverPublicationResult
        {
            Success = false, Result = battle.SkipReason ?? "ineligible", Publication = battle.Publication
        });
        var result = await publication.ReserveAsync(matchId, request ?? new PriceCrossoverReserveRequest(), ct);
        return result.Success ? Ok(result) : Conflict(result);
    }

    [Authorize(Policy = SocialAutomationDefaults.PolicyName), HttpPost("{matchId:int}/confirm")]
    [ProducesResponseType(typeof(PriceCrossoverPublicationResult), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status409Conflict)]
    public async Task<ActionResult<PriceCrossoverPublicationResult>> Confirm(
        int matchId, [FromBody] PriceCrossoverConfirmRequest request, CancellationToken ct = default)
    {
        if (matchId <= 0) return BadRequest(new { error = "matchId_invalido" });
        if (request is null || string.IsNullOrWhiteSpace(request.Outcome))
            return BadRequest(new { error = "outcome_obrigatorio" });
        if (request.ReservedAtUtc is null)
            return BadRequest(new { error = "reservedAtUtc_obrigatorio" });
        if (string.Equals(request.Outcome, "posted", StringComparison.OrdinalIgnoreCase)
            && string.IsNullOrWhiteSpace(request.ExternalPostId)
            && string.IsNullOrWhiteSpace(request.ExternalPostUrl))
            return BadRequest(new { error = "confirmacao_externa_obrigatoria" });
        var result = await publication.ConfirmAsync(matchId, request, ct);
        return result.Success ? Ok(result) : Conflict(result);
    }

    [Authorize(Policy = SocialAutomationDefaults.PolicyName), HttpPost("{matchId:int}/release")]
    [ProducesResponseType(typeof(PriceCrossoverPublicationResult), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status409Conflict)]
    public async Task<ActionResult<PriceCrossoverPublicationResult>> Release(
        int matchId, [FromBody] PriceCrossoverReleaseRequest? request, CancellationToken ct = default)
    {
        if (matchId <= 0) return BadRequest(new { error = "matchId_invalido" });
        if (request?.ReservedAtUtc is null) return BadRequest(new { error = "reservedAtUtc_obrigatorio" });
        var result = await publication.ReleaseAsync(matchId, request.Reason, request.ReservedAtUtc, ct);
        return result.Success ? Ok(result) : Conflict(result);
    }
}
