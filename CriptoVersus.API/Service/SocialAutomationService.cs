using DAL.NftFutebol;
using DTOs;
using EthicAI.EntityModel;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace CriptoVersus.API.Services;

public interface ISocialAutomationService
{
    Task<IReadOnlyList<SocialHotMatchDto>> GetHotMatchesAsync(CancellationToken ct);
    Task<IReadOnlyList<SocialGoalLogDto>?> GetGoalLogsAsync(int matchId, CancellationToken ct);
    Task<SocialShareCardDto?> GetShareCardAsync(int matchId, CancellationToken ct);
    Task<SocialMatchImageDto?> GetMatchImageAsync(int matchId, CancellationToken ct);
    Task<SocialPostHistoryRegistrationResult> RegisterPostAsync(RegisterSocialPostRequest request, CancellationToken ct);
}

public sealed class SocialAutomationService : ISocialAutomationService
{
    private const int MatchDurationMinutes = 90;

    private readonly EthicAIDbContext _db;
    private readonly SocialAutomationOptions _options;

    public SocialAutomationService(
        EthicAIDbContext db,
        IOptions<SocialAutomationOptions> options)
    {
        _db = db;
        _options = options.Value;
    }

    public async Task<IReadOnlyList<SocialHotMatchDto>> GetHotMatchesAsync(CancellationToken ct)
    {
        var matches = await LoadOngoingMatchesAsync(ct);
        if (matches.Count == 0)
            return [];

        var matchIds = matches.Select(x => x.MatchId).ToArray();
        var betSummaries = await LoadBetSummariesAsync(matchIds, ct);
        var goalLogsByMatch = await LoadGoalLogsByMatchAsync(matchIds, ct);

        return matches
            .Select(match =>
            {
                var socialMatch = BuildSocialMatch(match, betSummaries, goalLogsByMatch);
                return new SocialHotMatchDto
                {
                    MatchId = socialMatch.MatchId,
                    HomeSymbol = socialMatch.HomeSymbol,
                    AwaySymbol = socialMatch.AwaySymbol,
                    HomeGoals = socialMatch.HomeGoals,
                    AwayGoals = socialMatch.AwayGoals,
                    Status = socialMatch.Status,
                    Minute = socialMatch.Minute,
                    TotalGoals = socialMatch.TotalGoals,
                    TotalBets = socialMatch.TotalBets,
                    HomeBetAmount = socialMatch.HomeBetAmount,
                    AwayBetAmount = socialMatch.AwayBetAmount,
                    HotScore = socialMatch.HotScore,
                    PublicUrl = socialMatch.PublicUrl,
                    Reason = socialMatch.Reason
                };
            })
            .OrderByDescending(x => x.HotScore)
            .ThenByDescending(x => x.TotalGoals)
            .ThenByDescending(x => x.TotalBets)
            .ToList();
    }

    public async Task<IReadOnlyList<SocialGoalLogDto>?> GetGoalLogsAsync(int matchId, CancellationToken ct)
    {
        var match = await LoadMatchAsync(matchId, ct);
        if (match is null)
            return null;

        return await BuildGoalLogsAsync(match, ct);
    }

    public async Task<SocialShareCardDto?> GetShareCardAsync(int matchId, CancellationToken ct)
    {
        var match = await LoadMatchAsync(matchId, ct);
        if (match is null)
            return null;

        var betSummaries = await LoadBetSummariesAsync([matchId], ct);
        var goalLogs = await BuildGoalLogsAsync(match, ct);
        var goalLogsByMatch = new Dictionary<int, IReadOnlyList<SocialGoalLogDto>>
        {
            [matchId] = goalLogs
        };

        var socialMatch = BuildSocialMatch(match, betSummaries, goalLogsByMatch);
        var postingDecision = await EvaluatePostingDecisionAsync(socialMatch, ct);

        return new SocialShareCardDto
        {
            MatchId = socialMatch.MatchId,
            HomeSymbol = socialMatch.HomeSymbol,
            AwaySymbol = socialMatch.AwaySymbol,
            Score = $"{socialMatch.HomeGoals} x {socialMatch.AwayGoals}",
            Status = socialMatch.Status,
            Minute = socialMatch.Minute,
            HotScore = socialMatch.HotScore,
            Reason = socialMatch.Reason,
            PublicUrl = socialMatch.PublicUrl,
            SuggestedText = BuildSuggestedText(socialMatch),
            Hashtags = BuildHashtags(socialMatch),
            CanPost = postingDecision.CanPost,
            SkipReason = postingDecision.SkipReason,
            GoalLogs = goalLogs.ToList()
        };
    }

