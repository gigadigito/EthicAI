using System.Collections.Concurrent;
using System.Globalization;
using System.Net;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using BLL.GameRules;
using CriptoVersus.API.Hubs;
using DAL.NftFutebol;
using DTOs;
using EthicAI.EntityModel;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Npgsql;

namespace CriptoVersus.API.Services;

public interface ICommunityMatchService
{
    Task<CommunityMatchServiceResult> CreateAsync(
        CommunityMatchCreateRequestDto request,
        ClaimsPrincipal? user,
        string? remoteIpAddress,
        CancellationToken ct = default);
}

public sealed class CommunityMatchService : ICommunityMatchService
{
    private static readonly ConcurrentDictionary<string, SemaphoreSlim> PairLocks = new();
    private static readonly TimeSpan DefaultFreshnessWindow = TimeSpan.FromMinutes(15);
    private static readonly string[] QuoteSuffixes = ["USDT", "USDC", "BUSD", "FDUSD", "BRL", "EUR", "BTC", "ETH"];

    private readonly EthicAIDbContext _db;
    private readonly IOptions<CommunityMatchOptions> _options;
    private readonly ICaptchaValidator _captchaValidator;
    private readonly IConfiguration _configuration;
    private readonly IHubContext<DashboardHub> _hub;
    private readonly ILogger<CommunityMatchService> _logger;

    public CommunityMatchService(
        EthicAIDbContext db,
        IOptions<CommunityMatchOptions> options,
        ICaptchaValidator captchaValidator,
        IConfiguration configuration,
        IHubContext<DashboardHub> hub,
        ILogger<CommunityMatchService> logger)
    {
        _db = db;
        _options = options;
        _captchaValidator = captchaValidator;
        _configuration = configuration;
        _hub = hub;
        _logger = logger;
    }

