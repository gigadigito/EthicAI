using DTOs;
using BLL.Positions;
using DAL.NftFutebol;
using EthicAI.EntityModel;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using System.Data;
using System.Diagnostics;

namespace CriptoVersus.API.Controllers;

[ApiController]
[Route("api/[controller]")]
public sealed class StatsController : ControllerBase
{
    private const int MaxTopTeams = 20;
    private const int MaxDirectoryTeams = 100;
    private const int MaxLatestMatches = 20;
    private const int MaxTeamRivals = 5;
    private const int ActivityWindowDays = 30;
    private static readonly TimeSpan FreshCurrencyWindow = TimeSpan.FromMinutes(10);

    private readonly EthicAIDbContext _db;
    private readonly IConfiguration _configuration;
    private readonly ILogger<StatsController> _logger;

    public StatsController(EthicAIDbContext db, IConfiguration configuration, ILogger<StatsController> logger)
    {
        _db = db;
        _configuration = configuration;
        _logger = logger;
    }

    [AllowAnonymous]
    [HttpGet("overview")]
    public async Task<ActionResult<StatsOverviewDto>> GetOverview([FromQuery] string? search = null, CancellationToken ct = default)
    {
        var sw = Stopwatch.StartNew();
        var activityCutoffUtc = DateTime.UtcNow.Date.AddDays(-(ActivityWindowDays - 1));
        var visibleMatches = await LoadVisibleMatchesAsync(ct);
        visibleMatches = ApplySearchFilter(visibleMatches, search);
        var nowUtc = DateTime.UtcNow;

        var overview = new StatsOverviewDto
        {
            TotalMatches = visibleMatches.Count,
            FinishedMatches = visibleMatches.Count(m => m.Status == MatchStatus.Completed),
            ActiveAssets = visibleMatches
                .SelectMany(m => new[] { m.TeamASymbol, m.TeamBSymbol })
                .Where(symbol => !string.IsNullOrWhiteSpace(symbol))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .Count(),
            AverageScore = visibleMatches.Count == 0
                ? 0m
                : Math.Round((decimal)visibleMatches.Average(m => m.ScoreA + m.ScoreB), 2),
            HighestScore = visibleMatches.Count == 0
                ? 0
                : visibleMatches.Max(m => Math.Max(m.ScoreA, m.ScoreB)),
            LastUpdatedUtc = visibleMatches.Count == 0
                ? null
                : visibleMatches
                    .SelectMany(m => new DateTime?[] { m.TeamALastUpdatedUtc, m.TeamBLastUpdatedUtc, m.EndTime, m.StartTime })
                    .Where(x => x.HasValue)
                    .Select(x => x!.Value)
                    .DefaultIfEmpty()
                    .Max()
        };

        overview.IsStale = !overview.LastUpdatedUtc.HasValue || nowUtc - overview.LastUpdatedUtc.Value > TimeSpan.FromMinutes(10);
        overview.StaleReason = !overview.LastUpdatedUtc.HasValue
            ? "match-stats-missing"
            : overview.IsStale
                ? "match-stats-stale"
                : null;

        overview.TopTeams = BuildTopTeams(visibleMatches, search);
        if (!string.IsNullOrWhiteSpace(search))
            overview.ActiveAssets = overview.TopTeams.Count;
        overview.MatchActivity = BuildMatchActivity(visibleMatches, activityCutoffUtc);
        overview.LatestMatches = BuildLatestMatches(visibleMatches);

        _logger.LogInformation("[TV_MATCH_LOAD] API Stats.GetOverview search={Search} visibleMatches={VisibleMatches} latestMatches={LatestMatches} elapsedMs={ElapsedMs}", search, visibleMatches.Count, overview.LatestMatches.Count, sw.ElapsedMilliseconds);
        return Ok(overview);
    }

    [AllowAnonymous]
    [HttpGet("teams")]
    public async Task<ActionResult<List<StatsArenaTeamDto>>> GetTeams([FromQuery] string? search = null, CancellationToken ct = default)
    {
        var visibleMatches = await LoadVisibleMatchesAsync(ct);
        visibleMatches = ApplySearchFilter(visibleMatches, search);
        return Ok(BuildArenaTeams(visibleMatches, MaxDirectoryTeams, search));
    }

