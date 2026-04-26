
using DTOs;
using EthicAI.Data;
using EthicAI.EntityModel;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;

namespace CriptoVersus.API.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class WorkerController : ControllerBase
    {
        private readonly EthicAIDbContext _db;
        private readonly IConfiguration _config;

        public WorkerController(EthicAIDbContext db, IConfiguration config)
        {
            _db = db;
            _config = config;
        }

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
                CycleIntervalSeconds = GetInt("CriptoVersusWorker:IntervalSeconds", 30),
                MatchDurationMinutes = GetInt("CriptoVersusWorker:MatchDurationMinutes", 90),
                TargetUpcomingMatches = GetInt("CriptoVersusWorker:DesiredActiveMatches", 3)
            };
        }

        private int GetInt(string key, int fallback)
        {
            var raw = _config[key];
            return int.TryParse(raw, out var value) ? value : fallback;
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
