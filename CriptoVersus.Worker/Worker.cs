using System.Globalization;
using System.Net.Sockets;
using System.Net.Http.Json;
using BLL.NFTFutebol;
using EthicAI.EntityModel;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using static BLL.BinanceService;
using Microsoft.EntityFrameworkCore;
using DAL.NftFutebol;

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

        private async Task EnsureWorkerStatusTableAsync(CancellationToken ct)
        {
            using var scope = _sp.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<EthicAIDbContext>();

            var sql = @"
CREATE TABLE IF NOT EXISTS worker_status (
  worker_name      text PRIMARY KEY,
  status           text NOT NULL,
  last_heartbeat   timestamptz NOT NULL,
  last_success     timestamptz NULL,
  last_error       timestamptz NULL,
  last_error_msg   text NULL,
  details          jsonb NULL
);";

            await db.Database.ExecuteSqlRawAsync(sql, ct);
        }

        private async Task UpsertWorkerStatusAsync(
            string status,
            DateTime utcNow,
            DateTime? lastSuccessUtc,
            DateTime? lastErrorUtc,
            string? lastErrorMsg,
            string? detailsJson,
            CancellationToken ct)
        {
            using var scope = _sp.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<EthicAIDbContext>();

            var sql = @"
INSERT INTO worker_status
  (worker_name, status, last_heartbeat, last_success, last_error, last_error_msg, details)
VALUES
  ({0}, {1}, {2}, {3}, {4}, {5}, CASE WHEN {6} IS NULL THEN NULL ELSE CAST({6} AS jsonb) END)
ON CONFLICT (worker_name) DO UPDATE SET
  status         = EXCLUDED.status,
  last_heartbeat = EXCLUDED.last_heartbeat,
  last_success   = COALESCE(EXCLUDED.last_success, worker_status.last_success),
  last_error     = COALESCE(EXCLUDED.last_error, worker_status.last_error),
  last_error_msg = COALESCE(EXCLUDED.last_error_msg, worker_status.last_error_msg),
  details        = COALESCE(EXCLUDED.details, worker_status.details);";

            await db.Database.ExecuteSqlRawAsync(
                sql,
                parameters: new object?[]
                {
                    WorkerName,
                    status,
                    utcNow,
                    lastSuccessUtc,
                    lastErrorUtc,
                    lastErrorMsg,
                    detailsJson
                },
                cancellationToken: ct
            );
        }

        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            _logger.LogInformation("✅ CriptoVersus Worker started.");

            await WaitForPostgresAsync(stoppingToken);
            await EnsureWorkerStatusTableAsync(stoppingToken);

            while (!stoppingToken.IsCancellationRequested)
            {
                try
                {
                    var now = DateTime.UtcNow;

                    // status "Running" + heartbeat
                    await UpsertWorkerStatusAsync("Running", now, null, null, null, null, stoppingToken);

                    await RunCycleAsync(stoppingToken);

                    now = DateTime.UtcNow;

                    // status "Ok" + last_success
                    await UpsertWorkerStatusAsync("Ok", now, now, null, null, null, stoppingToken);

                    await Task.Delay(TimeSpan.FromSeconds(60), stoppingToken);
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "❌ Erro no ciclo do Worker");

                    // ✅ AQUI estava faltando: gravar Error no banco
                    var now = DateTime.UtcNow;
                    await UpsertWorkerStatusAsync("Error", now, null, now, ex.Message, null, stoppingToken);

                    var wait = IsDnsOrNetworkTransient(ex)
                        ? TimeSpan.FromSeconds(45)
                        : TimeSpan.FromSeconds(15);

                    _logger.LogWarning("⏳ Aguardando {sec}s para tentar novamente...", wait.TotalSeconds);
                    await Task.Delay(wait, stoppingToken);
                }
            }
        }

        private static bool IsDnsOrNetworkTransient(Exception ex)
        {
            for (var e = ex; e != null; e = e.InnerException)
            {
                if (e is SocketException) return true;
            }
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

        private async Task RunCycleAsync(CancellationToken ct)
        {
            using var scope = _sp.CreateScope();

            var http = _httpClientFactory.CreateClient();
            var matchService = scope.ServiceProvider.GetRequiredService<MatchService>();
            var db = scope.ServiceProvider.GetRequiredService<EthicAIDbContext>();

            // 1) Binance 24hr -> Top 6 gainers (USDT)
            var all = await http.GetFromJsonAsync<List<Crypto>>(
                "https://api.binance.com/api/v3/ticker/24hr",
                ct);

            if (all == null || all.Count == 0)
            {
                _logger.LogWarning("⚠️ Binance retornou vazio.");
                return;
            }

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

            // 2) Save/Update currencies
            var currencies = await matchService.SaveCurrenciesAsync(topGainers);

            // 3) Garantir 3 jogos (Pending/Ongoing)
            var upcoming = await matchService.GetUpcomingPendingMatchesAsync(3);

            if (upcoming.Count < 3)
            {
                var missing = 3 - upcoming.Count;
                _logger.LogWarning("⚠️ Faltam {missing} jogos. Criando...", missing);

                await CreateMissingMatchesAsync(matchService, db, currencies, missing, ct);

                upcoming = await matchService.GetUpcomingPendingMatchesAsync(3);
            }

            _logger.LogInformation("✅ Jogos suficientes. Total={total}", upcoming.Count);

            // 4) Recalcular placar (Ongoing) + 5) Auto-end após 90 min
            var ongoing = await matchService.GetOngoingMatchesAsync();
            if (ongoing.Count == 0) return;

            var nowUtc = DateTime.UtcNow;

            foreach (var m in ongoing)
            {
                if (m.StartTime == null)
                {
                    await matchService.UpdateMatchStatusAndStartTimeAsync(m.MatchId, MatchStatus.Ongoing, nowUtc);
                    m.StartTime = nowUtc;
                }

                var a = m.TeamA?.Currency?.PercentageChange ?? 0;
                var b = m.TeamB?.Currency?.PercentageChange ?? 0;

                var (scoreA, scoreB) = CalculateScoreFromPercent((double)a, (double)b);

                if (m.ScoreA != scoreA || m.ScoreB != scoreB)
                {
                    await matchService.UpdateMatchScoreAsync(m.MatchId, scoreA, scoreB);
                    _logger.LogInformation("📊 Match {id} score atualizado: {a}:{b}", m.MatchId, scoreA, scoreB);
                }

                var startUtc = ToUtcSafe(m.StartTime.Value);
                if (nowUtc - startUtc >= MatchDuration)
                {
                    _logger.LogInformation("⏱️ Match {id} atingiu 90min. Encerrando...", m.MatchId);
                    await matchService.EndMatchAsync(m.MatchId);
                }
            }
        }

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