    public async Task<CommunityMatchServiceResult> CreateAsync(
        CommunityMatchCreateRequestDto request,
        ClaimsPrincipal? user,
        string? remoteIpAddress,
        CancellationToken ct = default)
    {
        var options = _options.Value;
        if (!options.Enabled)
            return CommunityMatchServiceResult.Failure(HttpStatusCode.Forbidden, "communityMatchesUnavailable", "community matches disabled");

        if (request is null)
            return CommunityMatchServiceResult.Failure(HttpStatusCode.BadRequest, "invalidAsset", "request missing");

        var homeInput = NormalizeIncomingSymbol(request.HomeSymbol);
        var awayInput = NormalizeIncomingSymbol(request.AwaySymbol);
        if (string.IsNullOrWhiteSpace(homeInput) || string.IsNullOrWhiteSpace(awayInput))
            return CommunityMatchServiceResult.Failure(HttpStatusCode.BadRequest, "invalidAsset", "symbols missing");

        if (string.Equals(homeInput, awayInput, StringComparison.OrdinalIgnoreCase))
            return CommunityMatchServiceResult.Failure(HttpStatusCode.BadRequest, "sameAssetNotAllowed", "same asset");

        var captcha = await _captchaValidator.ValidateAsync(request.CaptchaToken, remoteIpAddress, ct);
        if (!captcha.IsValid)
        {
            _logger.LogWarning("community match captcha rejected. code={Code} unavailable={Unavailable}", captcha.MessageCode, captcha.IsUnavailable);
            return CommunityMatchServiceResult.Failure(
                captcha.IsUnavailable ? HttpStatusCode.ServiceUnavailable : HttpStatusCode.Forbidden,
                captcha.MessageCode,
                captcha.Detail,
                captcha.IsUnavailable);
        }

        var nowUtc = DateTime.UtcNow;
        var createdByUserId = TryReadAuthenticatedUserId(user);
        var creatorIpHash = HashCreatorIp(remoteIpAddress, options.CreatorIpSalt);

        var teamA = await ResolveTeamAsync(homeInput, ct);
        var teamB = await ResolveTeamAsync(awayInput, ct);
        if (teamA is null || teamB is null)
            return CommunityMatchServiceResult.Failure(HttpStatusCode.BadRequest, "invalidAsset", "asset not found");

        if (teamA.TeamId == teamB.TeamId)
            return CommunityMatchServiceResult.Failure(HttpStatusCode.BadRequest, "sameAssetNotAllowed", "same team id");

        if (!IsSupportedAsset(teamA, nowUtc, options) || !IsSupportedAsset(teamB, nowUtc, options))
            return CommunityMatchServiceResult.Failure(HttpStatusCode.BadRequest, "assetNotAvailable", "asset unsupported or stale");

        if (MatchPairRules.IsForbiddenPair(teamA.Currency?.Symbol, teamB.Currency?.Symbol, _configuration))
            return CommunityMatchServiceResult.Failure(HttpStatusCode.BadRequest, "assetNotAvailable", "forbidden pair");

        var normalizedTeamA = teamA.Currency!.Symbol.Trim().ToUpperInvariant();
        var normalizedTeamB = teamB.Currency!.Symbol.Trim().ToUpperInvariant();

        var rateLimit = await CheckRateLimitAsync(createdByUserId, creatorIpHash, nowUtc, options, ct);
        if (rateLimit is not null)
            return rateLimit;

        var pairKey = BuildPairKey(teamA.TeamId, teamB.TeamId);
        var pairLock = PairLocks.GetOrAdd(pairKey, static _ => new SemaphoreSlim(1, 1));
        await pairLock.WaitAsync(ct);

        try
        {
            var activeStatuses = GetActiveStatuses(options);
            var existing = await FindExistingActiveMatchAsync(pairKey, activeStatuses, ct);
            if (existing is not null)
            {
                var existingHome = existing.TeamA?.Currency?.Symbol ?? normalizedTeamA;
                var existingAway = existing.TeamB?.Currency?.Symbol ?? normalizedTeamB;
                _logger.LogInformation(
                    "community match reused existing match. MatchId={MatchId} PairKey={PairKey} Symbols={A}/{B}",
                    existing.MatchId,
                    pairKey,
                    existingHome,
                    existingAway);

                return CommunityMatchServiceResult.Success(CreateResponse(
                    created: false,
                    alreadyExists: true,
                    existing.MatchId,
                    existingHome,
                    existingAway,
                    existing.Status.ToString(),
                    "battleAlreadyExists",
                    BuildPublicUrl(existing.MatchId, existingHome, existingAway),
                    options.SuccessRedirectDelayMilliseconds / 1000));
            }

            var startTime = nowUtc.AddMinutes(Math.Max(1, options.StartDelayMinutes));
            var bettingCloseTime = startTime.AddMinutes(-Math.Max(1, options.BettingCloseOffsetMinutes));

            var match = new Match
            {
                TeamAId = teamA.TeamId,
                TeamBId = teamB.TeamId,
                Status = MatchStatus.Pending,
                StartTime = startTime,
                BettingCloseTime = bettingCloseTime.ToUniversalTime(),
                ScoreA = 0,
                ScoreB = 0,
                Origin = MatchOrigin.Community,
                CommunityCreatedAt = DateTimeOffset.UtcNow,
                CreatedByUserId = createdByUserId,
                CreatorIpHash = creatorIpHash,
                CommunityPairKey = pairKey,
                ScoringRuleType = MatchScoringRuleType.PercentThreshold,
                RulesetVersion = RuleConstants.DefaultRulesetVersion
            };

            if (match.BettingCloseTime.HasValue && match.StartTime.HasValue && match.BettingCloseTime.Value.UtcDateTime >= match.StartTime.Value)
                match.BettingCloseTime = match.StartTime.Value.AddMinutes(-Math.Max(1, options.BettingCloseOffsetMinutes)).ToUniversalTime();

            _db.Match.Add(match);
            _db.MatchScoreState.Add(new MatchScoreState
            {
                MatchId = match.MatchId,
                CreatedAtUtc = nowUtc,
                UpdatedAtUtc = nowUtc
            });

            try
            {
                await _db.SaveChangesAsync(ct);
            }
            catch (DbUpdateException ex) when (IsUniqueCommunityPairViolation(ex))
            {
                _logger.LogInformation(ex, "community match concurrency resolved by unique index. PairKey={PairKey}", pairKey);
                var resolved = await FindExistingActiveMatchAsync(pairKey, activeStatuses, ct);
                if (resolved is null)
                    return CommunityMatchServiceResult.Failure(HttpStatusCode.Conflict, "battleAlreadyExists", "unique violation without match");

                var resolvedHome = resolved.TeamA?.Currency?.Symbol ?? normalizedTeamA;
                var resolvedAway = resolved.TeamB?.Currency?.Symbol ?? normalizedTeamB;
                return CommunityMatchServiceResult.Success(CreateResponse(
                    created: false,
                    alreadyExists: true,
                    resolved.MatchId,
                    resolvedHome,
                    resolvedAway,
                    resolved.Status.ToString(),
                    "battleAlreadyExists",
                    BuildPublicUrl(resolved.MatchId, resolvedHome, resolvedAway),
                    options.SuccessRedirectDelayMilliseconds / 1000));
            }

            await NotifyDashboardAsync(match.MatchId, ct);

            _logger.LogInformation(
                "community match created. MatchId={MatchId} PairKey={PairKey} Symbols={A}/{B} Origin={Origin} UserId={UserId} CreatorIpHash={CreatorIpHash}",
                match.MatchId,
                pairKey,
                normalizedTeamA,
                normalizedTeamB,
                match.Origin,
                createdByUserId,
                creatorIpHash);

            return CommunityMatchServiceResult.Success(CreateResponse(
                created: true,
                alreadyExists: false,
                match.MatchId,
                normalizedTeamA,
                normalizedTeamB,
                match.Status.ToString(),
                "battleCreatedSuccessfully",
                BuildPublicUrl(match.MatchId, normalizedTeamA, normalizedTeamB),
                options.SuccessRedirectDelayMilliseconds / 1000));
        }
        finally
        {
            pairLock.Release();
        }
    }

