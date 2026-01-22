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
using Microsoft.Extensions.Options;
using Npgsql;
using static BLL.BinanceService;

namespace CriptoVersus.Worker
{
    public class Worker : BackgroundService
    {
        private readonly ILogger<Worker> _logger;
        private readonly IServiceProvider _sp;
        private readonly IHttpClientFactory _httpClientFactory;
        private readonly CriptoVersusWorkerOptions _options;
        public Worker(
     ILogger<Worker> logger,
     IServiceProvider sp,
     IHttpClientFactory httpClientFactory,
     IOptions<CriptoVersusWorkerOptions> options)
        {
            _logger = logger;
            _sp = sp;
            _httpClientFactory = httpClientFactory;
            _options = options.Value;
        }

        private const string WorkerName = "CriptoVersus.Worker";
        private static readonly TimeSpan MatchDuration = TimeSpan.FromMinutes(90);
        private static readonly TimeSpan CycleInterval = TimeSpan.FromSeconds(60);

        private const decimal MinQuoteVolumeUsdt = 5_000_000m; // 5M
        private const int MinTradesCount = 2000;              // trades minimos (mais “real”)

        // ✅ snapshot maior pra ter pool suficiente
        private const int TakeGainers = 40;                    // era 20

        private const int LogTop = 15;

        // ✅ metas do estoque
        private const int DesiredOngoing = 10;                 // sempre 10 em andamento
        private const int DesiredPending = 10;                 // estoque de 10 pendentes



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
                    var url = "http://criptoversus-api:8080/api/dashboard/notify";

                    try
                    {
                        using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(5) };
                        using var content = new StringContent("{}", System.Text.Encoding.UTF8, "application/json");

                        var resp = await http.PostAsync(url, content, stoppingToken);

                        _logger.LogInformation("📣 Notify dashboard_changed -> HTTP {StatusCode}", (int)resp.StatusCode);
                    }
                    catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
                    {
                    }
                    catch (Exception ex)
                    {
                        _logger.LogWarning(ex, "⚠️ Falha ao notificar dashboard_changed (não derruba o ciclo).");
                    }

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
            static decimal ParseDec(string? s)
                => decimal.TryParse(s, NumberStyles.Any, CultureInfo.InvariantCulture, out var v) ? v : 0m;

            var topGainers = all
     .Where(c => !string.IsNullOrWhiteSpace(c.Symbol))
     .Where(c => c.Symbol!.EndsWith("USDT", StringComparison.OrdinalIgnoreCase))
     .Where(c => c.Count >= MinTradesCount)                 // trades mínimos
     .Where(c => ParseDec(c.QuoteVolume) >= MinQuoteVolumeUsdt) // 5M USDT
     .OrderByDescending(c => ParsePercent(c.PriceChangePercent))
     .Take(TakeGainers)
     .ToList();


            if (topGainers.Count < 6)
            {
                _logger.LogWarning("⚠️ Top gainers insuficiente (count={count}).", topGainers.Count);
                return;
            }

            _logger.LogInformation(
                                    "✅ TopGainers OK (USDT, trades>={minTrades}, qv>={minQv:n0}) count={count} :: {symbols}",
                                    MinTradesCount,
                                    MinQuoteVolumeUsdt,
                                    topGainers.Count,
                                    string.Join(", ", topGainers.Select(x => x.Symbol))
                                );