    [AllowAnonymous]
    [HttpGet("assets/{symbol}/price-snapshot")]
    public async Task<ActionResult<AssetPriceSnapshotDto>> GetAssetPriceSnapshot(string symbol, CancellationToken ct = default)
    {
        var normalizedSymbol = NormalizeTicker(symbol);
        if (string.IsNullOrWhiteSpace(normalizedSymbol))
            return NotFound(new { message = "invalid-symbol" });

        if (IsStableUsdSymbol(normalizedSymbol))
        {
            return Ok(new AssetPriceSnapshotDto
            {
                QuerySymbol = normalizedSymbol.ToUpperInvariant(),
                AssetSymbol = normalizedSymbol.ToUpperInvariant(),
                MarketSymbol = normalizedSymbol.ToUpperInvariant(),
                TeamId = 0,
                MatchId = 0,
                LastPriceUsdt = 1m,
                PercentageChange = 0m,
                CapturedAtUtc = DateTime.UtcNow,
                Source = "stablecoin_override"
            });
        }

        var snapshot = await ResolveAssetPriceSnapshotAsync(normalizedSymbol, ct);

        return snapshot is null
            ? NotFound(new { message = "no-positive-market-price", symbol = normalizedSymbol.ToUpperInvariant() })
            : Ok(snapshot);
    }

    [AllowAnonymous]
    [HttpGet("teams/{slug}")]
    public async Task<ActionResult<StatsArenaTeamDetailDto>> GetTeamDetail(string slug, CancellationToken ct)
    {
        var normalizedSlug = NormalizeTicker(slug);
        if (string.IsNullOrWhiteSpace(normalizedSlug))
            return NotFound();

        var visibleMatches = await LoadVisibleMatchesAsync(ct);
        var arenaTeams = BuildArenaTeams(visibleMatches);
        var team = arenaTeams.FirstOrDefault(item => NormalizeTicker(item.Symbol) == normalizedSlug || NormalizeTicker(item.DisplaySymbol) == normalizedSlug);
        if (team is null)
            return NotFound();

        var teamMatches = visibleMatches
            .Where(match => NormalizeTicker(match.TeamASymbol) == normalizedSlug || NormalizeTicker(match.TeamBSymbol) == normalizedSlug)
            .OrderByDescending(match => match.EndTime ?? match.StartTime ?? DateTime.MinValue)
            .ToList();

        var activityCutoffUtc = DateTime.UtcNow.Date.AddDays(-(ActivityWindowDays - 1));

        var detail = new StatsArenaTeamDetailDto
        {
            TeamId = team.TeamId,
            Symbol = team.Symbol,
            DisplaySymbol = team.DisplaySymbol,
            DisplayName = team.DisplayName,
            Rank = team.Rank,
            Matches = team.Matches,
            Wins = team.Wins,
            Losses = team.Losses,
            Draws = Math.Max(0, team.Matches - team.Wins - team.Losses),
            WinRate = team.WinRate,
            AverageScore = team.AverageScore,
            TotalScore = team.TotalScore,
            CurrentStreak = BuildCurrentStreak(teamMatches, normalizedSlug),
            Momentum = team.Momentum,
            IconUrl = team.IconUrl,
            LastMatchUtc = team.LastMatchUtc,
            MatchActivity = BuildMatchActivity(teamMatches, activityCutoffUtc),
            LatestMatches = BuildLatestMatches(teamMatches),
            Rivalries = BuildRivalries(teamMatches, normalizedSlug)
        };

        return Ok(detail);
    }