    private async Task<CommunityMatchServiceResult?> CheckRateLimitAsync(
        int? userId,
        string creatorIpHash,
        DateTime nowUtc,
        CommunityMatchOptions options,
        CancellationToken ct)
    {
        var windowStart = nowUtc.AddDays(-1);
        var cooldownStart = nowUtc.AddMinutes(-Math.Max(1, options.CooldownMinutes));

        var query = _db.Match.AsNoTracking().Where(m => m.Origin == MatchOrigin.Community && m.CommunityCreatedAt.HasValue);
        if (userId.HasValue)
            query = query.Where(m => m.CreatedByUserId == userId);
        else
            query = query.Where(m => m.CreatorIpHash == creatorIpHash);

        var relevant = await query
            .Where(m => m.CommunityCreatedAt >= windowStart)
            .OrderByDescending(m => m.CommunityCreatedAt)
            .Select(m => new { m.CommunityCreatedAt })
            .ToListAsync(ct);

        var limit = userId.HasValue ? Math.Max(1, options.AuthenticatedDailyLimit) : Math.Max(1, options.AnonymousDailyLimit);
        if (relevant.Count >= limit)
        {
            var oldest = relevant.OrderBy(x => x.CommunityCreatedAt).First().CommunityCreatedAt?.UtcDateTime ?? nowUtc;
            var retryAfter = Math.Max(1, (int)Math.Ceiling((oldest.AddDays(1) - nowUtc).TotalSeconds));
            return CommunityMatchServiceResult.Failure(HttpStatusCode.TooManyRequests, "tooManyRequests", "daily limit", true, retryAfter);
        }

        var lastCreation = relevant.FirstOrDefault()?.CommunityCreatedAt?.UtcDateTime;
        if (lastCreation.HasValue && lastCreation.Value >= cooldownStart)
        {
            var retryAfter = Math.Max(1, (int)Math.Ceiling((lastCreation.Value.AddMinutes(Math.Max(1, options.CooldownMinutes)) - nowUtc).TotalSeconds));
            return CommunityMatchServiceResult.Failure(HttpStatusCode.TooManyRequests, "tooManyRequests", "cooldown", true, retryAfter);
        }

        return null;
    }

