using System.Globalization;
using DTOs;

namespace CriptoVersus.Web.Services;

public static class PublicStatsHubCalculator
{
    public static PublicStatsDataset Build(IEnumerable<MatchDto>? matches)
    {
        var materializedMatches = (matches ?? [])
            .Select(ToPublicMatch)
            .OrderByDescending(match => match.SortUtc ?? DateTime.MinValue)
            .ThenByDescending(match => match.MatchId)
            .ToList();

        var completedMatches = materializedMatches
            .Where(match => match.IsCompleted)
            .OrderBy(match => match.SortUtc ?? DateTime.MinValue)
            .ThenBy(match => match.MatchId)
            .ToList();

        var teamRows = completedMatches
            .SelectMany(match => new[]
            {
                new TeamResultRow(match, isHome: true),
                new TeamResultRow(match, isHome: false)
            })
            .GroupBy(row => row.CleanSymbol, StringComparer.OrdinalIgnoreCase)
            .Select(BuildTeamSummary)
            .OrderByDescending(team => team.Wins)
            .ThenByDescending(team => team.Efficiency)
            .ThenByDescending(team => team.GoalsFor)
            .ThenBy(team => team.Symbol, StringComparer.OrdinalIgnoreCase)
            .Select((team, index) =>
            {
                team.Rank = index + 1;
                return team;
            })
            .ToList();

        return new PublicStatsDataset(materializedMatches, completedMatches, teamRows);
    }

    public static string CleanAssetSymbol(string? symbol)
    {
        if (string.IsNullOrWhiteSpace(symbol))
            return "-";

        var normalized = new string(symbol.Trim().ToUpperInvariant().Where(char.IsLetterOrDigit).ToArray());
        foreach (var suffix in AssetSuffixes)
        {
            if (normalized.Length > suffix.Length + 1 && normalized.EndsWith(suffix, StringComparison.Ordinal))
                return normalized[..^suffix.Length];
        }

        return normalized;
    }

    public static bool MatchesSearch(PublicStatsMatch match, string? search)
    {
        var normalized = search?.Trim();
        if (string.IsNullOrWhiteSpace(normalized))
            return true;

        return Contains(match.HomeSymbol, normalized)
            || Contains(match.AwaySymbol, normalized)
            || Contains(match.HomeCleanSymbol, normalized)
            || Contains(match.AwayCleanSymbol, normalized);
    }

    public static bool MatchesSearch(PublicStatsTeamSummary team, string? search)
    {
        var normalized = search?.Trim();
        if (string.IsNullOrWhiteSpace(normalized))
            return true;

        return Contains(team.Symbol, normalized)
            || Contains(team.CleanSymbol, normalized)
            || Contains(team.DisplayName, normalized);
    }

    public static string BuildAssetSlug(string? symbol)
    {
        if (string.IsNullOrWhiteSpace(symbol))
            return string.Empty;

        var buffer = new List<char>(symbol.Length);
        foreach (var ch in symbol.Trim().ToLowerInvariant())
        {
            if (char.IsLetterOrDigit(ch))
                buffer.Add(ch);
            else if (buffer.Count > 0 && buffer[^1] != '-')
                buffer.Add('-');
        }

        return new string(buffer.ToArray()).Trim('-');
    }

    public static string FormatPercent(decimal value)
        => $"{value:0.##}%";

    public static string DisplayNumber(int value)
        => value.ToString("N0", CultureInfo.InvariantCulture);

    public static string DisplayDateTime(DateTime? value)
        => value.HasValue
            ? EnsureUtc(value.Value).ToString("yyyy-MM-dd HH:mm", CultureInfo.InvariantCulture)
            : "-";