    [AllowAnonymous]
    [HttpGet("teams/{slug}/investment-context")]
    public async Task<ActionResult<StatsArenaInvestmentContextDto>> GetTeamInvestmentContext(string slug, CancellationToken ct)
    {
        var normalizedSlug = NormalizeTicker(slug);
        if (string.IsNullOrWhiteSpace(normalizedSlug))
            return NotFound();

        var candidateTeams = await _db.Set<Team>()
            .AsNoTracking()
            .Include(t => t.Currency)
            .Where(t => t.Currency != null)
            .Select(t => new
            {
                t.TeamId,
                t.Currency.Symbol,
                DisplayName = string.IsNullOrWhiteSpace(t.Currency.Name) ? t.Currency.Symbol : t.Currency.Name
            })
            .ToListAsync(ct);

        var team = candidateTeams.FirstOrDefault(t => NormalizeTicker(t.Symbol) == normalizedSlug);

        if (team is null)
            return NotFound();

        var relevantMatches = await _db.Set<Match>()
            .AsNoTracking()
            .Where(m =>
                (m.TeamAId == team.TeamId || m.TeamBId == team.TeamId) &&
                (m.Status == MatchStatus.Ongoing || m.Status == MatchStatus.Pending))
            .OrderByDescending(m => m.StartTime ?? DateTime.MinValue)
            .Select(m => new
            {
                m.MatchId,
                Status = m.Status.ToString(),
                m.StartTime,
                OpponentSymbol = m.TeamAId == team.TeamId ? m.TeamB.Currency.Symbol : m.TeamA.Currency.Symbol
            })
            .ToListAsync(ct);

        foreach (var match in relevantMatches.Where(m => string.Equals(m.Status, MatchStatus.Ongoing.ToString(), StringComparison.OrdinalIgnoreCase)))
        {
            var decision = InvestmentAccessPolicy.EvaluatePersistentExposure(
                match.Status,
                match.StartTime,
                null,
                nowUtc: DateTimeOffset.UtcNow);

            if (!decision.CanInvest)
            {
                return Ok(new StatsArenaInvestmentContextDto
                {
                    TeamId = team.TeamId,
                    Symbol = team.Symbol,
                    DisplaySymbol = CleanAssetSymbol(team.Symbol),
                    IsAvailable = false,
                    FailureReason = "team_match_advanced_live",
                    MatchId = match.MatchId,
                    MatchStatus = match.Status,
                    MatchStartTimeUtc = match.StartTime,
                    OpponentName = CleanAssetSymbol(match.OpponentSymbol)
                });
            }
        }

        var preferredMatch = relevantMatches
            .OrderByDescending(m => string.Equals(m.Status, MatchStatus.Ongoing.ToString(), StringComparison.OrdinalIgnoreCase))
            .ThenByDescending(m => string.Equals(m.Status, MatchStatus.Pending.ToString(), StringComparison.OrdinalIgnoreCase))
            .ThenByDescending(m => m.StartTime ?? DateTime.MinValue)
            .FirstOrDefault();

        return Ok(new StatsArenaInvestmentContextDto
        {
            TeamId = team.TeamId,
            Symbol = team.Symbol,
            DisplaySymbol = CleanAssetSymbol(team.Symbol),
            IsAvailable = true,
            FailureReason = string.Empty,
            MatchId = preferredMatch?.MatchId,
            MatchStatus = preferredMatch?.Status ?? string.Empty,
            MatchStartTimeUtc = preferredMatch?.StartTime,
            OpponentName = preferredMatch is null ? string.Empty : CleanAssetSymbol(preferredMatch.OpponentSymbol)
        });
    }

    private async Task<List<StatsMatchProjection>> LoadVisibleMatchesAsync(CancellationToken ct)
    {
        var matches = await _db.Set<Match>()
            .AsNoTracking()
            .Include(m => m.TeamA).ThenInclude(t => t.Currency)
            .Include(m => m.TeamB).ThenInclude(t => t.Currency)
            .OrderByDescending(m => m.EndTime ?? m.StartTime ?? DateTime.MinValue)
            .Select(m => new StatsMatchProjection
            {
                MatchId = m.MatchId,
                TeamAId = m.TeamAId,
                TeamBId = m.TeamBId,
                TeamASymbol = m.TeamA.Currency.Symbol,
                TeamBSymbol = m.TeamB.Currency.Symbol,
                TeamADisplayName = string.IsNullOrWhiteSpace(m.TeamA.Currency.Name) ? m.TeamA.Currency.Symbol : m.TeamA.Currency.Name,
                TeamBDisplayName = string.IsNullOrWhiteSpace(m.TeamB.Currency.Name) ? m.TeamB.Currency.Symbol : m.TeamB.Currency.Name,
                ScoreA = m.ScoreA,
                ScoreB = m.ScoreB,
                Status = m.Status,
                WinnerTeamId = m.WinnerTeamId,
                StartTime = m.StartTime,
                EndTime = m.EndTime,
                TeamALastUpdatedUtc = m.TeamA.Currency.LastUpdated,
                TeamBLastUpdatedUtc = m.TeamB.Currency.LastUpdated
            })
            .ToListAsync(ct);

        return matches
            .Where(m => !MatchPairRules.IsForbiddenPair(m.TeamASymbol, m.TeamBSymbol, _configuration))
            .ToList();
    }