    private async Task<Team?> ResolveTeamAsync(string normalizedInput, CancellationToken ct)
    {
        var candidates = await _db.Team
            .AsNoTracking()
            .Include(t => t.Currency)
            .Where(t => t.Currency != null)
            .Where(t => !string.IsNullOrWhiteSpace(t.Currency!.Symbol))
            .ToListAsync(ct);

        var exact = candidates
            .Where(t => string.Equals(NormalizeIncomingSymbol(t.Currency!.Symbol), normalizedInput, StringComparison.OrdinalIgnoreCase))
            .OrderByDescending(t => t.Currency!.LastUpdated)
            .FirstOrDefault();
        if (exact is not null)
            return exact;

        var byDisplay = candidates
            .Where(t => string.Equals(NormalizeIncomingSymbol(t.Currency!.Name), normalizedInput, StringComparison.OrdinalIgnoreCase))
            .OrderByDescending(t => t.Currency!.LastUpdated)
            .FirstOrDefault();
        if (byDisplay is not null)
            return byDisplay;

        var byBase = candidates
            .Where(t => string.Equals(CleanAssetSymbol(t.Currency!.Symbol), normalizedInput, StringComparison.OrdinalIgnoreCase))
            .OrderByDescending(t => t.Currency!.LastUpdated)
            .FirstOrDefault();
        return byBase;
    }

    private bool IsSupportedAsset(Team team, DateTime nowUtc, CommunityMatchOptions options)
    {
        var currency = team.Currency;
        if (currency is null)
            return false;

        if (MatchPairRules.IsForbiddenStablecoin(currency.Symbol, _configuration))
            return false;

        var freshnessWindow = TimeSpan.FromMinutes(Math.Max(1, options.MarketDataFreshnessMinutes));
        if (currency.LastUpdated < nowUtc.Subtract(freshnessWindow))
            return false;

        return !string.IsNullOrWhiteSpace(currency.Symbol);
    }

    private async Task<Match?> FindExistingActiveMatchAsync(string pairKey, HashSet<MatchStatus> activeStatuses, CancellationToken ct)
        => await _db.Match
            .AsNoTracking()
            .Include(m => m.TeamA)
                .ThenInclude(t => t.Currency)
            .Include(m => m.TeamB)
                .ThenInclude(t => t.Currency)
            .Where(m => m.CommunityPairKey == pairKey)
            .Where(m => activeStatuses.Contains(m.Status))
            .OrderByDescending(m => m.CommunityCreatedAt ?? DateTimeOffset.MinValue)
            .FirstOrDefaultAsync(ct);

    private async Task NotifyDashboardAsync(int matchId, CancellationToken ct)
    {
        await _hub.Clients.All.SendAsync(
            "dashboard_changed",
            System.Text.Json.JsonSerializer.Serialize(new
            {
                reason = "community_match_created",
                matchId,
                utc = DateTimeOffset.UtcNow
            }),
            ct);
    }

    private static CommunityMatchCreateResponseDto CreateResponse(
        bool created,
        bool alreadyExists,
        int matchId,
        string homeSymbol,
        string awaySymbol,
        string status,
        string messageCode,
        string publicUrl,
        int? retryAfterSeconds)
        => new()
        {
            Created = created,
            AlreadyExists = alreadyExists,
            MatchId = matchId,
            HomeSymbol = homeSymbol,
            AwaySymbol = awaySymbol,
            PublicUrl = publicUrl,
            Status = status,
            MessageCode = messageCode,
            RetryAfterSeconds = retryAfterSeconds,
            Message = messageCode
        };

    private static string BuildPublicUrl(int matchId, string homeSymbol, string awaySymbol)
        => $"/match/{matchId}/{BuildSlug(homeSymbol, awaySymbol)}";

    private static string BuildSlug(string? left, string? right)
        => $"{BuildSlugPart(left, "team-a")}-vs-{BuildSlugPart(right, "team-b")}";

    private static string BuildSlugPart(string? value, string fallback)
    {
        var normalized = NormalizeIncomingSymbol(value);
        if (!string.IsNullOrWhiteSpace(normalized))
            return CleanAssetSymbol(normalized).ToLowerInvariant();

        var text = NormalizeSlugText(value);
        return string.IsNullOrWhiteSpace(text) ? fallback : text;
    }

