using CriptoVersus.API.Services;
using DTOs;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

namespace CriptoVersus.API.Controllers;

[ApiController]
[Route("api/tv")]
public sealed class TvController : ControllerBase
{
    private readonly ITvHotMatchService _tvHotMatchService;
    private readonly ITvAiNarrationService _tvAiNarrationService;
    private readonly ICandleBattleBroadcastSelectionService _broadcastSelection;
    private readonly ILogger<TvController> _logger;

    public TvController(ITvHotMatchService tvHotMatchService, ITvAiNarrationService tvAiNarrationService,
        ICandleBattleBroadcastSelectionService broadcastSelection, ILogger<TvController> logger)
    {
        _tvHotMatchService = tvHotMatchService;
        _tvAiNarrationService = tvAiNarrationService;
        _broadcastSelection = broadcastSelection;
        _logger = logger;
    }

    [AllowAnonymous]
    [HttpGet("hot-match")]
    public async Task<IActionResult> GetHotMatch(CancellationToken ct)
        => Ok(await _tvHotMatchService.GetHotMatchAsync(ct));

    [AllowAnonymous]
    [HttpPost("narration/{matchId:int}")]
    public async Task<IActionResult> GenerateNarration(int matchId, [FromBody] TvNarrationRequest? request, CancellationToken ct)
        => Ok(await _tvAiNarrationService.GenerateNarrationAsync(matchId, request ?? new TvNarrationRequest(), ct));

    /// <summary>
    /// Proximo conteudo da Candle Battle TV: LIVE adequada, senao REPLAY, senao tela de espera.
    /// Opcionalmente recebe o <paramref name="currentMatchId"/> em exibicao; enquanto esse conteudo
    /// nao terminar (encerramento real + janela de resultado final para LIVE), a resposta o mantem,
    /// mesmo que outra partida passe a pontuar mais. Somente leitura: nao reserva nem confirma
    /// publicacoes sociais.
    /// </summary>
    [AllowAnonymous]
    [EnableRateLimiting(TvBroadcastRateLimiter.PolicyName)]
    [HttpGet("candle-battle/next")]
    [ProducesResponseType(typeof(CandleBattleBroadcastSelectionDto), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(CandleBattleBroadcastSelectionDto), StatusCodes.Status503ServiceUnavailable)]
    [ProducesResponseType(StatusCodes.Status429TooManyRequests)]
    public async Task<ActionResult<CandleBattleBroadcastSelectionDto>> GetNextCandleBattle(
        [FromQuery] int? currentMatchId = null, [FromQuery] string? culture = null, CancellationToken ct = default)
    {
        try
        {
            var result = await _broadcastSelection.GetNextAsync(currentMatchId, culture, ct);
            if (result.SkipReason == CandleBattleBroadcastSkipReasons.SourceUnavailable)
                return StatusCode(StatusCodes.Status503ServiceUnavailable, result);
            return Ok(result);
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Candle Battle broadcast next failed. CurrentMatchId={CurrentMatchId}", currentMatchId);
            return StatusCode(StatusCodes.Status503ServiceUnavailable, new CandleBattleBroadcastSelectionDto
            {
                Available = false,
                Mode = CandleBattleBroadcastModes.None,
                SkipReason = CandleBattleBroadcastSkipReasons.SourceUnavailable,
                GeneratedAtUtc = DateTime.UtcNow
            });
        }
    }

    /// <summary>
    /// Estado de transmissao de uma Candle Battle. <c>isFinished</c> e o encerramento real da
    /// partida; <c>shouldSwitch</c> indica que o diretor ja exibiu resultado/replay o suficiente
    /// e o transmissor deve pedir o proximo conteudo. 5xx significa falha temporaria de origem:
    /// o transmissor deve manter a transmissao atual.
    /// </summary>
    [AllowAnonymous]
    [EnableRateLimiting(TvBroadcastRateLimiter.PolicyName)]
    [HttpGet("candle-battle/{matchId:int}/broadcast-status")]
    [ProducesResponseType(typeof(CandleBattleBroadcastStatusDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    [ProducesResponseType(StatusCodes.Status503ServiceUnavailable)]
    [ProducesResponseType(StatusCodes.Status429TooManyRequests)]
    public async Task<ActionResult<CandleBattleBroadcastStatusDto>> GetCandleBattleBroadcastStatus(
        int matchId, CancellationToken ct = default)
    {
        if (matchId <= 0) return BadRequest(new { error = "matchId_invalido" });
        try
        {
            var result = await _broadcastSelection.GetBroadcastStatusAsync(matchId, ct);
            return result is null ? NotFound() : Ok(result);
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Candle Battle broadcast status failed. MatchId={MatchId}", matchId);
            return StatusCode(StatusCodes.Status503ServiceUnavailable, new { error = CandleBattleBroadcastSkipReasons.SourceUnavailable });
        }
    }
}