    private List<StatsAssetPerformanceDto> BuildTopTeams(List<StatsMatchProjection> matches, string? search = null)
        => BuildArenaTeams(matches, MaxTopTeams, search)
            .Select(team => new StatsAssetPerformanceDto
            {
                Rank = team.Rank,
                Symbol = team.Symbol,
                DisplayName = team.DisplayName,
                Matches = team.Matches,
                Wins = team.Wins,
                Losses = team.Losses,
                WinRate = team.WinRate,
                AverageScore = team.AverageScore,
                TotalScore = team.TotalScore,
                LastMatchUtc = team.LastMatchUtc
            })
            .ToList();

    private List<StatsArenaTeamDto> BuildArenaTeams(
     List<StatsMatchProjection> matches,
     int? limit = null,
     string? search = null)
    {
        var completedMatches = matches
            .Where(m => m.Status == MatchStatus.Completed)
            .ToList();

        if (completedMatches.Count == 0)
            return [];

        var recentCutoffUtc = DateTime.UtcNow.Date.AddDays(-29);

        var teamRows = completedMatches
            .SelectMany(match => new[]
            {
            CreateTeamResult(match, isTeamA: true),
            CreateTeamResult(match, isTeamA: false)
            });

        var rankedTeams = teamRows
            .GroupBy(
                x => x.Symbol,
                StringComparer.OrdinalIgnoreCase)
            .Where(group =>
                string.IsNullOrWhiteSpace(search) ||
                AssetMatchesSearch(
                    group.First().Symbol,
                    group.First().DisplayName,
                    search.Trim()))
            .Select(group =>
            {
                var ordered = group
                    .OrderByDescending(
                        x => x.MatchUtc ?? DateTime.MinValue)
                    .ToList();

                var first = ordered.First();

                var wins = ordered.Count(x => x.IsWin);
                var losses = ordered.Count(x => x.IsLoss);
                var totalMatches = ordered.Count;
                var totalScore = ordered.Sum(x => x.Score);

                var winRate = totalMatches == 0
                    ? 0m
                    : Math.Round(
                        wins * 100m / totalMatches,
                        2);

                var averageScore = totalMatches == 0
                    ? 0m
                    : Math.Round(
                        (decimal)totalScore / totalMatches,
                        2);

                var recentMatches = ordered.Count(x =>
                    x.MatchUtc.HasValue &&
                    x.MatchUtc.Value.Date >= recentCutoffUtc);

                var displaySymbol =
                    CleanAssetSymbol(first.Symbol);

                /*
                 * Reduz o impacto de 100% de aproveitamento com poucas partidas.
                 *
                 * Com 15 partidas ou mais, o ativo recebe o peso completo
                 * da taxa de vitória.
                 *
                 * Exemplos:
                 *  3 partidas  -> peso 0,20
                 *  4 partidas  -> peso 0,27
                 * 10 partidas  -> peso 0,67
                 * 15 partidas  -> peso 1,00
                 */
                var sampleWeight = Math.Min(
                    1m,
                    totalMatches / 15m);

                var adjustedWinRate =
                    winRate * sampleWeight;

                /*
                 * Pontuação usada apenas para ordenar o ranking.
                 *
                 * - taxa ajustada: qualidade com confiança na amostra;
                 * - vitórias: recompensa desempenho sustentado;
                 * - pontuação total: recompensa produção na arena;
                 * - média de pontos: pequeno desempate por eficiência.
                 */
                var rankingScore =
                    adjustedWinRate +
                    wins * 4m +
                    totalScore * 0.15m +
                    averageScore * 0.50m;

                var team = new StatsArenaTeamDto
                {
                    TeamId = first.TeamId,
                    Symbol = first.Symbol,
                    DisplaySymbol = displaySymbol,
                    DisplayName = ordered
                        .FirstOrDefault(x =>
                            !string.IsNullOrWhiteSpace(x.DisplayName))
                        ?.DisplayName
                        ?? first.Symbol,

                    Matches = totalMatches,
                    Wins = wins,
                    Losses = losses,
                    WinRate = winRate,
                    AverageScore = averageScore,
                    TotalScore = totalScore,

                    Momentum = ResolveMomentum(
                        winRate,
                        totalMatches,
                        averageScore,
                        totalScore,
                        recentMatches),

                    IconUrl =
                        $"/api/icons/binance/{displaySymbol}",

                    LastMatchUtc =
                        ordered.FirstOrDefault()?.MatchUtc
                };

                return new
                {
                    Team = team,
                    RankingScore = rankingScore,
                    AdjustedWinRate = adjustedWinRate
                };
            })
            .OrderByDescending(x => x.RankingScore)
            .ThenByDescending(x => x.Team.Wins)
            .ThenByDescending(x => x.AdjustedWinRate)
            .ThenByDescending(x => x.Team.WinRate)
            .ThenByDescending(x => x.Team.TotalScore)
            .ThenByDescending(x => x.Team.Matches)
            .ThenBy(
                x => x.Team.Symbol,
                StringComparer.OrdinalIgnoreCase)
            .Take(
                limit.HasValue
                    ? Math.Max(1, limit.Value)
                    : int.MaxValue)
            .ToList();

        return rankedTeams
            .Select((item, index) =>
            {
                item.Team.Rank = index + 1;
                return item.Team;
            })
            .ToList();
    }