    public async Task<SocialMatchImageDto?> GetMatchImageAsync(int matchId, CancellationToken ct)
    {
        var match = await LoadMatchAsync(matchId, ct);
        if (match is null)
            return null;

        return new SocialMatchImageDto
        {
            ImageUrl = null,
            PublicUrl = BuildPublicUrl(match.MatchId, match.TeamA.Currency.Symbol, match.TeamB.Currency.Symbol),
            Mode = "external-screenshot",
            Note = "A API nao gera PNG no backend atualmente. Use o publicUrl no n8n com Browserless ou Playwright para screenshot."
        };
    }

    public async Task<SocialPostHistoryRegistrationResult> RegisterPostAsync(RegisterSocialPostRequest request, CancellationToken ct)
    {
        var match = await LoadMatchAsync(request.MatchId, ct);
        if (match is null)
            return SocialPostHistoryRegistrationResult.NotFound($"Partida {request.MatchId} nao encontrada.");

        var platform = NormalizePlatform(request.Platform);
        if (string.IsNullOrWhiteSpace(platform))
            return SocialPostHistoryRegistrationResult.Invalid("Platform e obrigatoria.");

        if (!_options.Enabled)
            return SocialPostHistoryRegistrationResult.Blocked("Social automation desabilitada.");

        if (request.HotScore < _options.MinimumHotScore)
            return SocialPostHistoryRegistrationResult.Blocked($"HotScore abaixo do minimo configurado ({_options.MinimumHotScore}).");

        var cooldownSince = DateTime.UtcNow.AddMinutes(-Math.Max(0, _options.CooldownMinutesPerMatch));
        var lastPost = await _db.SocialPostHistory
            .AsNoTracking()
            .Where(x => x.MatchId == request.MatchId && x.Platform == platform)
            .OrderByDescending(x => x.CreatedAt)
            .FirstOrDefaultAsync(ct);

        if (lastPost is not null && lastPost.CreatedAt >= cooldownSince)
        {
            var cooldownUntil = lastPost.CreatedAt.AddMinutes(_options.CooldownMinutesPerMatch);
            return SocialPostHistoryRegistrationResult.Blocked($"Cooldown ativo para a partida ate {cooldownUntil:O}.");
        }

        if (!string.IsNullOrWhiteSpace(request.ExternalPostId))
        {
            var duplicateExternalId = await _db.SocialPostHistory
                .AsNoTracking()
                .AnyAsync(
                    x => x.Platform == platform
                      && x.ExternalPostId == request.ExternalPostId.Trim(),
                    ct);

            if (duplicateExternalId)
                return SocialPostHistoryRegistrationResult.Blocked("externalPostId ja registrado para essa plataforma.");
        }

        var entity = new SocialPostHistory
        {
            MatchId = request.MatchId,
            Platform = platform,
            PostText = request.PostText.Trim(),
            PostUrl = request.PostUrl?.Trim(),
            ExternalPostId = request.ExternalPostId?.Trim(),
            HotScore = request.HotScore,
            Reason = string.IsNullOrWhiteSpace(request.Reason) ? null : request.Reason.Trim(),
            CreatedAt = DateTime.UtcNow
        };

        _db.SocialPostHistory.Add(entity);
        await _db.SaveChangesAsync(ct);

        return SocialPostHistoryRegistrationResult.Created(entity.Id, entity.CreatedAt);
    }

