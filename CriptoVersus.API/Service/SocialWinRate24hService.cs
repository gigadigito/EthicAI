using System.Globalization;
using DAL.NftFutebol;
using DTOs;
using EthicAI.EntityModel;
using Microsoft.EntityFrameworkCore;

namespace CriptoVersus.API.Services;

public interface ISocialWinRate24hService
{
    Task<SocialWinRate24hDto> GetAsync(CancellationToken ct = default);
}

public sealed class SocialWinRate24hService : ISocialWinRate24hService
{
    private const int WindowHours = 24;
    private const int MinimumDecisions = 3;
    private const int MaxAssets = 10;
    private const string SkipReasonText = "Not enough assets with valid decisions in the last 24 hours.";
    private static readonly CultureInfo SuggestedTextCulture = CultureInfo.GetCultureInfo("pt-BR");
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

    private readonly EthicAIDbContext _db;
    private readonly IConfiguration _configuration;
    private readonly ILogger<SocialWinRate24hService> _logger;

    public SocialWinRate24hService(
        EthicAIDbContext db,
        IConfiguration configuration,
        ILogger<SocialWinRate24hService> logger)
    {
        _db = db;
        _configuration = configuration;
        _logger = logger;
    }

    public async Task<SocialWinRate24hDto> GetAsync(CancellationToken ct = default)
    {
        var generatedAtUtc = DateTime.UtcNow;
        var fromUtc = generatedAtUtc.AddHours(-WindowHours);

        var matchRows = await _db.Set<Match>()
            .AsNoTracking()
            .Where(m =>
                m.Status == MatchStatus.Completed &&
                m.EndTime.HasValue &&
                m.EndTime.Value >= fromUtc &&
                m.EndTime.Value <= generatedAtUtc)
            .Select(m => new SocialWinRateMatchRow
            {
                MatchId = m.MatchId,
                TeamAId = m.TeamAId,
                TeamBId = m.TeamBId,
                TeamASymbol = m.TeamA.Currency.Symbol,
                TeamBSymbol = m.TeamB.Currency.Symbol,
                ScoreA = m.ScoreA,
                ScoreB = m.ScoreB,
                WinnerTeamId = m.WinnerTeamId,
                EndTimeUtc = m.EndTime
            })
            .ToListAsync(ct);

        var closedMatches = matchRows.Count;
        var assetMap = new Dictionary<string, SocialWinRateAssetAccumulator>(StringComparer.OrdinalIgnoreCase);

        foreach (var match in matchRows)
        {
            var effectiveWinnerTeamId = ResolveWinnerTeamId(match);

            AddSide(assetMap, match.TeamASymbol, match.TeamAId, match.TeamBId, effectiveWinnerTeamId, match);
            AddSide(assetMap, match.TeamBSymbol, match.TeamBId, match.TeamAId, effectiveWinnerTeamId, match);
        }

        var rankedAssets = assetMap.Values
            .Where(item => item.Decisions >= MinimumDecisions)
            .OrderByDescending(item => item.WinRate)
            .ThenByDescending(item => item.Wins)
            .ThenByDescending(item => item.Decisions)
            .ThenBy(item => item.Symbol, StringComparer.OrdinalIgnoreCase)
            .Take(MaxAssets)
            .Select((item, index) => new SocialWinRate24hAssetDto
            {
                Rank = index + 1,
                Symbol = item.Symbol,
                DisplaySymbol = item.Symbol,
                Wins = item.Wins,
                Losses = item.Losses,
                Draws = item.Draws,
                Decisions = item.Decisions,
                TotalMatches = item.TotalMatches,
                WinRate = item.WinRate
            })
            .ToList();

        var totalAssets = assetMap.Values.Count(item => item.Decisions >= MinimumDecisions);
        var canPost = rankedAssets.Count > 0;

        var response = new SocialWinRate24hDto
        {
            GeneratedAtUtc = generatedAtUtc,
            FromUtc = fromUtc,
            ToUtc = generatedAtUtc,
            WindowHours = WindowHours,
            MinimumDecisions = MinimumDecisions,
            TotalAssets = totalAssets,
            TotalClosedMatches = closedMatches,
            CanPost = canPost,
            SkipReason = canPost ? null : SkipReasonText,
            SuggestedText = canPost ? BuildSuggestedText(rankedAssets) : null,
            PublicUrl = BuildPublicUrl(),
            Assets = rankedAssets
        };

        if (!canPost)
        {
            _logger.LogInformation(
                "[SOCIAL_WIN_RATE_24H] No eligible assets. ClosedMatches={ClosedMatches} EligibleAssets={EligibleAssets} FromUtc={FromUtc:o} ToUtc={ToUtc:o}",
                closedMatches,
                totalAssets,
                fromUtc,
                generatedAtUtc);
        }
        else
        {
            _logger.LogInformation(
                "[SOCIAL_WIN_RATE_24H] Generated ranking. ClosedMatches={ClosedMatches} EligibleAssets={EligibleAssets} ReturnedAssets={ReturnedAssets} FromUtc={FromUtc:o} ToUtc={ToUtc:o}",
                closedMatches,
                totalAssets,
                rankedAssets.Count,
                fromUtc,
                generatedAtUtc);
        }

        return response;
    }

