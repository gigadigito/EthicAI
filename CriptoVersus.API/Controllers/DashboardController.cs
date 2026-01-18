using DTOs;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Npgsql;
using System.Data;

using EthicAI.EntityModel;
using DAL.NftFutebol;

namespace CriptoVersus.API.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class DashboardController : ControllerBase
    {
        private readonly IDbContextFactory<EthicAIDbContext> _dbFactory;
        private readonly IConfiguration _config;

        public DashboardController(IDbContextFactory<EthicAIDbContext> dbFactory, IConfiguration config)
        {
            _dbFactory = dbFactory;
            _config = config;
        }

        [HttpGet("snapshot")]
        public async Task<ActionResult<DashboardSnapshotDto>> GetSnapshot(
            [FromQuery] int top = 10,
            [FromQuery] int pending = 10,
            [FromQuery] int ongoing = 10,
            CancellationToken ct = default)
        {
            // sane
            top = Math.Clamp(top, 1, 50);
            pending = Math.Clamp(pending, 0, 50);
            ongoing = Math.Clamp(ongoing, 0, 50);

            var now = DateTime.UtcNow;
            var last24h = now.AddHours(-24);

            var cycleIntervalSeconds = GetInt("CriptoVersus:Worker:CycleIntervalSeconds", 60);
            var matchDurationMinutes = GetInt("CriptoVersus:Match:DurationMinutes", 90);
            var targetPendingMatches = GetInt("CriptoVersus:Match:TargetPendingMatches", 10); // novo (se não existir, cai no default)

            var workerTask = ReadWorkerStatusAsync(
                nowUtc: now,
                cycleIntervalSeconds: cycleIntervalSeconds,
                matchDurationMinutes: matchDurationMinutes,
                targetPendingMatches: targetPendingMatches,
                ct: ct);

            var topGainersTask = GetTopGainersAsync(top, ct);
            var ongoingListTask = GetOngoingListAsync(ongoing, now, matchDurationMinutes, ct);
            var pendingListTask = GetPendingListAsync(pending, now, matchDurationMinutes, ct);

            var pendingCountTask = CountPendingAsync(ct);
            var ongoingCountTask = CountOngoingAsync(ct);
            var completedLast24hTask = CountCompletedLast24hAsync(last24h, ct);

            await Task.WhenAll(
                workerTask,
                topGainersTask,
                ongoingListTask,
                pendingListTask,
                pendingCountTask,
                ongoingCountTask,
                completedLast24hTask);

            return Ok(new DashboardSnapshotDto
            {
                ServerTimeUtc = now,
                Worker = workerTask.Result,
                TopGainers = topGainersTask.Result,
                Matches = new MatchSummaryDto
                {
                    Pending = pendingCountTask.Result,
                    Ongoing = ongoingCountTask.Result,
                    CompletedLast24h = completedLast24hTask.Result,

                    // compat com web antiga: "Upcoming" agora é lista de Pending
                    Upcoming = pendingListTask.Result,
                    OngoingList = ongoingListTask.Result
                }
            });
        }

        // ----------------------------
        // Queries
        // ----------------------------
        private async Task<List<CurrencyDto>> GetTopGainersAsync(int top, CancellationToken ct)
        {
            await using var db = await _dbFactory.CreateDbContextAsync(ct);

            var minUtc = DateTime.UtcNow.AddMinutes(-10);

            var list = await db.Set<Currency>()
                .AsNoTracking()
                .Where(c => c.Symbol != null && EF.Functions.ILike(c.Symbol, "%USDT"))
                .Where(c => c.LastUpdated >= minUtc)
                .OrderByDescending(c => c.PercentageChange)
                .ThenByDescending(c => c.LastUpdated)
                .Take(top)
                .Select(c => new CurrencyDto
                {
                    Symbol = c.Symbol!,
                    Name = c.Name,
                    PercentageChange = (decimal)c.PercentageChange,
                    LastUpdatedUtc = c.LastUpdated,
                    Rank = 0
                })
                .ToListAsync(ct);

            for (int i = 0; i < list.Count; i++)
                list[i].Rank = i + 1;

            return list;
        }

        private async Task<List<MatchDto>> GetOngoingListAsync(int take, DateTime now, int matchDurationMinutes, CancellationToken ct)
        {
            await using var db = await _dbFactory.CreateDbContextAsync(ct);

            return await db.Set<Match>()
                .AsNoTracking()
                .Include(m => m.TeamA).ThenInclude(t => t.Currency)
                .Include(m => m.TeamB).ThenInclude(t => t.Currency)
                .Where(m => m.Status == MatchStatus.Ongoing)
                .OrderByDescending(m => m.StartTime ?? DateTime.MinValue)
                .Take(take)
                .Select(m => ToMatchDto(m, now, matchDurationMinutes))
                .ToListAsync(ct);
        }

        // ✅ Pending puro (sem "upcoming" fake)
        private async Task<List<MatchDto>> GetPendingListAsync(int take, DateTime now, int matchDurationMinutes, CancellationToken ct)
        {
            await using var db = await _dbFactory.CreateDbContextAsync(ct);

            return await db.Set<Match>()
                .AsNoTracking()
                .Include(m => m.TeamA).ThenInclude(t => t.Currency)
                .Include(m => m.TeamB).ThenInclude(t => t.Currency)
                .Where(m => m.Status == MatchStatus.Pending)
                .OrderByDescending(m => m.MatchId) // ou CreatedAt se tiver
                .Take(take)
                .Select(m => ToMatchDto(m, now, matchDurationMinutes))
                .ToListAsync(ct);
        }

        private async Task<int> CountPendingAsync(CancellationToken ct)
        {
            await using var db = await _dbFactory.CreateDbContextAsync(ct);
            return await db.Set<Match>().AsNoTracking().CountAsync(m => m.Status == MatchStatus.Pending, ct);
        }

        private async Task<int> CountOngoingAsync(CancellationToken ct)
        {
            await using var db = await _dbFactory.CreateDbContextAsync(ct);
            return await db.Set<Match>().AsNoTracking().CountAsync(m => m.Status == MatchStatus.Ongoing, ct);
        }

        // ✅ só completed nas últimas 24h
        private async Task<int> CountCompletedLast24hAsync(DateTime last24h, CancellationToken ct)
        {
            await using var db = await _dbFactory.CreateDbContextAsync(ct);
            return await db.Set<Match>()
                .AsNoTracking()
                .CountAsync(m => m.EndTime != null && m.EndTime >= last24h, ct);
        }

        private static MatchDto ToMatchDto(Match m, DateTime nowUtc, int matchDurationMinutes)
        {
            var a = m.TeamA?.Currency;
            var b = m.TeamB?.Currency;

            var teamA = a?.Symbol ?? $"Team#{m.TeamAId}";
            var teamB = b?.Symbol ?? $"Team#{m.TeamBId}";

            int elapsed = 0;
            int remaining = matchDurationMinutes;
            bool isFinished = false;

            if (m.StartTime != null)
            {
                elapsed = (int)Math.Max(0, Math.Floor((nowUtc - m.StartTime.Value).TotalMinutes));
                remaining = Math.Max(0, matchDurationMinutes - elapsed);
            }

            if (m.EndTime != null || m.Status == MatchStatus.Completed)
            {
                isFinished = true;

                if (m.StartTime != null && m.EndTime != null)
                    elapsed = (int)Math.Max(0, Math.Floor((m.EndTime.Value - m.StartTime.Value).TotalMinutes));

                remaining = 0;
            }

            return new MatchDto
            {
                MatchId = m.MatchId,
                TeamA = teamA,
                TeamB = teamB,
                ScoreA = m.ScoreA,
                ScoreB = m.ScoreB,
                Status = m.Status.ToString(),
                StartTime = m.StartTime,
                EndTime = m.EndTime,
                ElapsedMinutes = elapsed,
                RemainingMinutes = remaining,
                IsFinished = isFinished,

                // ✅ NOVO
                PctA = (decimal?)a?.PercentageChange,
                PctB = (decimal?)b?.PercentageChange
            };
        }


        private int GetInt(string key, int @default)
        {
            var val = _config[key];
            return int.TryParse(val, out var n) ? n : @default;
        }

        private async Task<WorkerStatusDto> ReadWorkerStatusAsync(
            DateTime nowUtc,
            int cycleIntervalSeconds,
            int matchDurationMinutes,
            int targetPendingMatches,
            CancellationToken ct)
        {
            var dto = new WorkerStatusDto
            {
                CycleIntervalSeconds = cycleIntervalSeconds,
                MatchDurationMinutes = matchDurationMinutes,
                TargetUpcomingMatches = targetPendingMatches, // mantém DTO sem quebrar
                LastHeartbeatUtc = DateTime.MinValue,
                IsAlive = false
            };

            await using var db = await _dbFactory.CreateDbContextAsync(ct);
            var connString = db.Database.GetConnectionString();
            if (string.IsNullOrWhiteSpace(connString))
                return dto;

            await using var conn = new NpgsqlConnection(connString);
            await conn.OpenAsync(ct);

            const string sql = @"
SELECT
  tx_worker_name,
  in_status,
  dt_last_heartbeat,
  dt_last_cycle_start,
  dt_last_cycle_end,
  dt_last_success,
  in_degraded,
  tx_health_json,
  tx_last_error
FROM worker_status
ORDER BY dt_updated_at DESC
LIMIT 1;";

            await using var cmd = new NpgsqlCommand(sql, conn) { CommandType = CommandType.Text };
            await using var reader = await cmd.ExecuteReaderAsync(ct);

            if (!await reader.ReadAsync(ct))
                return dto;

            dto.ServiceName = reader.IsDBNull(0) ? "CriptoVersus.Worker" : reader.GetString(0);

            var status = reader.IsDBNull(1) ? null : reader.GetString(1);
            var lastHeartbeat = reader.IsDBNull(2) ? (DateTime?)null : reader.GetDateTime(2);
            var lastCycleStart = reader.IsDBNull(3) ? (DateTime?)null : reader.GetDateTime(3);
            var lastCycleEnd = reader.IsDBNull(4) ? (DateTime?)null : reader.GetDateTime(4);
            var lastSuccess = reader.IsDBNull(5) ? (DateTime?)null : reader.GetDateTime(5);
            var degraded = !reader.IsDBNull(6) && reader.GetBoolean(6);
            var healthJson = reader.IsDBNull(7) ? null : reader.GetString(7);
            var lastErr = reader.IsDBNull(8) ? null : reader.GetString(8);

            dto.LastHeartbeatUtc = lastHeartbeat ?? (lastSuccess ?? DateTime.MinValue);
            dto.LastCycleStartUtc = lastCycleStart;
            dto.LastCycleEndUtc = lastCycleEnd;
            dto.LastError = string.IsNullOrWhiteSpace(lastErr) ? null : lastErr;
            dto.LastErrorUtc = null;

            // Alive baseado em heartbeat real
            if (lastHeartbeat != null)
            {
                var aliveWindow = TimeSpan.FromSeconds(Math.Max(10, cycleIntervalSeconds * 2));
                dto.IsAlive = (nowUtc - lastHeartbeat.Value) <= aliveWindow;
            }

            // Se você tiver campos no DTO pra isso depois:
            // dto.InDegraded = degraded;
            // dto.HealthJson = healthJson;
            // dto.Status = status;

            return dto;
        }
    }
}