    private async Task<List<Match>> LoadOngoingMatchesAsync(CancellationToken ct)
    {
        return await _db.Match
            .AsNoTracking()
            .Include(x => x.TeamA).ThenInclude(x => x.Currency)
            .Include(x => x.TeamB).ThenInclude(x => x.Currency)
            .Where(x => x.Status == MatchStatus.Ongoing)
            .ToListAsync(ct);
    }

    private async Task<Match?> LoadMatchAsync(int matchId, CancellationToken ct)
    {
        return await _db.Match
            .AsNoTracking()
            .Include(x => x.TeamA).ThenInclude(x => x.Currency)
            .Include(x => x.TeamB).ThenInclude(x => x.Currency)
            .FirstOrDefaultAsync(x => x.MatchId == matchId, ct);
    }

    private async Task<List<SocialBetSummary>> LoadBetSummariesAsync(IReadOnlyCollection<int> matchIds, CancellationToken ct)
    {
        return await _db.Bet
            .AsNoTracking()
            .Where(x => matchIds.Contains(x.MatchId))
            .GroupBy(x => new { x.MatchId, x.TeamId })
            .Select(g => new SocialBetSummary
            {
                MatchId = g.Key.MatchId,
                TeamId = g.Key.TeamId,
                TotalAmount = g.Sum(x => x.Amount),
                TotalBets = g.Count()
            })
            .ToListAsync(ct);
    }

    private async Task<IReadOnlyList<SocialGoalLogDto>> BuildGoalLogsAsync(Match match, CancellationToken ct)
    {
        var events = await _db.MatchScoreEvent
            .AsNoTracking()
            .Include(x => x.Team).ThenInclude(x => x.Currency)
            .Where(x => x.MatchId == match.MatchId && x.Points > 0)
            .OrderBy(x => x.EventSequence)
            .ThenBy(x => x.EventTimeUtc)
            .ToListAsync(ct);

        return ToGoalLogs(match, events);
    }

    private async Task<Dictionary<int, IReadOnlyList<SocialGoalLogDto>>> LoadGoalLogsByMatchAsync(
        IReadOnlyCollection<int> matchIds,
        CancellationToken ct)
    {
        var matches = await _db.Match
            .AsNoTracking()
            .Include(x => x.TeamA).ThenInclude(x => x.Currency)
            .Include(x => x.TeamB).ThenInclude(x => x.Currency)
            .Where(x => matchIds.Contains(x.MatchId))
            .ToListAsync(ct);

        var events = await _db.MatchScoreEvent
            .AsNoTracking()
            .Include(x => x.Team).ThenInclude(x => x.Currency)
            .Where(x => matchIds.Contains(x.MatchId) && x.Points > 0)
            .OrderBy(x => x.MatchId)
            .ThenBy(x => x.EventSequence)
            .ThenBy(x => x.EventTimeUtc)
            .ToListAsync(ct);

        return matches.ToDictionary(
            x => x.MatchId,
            x => (IReadOnlyList<SocialGoalLogDto>)ToGoalLogs(x, events.Where(e => e.MatchId == x.MatchId).ToList()));
    }

