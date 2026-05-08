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
    private const int MaxLatestMatches = 20;
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
    public async Task<ActionResult<StatsOverviewDto>> GetOverview(CancellationToken ct)
    {
        var activityCutoffUtc = DateTime.UtcNow.Date.AddDays(-(ActivityWindowDays - 1));

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

        var visibleMatches = matches
            .Where(m => !MatchPairRules.IsForbiddenPair(m.TeamASymbol, m.TeamBSymbol, _configuration))
            .ToList();

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

        overview.TopTeams = BuildTopTeams(visibleMatches);
        overview.MatchActivity = BuildMatchActivity(visibleMatches, activityCutoffUtc);
        overview.LatestMatches = BuildLatestMatches(visibleMatches);

        return Ok(overview);
    }

    private List<StatsAssetPerformanceDto> BuildTopTeams(List<StatsMatchProjection> matches)
    {
        var completedMatches = matches
            .Where(m => m.Status == MatchStatus.Completed)
            .ToList();

        if (completedMatches.Count == 0)
            return [];

        var teamRows = completedMatches
            .SelectMany(match => new[]
            {
                CreateTeamResult(match, isTeamA: true),
                CreateTeamResult(match, isTeamA: false)
            });

        return teamRows
            .GroupBy(x => x.Symbol, StringComparer.OrdinalIgnoreCase)
            .Select(group =>
            {
                var ordered = group
                    .OrderByDescending(x => x.MatchUtc ?? DateTime.MinValue)
                    .ToList();

                var wins = ordered.Count(x => x.IsWin);
                var losses = ordered.Count(x => x.IsLoss);
                var totalMatches = ordered.Count;
                var totalScore = ordered.Sum(x => x.Score);

                return new StatsAssetPerformanceDto
                {
                    Symbol = group.First().Symbol,
                    DisplayName = ordered.FirstOrDefault(x => !string.IsNullOrWhiteSpace(x.DisplayName))?.DisplayName ?? group.First().Symbol,
                    Matches = totalMatches,
                    Wins = wins,
                    Losses = losses,
                    WinRate = totalMatches == 0 ? 0m : Math.Round((decimal)wins * 100m / totalMatches, 2),
                    AverageScore = totalMatches == 0 ? 0m : Math.Round((decimal)totalScore / totalMatches, 2),
                    TotalScore = totalScore,
                    LastMatchUtc = ordered.FirstOrDefault()?.MatchUtc
                };
            })
            .OrderByDescending(x => x.WinRate)
            .ThenByDescending(x => x.Wins)
            .ThenByDescending(x => x.TotalScore)
            .ThenBy(x => x.Symbol, StringComparer.OrdinalIgnoreCase)
            .Take(MaxTopTeams)
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
