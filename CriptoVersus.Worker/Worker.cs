using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.Linq;
using System.Net.Http;
using System.Net.Http.Json;
using System.Net.Sockets;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using BLL.GameRules; // IMatchRuleEngine
using BLL.NFTFutebol;
using DAL.NftFutebol;
using DTOs;
using EthicAI.EntityModel;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Npgsql;
using static BLL.BinanceService;

namespace CriptoVersus.Worker
{
    public class Worker : BackgroundService
    {
        private readonly ILogger<Worker> _logger;
        private readonly IServiceProvider _sp;
        private readonly IHttpClientFactory _httpClientFactory;

        public Worker(ILogger<Worker> logger, IServiceProvider sp, IHttpClientFactory httpClientFactory)
        {
            _logger = logger;
            _sp = sp;
            _httpClientFactory = httpClientFactory;
        }

        private const string WorkerName = "CriptoVersus.Worker";
        private static readonly TimeSpan MatchDuration = TimeSpan.FromMinutes(90);
        private static readonly TimeSpan CycleInterval = TimeSpan.FromSeconds(60);

        // ===== Health DTO simples =====
        public record HealthItem(bool Ok, string Message);

        // ====== Schema do worker_status (agora com health) ======
        private async Task EnsureWorkerStatusTableAsync(CancellationToken ct)
        {
            using var scope = _sp.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<EthicAIDbContext>();

            var sql = @"
CREATE TABLE IF NOT EXISTS worker_status (
  tx_worker_name      varchar(50) PRIMARY KEY,
  dt_last_heartbeat   timestamptz NOT NULL,
  dt_last_cycle_start timestamptz NULL,
  dt_last_cycle_end   timestamptz NULL,
  dt_last_success     timestamptz NULL,
  nr_last_cycle_ms    integer NULL,
  in_degraded         boolean NOT NULL DEFAULT false,
  tx_health_json      text NULL,
  tx_last_error       text NULL,
  tx_last_error_stack text NULL,
  in_status           varchar(20) NOT NULL,
  dt_updated_at       timestamptz NOT NULL DEFAULT now()
);";

            await db.Database.ExecuteSqlRawAsync(sql, ct);
        }

        private async Task UpsertWorkerStatusAsync(
            string status,
            DateTime utcNow,
            DateTime? cycleStartUtc,
            DateTime? cycleEndUtc,
            DateTime? lastSuccessUtc,
            int? lastCycleMs,
            bool degraded,
            string? healthJson,
            string? lastErrorMsg,
            string? lastErrorStack,
            CancellationToken ct)
        {
            using var scope = _sp.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<EthicAIDbContext>();

            var sql = @"
INSERT INTO worker_status
  (tx_worker_name, in_status, dt_last_heartbeat, dt_last_cycle_start, dt_last_cycle_end, dt_last_success,
   nr_last_cycle_ms, in_degraded, tx_health_json, tx_last_error, tx_last_error_stack, dt_updated_at)
VALUES
  ({0}, {1}, {2}, {3}, {4}, {5},
   {6}, {7}, {8}, {9}, {10}, now())
ON CONFLICT (tx_worker_name) DO UPDATE SET
  in_status           = EXCLUDED.in_status,
  dt_last_heartbeat   = EXCLUDED.dt_last_heartbeat,
  dt_last_cycle_start = COALESCE(EXCLUDED.dt_last_cycle_start, worker_status.dt_last_cycle_start),
  dt_last_cycle_end   = COALESCE(EXCLUDED.dt_last_cycle_end, worker_status.dt_last_cycle_end),
  dt_last_success     = COALESCE(EXCLUDED.dt_last_success, worker_status.dt_last_success),
  nr_last_cycle_ms    = COALESCE(EXCLUDED.nr_last_cycle_ms, worker_status.nr_last_cycle_ms),
  in_degraded         = EXCLUDED.in_degraded,
  tx_health_json      = COALESCE(EXCLUDED.tx_health_json, worker_status.tx_health_json),
 tx_last_error = EXCLUDED.tx_last_error,
  tx_last_error_stack = COALESCE(EXCLUDED.tx_last_error_stack, worker_status.tx_last_error_stack),
  dt_updated_at       = now();";

            await db.Database.ExecuteSqlRawAsync(
                sql,
                new object?[]
                {
                    WorkerName,
                    status,
                    utcNow,
                    cycleStartUtc,
                    cycleEndUtc,
                    lastSuccessUtc,
                    lastCycleMs,
                    degraded,
                    healthJson,
                    lastErrorMsg,
                    lastErrorStack
                },
                ct
            );
        }

        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            // Aguarda Postgres subir (sem matar o worker se não subir)
            await WaitForPostgresAsync(stoppingToken);