    private void AddSide(
        Dictionary<string, SocialWinRateAssetAccumulator> assetMap,
        string? rawSymbol,
        int teamId,
        int opponentTeamId,
        int? winnerTeamId,
        SocialWinRateMatchRow match)
    {
        var symbol = CleanAssetSymbol(rawSymbol);
        if (string.IsNullOrWhiteSpace(symbol) || symbol == "-")
            return;

        if (!assetMap.TryGetValue(symbol, out var accumulator))
        {
            accumulator = new SocialWinRateAssetAccumulator(symbol);
            assetMap[symbol] = accumulator;
        }

        accumulator.TotalMatches++;

        if (!winnerTeamId.HasValue)
        {
            accumulator.Draws++;
            return;
        }

        if (winnerTeamId.Value == teamId)
        {
            accumulator.Wins++;
            return;
        }

        if (winnerTeamId.Value == opponentTeamId)
        {
            accumulator.Losses++;
            return;
        }

        accumulator.Draws++;
    }

    private static int? ResolveWinnerTeamId(SocialWinRateMatchRow match)
    {
        if (match.WinnerTeamId.HasValue)
            return match.WinnerTeamId;

        if (match.ScoreA > match.ScoreB)
            return match.TeamAId;

        if (match.ScoreB > match.ScoreA)
            return match.TeamBId;

        return null;
    }

    private string BuildPublicUrl()
    {
        var baseUrl = _configuration["CriptoVersus:PublicBaseUrl"]?.Trim()
            ?? _configuration["Api:PublicBaseUrl"]?.Trim()
            ?? "https://www.criptoversus.com";

        return $"{baseUrl.TrimEnd('/')}/en/social/win-rate-24h";
    }

    private static string BuildSuggestedText(IReadOnlyList<SocialWinRate24hAssetDto> assets)
    {
        var topAssets = assets.Take(3).ToList();
        var lines = new List<string>
        {
            "🏆 Quem dominou as últimas 24h no CriptoVersus?",
            string.Empty
        };

        foreach (var item in topAssets)
        {
            var medal = item.Rank switch
            {
                1 => "🥇",
                2 => "🥈",
                3 => "🥉",
                _ => $"{item.Rank}."
            };

            var cashtag = item.Rank <= 2 ? "$" : string.Empty;
            lines.Add($"{medal} {cashtag}{item.DisplaySymbol} — {item.WinRate.ToString("0.0", SuggestedTextCulture)}%");
        }

        lines.Add(string.Empty);
        lines.Add("O ranking considera partidas encerradas nas últimas 24 horas.");
        lines.Add("Veja o Top 10 completo no gráfico.");
        lines.Add(string.Empty);
        lines.Add("#CriptoVersus #Crypto");

        return string.Join(Environment.NewLine, lines);
    }

    private static string CleanAssetSymbol(string? symbol)
    {
        if (string.IsNullOrWhiteSpace(symbol))
            return string.Empty;

        var normalized = new string(symbol.Trim().ToUpperInvariant().Where(char.IsLetterOrDigit).ToArray());
        if (string.IsNullOrWhiteSpace(normalized))
            return string.Empty;

        foreach (var suffix in QuoteSuffixes)
        {
            if (normalized.Length > suffix.Length + 1 && normalized.EndsWith(suffix, StringComparison.Ordinal))
                return normalized[..^suffix.Length];
        }

        return normalized;
    }
    private sealed class SocialWinRateMatchRow
    {
        public int MatchId { get; init; }
        public int TeamAId { get; init; }
        public int TeamBId { get; init; }
        public string TeamASymbol { get; init; } = string.Empty;
        public string TeamBSymbol { get; init; } = string.Empty;
        public int ScoreA { get; init; }
        public int ScoreB { get; init; }
        public int? WinnerTeamId { get; init; }
        public DateTime? EndTimeUtc { get; init; }
    }

    private sealed class SocialWinRateAssetAccumulator
    {
        public SocialWinRateAssetAccumulator(string symbol)
        {
            Symbol = symbol;
        }

        public string Symbol { get; }
        public int Wins { get; set; }
        public int Losses { get; set; }
        public int Draws { get; set; }
        public int TotalMatches { get; set; }
        public int Decisions => Wins + Losses;
        public decimal WinRate => Decisions <= 0 ? 0m : Math.Round(Wins * 100m / Decisions, 1, MidpointRounding.AwayFromZero);
    }
}








