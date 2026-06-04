using DTOs;
using CriptoVersus.API.Hubs;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.Options;
using System.Text.Json;

// Ajuste namespaces conforme seu projeto
using EthicAI.EntityModel;
using DAL.NftFutebol;
using CriptoVersus.API.Services;
using BLL.ArenaSentiment;

namespace CriptoVersus.API.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class MatchesController : ControllerBase
    {
        private readonly EthicAIDbContext _db;
        private readonly IHubContext<DashboardHub> _hub;
        private readonly IMatchScoreRebuildService _matchScoreRebuildService;
        private readonly IConfiguration _configuration;
        private readonly IArenaSentimentService _arenaSentimentService;
        private readonly IAudioAssetResolverService _audioAssetResolver;
        private readonly IAudioGenerationQueueService _audioGenerationQueue;
        private readonly IOptions<ProceduralAudioFeatureOptions> _proceduralAudioOptions;
        private readonly ILogger<MatchesController> _logger;

        public MatchesController(
            EthicAIDbContext db,
            IHubContext<DashboardHub> hub,
            IMatchScoreRebuildService matchScoreRebuildService,
            IConfiguration configuration,
            IArenaSentimentService arenaSentimentService,
            IAudioAssetResolverService audioAssetResolver,
            IAudioGenerationQueueService audioGenerationQueue,
            IOptions<ProceduralAudioFeatureOptions> proceduralAudioOptions,
            ILogger<MatchesController> logger)
        {
            _db = db;
            _hub = hub;
            _matchScoreRebuildService = matchScoreRebuildService;
            _configuration = configuration;
            _arenaSentimentService = arenaSentimentService;
            _audioAssetResolver = audioAssetResolver;
            _audioGenerationQueue = audioGenerationQueue;
            _proceduralAudioOptions = proceduralAudioOptions;
            _logger = logger;
        }

        // =========================
        // GET /api/matches
        // =========================
        [AllowAnonymous]
        [HttpGet]
        public async Task<ActionResult<List<MatchDto>>> GetAll(
            [FromQuery] MatchStatus? status = null,
            [FromQuery] int take = 50,
            [FromQuery] bool includeParticipants = false,
            CancellationToken ct = default)
        {
            if (take <= 0) take = 50;
            if (take > 200) take = 200;

            var now = DateTime.UtcNow;

            var q = _db.Set<Match>()
                .AsNoTracking()
                .Include(m => m.TeamA).ThenInclude(t => t.Currency)
                .Include(m => m.TeamB).ThenInclude(t => t.Currency)
                .Include(m => m.WinnerTeam).ThenInclude(t => t!.Currency)
                .AsQueryable();

            if (status != null)
                q = q.Where(m => m.Status == status);

            var matches = await q
                .OrderByDescending(m => m.StartTime ?? DateTime.MaxValue)
                .Take(take)
                .ToListAsync(ct);

            matches = matches
                .Where(m => !MatchPairRules.IsForbiddenPair(m.TeamA?.Currency?.Symbol, m.TeamB?.Currency?.Symbol, _configuration))
                .ToList();

            var items = await ToMatchDtosAsync(matches, now, includeParticipants, ct);
            return Ok(items);
        }
        // =========================
        // GET /api/matches/by-symbols?symbolA=PENDLE&symbolB=DASH
        // Retorna o match Ongoing do par, senão o mais recente
        // =========================
        [AllowAnonymous]
        [HttpGet("by-symbols")]
        public async Task<ActionResult<MatchDto>> GetBySymbols(
            [FromQuery] string symbolA,
            [FromQuery] string symbolB,
            [FromQuery] bool includeParticipants = false,
            CancellationToken ct = default)
        {
            if (string.IsNullOrWhiteSpace(symbolA) || string.IsNullOrWhiteSpace(symbolB))
                return BadRequest("symbolA e symbolB são obrigatórios.");

            var now = DateTime.UtcNow;

            var a = symbolA.Trim().ToUpperInvariant();
            var b = symbolB.Trim().ToUpperInvariant();

            var q = _db.Set<Match>()
                .AsNoTracking()
                .Include(m => m.TeamA).ThenInclude(t => t.Currency)
                .Include(m => m.TeamB).ThenInclude(t => t.Currency)
                .Include(m => m.WinnerTeam).ThenInclude(t => t!.Currency)
                .Where(m =>
                    (m.TeamA.Currency.Symbol.ToUpper() == a && m.TeamB.Currency.Symbol.ToUpper() == b) ||
                    (m.TeamA.Currency.Symbol.ToUpper() == b && m.TeamB.Currency.Symbol.ToUpper() == a));

            // Prioriza a partida ao vivo. Se nao houver, prioriza a ultima finalizada
            // antes de mostrar uma nova pending do mesmo par.
            var match = await q
                .OrderBy(m => m.Status == MatchStatus.Ongoing ? 0
                    : m.Status == MatchStatus.Completed ? 1
                    : m.Status == MatchStatus.Pending ? 2
                    : 3)
                .ThenByDescending(m => m.EndTime ?? m.StartTime ?? DateTime.MinValue)
                .FirstOrDefaultAsync(ct);

            if (match is null)
                return NotFound();

            if (MatchPairRules.IsForbiddenPair(match.TeamA?.Currency?.Symbol, match.TeamB?.Currency?.Symbol, _configuration))
                return NotFound();

            return Ok(await ToMatchDtoAsync(match, now, includeParticipants, ct));
        }

        // =========================
        // GET /api/matches/{id}
        // =========================
        [AllowAnonymous]
        [HttpGet("{id:int}")]
        public async Task<ActionResult<MatchDto>> GetById(
            int id,
            [FromQuery] bool includeParticipants = true,
            CancellationToken ct = default)
        {
            var now = DateTime.UtcNow;

            var match = await _db.Set<Match>()
                .AsNoTracking()
                .Include(m => m.TeamA).ThenInclude(t => t.Currency)
                .Include(m => m.TeamB).ThenInclude(t => t.Currency)
                .Include(m => m.WinnerTeam).ThenInclude(t => t!.Currency)
                .FirstOrDefaultAsync(m => m.MatchId == id, ct);

            if (match == null)
                return NotFound();

            if (MatchPairRules.IsForbiddenPair(match.TeamA?.Currency?.Symbol, match.TeamB?.Currency?.Symbol, _configuration))
                return NotFound();

            return Ok(await ToMatchDtoAsync(match, now, includeParticipants, ct));
        }

        [AllowAnonymous]
        [HttpGet("{id:int}/score-events")]
        public async Task<ActionResult<List<MatchScoreEventDto>>> GetScoreEvents(
            int id,
            [FromQuery] string? language = null,
            CancellationToken ct = default)
        {
            var exists = await _db.Set<Match>().AnyAsync(m => m.MatchId == id, ct);
            if (!exists)
                return NotFound();

            var items = await _db.Set<MatchScoreEvent>()
                .AsNoTracking()
                .Include(x => x.Team).ThenInclude(t => t.Currency)
                .Where(x => x.MatchId == id)
                .OrderBy(x => x.EventSequence)
                .ToListAsync(ct);

            var requestedLanguage = string.IsNullOrWhiteSpace(language)
                ? null
                : AudioRequestNormalizer.NormalizeLanguage(language);

            var results = new List<MatchScoreEventDto>(items.Count);
            foreach (var item in items)
            {
            var dto = new MatchScoreEventDto
                {
                    MatchScoreEventId = item.MatchScoreEventId,
                    MatchId = item.MatchId,
                    TeamId = item.TeamId,
                    TeamSymbol = item.Team.Currency.Symbol,
                    RuleType = item.RuleType.ToString(),
                    EventType = item.EventType,
                    ReasonCode = item.ReasonCode,
                    Points = item.Points,
                    EventSequence = item.EventSequence,
                    TeamPercentageChange = item.TeamPercentageChange,
                    OpponentPercentageChange = item.OpponentPercentageChange,
                    TeamQuoteVolume = item.TeamQuoteVolume,
                    OpponentQuoteVolume = item.OpponentQuoteVolume,
                    MetricDelta = item.MetricDelta,
                    WindowStartUtc = item.WindowStartUtc,
                    WindowEndUtc = item.WindowEndUtc,
                    Description = item.Description,
                    EventTimeUtc = item.EventTimeUtc,
                    AudioContextKey = item.AudioContextKey,
                    AudioIntensity = item.AudioIntensity,
                    AudioVoiceKey = item.AudioVoiceKey,
                    AudioAssetId = item.AudioAssetId,
                    AudioUrl = item.AudioUrl,
                    AudioFallbackUsed = item.AudioFallbackUsed,
                    AudioResolvedLanguage = item.AudioResolvedLanguage
                };

                if (_proceduralAudioOptions.Value.Enabled
                    && _proceduralAudioOptions.Value.ResolveOnScoreEvents
                    && !string.IsNullOrWhiteSpace(requestedLanguage))
                    await ApplyLocalizedAudioAsync(item, dto, requestedLanguage, ct);

                results.Add(dto);
            }

            return Ok(results);
        }

        [AllowAnonymous]
        [HttpGet("{id:int}/metric-snapshots")]
        public async Task<ActionResult<List<MatchMetricSnapshotDto>>> GetMetricSnapshots(
            int id,
            [FromQuery] int take = 200,
            CancellationToken ct = default)
        {
            if (take <= 0) take = 200;
            if (take > 1000) take = 1000;

            var match = await _db.Set<Match>()
                .AsNoTracking()
                .Where(m => m.MatchId == id)
                .Select(m => new { m.MatchId, m.Status })
                .FirstOrDefaultAsync(ct);

            if (match is null)
                return NotFound();

            var rawItems = await _db.Set<MatchMetricSnapshot>()
                .AsNoTracking()
                .Include(x => x.Team).ThenInclude(t => t.Currency)
                .Where(x => x.MatchId == id)
                .OrderByDescending(x => x.CapturedAtUtc)
                .Take(take)
                .Select(x => new MatchMetricSnapshotDto
                {
                    MatchMetricSnapshotId = x.MatchMetricSnapshotId,
                    MatchId = x.MatchId,
                    TeamId = x.TeamId,
                    TeamSymbol = x.Team.Currency.Symbol,
                    CapturedAtUtc = x.CapturedAtUtc,
                    PercentageChange = x.PercentageChange,
                    QuoteVolume = x.QuoteVolume,
                    TradeCount = x.TradeCount
                })
                .ToListAsync(ct);

            if (rawItems.Count > 0)
            {
                _logger.LogInformation(
                    "Returning raw match metric snapshots for match {MatchId}. Count={Count}. Status={Status}",
                    id,
                    rawItems.Count,
                    match.Status);

                return Ok(rawItems
                    .OrderBy(x => x.CapturedAtUtc)
                    .ThenBy(x => x.MatchMetricSnapshotId)
                    .ToList());
            }

            var aggregateItems = await _db.Set<MatchMetricHourlyAggregate>()
                .AsNoTracking()
                .Where(x => x.MatchId == id)
                .OrderByDescending(x => x.HourBucketUtc)
                .Take(take)
                .Select(x => new MatchMetricSnapshotDto
                {
                    MatchMetricSnapshotId = x.Id,
                    MatchId = x.MatchId,
                    TeamId = x.TeamId,
                    TeamSymbol = x.Symbol,
                    CapturedAtUtc = x.HourBucketUtc,
                    PercentageChange = x.AveragePercentageChange,
                    QuoteVolume = x.AverageQuoteVolume,
                    TradeCount = (long)Math.Round(x.AverageTradeCount, MidpointRounding.AwayFromZero)
                })
                .ToListAsync(ct);

            if (aggregateItems.Count > 0)
            {
                _logger.LogInformation(
                    "Returning aggregated match metric snapshots for match {MatchId}. Count={Count}. Status={Status}",
                    id,
                    aggregateItems.Count,
                    match.Status);

                return Ok(aggregateItems
                    .OrderBy(x => x.CapturedAtUtc)
                    .ThenBy(x => x.MatchMetricSnapshotId)
                    .ToList());
            }

            _logger.LogInformation(
                "No metric snapshots found for match {MatchId}. Count=0. Status={Status}. TriedAggregate={TriedAggregate}",
                id,
                match.Status,
                true);

            return Ok(new List<MatchMetricSnapshotDto>());
        }

        [AllowAnonymous]
        [HttpGet("{id:int}/arena-sentiment")]
        public async Task<ActionResult<ArenaSentimentPairDto>> GetArenaSentiment(int id, CancellationToken ct)
        {
            var match = await _db.Set<Match>()
                .AsNoTracking()
                .Include(m => m.TeamA).ThenInclude(t => t.Currency)
                .Include(m => m.TeamB).ThenInclude(t => t.Currency)
                .FirstOrDefaultAsync(m => m.MatchId == id, ct);

            if (match is null || match.TeamA?.Currency is null || match.TeamB?.Currency is null)
                return NotFound();

            if (MatchPairRules.IsForbiddenPair(match.TeamA.Currency.Symbol, match.TeamB.Currency.Symbol, _configuration))
                return NotFound();

            return Ok(await _arenaSentimentService.GetArenaSentimentForMatchAsync(
                match.TeamA.Currency.Symbol,
                match.TeamB.Currency.Symbol,
                ct));
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

            var teams = await _db.Set<Team>()
                .AsNoTracking()
                .Include(t => t.Currency)
                .Where(t => t.TeamId == req.TeamAId || t.TeamId == req.TeamBId)
                .ToListAsync(ct);

            var teamA = teams.FirstOrDefault(t => t.TeamId == req.TeamAId);
            var teamB = teams.FirstOrDefault(t => t.TeamId == req.TeamBId);

            if (teamA is null || teamB is null)
                return BadRequest("Time inválido.");

            if (MatchPairRules.IsForbiddenPair(teamA.Currency?.Symbol, teamB.Currency?.Symbol, _configuration))
                return BadRequest(MatchPairRules.GetForbiddenPairReason(teamA.Currency?.Symbol, teamB.Currency?.Symbol, _configuration));

            var match = new Match
            {
                TeamAId = req.TeamAId,
                TeamBId = req.TeamBId,
                Status = MatchStatus.Pending,
                StartTime = req.StartTimeUtc,
                EndTime = null,
                ScoreA = 0,
                ScoreB = 0,
                ScoringRuleType = req.ScoringRuleType
            };

            _db.Add(match);
            await _db.SaveChangesAsync(ct);

            _db.Add(new MatchScoreState
            {
                MatchId = match.MatchId,
                CreatedAtUtc = DateTime.UtcNow,
                UpdatedAtUtc = DateTime.UtcNow
            });

            await _db.SaveChangesAsync(ct);
            await NotifyDashboardChangedAsync("match_created", match.MatchId, ct);

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
            await NotifyDashboardChangedAsync("match_started", match.MatchId, ct);
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
            match.WinnerTeamId = GetEffectiveWinnerTeamId(match);

            await _db.SaveChangesAsync(ct);
            await NotifyDashboardChangedAsync("match_completed", match.MatchId, ct);
            return Ok();
        }

        // =========================
        // Helpers
        // =========================
        private async Task<List<MatchDto>> ToMatchDtosAsync(
            List<Match> matches,
            DateTime nowUtc,
            bool includeParticipants,
            CancellationToken ct)
        {
            if (matches.Count == 0)
                return [];

            var matchIds = matches.Select(m => m.MatchId).ToList();

            var aggregates = await _db.Set<Bet>()
                .AsNoTracking()
                .Where(b => matchIds.Contains(b.MatchId))
                .GroupBy(b => new { b.MatchId, b.TeamId })
                .Select(g => new MatchSideAggregate
                {
                    MatchId = g.Key.MatchId,
                    TeamId = g.Key.TeamId,
                    TotalAmount = g.Sum(x => x.Amount),
                    TotalDistributed = g.Sum(x => x.PayoutAmount ?? 0m),
                    BetCount = g.Count(),
                    WalletCount = g.Select(x => x.UserId).Distinct().Count()
                })
                .ToListAsync(ct);

            var participantsByMatch = new Dictionary<int, List<MatchParticipantDto>>();
            if (includeParticipants)
            {
                var participants = await _db.Set<Bet>()
                    .AsNoTracking()
                    .Where(b => matchIds.Contains(b.MatchId))
                    .Include(b => b.User)
                    .Include(b => b.Team).ThenInclude(t => t.Currency)
                    .Include(b => b.Match)
                    .OrderByDescending(b => b.BetTime)
                    .ToListAsync(ct);

                participantsByMatch = participants
                    .GroupBy(x => x.MatchId)
                    .ToDictionary(
                        g => g.Key,
                        g => g.Select(x => new MatchParticipantDto
                        {
                            WalletMasked = MaskWallet(x.User?.Wallet),
                            TeamSymbol = x.Team?.Currency?.Symbol ?? $"Team#{x.TeamId}",
                            BetAmount = x.Amount,
                            ResultLabel = GetParticipantResultLabel(x.Match?.Status ?? MatchStatus.Pending, x.IsWinner, x.PayoutAmount ?? 0m, x.Amount, x.Match?.EndReasonCode),
                            ReceivedAmount = GetParticipantReceivedAmount(x.Match?.Status ?? MatchStatus.Pending, x.PayoutAmount ?? 0m, x.Amount, x.Match?.EndReasonCode)
                        }).ToList());
            }

            return matches.Select(match => ToMatchDto(match, nowUtc, aggregates, participantsByMatch)).ToList();
        }

        private async Task<MatchDto> ToMatchDtoAsync(
            Match match,
            DateTime nowUtc,
            bool includeParticipants,
            CancellationToken ct)
        {
            var items = await ToMatchDtosAsync([match], nowUtc, includeParticipants, ct);
            return items[0];
        }

        private MatchDto ToMatchDto(
            Match match,
            DateTime nowUtc,
            List<MatchSideAggregate> aggregates,
            Dictionary<int, List<MatchParticipantDto>> participantsByMatch)
        {
            var a = match.TeamA?.Currency;
            var b = match.TeamB?.Currency;
            var winner = match.WinnerTeam?.Currency;
            var effectiveWinnerTeamId = GetEffectiveWinnerTeamId(match);

            var elapsed = 0;
            var finished = match.Status == MatchStatus.Completed;

            if (match.StartTime != null)
                elapsed = (int)Math.Max(0, (nowUtc - match.StartTime.Value).TotalMinutes);

            var teamAStats = aggregates.FirstOrDefault(x => x.MatchId == match.MatchId && x.TeamId == match.TeamAId);
            var teamBStats = aggregates.FirstOrDefault(x => x.MatchId == match.MatchId && x.TeamId == match.TeamBId);
            var totalAmountTeamA = teamAStats?.TotalAmount ?? 0m;
            var totalAmountTeamB = teamBStats?.TotalAmount ?? 0m;
            var walletCountTeamA = teamAStats?.WalletCount ?? 0;
            var walletCountTeamB = teamBStats?.WalletCount ?? 0;
            var betCountTeamA = teamAStats?.BetCount ?? 0;
            var betCountTeamB = teamBStats?.BetCount ?? 0;
            var totalPool = totalAmountTeamA + totalAmountTeamB;
            var totalWalletCount = walletCountTeamA + walletCountTeamB;
            var totalDistributed = aggregates.Where(x => x.MatchId == match.MatchId).Sum(x => x.TotalDistributed);
            var hasBetsOnBothSides = totalAmountTeamA > 0m && totalAmountTeamB > 0m && walletCountTeamA > 0 && walletCountTeamB > 0;
            var hasValidFinancialDispute = HasValidFinancialDispute(match, totalAmountTeamA, totalAmountTeamB, walletCountTeamA, walletCountTeamB);
            var losingPool = effectiveWinnerTeamId == match.TeamAId ? totalAmountTeamB : effectiveWinnerTeamId == match.TeamBId ? totalAmountTeamA : 0m;
            var winningPool = effectiveWinnerTeamId == match.TeamAId ? totalAmountTeamA : effectiveWinnerTeamId == match.TeamBId ? totalAmountTeamB : 0m;
            var houseFeeRate = ClampRate(GetDecimal("CriptoVersusWorker:Settlement:HouseFeeRate", 0.01m));
            var houseFeeAmount = hasValidFinancialDispute ? Math.Round(losingPool * houseFeeRate, 8) : 0m;
            var poolStrengthTeamA = CalculatePoolStrength(walletCountTeamA, totalWalletCount, totalAmountTeamA, totalPool);
            var poolStrengthTeamB = CalculatePoolStrength(walletCountTeamB, totalWalletCount, totalAmountTeamB, totalPool);

            return new MatchDto
            {
                MatchId = match.MatchId,
                TeamA = a?.Symbol ?? $"Team#{match.TeamAId}",
                TeamB = b?.Symbol ?? $"Team#{match.TeamBId}",
                TeamAId = match.TeamAId,
                TeamBId = match.TeamBId,
                ScoreA = match.ScoreA,
                ScoreB = match.ScoreB,
                Status = match.Status.ToString(),
                StartTime = match.StartTime,
                EndTime = match.EndTime,
                ElapsedMinutes = elapsed,
                RemainingMinutes = Math.Max(0, 90 - elapsed),
                IsFinished = finished,
                PctA = (decimal?)a?.PercentageChange,
                PctB = (decimal?)b?.PercentageChange,
                QuoteVolumeA = a?.QuoteVolume,
                QuoteVolumeB = b?.QuoteVolume,
                ScoringRuleType = match.ScoringRuleType.ToString(),
                WinnerTeamId = effectiveWinnerTeamId,
                WinnerTeamSymbol = winner?.Symbol ?? (effectiveWinnerTeamId == match.TeamAId ? a?.Symbol : effectiveWinnerTeamId == match.TeamBId ? b?.Symbol : null),
                EndReasonCode = ResolveSettlementReasonCode(match, totalAmountTeamA, totalAmountTeamB, walletCountTeamA, walletCountTeamB),
                EndReasonDetail = match.EndReasonDetail,
                TotalAmountTeamA = totalAmountTeamA,
                TotalAmountTeamB = totalAmountTeamB,
                WalletCountTeamA = walletCountTeamA,
                WalletCountTeamB = walletCountTeamB,
                BetCountTeamA = betCountTeamA,
                BetCountTeamB = betCountTeamB,
                TotalPool = totalPool,
                TotalWalletCount = totalWalletCount,
                TotalPoolAmount = totalPool,
                LosingPool = losingPool,
                WinningPool = winningPool,
                HouseFeeAmount = houseFeeAmount,
                TotalDistributed = totalDistributed,
                HasBetsOnBothSides = hasBetsOnBothSides,
                HasValidFinancialDispute = hasValidFinancialDispute,
                PoolStrengthTeamA = poolStrengthTeamA,
                PoolStrengthTeamB = poolStrengthTeamB,
                Participants = participantsByMatch.TryGetValue(match.MatchId, out var participantsForMatch) ? participantsForMatch : []
            };
        }

        private decimal GetDecimal(string key, decimal fallback)
            => decimal.TryParse(_configuration[key], System.Globalization.NumberStyles.Any, System.Globalization.CultureInfo.InvariantCulture, out var value)
                ? value
                : fallback;

        private static decimal ClampRate(decimal rate)
            => Math.Clamp(rate, 0m, 1m);

        private static int CalculatePoolStrength(int walletCountTeam, int totalWalletCount, decimal totalAmountTeam, decimal totalPoolAmount)
        {
            const decimal walletWeight = 0.5m;
            const decimal amountWeight = 0.5m;

            var walletShare = totalWalletCount > 0
                ? (decimal)walletCountTeam / totalWalletCount
                : 0m;

            var amountShare = totalPoolAmount > 0m
                ? totalAmountTeam / totalPoolAmount
                : 0m;

            var strength = (walletShare * walletWeight + amountShare * amountWeight) * 100m;
            return (int)Math.Clamp(Math.Round(strength, MidpointRounding.AwayFromZero), 0m, 100m);
        }

        private static bool HasValidFinancialDispute(
            Match match,
            decimal totalAmountTeamA,
            decimal totalAmountTeamB,
            int walletCountTeamA,
            int walletCountTeamB)
            => match.Status == MatchStatus.Completed
               && GetEffectiveWinnerTeamId(match).HasValue
               && match.ScoreA != match.ScoreB
               && totalAmountTeamA > 0m
               && totalAmountTeamB > 0m
               && walletCountTeamA > 0
               && walletCountTeamB > 0;

        private static int? GetEffectiveWinnerTeamId(Match match)
        {
            if (match.WinnerTeamId.HasValue)
                return match.WinnerTeamId;

            if (match.Status != MatchStatus.Completed)
                return null;

            if (match.ScoreA > match.ScoreB)
                return match.TeamAId;

            if (match.ScoreB > match.ScoreA)
                return match.TeamBId;

            return null;
        }

        private static string ResolveSettlementReasonCode(
            Match match,
            decimal totalAmountTeamA,
            decimal totalAmountTeamB,
            int walletCountTeamA,
            int walletCountTeamB)
        {
            if (!string.IsNullOrWhiteSpace(match.EndReasonCode))
                return match.EndReasonCode!;

            if (match.Status == MatchStatus.Cancelled)
                return "CANCELLED";

            if (match.ScoreA == 0 && match.ScoreB == 0)
                return "DRAW_ZERO_ZERO";

            if (!GetEffectiveWinnerTeamId(match).HasValue || match.ScoreA == match.ScoreB)
                return "NO_WINNER";

            if (totalAmountTeamA <= 0m || walletCountTeamA <= 0)
                return "NO_BETS_ON_TEAM_A";

            if (totalAmountTeamB <= 0m || walletCountTeamB <= 0)
                return "NO_BETS_ON_TEAM_B";

            return "SETTLED";
        }

        private static string MaskWallet(string? wallet)
        {
            if (string.IsNullOrWhiteSpace(wallet))
                return "-";

            var trimmed = wallet.Trim();
            if (trimmed.Length <= 10)
                return trimmed;

            return $"{trimmed[..4]}...{trimmed[^4..]}";
        }

        private static decimal GetParticipantReceivedAmount(MatchStatus matchStatus, decimal payoutAmount, decimal betAmount, string? settlementReasonCode)
        {
            var resultCode = GetParticipantResultCode(matchStatus, null, payoutAmount, betAmount, settlementReasonCode);
            return resultCode switch
            {
                "won" or "lost" or "partial-loss" => payoutAmount,
                "refunded" => payoutAmount > 0m ? payoutAmount : betAmount,
                "cancelled" or "draw-refunded" or "won-no-opponent-pool" or "refunded-no-counterparty" => betAmount,
                _ => 0m
            };
        }

        private static string GetParticipantResultLabel(MatchStatus matchStatus, bool? isWinner, decimal payoutAmount, decimal betAmount, string? settlementReasonCode)
            => GetParticipantResultCode(matchStatus, isWinner, payoutAmount, betAmount, settlementReasonCode) switch
            {
                "won" => "GANHOU",
                "lost" => "PERDEU",
                "partial-loss" => "PERDEU PARCIALMENTE",
                "open" => "EM ABERTO",
                "won-no-opponent-pool" => "SEM ADVERSARIO",
                "refunded-no-counterparty" => "SEM CONTRAPARTE",
                _ => "REEMBOLSADO"
            };

        private static string GetParticipantResultCode(MatchStatus matchStatus, bool? isWinner, decimal payoutAmount, decimal betAmount, string? settlementReasonCode)
        {
            if (matchStatus is MatchStatus.Pending or MatchStatus.Ongoing)
                return "open";

            if (matchStatus == MatchStatus.Cancelled || settlementReasonCode == "CANCELLED")
                return "cancelled";

            if (settlementReasonCode == "DRAW_ZERO_ZERO")
                return "draw-refunded";

            if (settlementReasonCode is "NO_BETS_ON_TEAM_A" or "NO_BETS_ON_TEAM_B" or "NO_COUNTERPARTY")
                return isWinner == true ? "won-no-opponent-pool" : "refunded-no-counterparty";

            if (isWinner == true || payoutAmount > betAmount)
                return "won";

            if (payoutAmount == betAmount && betAmount > 0m)
                return "refunded";

            if (payoutAmount > 0m && payoutAmount < betAmount)
                return "partial-loss";

            return "lost";
        }

        private sealed class MatchSideAggregate
        {
            public int MatchId { get; init; }
            public int TeamId { get; init; }
            public decimal TotalAmount { get; init; }
            public decimal TotalDistributed { get; init; }
            public int BetCount { get; init; }
            public int WalletCount { get; init; }
        }

        private Task NotifyDashboardChangedAsync(string reason, int matchId, CancellationToken ct)
        {
            return _hub.Clients.All.SendAsync(
                "dashboard_changed",
                JsonSerializer.Serialize(new
                {
                    reason,
                    matchId,
                    utc = DateTimeOffset.UtcNow
                }),
                ct);
        }

        private async Task ApplyLocalizedAudioAsync(
            MatchScoreEvent item,
            MatchScoreEventDto dto,
            string requestedLanguage,
            CancellationToken ct)
        {
            var resolveRequest = BuildAudioResolveRequest(item, requestedLanguage);
            if (resolveRequest is null)
                return;

            dto.AudioContextKey ??= resolveRequest.ContextKey;
            dto.AudioIntensity ??= resolveRequest.Intensity;
            dto.AudioVoiceKey ??= resolveRequest.VoiceKey;

            if (dto.AudioAssetId.HasValue
                && !string.IsNullOrWhiteSpace(dto.AudioUrl)
                && string.Equals(dto.AudioResolvedLanguage, requestedLanguage, StringComparison.OrdinalIgnoreCase))
            {
                return;
            }

            var resolved = await _audioAssetResolver.ResolveAsync(resolveRequest, ct);
            if (resolved is not null)
            {
                dto.AudioAssetId = resolved.Asset.Id;
                dto.AudioUrl = resolved.Asset.AudioUrl;
                dto.AudioFallbackUsed = resolved.FallbackUsed;
                dto.AudioResolvedLanguage = resolved.ResolvedLanguage;
                dto.AudioVoiceKey ??= resolved.Asset.VoiceKey;

                _logger.LogInformation(
                    "Localized score-event audio resolved. MatchId={MatchId} EventId={EventId} Language={Language} AssetId={AssetId} FallbackUsed={FallbackUsed}",
                    item.MatchId,
                    item.MatchScoreEventId,
                    requestedLanguage,
                    resolved.Asset.Id,
                    resolved.FallbackUsed);
                return;
            }

            var queued = await _audioGenerationQueue.EnqueueIfMissingAsync(resolveRequest, ct);
            _logger.LogWarning(
                "Localized score-event audio missing. MatchId={MatchId} EventId={EventId} Language={Language} Queued={Queued} EventType={EventType}",
                item.MatchId,
                item.MatchScoreEventId,
                requestedLanguage,
                queued,
                resolveRequest.EventType);

            if (_proceduralAudioOptions.Value.FallbackToLegacyAudio && !string.IsNullOrWhiteSpace(item.AudioUrl))
            {
                dto.AudioUrl = item.AudioUrl;
                dto.AudioAssetId = item.AudioAssetId;
                dto.AudioFallbackUsed = true;
                dto.AudioResolvedLanguage = item.AudioResolvedLanguage;
                _logger.LogInformation(
                    "Legacy audio fallback used on score-event response. MatchId={MatchId} EventId={EventId} Language={Language} AudioUrl={AudioUrl}",
                    item.MatchId,
                    item.MatchScoreEventId,
                    requestedLanguage,
                    item.AudioUrl);
            }
        }

        private static AudioResolveRequest? BuildAudioResolveRequest(MatchScoreEvent item, string requestedLanguage)
        {
            var descriptor = ProceduralAudioEventMapper.MapScoreEvent(
                item.EventType,
                item.ReasonCode,
                item.MetricDelta);

            if (string.IsNullOrWhiteSpace(descriptor.EventType))
                return null;

            return new AudioResolveRequest
            {
                EventType = descriptor.EventType,
                Language = requestedLanguage,
                TeamSymbol = item.Team?.Currency?.Symbol,
                TeamName = item.Team?.Currency?.Name,
                ContextKey = item.AudioContextKey ?? descriptor.ContextKey,
                Intensity = item.AudioIntensity ?? descriptor.Intensity,
                VoiceKey = item.AudioVoiceKey
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
        public MatchScoringRuleType ScoringRuleType { get; set; } = MatchScoringRuleType.PercentThreshold;
    }
}
