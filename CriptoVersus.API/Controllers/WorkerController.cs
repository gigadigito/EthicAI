
using DTOs;
using EthicAI.Data;
using EthicAI.EntityModel;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace CriptoVersus.API.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class WorkerController : ControllerBase
    {
        private const string WorkerName = "CriptoVersus.Worker";
        private static readonly TimeSpan AliveWindow = TimeSpan.FromSeconds(120);

        private readonly EthicAIDbContext _db;
        public WorkerController(EthicAIDbContext db) => _db = db;

        [AllowAnonymous]
        [HttpGet("status")]
        public async Task<ActionResult<WorkerStatusDto>> Status(CancellationToken ct = default)
        {
            var row = await ReadWorkerStatusRowAsync(ct);

            if (row == null)
            {
                return new WorkerStatusDto
                {
                    ServiceName = WorkerName,
                    Status = "missing",
                    IsAlive = false,
                    LastHeartbeatUtc = DateTime.MinValue
                };
            }

            var now = DateTime.UtcNow;
            var isAlive = (now - row.LastHeartbeatUtc).TotalSeconds <= AliveWindow.TotalSeconds;

            return new WorkerStatusDto
            {
                ServiceName = WorkerName,
                Status = isAlive ? "running" : "stale",
                IsAlive = isAlive,
                LastHeartbeatUtc = row.LastHeartbeatUtc,
                LastCycleStartUtc = row.LastCycleStartUtc,
                LastCycleEndUtc = row.LastCycleEndUtc,
                LastSuccessUtc = row.LastSuccessUtc,
                LastCycleDurationMs = row.LastCycleMs,
                IsDegraded = row.Degraded,
                HealthJson = row.HealthJson,
                LastError = row.LastError,
                LastErrorUtc = row.LastErrorUtc,
                CycleIntervalSeconds = 60,
                MatchDurationMinutes = 90,
                TargetUpcomingMatches = 3
            };
        }

        [AllowAnonymous]
        [HttpGet("health")]
        public async Task<IActionResult> Health(CancellationToken ct = default)
        {
            var row = await ReadWorkerStatusRowAsync(ct);
            if (row == null)
            {
                return StatusCode(StatusCodes.Status503ServiceUnavailable, new
                {
                    ok = false,
                    service = WorkerName,
                    reason = "worker-status-missing"
                });
            }

            var heartbeatAgeSeconds = Math.Max(0, (int)Math.Round((DateTime.UtcNow - row.LastHeartbeatUtc).TotalSeconds));
            var isAlive = heartbeatAgeSeconds <= AliveWindow.TotalSeconds;

            return StatusCode(isAlive ? StatusCodes.Status200OK : StatusCodes.Status503ServiceUnavailable, new
            {
                ok = isAlive,
                service = WorkerName,
                status = isAlive ? "running" : "stale",
                degraded = row.Degraded,
                heartbeatAgeSeconds,
                lastHeartbeatUtc = row.LastHeartbeatUtc,
                lastCycleStartUtc = row.LastCycleStartUtc,
                lastCycleEndUtc = row.LastCycleEndUtc,
                lastSuccessUtc = row.LastSuccessUtc,
                lastCycleDurationMs = row.LastCycleMs,
                lastError = row.LastError
            });
        }

        private async Task<WorkerStatusRow?> ReadWorkerStatusRowAsync(CancellationToken ct)
        {
            return await _db.Set<WorkerStatusRow>()
                .FromSqlInterpolated($@"
                    SELECT 
                      tx_worker_name AS ""ServiceName"",
                      dt_last_heartbeat AS ""LastHeartbeatUtc"",
                      dt_last_cycle_start AS ""LastCycleStartUtc"",
                      dt_last_cycle_end AS ""LastCycleEndUtc"",
                      dt_last_success AS ""LastSuccessUtc"",
                      nr_last_cycle_ms AS ""LastCycleMs"",
                      in_degraded AS ""Degraded"",
                      tx_health_json AS ""HealthJson"",
                      tx_last_error AS ""LastError"",
                      dt_updated_at AS ""LastErrorUtc""
                    FROM worker_status
                    WHERE tx_worker_name = {WorkerName}
                    LIMIT 1
                ")
                .AsNoTracking()
                .FirstOrDefaultAsync(ct);
        }

        // DTO interno só pra mapear SQL sem entidade formal
        private class WorkerStatusRow
        {
            public string ServiceName { get; set; } = "";
            public DateTime LastHeartbeatUtc { get; set; }
            public DateTime? LastCycleStartUtc { get; set; }
            public DateTime? LastCycleEndUtc { get; set; }
            public DateTime? LastSuccessUtc { get; set; }
            public int? LastCycleMs { get; set; }
            public bool Degraded { get; set; }
            public string? HealthJson { get; set; }
            public string? LastError { get; set; }
            public DateTime? LastErrorUtc { get; set; }
        }
    }
}