    private static List<SocialGoalLogDto> ToGoalLogs(Match match, IReadOnlyList<MatchScoreEvent> events)
    {
        var homeGoals = 0;
        var awayGoals = 0;
        var logs = new List<SocialGoalLogDto>(events.Count);

        foreach (var evt in events)
        {
            var points = Math.Max(1, evt.Points);
            var isHome = evt.TeamId == match.TeamAId;
            var isAway = evt.TeamId == match.TeamBId;
            if (!isHome && !isAway)
                continue;

            if (isHome)
                homeGoals += points;
            else
                awayGoals += points;

            var symbol = evt.Team?.Currency?.Symbol
                ?? (isHome ? match.TeamA.Currency.Symbol : match.TeamB.Currency.Symbol);

            logs.Add(new SocialGoalLogDto
            {
                Minute = GetElapsedMinute(match.StartTime, evt.EventTimeUtc),
                TeamSymbol = symbol,
                EventType = "Goal",
                ScoreAfter = $"{homeGoals} x {awayGoals}",
                Description = BuildGoalDescription(symbol, evt.Description, homeGoals, awayGoals, isHome)
            });
        }

        return logs;
    }

    private SocialComputedMatch BuildSocialMatch(
        Match match,
        IReadOnlyCollection<SocialBetSummary> betSummaries,
        IReadOnlyDictionary<int, IReadOnlyList<SocialGoalLogDto>> goalLogsByMatch)
    {
        var homeSummary = betSummaries.FirstOrDefault(x => x.MatchId == match.MatchId && x.TeamId == match.TeamAId);
        var awaySummary = betSummaries.FirstOrDefault(x => x.MatchId == match.MatchId && x.TeamId == match.TeamBId);
        var homeAmount = homeSummary?.TotalAmount ?? 0m;
        var awayAmount = awaySummary?.TotalAmount ?? 0m;
        var totalBets = (homeSummary?.TotalBets ?? 0) + (awaySummary?.TotalBets ?? 0);
        var goalLogs = goalLogsByMatch.TryGetValue(match.MatchId, out var logs) ? logs : [];
        var totalGoals = match.ScoreA + match.ScoreB;
        var minute = GetElapsedMinute(match.StartTime, DateTime.UtcNow);
        var isTightScore = Math.Abs(match.ScoreA - match.ScoreB) <= 1;
        var betBalanceScore = CalculateBetBalanceScore(homeAmount, awayAmount);
        var recentGoal = goalLogs.LastOrDefault(x => minute - x.Minute <= 10);
        var recentComeback = DetectRecentComeback(match, goalLogs);
        var hotScore = CalculateHotScore(totalGoals, match.ScoreA, match.ScoreB, totalBets, betBalanceScore, recentGoal is not null, recentComeback);
        var reason = BuildReason(totalGoals, isTightScore, totalBets, betBalanceScore, recentGoal is not null, recentComeback);

        return new SocialComputedMatch
        {
            MatchId = match.MatchId,
            HomeSymbol = match.TeamA.Currency.Symbol,
            AwaySymbol = match.TeamB.Currency.Symbol,
            HomeGoals = match.ScoreA,
            AwayGoals = match.ScoreB,
            Status = match.Status.ToString(),
            Minute = minute,
            TotalGoals = totalGoals,
            TotalBets = totalBets,
            HomeBetAmount = homeAmount,
            AwayBetAmount = awayAmount,
            HotScore = hotScore,
            PublicUrl = BuildPublicUrl(match.MatchId, match.TeamA.Currency.Symbol, match.TeamB.Currency.Symbol),
            Reason = reason
        };
    }

    private async Task<SocialPostingDecision> EvaluatePostingDecisionAsync(SocialComputedMatch match, CancellationToken ct)
    {
        if (!_options.Enabled)
            return SocialPostingDecision.Skip("Social automation desabilitada.");

        if (!string.Equals(match.Status, MatchStatus.Ongoing.ToString(), StringComparison.OrdinalIgnoreCase))
            return SocialPostingDecision.Skip("Apenas partidas em andamento podem ser postadas.");

        if (match.HotScore < _options.MinimumHotScore)
            return SocialPostingDecision.Skip($"HotScore abaixo do minimo configurado ({_options.MinimumHotScore}).");

        var cooldownSince = DateTime.UtcNow.AddMinutes(-Math.Max(0, _options.CooldownMinutesPerMatch));
        var recentlyPosted = await _db.SocialPostHistory
            .AsNoTracking()
            .Where(x => x.MatchId == match.MatchId && x.CreatedAt >= cooldownSince)
            .OrderByDescending(x => x.CreatedAt)
            .FirstOrDefaultAsync(ct);

        if (recentlyPosted is not null)
        {
            var cooldownUntil = recentlyPosted.CreatedAt.AddMinutes(_options.CooldownMinutesPerMatch);
            return SocialPostingDecision.Skip($"Cooldown ativo ate {cooldownUntil:O}.");
        }

        return SocialPostingDecision.Post();
    }