            // Garante a tabela
            await EnsureWorkerStatusTableAsync(stoppingToken);

            // Primeira batida
            await UpsertWorkerStatusAsync(
                status: "starting",
                utcNow: DateTime.UtcNow,
                cycleStartUtc: null,
                cycleEndUtc: null,
                lastSuccessUtc: null,
                lastCycleMs: null,
                degraded: false,
                healthJson: null,
                lastErrorMsg: null,
                lastErrorStack: null,
                ct: stoppingToken);

            while (!stoppingToken.IsCancellationRequested)
            {
                var cycleStartUtc = DateTime.UtcNow;
                var sw = Stopwatch.StartNew();

                string status = "running";
                string? lastError = null;
                string? lastStack = null;
                DateTime? lastSuccessUtc = null;

                Dictionary<string, HealthItem>? checks = null;

                try
                {
                    // 1) Health checks (rápidos)
                    checks = await BuildHealthChecksAsync(stoppingToken);

                    // 2) Executa seu ciclo real
                    await RunCycleAsync(stoppingToken);

                    lastSuccessUtc = DateTime.UtcNow;
                }
                catch (Exception ex)
                {
                    lastError = ex.Message;
                    lastStack = ex.ToString();

                    status = IsDnsOrNetworkTransient(ex) ? "degraded" : "error";

                    _logger.LogError(ex, "❌ Erro no ciclo do worker.");
                }
                finally
                {
                    sw.Stop();

                    // Se não conseguiu nem montar checks, marca como degradado e registra
                    checks ??= new Dictionary<string, HealthItem>
                    {
                        ["health"] = new HealthItem(false, "Health check failed to build")
                    };

                    var degraded = status == "degraded" || checks.Values.Any(x => !x.Ok);
                    var healthJson = JsonSerializer.Serialize(checks);

                    // Normaliza status final
                    // - error: falha séria
                    // - degraded: algum check falhou ou erro transitório
                    // - running: ok
                    if (status == "running" && degraded) status = "degraded";

                    await UpsertWorkerStatusAsync(
                        status: status,
                        utcNow: DateTime.UtcNow,
                        cycleStartUtc: cycleStartUtc,
                        cycleEndUtc: DateTime.UtcNow,
                        lastSuccessUtc: lastSuccessUtc,
                        lastCycleMs: (int)sw.ElapsedMilliseconds,
                        degraded: degraded,
                        healthJson: healthJson,
                        lastErrorMsg: lastError,
                        lastErrorStack: lastStack,
                        ct: stoppingToken
                    );
                }

                await Task.Delay(CycleInterval, stoppingToken);
            }
        }