    private static List<StatsMatchActivityDto> BuildMatchActivity(List<StatsMatchProjection> matches, DateTime activityCutoffUtc)
    {
        return matches
            .Where(m => (m.EndTime ?? m.StartTime).HasValue && (m.EndTime ?? m.StartTime)!.Value.Date >= activityCutoffUtc)
            .GroupBy(m => (m.EndTime ?? m.StartTime)!.Value.Date)
            .OrderBy(g => g.Key)
            .Select(g => new StatsMatchActivityDto
            {
                Date = g.Key.ToString("yyyy-MM-dd"),
                Matches = g.Count()
            })
            .ToList();
    }

    private List<StatsLatestMatchDto> BuildLatestMatches(List<StatsMatchProjection> matches)
    {
        return matches
            .OrderByDescending(m => m.EndTime ?? m.StartTime ?? DateTime.MinValue)
            .Take(MaxLatestMatches)
            .Select(m => new StatsLatestMatchDto
            {
                MatchId = m.MatchId,
                HomeSymbol = m.TeamASymbol,
                AwaySymbol = m.TeamBSymbol,
                HomeScore = m.ScoreA,
                AwayScore = m.ScoreB,
                Status = m.Status.ToString(),
                StartedAtUtc = m.StartTime,
                FinishedAtUtc = m.EndTime,
                PublicUrl = BuildPublicMatchUrl(m)
            })
            .ToList();
    }

    private List<StatsArenaRivalDto> BuildRivalries(List<StatsMatchProjection> matches, string normalizedSlug)
    {
        var completedMatches = matches
            .Where(match => match.Status == MatchStatus.Completed)
            .ToList();

        if (completedMatches.Count == 0)
            return [];

        return completedMatches
            .Select(match =>
            {
                var isTeamA = NormalizeTicker(match.TeamASymbol) == normalizedSlug;
                var rivalSymbol = isTeamA ? match.TeamBSymbol : match.TeamASymbol;
                var rivalDisplayName = isTeamA ? match.TeamBDisplayName : match.TeamADisplayName;
                var winnerTeamId = ResolveWinnerTeamId(match);
                var teamId = isTeamA ? match.TeamAId : match.TeamBId;

                return new
                {
                    RivalSymbol = rivalSymbol,
                    RivalDisplayName = rivalDisplayName,
                    IsWin = winnerTeamId.HasValue && winnerTeamId.Value == teamId,
                    IsLoss = winnerTeamId.HasValue && winnerTeamId.Value != teamId
                };
            })
            .GroupBy(item => item.RivalSymbol, StringComparer.OrdinalIgnoreCase)
            .Select(group => new StatsArenaRivalDto
            {
                Symbol = group.Key,
                DisplaySymbol = CleanAssetSymbol(group.Key),
                DisplayName = group.First().RivalDisplayName,
                Matches = group.Count(),
                Wins = group.Count(item => item.IsWin),
                Losses = group.Count(item => item.IsLoss),
                IconUrl = $"/api/icons/binance/{CleanAssetSymbol(group.Key)}"
            })
            .OrderByDescending(item => item.Matches)
            .ThenByDescending(item => item.Wins)
            .ThenBy(item => item.Symbol, StringComparer.OrdinalIgnoreCase)
            .Take(MaxTeamRivals)
            .ToList();
    }

