using CriptoVersus.API.Services;
using DTOs;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using System.Text.RegularExpressions;

namespace CriptoVersus.API.Controllers;

[ApiController]
[AllowAnonymous]
[Route("internal/market-flow")]
public sealed class MoneyFlowController : ControllerBase
{
    private static readonly Regex SymbolPattern = new("^[A-Z0-9]{2,30}$", RegexOptions.Compiled | RegexOptions.CultureInvariant);
    private readonly IMoneyFlowWorkerAuthenticationService _authentication;
    private readonly MoneyFlowDispatcher _dispatcher;
    private readonly IOptions<MoneyFlowTransportOptions> _options;
    private readonly MoneyFlowMetrics _metrics;
    private readonly WhaleOceanScoreStore _scoreStore;

    public MoneyFlowController(
        IMoneyFlowWorkerAuthenticationService authentication,
        MoneyFlowDispatcher dispatcher,
        IOptions<MoneyFlowTransportOptions> options,
        MoneyFlowMetrics metrics,
        WhaleOceanScoreStore scoreStore)
    {
        _authentication = authentication;
        _dispatcher = dispatcher;
        _options = options;
        _metrics = metrics;
        _scoreStore = scoreStore;
    }

    [HttpPost("batches")]
    [RequestSizeLimit(512_000)]
    public async Task<ActionResult<MoneyFlowTransportAccepted>> Post(
        [FromBody] MoneyFlowTransportRequest request,
        CancellationToken ct)
    {
        var options = _options.Value.Validate();
        if (!options.Enabled || !options.TransportEnabled)
            return NotFound();
        if (!_authentication.IsAuthorized(Request))
            return Unauthorized(new { ok = false, reason = "invalid-money-flow-worker-key" });
        if (request is null || string.IsNullOrWhiteSpace(request.SourceId) || request.SourceId.Length > 128)
            return BadRequest(new { ok = false, reason = "invalid-source-id" });
        if (request.Batches is null || request.Batches.Count is < 1 or > 100 || request.Batches.Count > options.MaxBatchCount)
            return BadRequest(new { ok = false, reason = "invalid-batch-count" });

        var now = DateTimeOffset.UtcNow;
        foreach (var batch in request.Batches)
        {
            if (!IsValid(batch, now, options.ReplayWindowMinutes))
            {
                _metrics.Rejected.Add(1);
                return BadRequest(new { ok = false, reason = "invalid-money-flow-batch" });
            }
        }

        // Persist before acknowledging the worker. The transport retry then
        // becomes safe even if the API process stops before SignalR publish.
        await _scoreStore.PersistAsync(request.SourceId, request.Batches, ct);
        return Accepted(await _dispatcher.EnqueueAsync(request, ct));
    }

    private static bool IsValid(MoneyFlowBatchDto batch, DateTimeOffset now, int replayWindowMinutes)
    {
        if (!SymbolPattern.IsMatch(batch.Symbol)) return false;
        if (batch.Sequence < 1 || batch.TradeCount < 1) return false;
        if (batch.WindowEndUtc <= batch.WindowStartUtc || batch.WindowEndUtc - batch.WindowStartUtc > TimeSpan.FromMinutes(1)) return false;
        if (batch.EventTimeUtc == default || batch.ReceivedAtUtc == default || batch.PublishedAtUtc == default) return false;
        if (batch.PublishedAtUtc < now.AddMinutes(-replayWindowMinutes) || batch.PublishedAtUtc > now.AddMinutes(2)) return false;
        if (batch.ReceivedAtUtc > now.AddMinutes(2)) return false;
        if (batch.TotalBaseQuantity < 0 || batch.TakerBuyBaseQuantity < 0 || batch.TakerSellBaseQuantity < 0
            || batch.TakerBuyQuote < 0 || batch.TakerSellQuote < 0 || batch.FirstPrice <= 0 || batch.LastPrice <= 0
            || batch.HighPrice <= 0 || batch.LowPrice <= 0)
            return false;
        // Older Workers may omit CreatureCounts during a rolling deployment;
        // those batches remain valid but cannot contribute species points.
        // New batches with counts must reconcile exactly to the real trade count.
        var counts = batch.CreatureCounts;
        if (counts.TradeCount > 0 && counts.TradeCount != batch.TradeCount) return false;
        if (counts.Buy.Small < 0 || counts.Buy.Medium < 0 || counts.Buy.Large < 0
            || counts.Buy.Shark < 0 || counts.Buy.Whale < 0 || counts.Sell.Small < 0
            || counts.Sell.Medium < 0 || counts.Sell.Large < 0 || counts.Sell.Shark < 0
            || counts.Sell.Whale < 0)
            return false;
        return true;
    }
}