        // ===== Health checks =====
        private async Task<Dictionary<string, HealthItem>> BuildHealthChecksAsync(CancellationToken ct)
        {
            var checks = new Dictionary<string, HealthItem>();

            // 1) Database
            try
            {
                using var scope = _sp.CreateScope();
                var db = scope.ServiceProvider.GetRequiredService<EthicAIDbContext>();

                var connStr = db.Database.GetDbConnection().ConnectionString;
                await using var conn = new NpgsqlConnection(connStr);
                await conn.OpenAsync(ct);

                // ping simples
                await using var cmd = new NpgsqlCommand("SELECT 1;", conn);
                _ = await cmd.ExecuteScalarAsync(ct);

                checks["database"] = new HealthItem(true, "Connected");
            }
            catch (Exception ex)
            {
                checks["database"] = new HealthItem(false, ex.Message);
            }

            // 2) Binance (ping leve: /api/v3/ping)
            try
            {
                var http = _httpClientFactory.CreateClient();
                http.Timeout = TimeSpan.FromSeconds(3);

                var resp = await http.GetAsync("https://api.binance.com/api/v3/ping", ct);
                checks["binance"] = resp.IsSuccessStatusCode
                    ? new HealthItem(true, "Ping OK")
                    : new HealthItem(false, $"HTTP {(int)resp.StatusCode}");
            }
            catch (Exception ex)
            {
                checks["binance"] = new HealthItem(false, ex.Message);
            }

            // 3) Rules DI (seu erro atual)
            try
            {
                using var scope = _sp.CreateScope();
                _ = scope.ServiceProvider.GetRequiredService<IMatchRuleEngine>();
                checks["rules"] = new HealthItem(true, "Registered");
            }
            catch (Exception ex)
            {
                checks["rules"] = new HealthItem(false, ex.Message);
            }

            return checks;
        }

        private static bool IsDnsOrNetworkTransient(Exception ex)
        {
            for (var e = ex; e != null; e = e.InnerException)
                if (e is SocketException) return true;

            return false;
        }

        private async Task WaitForPostgresAsync(CancellationToken ct)
        {
            const string host = "postgres";
            const int port = 5432;

            var deadline = DateTime.UtcNow.AddMinutes(3);
            var attempt = 0;

            while (!ct.IsCancellationRequested && DateTime.UtcNow < deadline)
            {
                attempt++;

                try
                {
                    using var tcp = new TcpClient();
                    var connectTask = tcp.ConnectAsync(host, port);

                    var completed = await Task.WhenAny(connectTask, Task.Delay(TimeSpan.FromSeconds(3), ct));
                    if (completed != connectTask)
                        throw new TimeoutException("Timeout conectando no Postgres.");

                    _logger.LogInformation("✅ Postgres acessível em {host}:{port} (tentativa {attempt})", host, port, attempt);
                    return;
                }
                catch (Exception ex)
                {
                    _logger.LogWarning("⏳ Postgres ainda não está pronto ({host}:{port}) tentativa {attempt}: {msg}",
                        host, port, attempt, ex.Message);

                    await Task.Delay(TimeSpan.FromSeconds(Math.Min(10, 2 + attempt)), ct);
                }
            }

            _logger.LogWarning("⚠️ Timeout aguardando Postgres. O worker vai continuar e tentar no ciclo mesmo assim.");
        }