            foreach (var c in topGainers.Take(LogTop))
            {
                _logger.LogInformation("Gainer {sym} pct={pct} quoteVol={qv} trades={cnt}",
                    c.Symbol, c.PriceChangePercent, c.QuoteVolume, c.Count);
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

            // ✅ lookup por symbol para criar matches com seguranca
            var currencyBySymbol = currencies
                .Where(c => !string.IsNullOrWhiteSpace(c.Symbol))
                .ToDictionary(c => c.Symbol!, StringComparer.OrdinalIgnoreCase);

            // ✅ allowed symbols (snapshot atual)
            var allowed = snapshot.Select(x => x.Symbol).ToHashSet(StringComparer.OrdinalIgnoreCase);

            // =============================
            // A) HIGIENE: cancelar PENDING fora do snapshot
            // =============================
            await CancelPendingOutsideSnapshotAsync(db, allowed, nowUtc, ct);

            // =============================
            // B) HIGIENE: finalizar ONGOING fora do snapshot (agressivo)
            // =============================
            await ForceEndOngoingOutsideSnapshotAsync(db, allowed, nowUtc, ct);

            // =============================
            // C) GARANTIR ESTOQUE DE PENDING (10)
            // =============================
            await EnsurePendingPoolAsync(matchService, db, snapshot, currencyBySymbol, DesiredPending, ct);

            // =============================
            // D) GARANTIR 10 ONGOING (startar a partir dos pending)
            // =============================
            await EnsureOngoingAsync(matchService, db, ruleEngine, snapshot, snapshotUtc, allowed, nowUtc, DesiredOngoing, ct);


            var pendingCount = await db.Match.CountAsync(x => x.Status == MatchStatus.Pending, ct);
            var ongoingCount = await db.Match.CountAsync(x => x.Status == MatchStatus.Ongoing, ct);
            _logger.LogInformation("📦 Pool status: pending={pending} ongoing={ongoing} (targets p={pTarget} o={oTarget})",
                pendingCount, ongoingCount, DesiredPending, DesiredOngoing);


            // =============================
            // E) PROCESSAR ONGOING (score, KO/WO, time-limit)
            // =============================
            await ProcessOngoingAsync(matchService, db, ruleEngine, snapshot, snapshotUtc, allowed, nowUtc, ct);



           
            
        }
        private static async Task CancelPendingOutsideSnapshotAsync(
    EthicAIDbContext db,
    HashSet<string> allowed,
    DateTime nowUtc,
    CancellationToken ct)
        {
            var pendingNow = await db.Match
                .Include(x => x.TeamA).ThenInclude(t => t.Currency)
                .Include(x => x.TeamB).ThenInclude(t => t.Currency)
                .Where(x => x.Status == MatchStatus.Pending)
                .ToListAsync(ct);

            var cancelled = 0;

            foreach (var m in pendingNow)
            {
                var a = m.TeamA?.Currency?.Symbol ?? "";
                var b = m.TeamB?.Currency?.Symbol ?? "";

                if (!allowed.Contains(a) || !allowed.Contains(b))
                {
                    m.Status = MatchStatus.Cancelled;
                    m.EndTime = nowUtc;
                    m.EndReasonCode = "FILTERED_OUT";
                    m.EndReasonDetail = $"Pair not in TopGainers snapshot. A={a} B={b}";
                    m.WinnerTeamId = null;
                    m.TeamAOutCycles = 0;
                    m.TeamBOutCycles = 0;
                    cancelled++;
                }
            }

            if (cancelled > 0)
                await db.SaveChangesAsync(ct);
        }
        private async Task ProcessOngoingAsync(
    MatchService matchService,
    EthicAIDbContext db,
    IMatchRuleEngine ruleEngine,
    List<GainerEntry> snapshot,
    DateTime snapshotUtc,
    HashSet<string> allowed,
    DateTime nowUtc,
    CancellationToken ct)
        {
            var ongoingNow = await matchService.GetOngoingMatchesAsync();

            if (ongoingNow.Count == 0)
            {
                _logger.LogWarning("⚠️ Nenhum jogo Ongoing. Nada a processar.");
                return;
            }

            foreach (var m in ongoingNow)
            {
                var match = await db.Match
                    .Include(x => x.TeamA).ThenInclude(t => t.Currency)
                    .Include(x => x.TeamB).ThenInclude(t => t.Currency)
                    .FirstOrDefaultAsync(x => x.MatchId == m.MatchId, ct);

                if (match == null) continue;
                if (match.Status != MatchStatus.Ongoing) continue;

                // garantia extra: startTime
                if (match.StartTime == null)
                {
                    await matchService.UpdateMatchStatusAndStartTimeAsync(match.MatchId, MatchStatus.Ongoing, nowUtc);
                    match.StartTime = nowUtc;
                }

                var symA = match.TeamA?.Currency?.Symbol ?? "";
                var symB = match.TeamB?.Currency?.Symbol ?? "";

                // ✅ agressivo: se saiu do snapshot, encerra imediatamente
                if (!allowed.Contains(symA) || !allowed.Contains(symB))
                {
                    match.Status = MatchStatus.Completed;
                    match.EndTime = nowUtc;

                    match.WinnerTeamId = null; // WO tecnico
                    match.EndReasonCode = "FILTERED_OUT_ONGOING";
                    match.EndReasonDetail = $"Forced end: pair not in TopGainers snapshot. A={symA} B={symB}";

                    match.TeamAOutCycles = 0;
                    match.TeamBOutCycles = 0;

                    match.RulesetVersion ??= RuleConstants.DefaultRulesetVersion;

                    await db.SaveChangesAsync(ct);

                    _logger.LogWarning("🏁 FORCE END (WO) match {id} ({a} vs {b}) - fora do snapshot.",
                        match.MatchId, symA, symB);

                    continue;
                }

                // % da moeda (atualizado via SaveCurrenciesAsync no mesmo ciclo)
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

                // time limit
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

        private static async Task ForceEndOngoingOutsideSnapshotAsync(
    EthicAIDbContext db,
    HashSet<string> allowed,
    DateTime nowUtc,
    CancellationToken ct)
        {
            var ongoingNow = await db.Match
                .Include(x => x.TeamA).ThenInclude(t => t.Currency)
                .Include(x => x.TeamB).ThenInclude(t => t.Currency)
                .Where(x => x.Status == MatchStatus.Ongoing)
                .ToListAsync(ct);

            var ended = 0;

            foreach (var m in ongoingNow)
            {
                var a = m.TeamA?.Currency?.Symbol ?? "";
                var b = m.TeamB?.Currency?.Symbol ?? "";

                if (!allowed.Contains(a) || !allowed.Contains(b))
                {
                    m.Status = MatchStatus.Completed;
                    m.EndTime = nowUtc;
                    m.WinnerTeamId = null; // WO tecnico (sem vencedor)
                    m.EndReasonCode = "FILTERED_OUT_ONGOING";
                    m.EndReasonDetail = $"Forced end: pair not in TopGainers snapshot. A={a} B={b}";
                    m.TeamAOutCycles = 0;
                    m.TeamBOutCycles = 0;
                    m.RulesetVersion ??= RuleConstants.DefaultRulesetVersion;

                    ended++;
                }
            }

            if (ended > 0)
                await db.SaveChangesAsync(ct);
        }
        private async Task EnsurePendingPoolAsync(
    MatchService matchService,
    EthicAIDbContext db,
    List<GainerEntry> snapshot,
    Dictionary<string, Currency> currencyBySymbol,
    int desiredPending,
    CancellationToken ct)
        {
            var pendingCount = await db.Match.CountAsync(x => x.Status == MatchStatus.Pending, ct);
            var missing = desiredPending - pendingCount;

            if (missing <= 0)
                return;

            // Pares existentes (pending + ongoing) para n%ao duplicar
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
                .Where(k => !string.IsNullOrWhiteSpace(k) && !k.StartsWith("|") && !k.EndsWith("|")),
                StringComparer.OrdinalIgnoreCase
            );

            // Opcional: evitar o mesmo symbol em 2 partidas ao mesmo tempo (recomendado)
            var busySymbols = new HashSet<string>(
                existing.SelectMany(m => new[]
                {
            m.TeamA?.Currency?.Symbol ?? "",
            m.TeamB?.Currency?.Symbol ?? ""
                })
                .Where(s => !string.IsNullOrWhiteSpace(s)),
                StringComparer.OrdinalIgnoreCase
            );

            // Snapshot ordenado por rank
            var ranked = snapshot
                .Where(x => !string.IsNullOrWhiteSpace(x.Symbol))
                .OrderBy(x => x.Rank)
                .Select(x => x.Symbol)
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToList();

            // Gera lista de candidatos (pares “proximos” em rank primeiro)
            var candidates = new List<(string A, string B, int Score)>();
            for (int i = 0; i < ranked.Count; i++)
                for (int j = i + 1; j < ranked.Count; j++)
                {
                    var a = ranked[i];
                    var b = ranked[j];

                    // score menor = melhor: pares mais proximos no rank e mais altos
                    var diff = j - i;                 // proximidade
                    var sum = i + j;                 // penaliza ranks mais baixos
                    var score = diff * 1000 + sum;    // diff domina

                    candidates.Add((a, b, score));
                }

            candidates.Sort((x, y) => x.Score.CompareTo(y.Score));

            var created = 0;

            foreach (var (symA, symB, _) in candidates)
            {
                if (created >= missing) break;

                var key = PairKey(symA, symB);
                if (existingPairs.Contains(key)) continue;

                // Se quiser permitir repeats de symbol em partidas diferentes, remova este bloco
                if (busySymbols.Contains(symA) || busySymbols.Contains(symB))
                    continue;

                if (!currencyBySymbol.TryGetValue(symA, out var curA)) continue;
                if (!currencyBySymbol.TryGetValue(symB, out var curB)) continue;

                await matchService.CreateMatchAsync(curA, curB);

                existingPairs.Add(key);
                busySymbols.Add(symA);
                busySymbols.Add(symB);
                created++;
            }

            if (created < missing)
                _logger.LogWarning("⚠️ Pending pool: consegui criar {created} de {missing}. Talvez aumentar TakeGainers.", created, missing);
            else
                _logger.LogInformation("✅ Pending pool reposto: criados {created} (meta={desired}).", created, desiredPending);
        }
        private async Task EnsureOngoingAsync(
    MatchService matchService,
    EthicAIDbContext db,
    IMatchRuleEngine ruleEngine,
    List<GainerEntry> snapshot,
    DateTime snapshotUtc,
    HashSet<string> allowed,
    DateTime nowUtc,
    int desiredOngoing,
    CancellationToken ct)
        {
            var ongoingCount = await db.Match.CountAsync(x => x.Status == MatchStatus.Ongoing, ct);
            var needToStart = desiredOngoing - ongoingCount;

            if (needToStart <= 0)
                return;

            // pega mais pendings pra ter margem de NoAction/Cancel
            var pendingsToConsider = await matchService.GetUpcomingPendingMatchesAsync(needToStart * 5);

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

                    started++;
                }
            }

            _logger.LogInformation("🚀 Ongoing: iniciados {started} (meta={desired}).", started, desiredOngoing);
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

        private (int scoreA, int scoreB) CalculateScoreFromPercent(double a, double b)
        {
            var percentPerGoal = _options.Scoring.PercentPerGoal;
            var maxGoals = _options.Scoring.MaxGoalsPerTeam;

            if (a > b)
            {
                var diff = a - b;
                var goals = Math.Min(maxGoals, (int)Math.Floor(diff / percentPerGoal));
                return (goals, 0);
            }

            if (b > a)
            {
                var diff = b - a;
                var goals = Math.Min(maxGoals, (int)Math.Floor(diff / percentPerGoal));
                return (0, goals);
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
