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
using BLL.GameRules;
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

        private const string WorkerName = "CriptoVersus.Worker";

        private static readonly TimeSpan CycleInterval = TimeSpan.FromSeconds(60);
        private static readonly TimeSpan MatchDuration = TimeSpan.FromMinutes(90);

        private const int DesiredOngoing = 10;
        private const int DesiredPending = 10;

        private static readonly TimeSpan PendingLeadTime = TimeSpan.FromMinutes(10);
        private static readonly TimeSpan BettingCloseOffset = TimeSpan.FromMinutes(2);

        private const decimal MinQuoteVolumeUsdt = 5_000_000m;
        private const int MinTradesCount = 2000;
        private const int TakeGainers = 40;
        private const int LogTop = 15;

        public record HealthItem(bool Ok, string Message);

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

        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            await WaitForPostgresAsync(stoppingToken);
            await EnsureWorkerStatusTableAsync(stoppingToken);

            await WriteWorkerStatusAsync(
                status: "starting",
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
                await ExecuteCycleWithStatusAsync(stoppingToken);
                await Task.Delay(CycleInterval, stoppingToken);
            }
        }

        private async Task ExecuteCycleWithStatusAsync(CancellationToken ct)
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
                checks = await BuildHealthChecksAsync(ct);
                await RunCycleAsync(ct);
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

                checks ??= new Dictionary<string, HealthItem>
                {
                    ["health"] = new HealthItem(false, "Health check failed to build")
                };

                var degraded = status == "degraded" || checks.Values.Any(x => !x.Ok);
                var healthJson = JsonSerializer.Serialize(checks);

                if (status == "running" && degraded)
                    status = "degraded";

                await WriteWorkerStatusAsync(
                    status: status,
                    cycleStartUtc: cycleStartUtc,
                    cycleEndUtc: DateTime.UtcNow,
                    lastSuccessUtc: lastSuccessUtc,
                    lastCycleMs: (int)sw.ElapsedMilliseconds,
                    degraded: degraded,
                    healthJson: healthJson,
                    lastErrorMsg: lastError,
                    lastErrorStack: lastStack,
                    ct: ct);

                await NotifyDashboardChangedAsync(ct);
            }
        }

        private async Task RunCycleAsync(CancellationToken ct)
        {
            using var scope = _sp.CreateScope();

            var http = _httpClientFactory.CreateClient();
            var db = scope.ServiceProvider.GetRequiredService<EthicAIDbContext>();
            var matchService = scope.ServiceProvider.GetRequiredService<MatchService>();
            var ruleEngine = scope.ServiceProvider.GetRequiredService<IMatchRuleEngine>();

            var nowUtc = DateTime.UtcNow;

            var topGainers = await LoadTopGainersAsync(http, ct);
            if (topGainers.Count < 6)
            {
                _logger.LogWarning("⚠️ Top gainers insuficiente (count={count}).", topGainers.Count);
                return;
            }

            LogTopGainers(topGainers);

            var snapshotUtc = nowUtc;
            var snapshot = BuildSnapshot(topGainers);

            var currencies = await matchService.SaveCurrenciesAsync(topGainers);
            var currencyBySymbol = BuildCurrencyMap(currencies);
            var allowedSymbols = BuildAllowedSet(snapshot);

            await CleanupOutOfSnapshotMatchesAsync(db, allowedSymbols, nowUtc, ct);
            await ExpireStalePendingAsync(db, nowUtc, ct);

            await ProcessOngoingAsync(matchService, db, ruleEngine, snapshot, snapshotUtc, allowedSymbols, nowUtc, ct);
            await PromoteDuePendingToOngoingAsync(db, nowUtc, ct);
            await EnsureOngoingPoolAsync(db, nowUtc, ct);
            await EnsurePendingPoolAsync(db, snapshot, currencyBySymbol, DesiredPending, nowUtc, ct);

            await LogPoolStatusAsync(db, nowUtc, ct);
        }

        private async Task<List<Crypto>> LoadTopGainersAsync(HttpClient http, CancellationToken ct)
        {
            var all = await http.GetFromJsonAsync<List<Crypto>>(
                "https://api.binance.com/api/v3/ticker/24hr",
                ct);

            if (all == null || all.Count == 0)
            {
                _logger.LogWarning("⚠️ Binance retornou vazio.");
                return new List<Crypto>();
            }

            static decimal ParseDec(string? s)
                => decimal.TryParse(s, NumberStyles.Any, CultureInfo.InvariantCulture, out var v) ? v : 0m;

            return all
                .Where(c => !string.IsNullOrWhiteSpace(c.Symbol))
                .Where(c => c.Symbol!.EndsWith("USDT", StringComparison.OrdinalIgnoreCase))
                .Where(c => c.Count >= MinTradesCount)
                .Where(c => ParseDec(c.QuoteVolume) >= MinQuoteVolumeUsdt)
                .OrderByDescending(c => ParsePercent(c.PriceChangePercent))
                .Take(TakeGainers)
                .ToList();
        }

        private void LogTopGainers(List<Crypto> topGainers)
        {
            _logger.LogInformation(
                "✅ TopGainers OK (USDT, trades>={minTrades}, qv>={minQv:n0}) count={count} :: {symbols}",
                MinTradesCount,
                MinQuoteVolumeUsdt,
                topGainers.Count,
                string.Join(", ", topGainers.Select(x => x.Symbol)));

            foreach (var c in topGainers.Take(LogTop))
            {
                _logger.LogInformation("Gainer {sym} pct={pct} quoteVol={qv} trades={cnt}",
                    c.Symbol, c.PriceChangePercent, c.QuoteVolume, c.Count);
            }
        }

        private static List<GainerEntry> BuildSnapshot(List<Crypto> topGainers)
        {
            return topGainers
                .Select((c, idx) => new GainerEntry
                {
                    Symbol = c.Symbol ?? "",
                    Rank = idx + 1,
                    PercentageChange = (decimal?)ParsePercent(c.PriceChangePercent)
                })
                .ToList();
        }

        private static Dictionary<string, Currency> BuildCurrencyMap(List<Currency> currencies)
        {
            return currencies
                .Where(c => !string.IsNullOrWhiteSpace(c.Symbol))
                .ToDictionary(c => c.Symbol!, StringComparer.OrdinalIgnoreCase);
        }

        private static HashSet<string> BuildAllowedSet(List<GainerEntry> snapshot)
        {
            return snapshot
                .Select(x => x.Symbol)
                .ToHashSet(StringComparer.OrdinalIgnoreCase);
        }

        private async Task CleanupOutOfSnapshotMatchesAsync(
            EthicAIDbContext db,
            HashSet<string> allowedSymbols,
            DateTime nowUtc,
            CancellationToken ct)
        {
            await CancelPendingOutsideSnapshotAsync(db, allowedSymbols, nowUtc, ct);
            await ForceEndOngoingOutsideSnapshotAsync(db, allowedSymbols, nowUtc, ct);
        }

        private async Task LogPoolStatusAsync(EthicAIDbContext db, DateTime nowUtc, CancellationToken ct)
        {
            var pendingCount = await CountValidPendingAsync(db, nowUtc, ct);
            var ongoingCount = await db.Match.CountAsync(x => x.Status == MatchStatus.Ongoing, ct);

            _logger.LogInformation(
                "📦 Pool status: pendingValid={pending} ongoing={ongoing} (targets p={pTarget} o={oTarget})",
                pendingCount,
                ongoingCount,
                DesiredPending,
                DesiredOngoing);
        }

        private async Task EnsurePendingPoolAsync(
            EthicAIDbContext db,
            List<GainerEntry> snapshot,
            Dictionary<string, Currency> currencyBySymbol,
            int desiredPending,
            DateTime nowUtc,
            CancellationToken ct)
        {
            var pendingCount = await CountValidPendingAsync(db, nowUtc, ct);
            var missing = desiredPending - pendingCount;
            if (missing <= 0) return;

            var existing = await LoadExistingPoolMatchesAsync(db, ct);

            var existingPairs = BuildExistingPairs(existing);
            var busySymbols = BuildBusySymbols(existing);
            var rankedSymbols = snapshot
                .Where(x => !string.IsNullOrWhiteSpace(x.Symbol))
                .OrderBy(x => x.Rank)
                .Select(x => x.Symbol)
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToList();

            var candidates = BuildCandidatePairs(rankedSymbols);
            var created = 0;

            foreach (var (symA, symB, _) in candidates)
            {
                if (created >= missing) break;

                var key = PairKey(symA, symB);
                if (existingPairs.Contains(key)) continue;
                if (busySymbols.Contains(symA) || busySymbols.Contains(symB)) continue;
                if (!currencyBySymbol.TryGetValue(symA, out var curA)) continue;
                if (!currencyBySymbol.TryGetValue(symB, out var curB)) continue;

                await CreatePendingMatchAsync(db, curA, curB, nowUtc, ct);

                existingPairs.Add(key);
                busySymbols.Add(symA);
                busySymbols.Add(symB);
                created++;
            }

            if (created < missing)
                _logger.LogWarning("⚠️ Pending pool: consegui criar {created} de {missing}.", created, missing);
            else
                _logger.LogInformation("✅ Pending pool reposto: criados {created} (meta={desired}).", created, desiredPending);
        }

        private async Task<List<Match>> LoadExistingPoolMatchesAsync(EthicAIDbContext db, CancellationToken ct)
        {
            return await db.Match
                .Where(m => m.Status == MatchStatus.Pending || m.Status == MatchStatus.Ongoing)
                .Include(m => m.TeamA).ThenInclude(t => t.Currency)
                .Include(m => m.TeamB).ThenInclude(t => t.Currency)
                .ToListAsync(ct);
        }

        private static HashSet<string> BuildExistingPairs(List<Match> existing)
        {
            return new HashSet<string>(
                existing.Select(m =>
                    PairKey(m.TeamA?.Currency?.Symbol ?? "", m.TeamB?.Currency?.Symbol ?? ""))
                .Where(k => !string.IsNullOrWhiteSpace(k) && !k.StartsWith("|") && !k.EndsWith("|")),
                StringComparer.OrdinalIgnoreCase);
        }

        private static HashSet<string> BuildBusySymbols(List<Match> existing)
        {
            return new HashSet<string>(
                existing.SelectMany(m => new[]
                {
                    m.TeamA?.Currency?.Symbol ?? "",
                    m.TeamB?.Currency?.Symbol ?? ""
                })
                .Where(s => !string.IsNullOrWhiteSpace(s)),
                StringComparer.OrdinalIgnoreCase);
        }

        private static List<(string A, string B, int Score)> BuildCandidatePairs(List<string> rankedSymbols)
        {
            var result = new List<(string A, string B, int Score)>();

            for (int i = 0; i < rankedSymbols.Count; i++)
            {
                for (int j = i + 1; j < rankedSymbols.Count; j++)
                {
                    var a = rankedSymbols[i];
                    var b = rankedSymbols[j];
                    var diff = j - i;
                    var sum = i + j;
                    result.Add((a, b, diff * 1000 + sum));
                }
            }

            result.Sort((x, y) => x.Score.CompareTo(y.Score));
            return result;
        }

        private async Task CreatePendingMatchAsync(
            EthicAIDbContext db,
            Currency curA,
            Currency curB,
            DateTime nowUtc,
            CancellationToken ct)
        {
            var teamA = await db.Team
                .Include(t => t.Currency)
                .Where(t => t.Currency != null && t.Currency.Symbol == curA.Symbol)
                .OrderBy(t => t.TeamId)
                .FirstOrDefaultAsync(ct);

            var teamB = await db.Team
                .Include(t => t.Currency)
                .Where(t => t.Currency != null && t.Currency.Symbol == curB.Symbol)
                .OrderBy(t => t.TeamId)
                .FirstOrDefaultAsync(ct);

            if (teamA == null || teamB == null)
            {
                _logger.LogWarning("⚠️ Team não encontrado para criar partida pending: {a} vs {b}", curA.Symbol, curB.Symbol);
                return;
            }

            var startTime = nowUtc.Add(PendingLeadTime);
            var bettingCloseTime = startTime.Subtract(BettingCloseOffset);

            var match = new Match
            {
                TeamAId = teamA.TeamId,
                TeamBId = teamB.TeamId,
                Status = MatchStatus.Pending,
                StartTime = startTime,
                BettingCloseTime = bettingCloseTime,
                ScoreA = 0,
                ScoreB = 0,
                WinnerTeamId = null,
                EndTime = null,
                EndReasonCode = null,
                EndReasonDetail = null,
                TeamAOutCycles = 0,
                TeamBOutCycles = 0,
                RulesetVersion = RuleConstants.DefaultRulesetVersion
            };

            db.Match.Add(match);
            await db.SaveChangesAsync(ct);

            _logger.LogInformation(
                "🆕 Pending criada: MatchId={matchId} {a} vs {b} start={start} betClose={close}",
                match.MatchId, curA.Symbol, curB.Symbol, startTime, bettingCloseTime);
        }

        private async Task PromoteDuePendingToOngoingAsync(
            EthicAIDbContext db,
            DateTime nowUtc,
            CancellationToken ct)
        {
            var duePending = await db.Match
                .Where(m =>
                    m.Status == MatchStatus.Pending &&
                    m.StartTime.HasValue &&
                    m.StartTime.Value <= nowUtc)
                .OrderBy(m => m.StartTime)
                .ToListAsync(ct);

            if (duePending.Count == 0)
                return;

            foreach (var match in duePending)
            {
                match.Status = MatchStatus.Ongoing;

                if (!match.BettingCloseTime.HasValue && match.StartTime.HasValue)
                    match.BettingCloseTime = match.StartTime.Value.AddMinutes(-1);
            }

            await db.SaveChangesAsync(ct);
            _logger.LogInformation("🚀 Promovidas {count} partidas Pending -> Ongoing", duePending.Count);
        }

        private async Task EnsureOngoingPoolAsync(
            EthicAIDbContext db,
            DateTime nowUtc,
            CancellationToken ct)
        {
            var ongoingCount = await db.Match.CountAsync(x => x.Status == MatchStatus.Ongoing, ct);
            if (ongoingCount >= DesiredOngoing) return;

            var missing = DesiredOngoing - ongoingCount;

            var duePending = await db.Match
                .Where(m =>
                    m.Status == MatchStatus.Pending &&
                    m.StartTime.HasValue &&
                    m.StartTime.Value <= nowUtc)
                .OrderBy(m => m.StartTime)
                .Take(missing)
                .ToListAsync(ct);

            foreach (var match in duePending)
                match.Status = MatchStatus.Ongoing;

            if (duePending.Count > 0)
            {
                await db.SaveChangesAsync(ct);
                _logger.LogInformation("🚀 Ongoing pool ajustado: iniciadas {count} partidas", duePending.Count);
            }
        }

        private async Task<int> CountValidPendingAsync(
            EthicAIDbContext db,
            DateTime nowUtc,
            CancellationToken ct)
        {
            return await db.Match.CountAsync(m =>
                m.Status == MatchStatus.Pending &&
                (
                    (m.BettingCloseTime.HasValue && m.BettingCloseTime.Value > nowUtc) ||
                    (!m.BettingCloseTime.HasValue && m.StartTime.HasValue && m.StartTime.Value > nowUtc)
                ), ct);
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

            var changed = 0;

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
                    m.RulesetVersion ??= RuleConstants.DefaultRulesetVersion;
                    changed++;
                }
            }

            if (changed > 0)
                await db.SaveChangesAsync(ct);
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

            var changed = 0;

            foreach (var m in ongoingNow)
            {
                var a = m.TeamA?.Currency?.Symbol ?? "";
                var b = m.TeamB?.Currency?.Symbol ?? "";

                if (!allowed.Contains(a) || !allowed.Contains(b))
                {
                    m.Status = MatchStatus.Completed;
                    m.EndTime = nowUtc;
                    m.WinnerTeamId = null;
                    m.EndReasonCode = "FILTERED_OUT_ONGOING";
                    m.EndReasonDetail = $"Forced end: pair not in TopGainers snapshot. A={a} B={b}";
                    m.TeamAOutCycles = 0;
                    m.TeamBOutCycles = 0;
                    m.RulesetVersion ??= RuleConstants.DefaultRulesetVersion;
                    changed++;
                }
            }

            if (changed > 0)
                await db.SaveChangesAsync(ct);
        }

        private static async Task ExpireStalePendingAsync(
            EthicAIDbContext db,
            DateTime nowUtc,
            CancellationToken ct)
        {
            var stalePending = await db.Match
                .Where(m =>
                    m.Status == MatchStatus.Pending &&
                    (
                        (m.BettingCloseTime.HasValue && m.BettingCloseTime.Value <= nowUtc) ||
                        (!m.BettingCloseTime.HasValue && m.StartTime.HasValue && m.StartTime.Value <= nowUtc)
                    ))
                .ToListAsync(ct);

            if (stalePending.Count == 0)
                return;

            foreach (var m in stalePending)
            {
                m.Status = MatchStatus.Cancelled;
                m.EndTime = nowUtc;
                m.WinnerTeamId = null;
                m.EndReasonCode = "PENDING_EXPIRED";
                m.EndReasonDetail = "Pending venceu a janela de aposta sem ser iniciado.";
            }

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
                _logger.LogInformation("ℹ️ Nenhum jogo Ongoing para processar.");
                return;
            }

            foreach (var m in ongoingNow)
            {
                var match = await db.Match
                    .Include(x => x.TeamA).ThenInclude(t => t.Currency)
                    .Include(x => x.TeamB).ThenInclude(t => t.Currency)
                    .FirstOrDefaultAsync(x => x.MatchId == m.MatchId, ct);

                if (match == null || match.Status != MatchStatus.Ongoing)
                    continue;

                var symA = match.TeamA?.Currency?.Symbol ?? "";
                var symB = match.TeamB?.Currency?.Symbol ?? "";

                if (!allowed.Contains(symA) || !allowed.Contains(symB))
                {
                    match.Status = MatchStatus.Completed;
                    match.EndTime = nowUtc;
                    match.WinnerTeamId = null;
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

                    ApplyFinish(match, winnerId, decisionOngoing, nowUtc);
                    await db.SaveChangesAsync(ct);

                    _logger.LogWarning("🏁 FINISH match {id} WINNER={winner}. Reason={code} Detail={detail}",
                        match.MatchId, winnerId, decisionOngoing.ReasonCode, decisionOngoing.ReasonDetail);

                    continue;
                }

                if (decisionOngoing.Decision == MatchDecisionType.FinishWithWO)
                {
                    ApplyFinish(match, null, decisionOngoing, nowUtc);
                    await db.SaveChangesAsync(ct);

                    _logger.LogWarning("🏁 FINISH match {id} WO. Reason={code} Detail={detail}",
                        match.MatchId, decisionOngoing.ReasonCode, decisionOngoing.ReasonDetail);

                    continue;
                }

                if (!match.StartTime.HasValue)
                {
                    _logger.LogWarning("⚠️ Match {id} sem StartTime. Pulando processamento.", match.MatchId);
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
                else
                {
                    await db.SaveChangesAsync(ct);
                }
            }
        }

        private static void ApplyFinish(Match match, int? winnerTeamId, MatchDecision decision, DateTime nowUtc)
        {
            match.Status = MatchStatus.Completed;
            match.EndTime = nowUtc;
            match.WinnerTeamId = winnerTeamId;
            match.EndReasonCode = decision.ReasonCode;
            match.EndReasonDetail = decision.ReasonDetail;
            match.RulesetVersion = decision.RulesetVersion;
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

        private static double ParsePercent(string? s)
        {
            if (string.IsNullOrWhiteSpace(s)) return 0;
            return double.TryParse(s, NumberStyles.Any, CultureInfo.InvariantCulture, out var v) ? v : 0;
        }

        private static string PairKey(string a, string b)
            => string.CompareOrdinal(a, b) < 0 ? $"{a}|{b}" : $"{b}|{a}";

        private static DateTime ToUtcSafe(DateTime dt)
        {
            if (dt.Kind == DateTimeKind.Unspecified)
                return DateTime.SpecifyKind(dt, DateTimeKind.Utc);

            return dt.ToUniversalTime();
        }

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

        private async Task WriteWorkerStatusAsync(
            string status,
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

            var utcNow = DateTime.UtcNow;

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
  tx_last_error       = EXCLUDED.tx_last_error,
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
                ct);
        }

        private async Task NotifyDashboardChangedAsync(CancellationToken ct)
        {
            try
            {
                using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(5) };
                using var content = new StringContent("{}", System.Text.Encoding.UTF8, "application/json");
                var resp = await http.PostAsync("http://criptoversus-api:8080/api/dashboard/notify", content, ct);

                _logger.LogInformation("📣 Notify dashboard_changed -> HTTP {StatusCode}", (int)resp.StatusCode);
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "⚠️ Falha ao notificar dashboard_changed.");
            }
        }

        private async Task<Dictionary<string, HealthItem>> BuildHealthChecksAsync(CancellationToken ct)
        {
            var checks = new Dictionary<string, HealthItem>();

            try
            {
                using var scope = _sp.CreateScope();
                var db = scope.ServiceProvider.GetRequiredService<EthicAIDbContext>();

                var connStr = db.Database.GetDbConnection().ConnectionString;
                await using var conn = new NpgsqlConnection(connStr);
                await conn.OpenAsync(ct);

                await using var cmd = new NpgsqlCommand("SELECT 1;", conn);
                _ = await cmd.ExecuteScalarAsync(ct);

                checks["database"] = new HealthItem(true, "Connected");
            }
            catch (Exception ex)
            {
                checks["database"] = new HealthItem(false, ex.Message);
            }

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

            _logger.LogWarning("⚠️ Timeout aguardando Postgres. O worker vai continuar.");
        }
    }
}