    private static string NormalizePlatform(string? platform)
        => string.IsNullOrWhiteSpace(platform) ? string.Empty : platform.Trim();

    private string BuildPublicUrl(int matchId, string homeSymbol, string awaySymbol)
        => $"{_options.PublicBaseUrl.TrimEnd('/')}/match/{matchId}/{Slugify(homeSymbol)}-vs-{Slugify(awaySymbol)}";

    private static string Slugify(string value)
    {
        return string.Concat(
            value.Trim().ToLowerInvariant().Select(ch => char.IsLetterOrDigit(ch) ? ch : '-'))
            .Trim('-');
    }

    private static int GetElapsedMinute(DateTime? startTimeUtc, DateTime eventTimeUtc)
    {
        if (!startTimeUtc.HasValue)
            return 0;

        var minute = (int)Math.Floor((eventTimeUtc - startTimeUtc.Value).TotalMinutes);
        return Math.Clamp(minute, 0, MatchDurationMinutes);
    }

    private static int CalculateBetBalanceScore(decimal homeAmount, decimal awayAmount)
    {
        var total = homeAmount + awayAmount;
        if (total <= 0m || homeAmount <= 0m || awayAmount <= 0m)
            return 0;

        var dominant = Math.Max(homeAmount, awayAmount);
        var balanced = Math.Min(homeAmount, awayAmount) / dominant;
        return (int)Math.Round(balanced * 15m, MidpointRounding.AwayFromZero);
    }

    private static bool DetectRecentComeback(Match match, IReadOnlyList<SocialGoalLogDto> goalLogs)
    {
        if (goalLogs.Count < 2)
            return false;

        var currentMinute = GetElapsedMinute(match.StartTime, DateTime.UtcNow);
        if (currentMinute - goalLogs[^1].Minute > 15)
            return false;

        var leader = 0;
        foreach (var log in goalLogs)
        {
            var parts = log.ScoreAfter.Split(" x ");
            if (parts.Length != 2)
                continue;

            if (!int.TryParse(parts[0], out var home) || !int.TryParse(parts[1], out var away))
                continue;

            var newLeader = home == away ? 0 : home > away ? 1 : -1;
            if (leader != 0 && newLeader != 0 && leader != newLeader)
                return true;

            leader = newLeader;
        }

        return false;
    }

    private static int CalculateHotScore(
        int totalGoals,
        int homeGoals,
        int awayGoals,
        int totalBets,
        int betBalanceScore,
        bool hasRecentGoal,
        bool hasRecentComeback)
    {
        var score = 0;
        score += Math.Min(40, totalGoals * 10);

        var diff = Math.Abs(homeGoals - awayGoals);
        score += diff switch
        {
            0 => 20,
            1 => 16,
            2 => 8,
            _ => 0
        };

        score += Math.Min(20, totalBets * 2);
        score += betBalanceScore;

        if (hasRecentGoal)
            score += 10;

        if (hasRecentComeback)
            score += 10;

        return Math.Clamp(score, 0, 100);
    }

