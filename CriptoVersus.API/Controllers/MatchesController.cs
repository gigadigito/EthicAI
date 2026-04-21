using DTOs;
using CriptoVersus.API.Hubs;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.AspNetCore.SignalR;
using System.Text.Json;

// Ajuste namespaces conforme seu projeto
using EthicAI.EntityModel;
using DAL.NftFutebol;

namespace CriptoVersus.API.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class MatchesController : ControllerBase
    {
        private readonly EthicAIDbContext _db;
        private readonly IHubContext<DashboardHub> _hub;

        public MatchesController(
            EthicAIDbContext db,
            IHubContext<DashboardHub> hub)
        {
            _db = db;
            _hub = hub;
        }

        // =========================
        // GET /api/matches
        // =========================
        [HttpGet]
        public async Task<ActionResult<List<MatchDto>>> GetAll(
            [FromQuery] MatchStatus? status = null,
            [FromQuery] int take = 50,
            CancellationToken ct = default)
        {
            if (take <= 0) take = 50;
            if (take > 200) take = 200;

            var now = DateTime.UtcNow;

            var q = _db.Set<Match>()
                .AsNoTracking()
                .Include(m => m.TeamA).ThenInclude(t => t.Currency)
                .Include(m => m.TeamB).ThenInclude(t => t.Currency)
                .AsQueryable();

            if (status != null)
                q = q.Where(m => m.Status == status);

            var items = await q
                .OrderByDescending(m => m.StartTime ?? DateTime.MaxValue)
                .Take(take)
                .Select(m => ToMatchDto(m, now))
                .ToListAsync(ct);

            return Ok(items);
        }
        // =========================
        // GET /api/matches/by-symbols?symbolA=PENDLE&symbolB=DASH
        // Retorna o match Ongoing do par, senão o mais recente
        // =========================
        [HttpGet("by-symbols")]
        public async Task<ActionResult<MatchDto>> GetBySymbols(
            [FromQuery] string symbolA,
            [FromQuery] string symbolB,
            CancellationToken ct = default)
        {
            if (string.IsNullOrWhiteSpace(symbolA) || string.IsNullOrWhiteSpace(symbolB))
                return BadRequest("symbolA e symbolB são obrigatórios.");

            var now = DateTime.UtcNow;

            var a = symbolA.Trim().ToUpperInvariant();
            var b = symbolB.Trim().ToUpperInvariant();

            var q = _db.Set<Match>()
                .AsNoTracking()
                .Include(m => m.TeamA).ThenInclude(t => t.Currency)
                .Include(m => m.TeamB).ThenInclude(t => t.Currency)
                .Where(m =>
                    (m.TeamA.Currency.Symbol.ToUpper() == a && m.TeamB.Currency.Symbol.ToUpper() == b) ||
                    (m.TeamA.Currency.Symbol.ToUpper() == b && m.TeamB.Currency.Symbol.ToUpper() == a));

            // Prioriza Ongoing, depois mais recente
            var match = await q
                .OrderBy(m => m.Status == MatchStatus.Ongoing ? 0 : 1)
                .ThenByDescending(m => m.StartTime ?? DateTime.MinValue)
                .FirstOrDefaultAsync(ct);

            if (match is null)
                return NotFound();

            return Ok(ToMatchDto(match, now));
        }

        // =========================
        // GET /api/matches/{id}
        // =========================
        [HttpGet("{id:int}")]
        public async Task<ActionResult<MatchDto>> GetById(int id, CancellationToken ct)
        {
            var now = DateTime.UtcNow;

            var match = await _db.Set<Match>()
                .AsNoTracking()
                .Include(m => m.TeamA).ThenInclude(t => t.Currency)
                .Include(m => m.TeamB).ThenInclude(t => t.Currency)
                .FirstOrDefaultAsync(m => m.MatchId == id, ct);

            if (match == null)
                return NotFound();

            return Ok(ToMatchDto(match, now));
        }

        [HttpGet("{id:int}/score-events")]
        public async Task<ActionResult<List<MatchScoreEventDto>>> GetScoreEvents(int id, CancellationToken ct)
        {
            var exists = await _db.Set<Match>().AnyAsync(m => m.MatchId == id, ct);
            if (!exists)
                return NotFound();

            var items = await _db.Set<MatchScoreEvent>()
                .AsNoTracking()
                .Include(x => x.Team).ThenInclude(t => t.Currency)
                .Where(x => x.MatchId == id)
                .OrderBy(x => x.EventSequence)
                .Select(x => new MatchScoreEventDto
                {
                    MatchScoreEventId = x.MatchScoreEventId,
                    MatchId = x.MatchId,
                    TeamId = x.TeamId,
                    TeamSymbol = x.Team.Currency.Symbol,
                    RuleType = x.RuleType.ToString(),
                    EventType = x.EventType,
                    ReasonCode = x.ReasonCode,
                    Points = x.Points,
                    EventSequence = x.EventSequence,
                    TeamPercentageChange = x.TeamPercentageChange,
                    OpponentPercentageChange = x.OpponentPercentageChange,
                    TeamQuoteVolume = x.TeamQuoteVolume,
                    OpponentQuoteVolume = x.OpponentQuoteVolume,
                    MetricDelta = x.MetricDelta,
                    WindowStartUtc = x.WindowStartUtc,
                    WindowEndUtc = x.WindowEndUtc,
                    Description = x.Description,
                    EventTimeUtc = x.EventTimeUtc
                })
                .ToListAsync(ct);

            return Ok(items);
        }

        [HttpGet("{id:int}/metric-snapshots")]
        public async Task<ActionResult<List<MatchMetricSnapshotDto>>> GetMetricSnapshots(
            int id,
            [FromQuery] int take = 200,
            CancellationToken ct = default)
        {
            if (take <= 0) take = 200;
            if (take > 1000) take = 1000;

            var exists = await _db.Set<Match>().AnyAsync(m => m.MatchId == id, ct);
            if (!exists)
                return NotFound();

            var items = await _db.Set<MatchMetricSnapshot>()
                .AsNoTracking()
                .Include(x => x.Team).ThenInclude(t => t.Currency)
                .Where(x => x.MatchId == id)
                .OrderByDescending(x => x.CapturedAtUtc)
                .Take(take)
                .Select(x => new MatchMetricSnapshotDto
                {
                    MatchMetricSnapshotId = x.MatchMetricSnapshotId,
                    MatchId = x.MatchId,
                    TeamId = x.TeamId,
                    TeamSymbol = x.Team.Currency.Symbol,
                    CapturedAtUtc = x.CapturedAtUtc,
                    PercentageChange = x.PercentageChange,
                    QuoteVolume = x.QuoteVolume,
                    TradeCount = x.TradeCount
                })
                .ToListAsync(ct);

            return Ok(items.OrderBy(x => x.CapturedAtUtc).ToList());
        }

        // =========================
        // POST /api/matches
        // Cria uma nova partida
        // =========================
        [HttpPost]
        public async Task<ActionResult> Create(
            [FromBody] CreateMatchRequest req,
            CancellationToken ct)
        {
            if (req.TeamAId == req.TeamBId)
                return BadRequest("TeamA e TeamB devem ser diferentes.");

            var teamAExists = await _db.Set<Team>().AnyAsync(t => t.TeamId == req.TeamAId, ct);
            var teamBExists = await _db.Set<Team>().AnyAsync(t => t.TeamId == req.TeamBId, ct);

            if (!teamAExists || !teamBExists)
                return BadRequest("Time inválido.");

            var match = new Match
            {
                TeamAId = req.TeamAId,
                TeamBId = req.TeamBId,
                Status = MatchStatus.Pending,
                StartTime = req.StartTimeUtc,
                EndTime = null,
                ScoreA = 0,
                ScoreB = 0,
                ScoringRuleType = req.ScoringRuleType
            };

            _db.Add(match);
            await _db.SaveChangesAsync(ct);

            _db.Add(new MatchScoreState
            {
                MatchId = match.MatchId,
                CreatedAtUtc = DateTime.UtcNow,
                UpdatedAtUtc = DateTime.UtcNow
            });

            await _db.SaveChangesAsync(ct);
            await NotifyDashboardChangedAsync("match_created", match.MatchId, ct);

            return CreatedAtAction(nameof(GetById), new { id = match.MatchId }, new { match.MatchId });
        }

        // =========================
        // POST /api/matches/{id}/start
        // =========================
        [HttpPost("{id:int}/start")]
        public async Task<ActionResult> Start(int id, CancellationToken ct)
        {
            var match = await _db.Set<Match>().FirstOrDefaultAsync(m => m.MatchId == id, ct);
            if (match == null)
                return NotFound();

            if (match.Status != MatchStatus.Pending)
                return BadRequest("A partida não está pendente.");

            match.Status = MatchStatus.Ongoing;
            match.StartTime ??= DateTime.UtcNow;

            await _db.SaveChangesAsync(ct);
            await NotifyDashboardChangedAsync("match_started", match.MatchId, ct);
            return Ok();
        }

        // =========================
        // POST /api/matches/{id}/complete
        // =========================
        [HttpPost("{id:int}/complete")]
        public async Task<ActionResult> Complete(int id, CancellationToken ct)
        {
            var match = await _db.Set<Match>().FirstOrDefaultAsync(m => m.MatchId == id, ct);
            if (match == null)
                return NotFound();

            if (match.Status != MatchStatus.Ongoing)
                return BadRequest("A partida não está em andamento.");

            match.Status = MatchStatus.Completed;
            match.EndTime = DateTime.UtcNow;

            await _db.SaveChangesAsync(ct);
            await NotifyDashboardChangedAsync("match_completed", match.MatchId, ct);
            return Ok();
        }

        // =========================
        // Helpers
        // =========================
        private static MatchDto ToMatchDto(Match m, DateTime nowUtc)
        {
            var a = m.TeamA?.Currency;
            var b = m.TeamB?.Currency;

            int elapsed = 0;
            bool finished = m.Status == MatchStatus.Completed;

            if (m.StartTime != null)
                elapsed = (int)Math.Max(0, (nowUtc - m.StartTime.Value).TotalMinutes);

            return new MatchDto
            {
                MatchId = m.MatchId,
                TeamA = a?.Symbol ?? $"Team#{m.TeamAId}",
                TeamB = b?.Symbol ?? $"Team#{m.TeamBId}",
                ScoreA = m.ScoreA,
                ScoreB = m.ScoreB,
                Status = m.Status.ToString(),
                StartTime = m.StartTime,
                EndTime = m.EndTime,
                ElapsedMinutes = elapsed,
                RemainingMinutes = Math.Max(0, 90 - elapsed),
                IsFinished = finished,

                // ✅ NOVO: percentuais atuais
                PctA = (decimal?)a?.PercentageChange,
                PctB = (decimal?)b?.PercentageChange,
                QuoteVolumeA = a?.QuoteVolume,
                QuoteVolumeB = b?.QuoteVolume,
                ScoringRuleType = m.ScoringRuleType.ToString()
            };
        }

        private Task NotifyDashboardChangedAsync(string reason, int matchId, CancellationToken ct)
        {
            return _hub.Clients.All.SendAsync(
                "dashboard_changed",
                JsonSerializer.Serialize(new
                {
                    reason,
                    matchId,
                    utc = DateTimeOffset.UtcNow
                }),
                ct);
        }

    }

    // =========================
    // DTO de criação
    // =========================
    public sealed class CreateMatchRequest
    {
        public int TeamAId { get; set; }
        public int TeamBId { get; set; }
        public DateTime? StartTimeUtc { get; set; }
        public MatchScoringRuleType ScoringRuleType { get; set; } = MatchScoringRuleType.PercentThreshold;
    }
}
