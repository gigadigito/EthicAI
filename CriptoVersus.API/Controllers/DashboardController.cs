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
            [FromQuery] int top = 6,
            [FromQuery] int upcoming = 3,
            [FromQuery] int ongoing = 3,
            CancellationToken ct = default)
        {
            if (top <= 0) top = 6;
            if (top > 50) top = 50;

            if (upcoming < 0) upcoming = 0;
            if (upcoming > 20) upcoming = 20;

            if (ongoing < 0) ongoing = 0;
            if (ongoing > 20) ongoing = 20;

            var now = DateTime.UtcNow;
            var last24h = now.AddHours(-24);

            var cycleIntervalSeconds = GetInt("CriptoVersus:Worker:CycleIntervalSeconds", 60);
            var matchDurationMinutes = GetInt("CriptoVersus:Match:DurationMinutes", 90);
            var targetUpcomingMatches = GetInt("CriptoVersus:Match:TargetUpcomingMatches", 3);

            // ✅ cada operação com seu próprio DbContext
            var workerTask = ReadWorkerStatusAsync(
                nowUtc: now,
                cycleIntervalSeconds: cycleIntervalSeconds,
                matchDurationMinutes: matchDurationMinutes,
                targetUpcomingMatches: targetUpcomingMatches,
                ct: ct);

            var topGainersTask = GetTopGainersAsync(top, ct);
            var ongoingListTask = GetOngoingListAsync(ongoing, now, matchDurationMinutes, ct);
            var upcomingListTask = GetUpcomingListAsync(upcoming, now, matchDurationMinutes, ct);

            var pendingCountTask = CountPendingAsync(now, ct);
            var ongoingCountTask = CountOngoingAsync(now, ct);
            var completedLast24hTask = CountCompletedLast24hAsync(last24h, ct);

            await Task.WhenAll(
                workerTask,
                topGainersTask,
                ongoingListTask,
                upcomingListTask,
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
                    Upcoming = upcomingListTask.Result,
                    OngoingList = ongoingListTask.Result
                }
            });
        }

        // ----------------------------
        // Queries (cada uma cria um DbContext)
        // ----------------------------
        private async Task<List<CurrencyDto>> GetTopGainersAsync(int top, CancellationToken ct)
        {
            await using var db = await _dbFactory.CreateDbContextAsync(ct);

            var list = await db.Set<Currency>()
                .AsNoTracking()
                .OrderByDescending(c => c.PercentageChange)
                .Take(top)
                .Select(c => new CurrencyDto
                {
                    Symbol = c.Symbol,
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
                .Where(m =>
                    m.Status == MatchStatus.Ongoing ||
                    (m.StartTime != null && m.StartTime <= now && m.EndTime == null))
                .OrderBy(m => m.StartTime ?? DateTime.MaxValue)
                .Take(take)
                .Select(m => ToMatchDto(m, now, matchDurationMinutes))
                .ToListAsync(ct);
        }

        private async Task<List<MatchDto>> GetUpcomingListAsync(int take, DateTime now, int matchDurationMinutes, CancellationToken ct)
        {
            await using var db = await _dbFactory.CreateDbContextAsync(ct);

            return await db.Set<Match>()
                .AsNoTracking()
                .Include(m => m.TeamA).ThenInclude(t => t.Currency)
                .Include(m => m.TeamB).ThenInclude(t => t.Currency)
                .Where(m =>
                    m.Status == MatchStatus.Pending ||
                    (m.StartTime != null && m.StartTime > now && m.EndTime == null))
                .OrderBy(m => m.StartTime ?? DateTime.MaxValue)
                .Take(take)
                .Select(m => ToMatchDto(m, now, matchDurationMinutes))
                .ToListAsync(ct);
        }

        private async Task<int> CountPendingAsync(DateTime now, CancellationToken ct)
        {
            await using var db = await _dbFactory.CreateDbContextAsync(ct);

            return await db.Set<Match>()
                .AsNoTracking()
                .CountAsync(m =>
                    m.Status == MatchStatus.Pending ||
                    (m.StartTime != null && m.StartTime > now && m.EndTime == null),
                    ct);
        }

        private async Task<int> CountOngoingAsync(DateTime now, CancellationToken ct)
        {
            await using var db = await _dbFactory.CreateDbContextAsync(ct);

            return await db.Set<Match>()
                .AsNoTracking()
                .CountAsync(m =>
                    m.Status == MatchStatus.Ongoing ||
                    (m.StartTime != null && m.StartTime <= now && m.EndTime == null),
                    ct);
        }

        private async Task<int> CountCompletedLast24hAsync(DateTime last24h, CancellationToken ct)
        {
            await using var db = await _dbFactory.CreateDbContextAsync(ct);

            return await db.Set<Match>()
                .AsNoTracking()
                .CountAsync(m =>
                    m.Status == MatchStatus.Completed ||
                    (m.EndTime != null && m.EndTime >= last24h),
                    ct);
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
                IsFinished = isFinished
            };
        }

        private int GetInt(string key, int @default)
        {
            var val = _config[key];
            return int.TryParse(val, out var n) ? n : @default;
        }

        // Worker status via SQL direto (usa conn string do db gerado pela factory)
        private async Task<WorkerStatusDto> ReadWorkerStatusAsync(
            DateTime nowUtc,
            int cycleIntervalSeconds,
            int matchDurationMinutes,
            int targetUpcomingMatches,
            CancellationToken ct)
        {
            var dto = new WorkerStatusDto
            {
                CycleIntervalSeconds = cycleIntervalSeconds,
                MatchDurationMinutes = matchDurationMinutes,
                TargetUpcomingMatches = targetUpcomingMatches,
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
  dt_last_cycle_start,
  dt_last_cycle_end,
  dt_last_success,
  tx_last_error
FROM worker_status
ORDER BY dt_last_success DESC NULLS LAST
LIMIT 1;";

            await using var cmd = new NpgsqlCommand(sql, conn) { CommandType = CommandType.Text };
            await using var reader = await cmd.ExecuteReaderAsync(ct);

            if (!await reader.ReadAsync(ct))
                return dto;

            DateTime? lastCycleStart = reader.IsDBNull(0) ? null : reader.GetDateTime(0);
            DateTime? lastCycleEnd = reader.IsDBNull(1) ? null : reader.GetDateTime(1);
            DateTime? lastSuccess = reader.IsDBNull(2) ? null : reader.GetDateTime(2);
            string? lastErr = reader.IsDBNull(3) ? null : reader.GetString(3);

            dto.LastCycleStartUtc = lastCycleStart;
            dto.LastCycleEndUtc = lastCycleEnd;
            dto.LastError = string.IsNullOrWhiteSpace(lastErr) ? null : lastErr;

            if (lastSuccess != null)
            {
                dto.LastHeartbeatUtc = lastSuccess.Value;
                var aliveWindow = TimeSpan.FromSeconds(Math.Max(10, cycleIntervalSeconds * 2));
                dto.IsAlive = (nowUtc - lastSuccess.Value) <= aliveWindow;
            }

            dto.LastErrorUtc = null;
            return dto;
        }
    }
}
