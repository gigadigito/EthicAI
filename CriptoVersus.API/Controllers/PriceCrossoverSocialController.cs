using CriptoVersus.API.Services;
using DTOs;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace CriptoVersus.API.Controllers;

/// <summary>
/// Endpoints sociais do Price Crossover Highlights.
///
/// GET sao publicos e SEM EFEITO COLATERAL: nunca reservam, nunca alteram estado.
/// Operacoes de reserva/confirmacao/liberacao exigem autenticacao (politica de fallback da API)
/// e sao deliberadamente separadas da consulta.
/// </summary>
[ApiController]
[Route("api/social/price-crossover")]
public sealed class PriceCrossoverSocialController : ControllerBase
{
    private readonly IPriceCrossoverSocialService _socialService;
    private readonly IPriceCrossoverHighlightSelector _selector;
    private readonly IPriceCrossoverPublicationService _publicationService;

    public PriceCrossoverSocialController(
        IPriceCrossoverSocialService socialService,
        IPriceCrossoverHighlightSelector selector,
        IPriceCrossoverPublicationService publicationService)
    {
        _socialService = socialService;
        _selector = selector;
        _publicationService = publicationService;
    }

    /// <summary>
    /// Destaque automatico: melhor partida encerrada na janela informada.
    /// Consulta pura. Nao reserva a partida.
    /// </summary>
    [AllowAnonymous]
    [HttpGet("highlight")]
    [ProducesResponseType(typeof(PriceCrossoverHighlightResponse), StatusCodes.Status200OK)]
    public async Task<ActionResult<PriceCrossoverHighlightResponse>> GetHighlight(
        [FromQuery] int lookbackHours = 6,
        [FromQuery] string language = "pt-BR",
        [FromQuery] bool includeSeries = true,
        CancellationToken ct = default)
    {
        lookbackHours = Math.Clamp(lookbackHours, 1, 48);
        var result = await _selector.GetHighlightAsync(lookbackHours, language, includeSeries, ct);
        return Ok(result);
    }

    /// <summary>
    /// Candidatos avaliados, com indice de interesse e motivos de selecao ou rejeicao.
    /// Informacao de diagnostico: exige autenticacao.
    /// </summary>
    [HttpGet("highlights/candidates")]
    [ProducesResponseType(typeof(PriceCrossoverCandidatesResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    public async Task<ActionResult<PriceCrossoverCandidatesResponse>> GetCandidates(
        [FromQuery] int lookbackHours = 6,
        [FromQuery] int take = 10,
        CancellationToken ct = default)
    {
        lookbackHours = Math.Clamp(lookbackHours, 1, 48);
        take = Math.Clamp(take, 1, 50);

        var result = await _selector.GetCandidatesAsync(lookbackHours, take, ct);
        return Ok(result);
    }

    /// <summary>
    /// Analise completa de uma partida especifica, incluindo serie historica e dados de qualidade.
    /// Consulta pura. Nao reserva a partida.
    /// </summary>
    [AllowAnonymous]
    [HttpGet("{matchId:int}")]
    [ProducesResponseType(typeof(PriceCrossoverSocialResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<PriceCrossoverSocialResponse>> GetByMatchId(
        int matchId,
        [FromQuery] string language = "pt-BR",
        [FromQuery] bool includeSeries = true,
        CancellationToken ct = default)
    {
        if (matchId <= 0)
            return BadRequest(new { error = "matchId_invalido" });

        var result = await _socialService.GetByMatchIdAsync(matchId, language, includeSeries, ct);
        return result is null ? NotFound() : Ok(result);
    }

    /// <summary>
    /// Reserva a partida para publicacao. Exige autenticacao. Idempotente por
    /// <c>price_crossover_highlight:{matchId}</c>.
    /// </summary>
    [HttpPost("{matchId:int}/reserve")]
    [ProducesResponseType(typeof(PriceCrossoverPublicationResult), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status409Conflict)]
    public async Task<ActionResult<PriceCrossoverPublicationResult>> Reserve(
        int matchId,
        [FromBody] PriceCrossoverReserveRequest? request,
        CancellationToken ct = default)
    {
        if (matchId <= 0)
            return BadRequest(new { error = "matchId_invalido" });

        var result = await _publicationService.ReserveAsync(
            matchId,
            request ?? new PriceCrossoverReserveRequest(),
            ct);

        return result.Success ? Ok(result) : Conflict(result);
    }

    /// <summary>
    /// Confirma o resultado da publicacao. Exige autenticacao.
    /// <c>outcome=unknown</c> marca <c>reconciliation_required</c> e BLOQUEIA nova tentativa automatica.
    /// </summary>
    [HttpPost("{matchId:int}/confirm")]
    [ProducesResponseType(typeof(PriceCrossoverPublicationResult), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status409Conflict)]
    public async Task<ActionResult<PriceCrossoverPublicationResult>> Confirm(
        int matchId,
        [FromBody] PriceCrossoverConfirmRequest request,
        CancellationToken ct = default)
    {
        if (matchId <= 0)
            return BadRequest(new { error = "matchId_invalido" });

        if (request is null || string.IsNullOrWhiteSpace(request.Outcome))
            return BadRequest(new { error = "outcome_obrigatorio" });

        var result = await _publicationService.ConfirmAsync(matchId, request, ct);
        return result.Success ? Ok(result) : Conflict(result);
    }

    /// <summary>Libera uma reserva sem confirmar publicacao. Exige autenticacao.</summary>
    [HttpPost("{matchId:int}/release")]
    [ProducesResponseType(typeof(PriceCrossoverPublicationResult), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status409Conflict)]
    public async Task<ActionResult<PriceCrossoverPublicationResult>> Release(
        int matchId,
        [FromBody] PriceCrossoverReleaseRequest? request,
        CancellationToken ct = default)
    {
        if (matchId <= 0)
            return BadRequest(new { error = "matchId_invalido" });

        var result = await _publicationService.ReleaseAsync(matchId, request?.Reason, ct);
        return result.Success ? Ok(result) : Conflict(result);
    }
}

public sealed class PriceCrossoverReleaseRequest
{
    public string? Reason { get; init; }
}
