using DTOs;
using DAL.NftFutebol;
using EthicAI.EntityModel;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

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

    private readonly EthicAIDbContext _db;
    private readonly IConfiguration _configuration;

    public StatsController(EthicAIDbContext db, IConfiguration configuration)
    {
        _db = db;
        _configuration = configuration;
    }

    [AllowAnonymous]
    [HttpGet("overview")]
    public async Task<ActionResult<StatsOverviewDto>> GetOverview([FromQuery] string? search = null, CancellationToken ct = default)
    {
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

    private List<StatsArenaTeamDto> BuildArenaTeams(List<StatsMatchProjection> matches, int? limit = null, string? search = null)
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

        return teamRows
            .GroupBy(x => x.Symbol, StringComparer.OrdinalIgnoreCase)
            .Where(group => string.IsNullOrWhiteSpace(search)
                || AssetMatchesSearch(group.First().Symbol, group.First().DisplayName, search.Trim()))
            .Select(group =>
            {
                var ordered = group
                    .OrderByDescending(x => x.MatchUtc ?? DateTime.MinValue)
                    .ToList();

                var wins = ordered.Count(x => x.IsWin);
                var losses = ordered.Count(x => x.IsLoss);
                var totalMatches = ordered.Count;
                var totalScore = ordered.Sum(x => x.Score);
                var winRate = totalMatches == 0 ? 0m : Math.Round((decimal)wins * 100m / totalMatches, 2);
                var averageScore = totalMatches == 0 ? 0m : Math.Round((decimal)totalScore / totalMatches, 2);
                var recentMatches = ordered.Count(x => x.MatchUtc.HasValue && x.MatchUtc.Value.Date >= recentCutoffUtc);
                var displaySymbol = CleanAssetSymbol(group.First().Symbol);

                return new StatsArenaTeamDto
                {
                    TeamId = group.First().TeamId,
                    Symbol = group.First().Symbol,
                    DisplaySymbol = displaySymbol,
                    DisplayName = ordered.FirstOrDefault(x => !string.IsNullOrWhiteSpace(x.DisplayName))?.DisplayName ?? group.First().Symbol,
                    Matches = totalMatches,
                    Wins = wins,
                    Losses = losses,
                    WinRate = winRate,
                    AverageScore = averageScore,
                    TotalScore = totalScore,
                    Momentum = ResolveMomentum(winRate, totalMatches, averageScore, totalScore, recentMatches),
                    IconUrl = $"/api/icons/binance/{displaySymbol}",
                    LastMatchUtc = ordered.FirstOrDefault()?.MatchUtc
                };
            })
            .OrderByDescending(x => x.WinRate)
            .ThenByDescending(x => x.Wins)
            .ThenByDescending(x => x.TotalScore)
            .ThenBy(x => x.Symbol, StringComparer.OrdinalIgnoreCase)
            .Take(limit.HasValue ? Math.Max(1, limit.Value) : int.MaxValue)
            .Select((item, index) =>
            {
                item.Rank = index + 1;
                return item;
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
