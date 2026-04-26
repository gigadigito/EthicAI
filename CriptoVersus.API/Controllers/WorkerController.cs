
using DTOs;
using EthicAI.Data;
using EthicAI.EntityModel;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace CriptoVersus.API.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class WorkerController : ControllerBase
    {
        private readonly EthicAIDbContext _db;
        public WorkerController(EthicAIDbContext db) => _db = db;

        [HttpGet("status")]
        public async Task<ActionResult<WorkerStatusDto>> Status(CancellationToken ct = default)
        {
            const string name = "CriptoVersus.Worker";

            // lê direto via SQL (sem precisar criar entidade agora)
            var row = await _db.Set<WorkerStatusRow>()
                .FromSqlInterpolated($@"
                    SELECT 
                      tx_service_name,
                      dt_last_heartbeat_utc,
                      dt_last_cycle_start_utc,
                      dt_last_cycle_end_utc,
                      tx_last_error,
                      dt_last_error_utc
                    FROM worker_status
                    WHERE tx_service_name = {name}
                ")
                .AsNoTracking()
                .FirstOrDefaultAsync(ct);

            if (row == null)
            {
                return new WorkerStatusDto
                {
                    ServiceName = name,
                    IsAlive = false,
                    LastHeartbeatUtc = DateTime.MinValue
                };
            }

            var now = DateTime.UtcNow;
            var isAlive = (now - row.LastHeartbeatUtc).TotalSeconds <= 120; // heartbeat até 2min

            return new WorkerStatusDto
            {
                ServiceName = name,
                IsAlive = isAlive,
                LastHeartbeatUtc = row.LastHeartbeatUtc,
                LastCycleStartUtc = row.LastCycleStartUtc,
                LastCycleEndUtc = row.LastCycleEndUtc,
                LastError = row.LastError,
                LastErrorUtc = row.LastErrorUtc,
                CycleIntervalSeconds = 60,
                MatchDurationMinutes = 90,
                TargetUpcomingMatches = 3
            };
        }

        // DTO interno só pra mapear SQL sem entidade formal
        private class WorkerStatusRow
        {
            public string ServiceName { get; set; } = "";
            public DateTime LastHeartbeatUtc { get; set; }
            public DateTime? LastCycleStartUtc { get; set; }
            public DateTime? LastCycleEndUtc { get; set; }
            public string? LastError { get; set; }
            public DateTime? LastErrorUtc { get; set; }
        }
    }
}