    private static string BuildReason(
        int totalGoals,
        bool isTightScore,
        int totalBets,
        int betBalanceScore,
        bool hasRecentGoal,
        bool hasRecentComeback)
    {
        var parts = new List<string>();

        if (totalGoals >= 4)
            parts.Add("muitos gols");

        if (isTightScore)
            parts.Add("placar apertado");

        if (totalBets >= 10)
            parts.Add("bom volume de apostas");

        if (betBalanceScore >= 10)
            parts.Add("apostas equilibradas");

        if (hasRecentGoal)
            parts.Add("gol recente");

        if (hasRecentComeback)
            parts.Add("virada recente");

        if (parts.Count == 0)
            return "Partida ativa com potencial para conteudo social.";

        return $"Jogo com {string.Join(", ", parts)}.";
    }

    private static string BuildSuggestedText(SocialComputedMatch match)
        => $"{match.HomeSymbol} e {match.AwaySymbol} fazem uma batalha intensa no CriptoVersus. Placar atual: {match.HomeGoals} x {match.AwayGoals} aos {match.Minute}'";

    private static List<string> BuildHashtags(SocialComputedMatch match)
        => ["#CriptoVersus", "#Crypto", $"#{match.HomeSymbol}", $"#{match.AwaySymbol}"];

    private static string BuildGoalDescription(string symbol, string? engineDescription, int homeGoals, int awayGoals, bool isHome)
    {
        if (!string.IsNullOrWhiteSpace(engineDescription))
            return engineDescription.Trim();

        if (homeGoals == awayGoals)
            return $"{symbol} empatou a partida.";

        var isLeading = isHome ? homeGoals > awayGoals : awayGoals > homeGoals;
        return isLeading
            ? $"{symbol} assumiu a frente do placar."
            : $"{symbol} marcou e manteve o jogo vivo.";
    }

    private sealed class SocialBetSummary
    {
        public int MatchId { get; init; }
        public int TeamId { get; init; }
        public decimal TotalAmount { get; init; }
        public int TotalBets { get; init; }
    }

    private sealed class SocialComputedMatch
    {
        public int MatchId { get; init; }
        public string HomeSymbol { get; init; } = string.Empty;
        public string AwaySymbol { get; init; } = string.Empty;
        public int HomeGoals { get; init; }
        public int AwayGoals { get; init; }
        public string Status { get; init; } = string.Empty;
        public int Minute { get; init; }
        public int TotalGoals { get; init; }
        public int TotalBets { get; init; }
        public decimal HomeBetAmount { get; init; }
        public decimal AwayBetAmount { get; init; }
        public int HotScore { get; init; }
        public string PublicUrl { get; init; } = string.Empty;
        public string Reason { get; init; } = string.Empty;
    }
}

public sealed class SocialAutomationOptions
{
    public const string SectionName = "SocialAutomation";

    public bool Enabled { get; set; } = true;
    public int MinimumHotScore { get; set; } = 50;
    public int CooldownMinutesPerMatch { get; set; } = 30;
    public string PublicBaseUrl { get; set; } = "https://criptoversus.com";
}

public sealed class SocialPostingDecision
{
    public bool CanPost { get; init; }
    public string? SkipReason { get; init; }

    public static SocialPostingDecision Post() => new() { CanPost = true };
    public static SocialPostingDecision Skip(string reason) => new() { CanPost = false, SkipReason = reason };
}

public sealed class SocialPostHistoryRegistrationResult
{
    public bool Success { get; init; }
    public bool NotFoundMatch { get; init; }
    public string? Error { get; init; }
    public long? Id { get; init; }
    public DateTime? CreatedAtUtc { get; init; }

    public static SocialPostHistoryRegistrationResult Created(long id, DateTime createdAtUtc) => new()
    {
        Success = true,
        Id = id,
        CreatedAtUtc = createdAtUtc
    };

    public static SocialPostHistoryRegistrationResult NotFound(string error) => new()
    {
        NotFoundMatch = true,
        Error = error
    };

    public static SocialPostHistoryRegistrationResult Invalid(string error) => new()
    {
        Error = error
    };

    public static SocialPostHistoryRegistrationResult Blocked(string error) => new()
    {
        Error = error
    };
}