        // ============================
        // SEU CICLO REAL (mantido)
        // ============================
        private async Task RunCycleAsync(CancellationToken ct)
        {
            using var scope = _sp.CreateScope();

            var http = _httpClientFactory.CreateClient();
            var matchService = scope.ServiceProvider.GetRequiredService<MatchService>();
            var db = scope.ServiceProvider.GetRequiredService<EthicAIDbContext>();
            var ruleEngine = scope.ServiceProvider.GetRequiredService<IMatchRuleEngine>();

            var nowUtc = DateTime.UtcNow;

            // 1) Binance 24hr
            var all = await http.GetFromJsonAsync<List<Crypto>>(
                "https://api.binance.com/api/v3/ticker/24hr",
                ct);

            if (all == null || all.Count == 0)
            {
                _logger.LogWarning("⚠️ Binance retornou vazio.");
                return;
            }

            // 2) Top gainers (USDT)
            var topGainers = all
                .Where(c => c.Symbol != null && c.Symbol.EndsWith("USDT", StringComparison.OrdinalIgnoreCase))
                .OrderByDescending(c => ParsePercent(c.PriceChangePercent))
                .Take(6)
                .ToList();

            if (topGainers.Count < 6)
            {
                _logger.LogWarning("⚠️ Top gainers insuficiente (count={count}).", topGainers.Count);
                return;
            }

            // Snapshot para o engine (rank 1..N)
            var snapshotUtc = nowUtc;
            var snapshot = topGainers
                .Select((c, idx) => new GainerEntry
                {
                    Symbol = c.Symbol ?? "",
                    Rank = idx + 1,
                    PercentageChange = (decimal?)ParsePercent(c.PriceChangePercent)
                })
                .ToList();

            // 3) Save/Update currencies
            var currencies = await matchService.SaveCurrenciesAsync(topGainers);

            // 4) Garantir 3 jogos Pending (candidatos)
            var upcoming = await matchService.GetUpcomingPendingMatchesAsync(3);

            if (upcoming.Count < 3)
            {
                var missing = 3 - upcoming.Count;
                _logger.LogWarning("⚠️ Faltam {missing} jogos. Criando...", missing);

                await CreateMissingMatchesAsync(matchService, db, currencies, missing, ct);
                upcoming = await matchService.GetUpcomingPendingMatchesAsync(3);
            }

            _logger.LogInformation("✅ Pending disponíveis. Total={total}", upcoming.Count);

            // 5) Garantir 3 Ongoing
            const int desiredOngoing = 3;

            var ongoingNow = await matchService.GetOngoingMatchesAsync();
            var needToStart = desiredOngoing - ongoingNow.Count;

            if (needToStart > 0)
            {
                var pendingsToConsider = await matchService.GetUpcomingPendingMatchesAsync(needToStart * 3);

                var started = 0;

                foreach (var p in pendingsToConsider)
                {
                    if (started >= needToStart) break;

                    var match = await db.Match
                        .Include(x => x.TeamA).ThenInclude(t => t.Currency)
                        .Include(x => x.TeamB).ThenInclude(t => t.Currency)
                        .FirstOrDefaultAsync(x => x.MatchId == p.MatchId, ct);

                    if (match == null) continue;
                    if (match.Status != MatchStatus.Pending) continue;

                    var symA = match.TeamA?.Currency?.Symbol ?? "";
                    var symB = match.TeamB?.Currency?.Symbol ?? "";

                    var decision = ruleEngine.EvaluatePending(symA, symB, snapshot, snapshotUtc);

                    if (decision.Decision == MatchDecisionType.CancelMatch)
                    {
                        ApplyCancel(match, decision);
                        await db.SaveChangesAsync(ct);

                        _logger.LogWarning("🛑 CANCEL match {id} ({a} vs {b}). Reason={code} Detail={detail}",
                            match.MatchId, symA, symB, decision.ReasonCode, decision.ReasonDetail);

                        continue;
                    }

                    if (decision.Decision == MatchDecisionType.StartMatch)
                    {
                        await matchService.UpdateMatchStatusAndStartTimeAsync(match.MatchId, MatchStatus.Ongoing, nowUtc);

                        match.TeamAOutCycles = 0;
                        match.TeamBOutCycles = 0;
                        match.WinnerTeamId = null;
                        match.EndReasonCode = null;
                        match.EndReasonDetail = null;
                        match.RulesetVersion = decision.RulesetVersion;

                        await db.SaveChangesAsync(ct);

                        _logger.LogInformation("🚀 START match {id} ({a} vs {b}). Ruleset={ruleset}",
                            match.MatchId, symA, symB, decision.RulesetVersion);

                        started++;
                        continue;
                    }

                    _logger.LogInformation("⏭️ NoAction match {id} pending. Detail={detail}", match.MatchId, decision.ReasonDetail);
                }

                ongoingNow = await matchService.GetOngoingMatchesAsync();
            }

            if (ongoingNow.Count == 0)
            {
                _logger.LogWarning("⚠️ Nenhum jogo Ongoing após auto-start. Nada a processar.");
                return;
            }

            // 6) Ongoing: atualizar score + aplicar KO/WO + auto-end 90min
            foreach (var m in ongoingNow)
            {
                var match = await db.Match
                    .Include(x => x.TeamA).ThenInclude(t => t.Currency)
                    .Include(x => x.TeamB).ThenInclude(t => t.Currency)
                    .FirstOrDefaultAsync(x => x.MatchId == m.MatchId, ct);

                if (match == null) continue;
                if (match.Status != MatchStatus.Ongoing) continue;

                if (match.StartTime == null)
                {
                    await matchService.UpdateMatchStatusAndStartTimeAsync(match.MatchId, MatchStatus.Ongoing, nowUtc);
                    match.StartTime = nowUtc;
                }

                var symA = match.TeamA?.Currency?.Symbol ?? "";
                var symB = match.TeamB?.Currency?.Symbol ?? "";

                var a = match.TeamA?.Currency?.PercentageChange ?? 0;
                var b = match.TeamB?.Currency?.PercentageChange ?? 0;

                var (scoreA, scoreB) = CalculateScoreFromPercent((double)a, (double)b);

                if (match.ScoreA != scoreA || match.ScoreB != scoreB)
                {
                    await matchService.UpdateMatchScoreAsync(match.MatchId, scoreA, scoreB);
                    match.ScoreA = scoreA;
                    match.ScoreB = scoreB;

                    _logger.LogInformation("📊 Match {id} score atualizado: {a}:{b}", match.MatchId, scoreA, scoreB);
                }

                var decisionOngoing = ruleEngine.EvaluateOngoing(
                    teamAId: match.TeamAId,
                    teamBId: match.TeamBId,
                    teamASymbol: symA,
                    teamBSymbol: symB,
                    scoreA: match.ScoreA,
                    scoreB: match.ScoreB,
                    teamAOutCycles: match.TeamAOutCycles,
                    teamBOutCycles: match.TeamBOutCycles,
                    topGainersSnapshot: snapshot,
                    snapshotTimeUtc: snapshotUtc
                );

                if (decisionOngoing.UpdatedTeamAOutCycles.HasValue)
                    match.TeamAOutCycles = decisionOngoing.UpdatedTeamAOutCycles.Value;

                if (decisionOngoing.UpdatedTeamBOutCycles.HasValue)
                    match.TeamBOutCycles = decisionOngoing.UpdatedTeamBOutCycles.Value;

                if (decisionOngoing.Decision == MatchDecisionType.FinishWithWinner)
                {
                    var winnerId = decisionOngoing.WinnerTeamId
                        ?? (decisionOngoing.WinnerSide == MatchWinnerSide.A ? match.TeamAId : match.TeamBId);

                    ApplyFinish(match, winnerId, decisionOngoing);

                    await db.SaveChangesAsync(ct);

                    _logger.LogWarning("🏁 FINISH match {id} WINNER={winner}. Reason={code} Detail={detail}",
                        match.MatchId, winnerId, decisionOngoing.ReasonCode, decisionOngoing.ReasonDetail);

                    continue;
                }

                if (decisionOngoing.Decision == MatchDecisionType.FinishWithWO)
                {
                    ApplyFinish(match, winnerTeamId: null, decisionOngoing);

                    await db.SaveChangesAsync(ct);

                    _logger.LogWarning("🏁 FINISH match {id} WO. Reason={code} Detail={detail}",
                        match.MatchId, decisionOngoing.ReasonCode, decisionOngoing.ReasonDetail);

                    continue;
                }

                var startUtc = ToUtcSafe(match.StartTime.Value);

                if (nowUtc - startUtc >= MatchDuration)
                {
                    match.Status = MatchStatus.Completed;
                    match.EndTime = nowUtc;
                    match.EndReasonCode = "TIME_LIMIT";
                    match.EndReasonDetail = $"Reached {MatchDuration.TotalMinutes}min time limit";
                    match.RulesetVersion ??= RuleConstants.DefaultRulesetVersion;

                    await db.SaveChangesAsync(ct);

                    _logger.LogInformation("⏱️ Match {id} atingiu 90min. Encerrado por tempo.", match.MatchId);
                }
            }
        }