    private static TeamResultRow CreateTeamResult(StatsMatchProjection match, bool isTeamA)
    {
        var teamId = isTeamA ? match.TeamAId : match.TeamBId;
        var score = isTeamA ? match.ScoreA : match.ScoreB;
        var opponentScore = isTeamA ? match.ScoreB : match.ScoreA;
        var winnerTeamId = ResolveWinnerTeamId(match);

        return new TeamResultRow
        {
            TeamId = teamId,
            Symbol = isTeamA ? match.TeamASymbol : match.TeamBSymbol,
            DisplayName = isTeamA ? match.TeamADisplayName : match.TeamBDisplayName,
            Score = score,
            OpponentScore = opponentScore,
            MatchUtc = match.EndTime ?? match.StartTime,
            IsWin = winnerTeamId.HasValue && winnerTeamId.Value == teamId,
            IsLoss = winnerTeamId.HasValue && winnerTeamId.Value != teamId
        };
    }

    private string? BuildPublicMatchUrl(StatsMatchProjection match)
    {
        var slugA = NormalizeTicker(match.TeamASymbol);
        var slugB = NormalizeTicker(match.TeamBSymbol);
        if (string.IsNullOrWhiteSpace(slugA) || string.IsNullOrWhiteSpace(slugB))
            return null;

        return $"/match/{match.MatchId}/{slugA}-vs-{slugB}";
    }

    private static int? ResolveWinnerTeamId(StatsMatchProjection match)
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

    private static string NormalizeTicker(string? ticker)
    {
        if (string.IsNullOrWhiteSpace(ticker))
            return string.Empty;

        var normalized = new string(ticker.Trim().ToUpperInvariant().Where(char.IsLetterOrDigit).ToArray());
        foreach (var suffix in QuoteSuffixes)
        {
            if (normalized.Length > suffix.Length && normalized.EndsWith(suffix, StringComparison.Ordinal))
            {
                normalized = normalized[..^suffix.Length];
                break;
            }
        }

        return normalized.ToLowerInvariant();
    }

    private static string CleanAssetSymbol(string? symbol)
    {
        if (string.IsNullOrWhiteSpace(symbol))
            return "-";

        var normalized = new string(symbol.Trim().ToUpperInvariant().Where(char.IsLetterOrDigit).ToArray());
        foreach (var suffix in QuoteSuffixes)
        {
            if (normalized.Length > suffix.Length + 1 && normalized.EndsWith(suffix, StringComparison.Ordinal))
                return normalized[..^suffix.Length];
        }

        return normalized;
    }

    private static string[] BuildCandidateMarketSymbols(string normalizedSymbol)
    {
        var upper = normalizedSymbol.Trim().ToUpperInvariant();
        var symbols = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            upper
        };

        foreach (var suffix in QuoteSuffixes)
            symbols.Add($"{upper}{suffix}");