    private static string NormalizeSlugText(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
            return string.Empty;

        var builder = new StringBuilder(value.Trim().Length);
        var lastWasDash = false;
        foreach (var ch in value.Trim().Normalize(NormalizationForm.FormKC))
        {
            if (char.IsLetterOrDigit(ch))
            {
                builder.Append(char.ToLowerInvariant(ch));
                lastWasDash = false;
                continue;
            }

            if (char.IsWhiteSpace(ch) || ch is '-' or '_' or '.' or '/' or '\\')
            {
                if (builder.Length > 0 && !lastWasDash)
                {
                    builder.Append('-');
                    lastWasDash = true;
                }
            }
        }

        return builder.ToString().Trim('-');
    }

    private static string CleanAssetSymbol(string? symbol)
    {
        if (string.IsNullOrWhiteSpace(symbol))
            return string.Empty;

        var normalized = new string(symbol.Trim().ToUpperInvariant().Where(char.IsLetterOrDigit).ToArray());
        foreach (var suffix in QuoteSuffixes)
        {
            if (normalized.Length > suffix.Length && normalized.EndsWith(suffix, StringComparison.Ordinal))
                return normalized[..^suffix.Length];
        }

        return normalized;
    }

    private static string NormalizeIncomingSymbol(string? symbol)
        => new string((symbol ?? string.Empty).Trim().ToUpperInvariant().Where(char.IsLetterOrDigit).ToArray());

    private static HashSet<MatchStatus> GetActiveStatuses(CommunityMatchOptions options)
    {
        var parsed = new HashSet<MatchStatus>();
        foreach (var status in options.ActiveDuplicateStatuses)
        {
            if (Enum.TryParse<MatchStatus>(status, ignoreCase: true, out var value))
                parsed.Add(value);
        }

        if (parsed.Count == 0)
        {
            parsed.Add(MatchStatus.Pending);
            parsed.Add(MatchStatus.Ongoing);
        }

        return parsed;
    }

    private static string BuildPairKey(int teamAId, int teamBId)
    {
        var low = Math.Min(teamAId, teamBId);
        var high = Math.Max(teamAId, teamBId);
        return $"{low}:{high}";
    }

    private static int? TryReadAuthenticatedUserId(ClaimsPrincipal? user)
    {
        if (user is null)
            return null;

        var candidates = new[]
        {
            user.FindFirstValue("cd_user"),
            user.FindFirstValue("userId"),
            user.FindFirstValue(ClaimTypes.NameIdentifier)
        };

        foreach (var candidate in candidates)
        {
            if (int.TryParse(candidate, out var parsed) && parsed > 0)
                return parsed;
        }

        return null;
    }

    private static string HashCreatorIp(string? remoteIpAddress, string salt)
    {
        var normalized = string.IsNullOrWhiteSpace(remoteIpAddress) ? "unknown" : remoteIpAddress.Trim();
        var key = Encoding.UTF8.GetBytes(string.IsNullOrWhiteSpace(salt) ? "community-match-ip" : salt.Trim());
        using var hmac = new HMACSHA256(key);
        var hash = hmac.ComputeHash(Encoding.UTF8.GetBytes(normalized));
        return Convert.ToHexString(hash).ToLowerInvariant();
    }

    private static bool IsUniqueCommunityPairViolation(DbUpdateException ex)
        => ex.InnerException is PostgresException pg && pg.SqlState == PostgresErrorCodes.UniqueViolation;
}

public sealed record CommunityMatchServiceResult(
    HttpStatusCode StatusCode,
    CommunityMatchCreateResponseDto? Response,
    string MessageCode,
    string? Detail,
    bool IsUnavailable = false,
    int? RetryAfterSeconds = null)
{
    public static CommunityMatchServiceResult Success(CommunityMatchCreateResponseDto response)
        => new(HttpStatusCode.OK, response, response.MessageCode, response.Message, false, response.RetryAfterSeconds);

    public static CommunityMatchServiceResult Failure(
        HttpStatusCode statusCode,
        string messageCode,
        string? detail = null,
        bool isUnavailable = false,
        int? retryAfterSeconds = null)
        => new(statusCode, null, messageCode, detail, isUnavailable, retryAfterSeconds);
}