        // ========= Persist helpers =========
        private static void ApplyCancel(Match match, MatchDecision decision)
        {
            match.Status = MatchStatus.Cancelled;
            match.EndTime = DateTime.UtcNow;

            match.WinnerTeamId = null;

            match.EndReasonCode = decision.ReasonCode;
            match.EndReasonDetail = decision.ReasonDetail;
            match.RulesetVersion = decision.RulesetVersion;

            match.TeamAOutCycles = 0;
            match.TeamBOutCycles = 0;
        }

        private static void ApplyFinish(Match match, int? winnerTeamId, MatchDecision decision)
        {
            match.Status = MatchStatus.Completed;
            match.EndTime = DateTime.UtcNow;

            match.WinnerTeamId = winnerTeamId;

            match.EndReasonCode = decision.ReasonCode;
            match.EndReasonDetail = decision.ReasonDetail;
            match.RulesetVersion = decision.RulesetVersion;
        }

        // ========= Utils =========
        private static double ParsePercent(string? s)
        {
            if (string.IsNullOrWhiteSpace(s)) return 0;
            return double.TryParse(s, NumberStyles.Any, CultureInfo.InvariantCulture, out var v) ? v : 0;
        }

        private static (int scoreA, int scoreB) CalculateScoreFromPercent(double a, double b)
        {
            if (a > b)
            {
                var diff = a - b;
                return ((int)Math.Floor(diff / 10), 0);
            }
            if (b > a)
            {
                var diff = b - a;
                return (0, (int)Math.Floor(diff / 10));
            }
            return (0, 0);
        }