        return symbols.ToArray();
    }

    private async Task<AssetPriceSnapshotDto?> ResolveAssetPriceSnapshotAsync(string normalizedSymbol, CancellationToken ct)
    {
        var currentPrice = await ResolveFreshCoinPriceCurrentSnapshotAsync(normalizedSymbol, ct);
        if (currentPrice is not null)
            return currentPrice;

        return await ResolveMatchMetricSnapshotPriceAsync(normalizedSymbol, ct);
    }

    private async Task<AssetPriceSnapshotDto?> ResolveFreshCoinPriceCurrentSnapshotAsync(string normalizedSymbol, CancellationToken ct)
    {
        var normalizedUpper = normalizedSymbol.Trim().ToUpperInvariant();
        if (string.IsNullOrWhiteSpace(normalizedUpper))
            return null;

        var candidateSymbols = BuildCandidateMarketSymbols(normalizedSymbol)
            .Select(symbol => symbol.ToUpperInvariant())
            .Distinct(StringComparer.Ordinal)
            .ToArray();

        var preferredSymbol = $"{normalizedUpper}USDT";
        var freshCutoffUtc = DateTime.UtcNow.Subtract(FreshCurrencyWindow);

        const string sql = @"
SELECT
    tx_symbol,
    tx_base_asset,
    tx_quote_asset,
    nr_last_price,
    nr_price_change_pct_24h,
    dt_binance_snapshot_utc,
    dt_updated_at
FROM coin_price_current
WHERE
    nr_last_price IS NOT NULL
    AND nr_last_price > 0
    AND dt_updated_at >= @fresh_cutoff_utc
    AND (
        upper(tx_symbol) = ANY(@candidate_symbols)
        OR upper(tx_base_asset) = @base_asset
    )
ORDER BY
    CASE
        WHEN upper(tx_symbol) = @preferred_symbol THEN 0
        WHEN upper(tx_base_asset) = @base_asset AND upper(tx_quote_asset) = 'USDT' THEN 1
        ELSE 2
    END,
    dt_updated_at DESC
LIMIT 1;";

        try
        {
            await using var conn = new NpgsqlConnection(_db.Database.GetDbConnection().ConnectionString);
            await conn.OpenAsync(ct);

            await using var cmd = new NpgsqlCommand(sql, conn);
            cmd.Parameters.AddWithValue("candidate_symbols", candidateSymbols);
            cmd.Parameters.AddWithValue("base_asset", normalizedUpper);
            cmd.Parameters.AddWithValue("preferred_symbol", preferredSymbol);
            cmd.Parameters.AddWithValue("fresh_cutoff_utc", freshCutoffUtc);

            await using var reader = await cmd.ExecuteReaderAsync(CommandBehavior.SingleRow, ct);
            if (!await reader.ReadAsync(ct))
                return null;

            var marketSymbol = reader.GetString(0);
            var baseAsset = reader.GetString(1);
            var lastPrice = reader.GetDecimal(3);
            var percentageChange = reader.IsDBNull(4) ? (decimal?)null : reader.GetDecimal(4);
            var binanceSnapshotUtc = reader.GetDateTime(5);
            var updatedAtUtc = reader.GetDateTime(6);

            return new AssetPriceSnapshotDto
            {
                QuerySymbol = normalizedUpper,
                AssetSymbol = CleanAssetSymbol(baseAsset),
                MarketSymbol = marketSymbol,
                TeamId = 0,
                MatchId = 0,
                LastPriceUsdt = lastPrice,
                PercentageChange = percentageChange ?? 0m,
                CapturedAtUtc = binanceSnapshotUtc == default ? updatedAtUtc : binanceSnapshotUtc,
                Source = "coin_price_current"
            };
        }
        catch (PostgresException ex) when (ex.SqlState == PostgresErrorCodes.UndefinedTable)
        {
            _logger.LogWarning(
                ex,
                "coin_price_current ainda nao existe. Falling back to match_metric_snapshot for symbol={Symbol}",
                normalizedUpper);
            return null;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _logger.LogWarning(
                ex,
                "Falha ao ler coin_price_current. Falling back to match_metric_snapshot for symbol={Symbol}",
                normalizedUpper);
            return null;
        }
    }

    private async Task<AssetPriceSnapshotDto?> ResolveMatchMetricSnapshotPriceAsync(string normalizedSymbol, CancellationToken ct)
    {
        var candidateSymbols = BuildCandidateMarketSymbols(normalizedSymbol)
            .Select(symbol => symbol.ToUpperInvariant())
            .Distinct(StringComparer.Ordinal)
            .ToArray();

        return await _db.Set<MatchMetricSnapshot>()
            .AsNoTracking()
            .Include(x => x.Team).ThenInclude(t => t.Currency)
            .Where(x => x.LastPrice.HasValue && x.LastPrice.Value > 0m)
            .Where(x => x.Team.Currency != null && candidateSymbols.Contains(x.Team.Currency.Symbol.ToUpper()))
            .OrderByDescending(x => x.CapturedAtUtc)
            .ThenByDescending(x => x.MatchMetricSnapshotId)
            .Select(x => new AssetPriceSnapshotDto
            {
                QuerySymbol = normalizedSymbol.ToUpperInvariant(),
                AssetSymbol = CleanAssetSymbol(x.Team.Currency.Symbol),
                MarketSymbol = x.Team.Currency.Symbol,
                TeamId = x.TeamId,
                MatchId = x.MatchId,
                LastPriceUsdt = x.LastPrice,
                PercentageChange = x.PercentageChange,
                CapturedAtUtc = x.CapturedAtUtc,
                Source = "match_metric_snapshot_fallback"
            })
            .FirstOrDefaultAsync(ct);
    }

    private static bool IsStableUsdSymbol(string symbol)
        => StableUsdSymbols.Contains(symbol);

    private static List<StatsMatchProjection> ApplySearchFilter(List<StatsMatchProjection> matches, string? search)
    {
        var normalizedSearch = search?.Trim();
        if (string.IsNullOrWhiteSpace(normalizedSearch))
            return matches;

        return matches
            .Where(match =>
                AssetMatchesSearch(match.TeamASymbol, match.TeamADisplayName, normalizedSearch)
                || AssetMatchesSearch(match.TeamBSymbol, match.TeamBDisplayName, normalizedSearch))
            .ToList();
    }

    private static bool AssetMatchesSearch(string? symbol, string? name, string search)
        => ContainsSearch(symbol, search)
           || ContainsSearch(name, search)
           || ContainsSearch(CleanAssetSymbol(symbol), search);

    private static bool ContainsSearch(string? source, string search)
        => !string.IsNullOrWhiteSpace(source)
           && source.Contains(search, StringComparison.OrdinalIgnoreCase);

    private static string ResolveMomentum(decimal winRate, int matches, decimal averageScore, int totalScore, int recentMatches)
    {
        if (winRate >= 70m)
            return "Dominant";

        if (recentMatches >= 5 && winRate >= 55m)
            return "Hot";

        if (averageScore >= 4.5m || totalScore >= 200)
            return "Aggressive";

        if (matches >= 35)
            return "Veteran";

        if (winRate >= 55m)
            return "Rising";

        if (winRate < 40m)
            return "Struggling";

        return "Volatile";
    }

    private static string BuildCurrentStreak(List<StatsMatchProjection> matches, string normalizedSlug)
    {
        var ordered = matches
            .Where(match => match.Status == MatchStatus.Completed)
            .OrderByDescending(match => match.EndTime ?? match.StartTime ?? DateTime.MinValue)
            .ToList();

        if (ordered.Count == 0)
            return string.Empty;

        string? streakType = null;
        var streakCount = 0;

        foreach (var match in ordered)
        {
            var isTeamA = NormalizeTicker(match.TeamASymbol) == normalizedSlug;
            var teamId = isTeamA ? match.TeamAId : match.TeamBId;
            var winnerTeamId = ResolveWinnerTeamId(match);
            var currentType = winnerTeamId switch
            {
                null => "D",
                var winnerId when winnerId == teamId => "W",
                _ => "L"
            };

            if (streakType is null)
                streakType = currentType;

            if (!string.Equals(streakType, currentType, StringComparison.Ordinal))
                break;

            streakCount++;
        }

        return streakType is null || streakCount == 0 ? string.Empty : $"{streakType}{streakCount}";
    }

    private static readonly string[] QuoteSuffixes =
    [
        "USDT",
        "USDC",
        "BUSD",
        "FDUSD",
        "BRL",
        "EUR",
        "BTC",
        "ETH"
    ];

    private static readonly HashSet<string> StableUsdSymbols = new(StringComparer.OrdinalIgnoreCase)
    {
        "USDT",
        "USDC",
        "BUSD",
        "FDUSD"
    };

    private sealed class StatsMatchProjection
    {
        public int MatchId { get; init; }
        public int TeamAId { get; init; }
        public int TeamBId { get; init; }
        public string TeamASymbol { get; init; } = string.Empty;
        public string TeamBSymbol { get; init; } = string.Empty;
        public string TeamADisplayName { get; init; } = string.Empty;
        public string TeamBDisplayName { get; init; } = string.Empty;
        public int ScoreA { get; init; }
        public int ScoreB { get; init; }
        public MatchStatus Status { get; init; }
        public int? WinnerTeamId { get; init; }
        public DateTime? StartTime { get; init; }
        public DateTime? EndTime { get; init; }
        public DateTime TeamALastUpdatedUtc { get; init; }
        public DateTime TeamBLastUpdatedUtc { get; init; }
    }

    private sealed class TeamResultRow
    {
        public int TeamId { get; init; }
        public string Symbol { get; init; } = string.Empty;
        public string DisplayName { get; init; } = string.Empty;
        public int Score { get; init; }
        public int OpponentScore { get; init; }
        public DateTime? MatchUtc { get; init; }
        public bool IsWin { get; init; }
        public bool IsLoss { get; init; }
    }
}