    public static string DisplayDate(DateTime? value)
        => value.HasValue
            ? EnsureUtc(value.Value).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)
            : "-";

    public static DateTime EnsureUtc(DateTime value)
        => value.Kind switch
        {
            DateTimeKind.Utc => value,
            DateTimeKind.Local => value.ToUniversalTime(),
            _ => DateTime.SpecifyKind(value, DateTimeKind.Utc)
        };

    private static PublicStatsMatch ToPublicMatch(MatchDto match)
    {
        var status = NormalizeStatus(match.Status);
        var homeSymbol = string.IsNullOrWhiteSpace(match.TeamA) ? "?" : match.TeamA.Trim();
        var awaySymbol = string.IsNullOrWhiteSpace(match.TeamB) ? "?" : match.TeamB.Trim();

        return new PublicStatsMatch(
            match.MatchId,
            homeSymbol,
            awaySymbol,
            CleanAssetSymbol(homeSymbol),
            CleanAssetSymbol(awaySymbol),
            status,
            match.ScoreA,
            match.ScoreB,
            match.TeamAId,
            match.TeamBId,
            match.WinnerTeamId,
            match.StartTime,
            match.EndTime,
            match.EndTime ?? match.StartTime);
    }

    private static PublicStatsTeamSummary BuildTeamSummary(IGrouping<string, TeamResultRow> group)
    {
        var ordered = group
            .OrderBy(row => row.MatchUtc ?? DateTime.MinValue)
            .ThenBy(row => row.MatchId)
            .ToList();

        var wins = ordered.Count(row => row.Result == MatchResultKind.Win);
        var losses = ordered.Count(row => row.Result == MatchResultKind.Loss);
        var draws = ordered.Count(row => row.Result == MatchResultKind.Draw);
        var matches = ordered.Count;
        var goalsFor = ordered.Sum(row => row.GoalsFor);
        var goalsAgainst = ordered.Sum(row => row.GoalsAgainst);
        var efficiency = matches == 0
            ? 0m
            : Math.Round(((wins * 3m) + draws) * 100m / (matches * 3m), 2);

        return new PublicStatsTeamSummary
        {
            Symbol = ordered[0].Symbol,
            CleanSymbol = ordered[0].CleanSymbol,
            DisplayName = ordered[0].CleanSymbol,
            Matches = matches,
            Wins = wins,
            Losses = losses,
            Draws = draws,
            GoalsFor = goalsFor,
            GoalsAgainst = goalsAgainst,
            GoalDifference = goalsFor - goalsAgainst,
            WinRate = matches == 0 ? 0m : Math.Round(wins * 100m / matches, 2),
            Efficiency = efficiency,
            LastMatchUtc = ordered[^1].MatchUtc,
            CurrentWinStreak = CountStreak(ordered, result => result == MatchResultKind.Win),
            CurrentUnbeatenStreak = CountStreak(ordered, result => result != MatchResultKind.Loss),
            BestWinStreak = CountBestWinStreak(ordered)
        };
    }

    private static int CountStreak(List<TeamResultRow> ordered, Func<MatchResultKind, bool> predicate)
    {
        var streak = 0;
        for (var index = ordered.Count - 1; index >= 0; index--)
        {
            if (!predicate(ordered[index].Result))
                break;

            streak++;
        }

        return streak;
    }

    private static int CountBestWinStreak(List<TeamResultRow> ordered)
    {
        var best = 0;
        var current = 0;

        foreach (var row in ordered)
        {
            if (row.Result == MatchResultKind.Win)
            {
                current++;
                best = Math.Max(best, current);
            }
            else
            {
                current = 0;
            }
        }

        return best;
    }

    private static string NormalizeStatus(string? status)
        => status?.Trim().ToLowerInvariant() switch
        {
            "completed" => "completed",
            "ongoing" => "ongoing",
            "pending" => "pending",
            "cancelled" => "cancelled",
            _ => "unknown"
        };

    private static bool Contains(string? source, string value)
        => !string.IsNullOrWhiteSpace(source)
           && source.Contains(value, StringComparison.OrdinalIgnoreCase);

    private static readonly string[] AssetSuffixes = ["USDT", "USDC", "BUSD", "FDUSD", "BTC", "ETH"];

    public sealed record PublicStatsDataset(
        IReadOnlyList<PublicStatsMatch> Matches,
        IReadOnlyList<PublicStatsMatch> CompletedMatches,
        IReadOnlyList<PublicStatsTeamSummary> Teams);

    public sealed record PublicStatsMatch(
        int MatchId,
        string HomeSymbol,
        string AwaySymbol,
        string HomeCleanSymbol,
        string AwayCleanSymbol,
        string Status,
        int HomeScore,
        int AwayScore,
        int HomeTeamId,
        int AwayTeamId,
        int? WinnerTeamId,
        DateTime? StartedAtUtc,
        DateTime? FinishedAtUtc,
        DateTime? SortUtc)
    {
        public bool IsCompleted => Status == "completed";
        public int TotalGoals => HomeScore + AwayScore;
        public int GoalDifference => Math.Abs(HomeScore - AwayScore);
    }

    public sealed class PublicStatsTeamSummary
    {
        public int Rank { get; set; }
        public string Symbol { get; set; } = string.Empty;
        public string CleanSymbol { get; set; } = string.Empty;
        public string DisplayName { get; set; } = string.Empty;
        public int Matches { get; set; }
        public int Wins { get; set; }
        public int Losses { get; set; }
        public int Draws { get; set; }
        public int GoalsFor { get; set; }
        public int GoalsAgainst { get; set; }
        public int GoalDifference { get; set; }
        public decimal WinRate { get; set; }
        public decimal Efficiency { get; set; }
        public DateTime? LastMatchUtc { get; set; }
        public int CurrentWinStreak { get; set; }
        public int CurrentUnbeatenStreak { get; set; }
        public int BestWinStreak { get; set; }
    }

    private sealed class TeamResultRow
    {
        public TeamResultRow(PublicStatsMatch match, bool isHome)
        {
            MatchId = match.MatchId;
            Symbol = isHome ? match.HomeSymbol : match.AwaySymbol;
            CleanSymbol = isHome ? match.HomeCleanSymbol : match.AwayCleanSymbol;
            GoalsFor = isHome ? match.HomeScore : match.AwayScore;
            GoalsAgainst = isHome ? match.AwayScore : match.HomeScore;
            MatchUtc = match.SortUtc;

            var teamId = isHome ? match.HomeTeamId : match.AwayTeamId;
            Result = ResolveResult(match, teamId);
        }

        public int MatchId { get; }
        public string Symbol { get; }
        public string CleanSymbol { get; }
        public int GoalsFor { get; }
        public int GoalsAgainst { get; }
        public DateTime? MatchUtc { get; }
        public MatchResultKind Result { get; }

        private static MatchResultKind ResolveResult(PublicStatsMatch match, int teamId)
        {
            if (match.WinnerTeamId is null)
                return match.HomeScore == match.AwayScore ? MatchResultKind.Draw : MatchResultKind.None;

            return match.WinnerTeamId == teamId
                ? MatchResultKind.Win
                : MatchResultKind.Loss;
        }
    }

    private enum MatchResultKind
    {
        None = 0,
        Win = 1,
        Loss = 2,
        Draw = 3
    }
}