        private static DateTime ToUtcSafe(DateTime dt)
        {
            if (dt.Kind == DateTimeKind.Unspecified)
                return DateTime.SpecifyKind(dt, DateTimeKind.Utc);

            return dt.ToUniversalTime();
        }

        private async Task CreateMissingMatchesAsync(
            MatchService matchService,
            EthicAIDbContext db,
            List<Currency> currencies,
            int missing,
            CancellationToken ct)
        {
            var existing = await db.Match
                .Where(m => m.Status == MatchStatus.Pending || m.Status == MatchStatus.Ongoing)
                .Include(m => m.TeamA).ThenInclude(t => t.Currency)
                .Include(m => m.TeamB).ThenInclude(t => t.Currency)
                .ToListAsync(ct);

            static string PairKey(string a, string b)
                => string.CompareOrdinal(a, b) < 0 ? $"{a}|{b}" : $"{b}|{a}";

            var existingPairs = new HashSet<string>(
                existing.Select(m =>
                {
                    var sa = m.TeamA?.Currency?.Symbol ?? "";
                    var sb = m.TeamB?.Currency?.Symbol ?? "";
                    return PairKey(sa, sb);
                })
                .Where(k => !string.IsNullOrWhiteSpace(k) && !k.StartsWith("|") && !k.EndsWith("|"))
            );

            var candidatePairs = new List<(Currency A, Currency B)>();
            for (int i = 0; i + 1 < currencies.Count; i += 2)
                candidatePairs.Add((currencies[i], currencies[i + 1]));

            var created = 0;

            foreach (var (A, B) in candidatePairs)
            {
                if (created >= missing) break;

                var key = PairKey(A.Symbol, B.Symbol);
                if (existingPairs.Contains(key))
                    continue;

                await matchService.CreateMatchAsync(A, B);
                existingPairs.Add(key);
                created++;

                _logger.LogInformation("🎮 Criado match faltante: {a} vs {b}", A.Symbol, B.Symbol);
            }

            if (created < missing)
                _logger.LogWarning("⚠️ Não consegui criar todos os faltantes. Criados={created}, faltavam={missing}", created, missing);
        }
    }
}
