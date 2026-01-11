using DTOs;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

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

        public MatchesController(EthicAIDbContext db)
        {
            _db = db;
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
                ScoreB = 0
            };

            _db.Add(match);
            await _db.SaveChangesAsync(ct);

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
                IsFinished = finished
            };
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
    }
}
