using CriptoVersus.API.Contracts;
using CriptoVersus.API.Services;
using DAL.NftFutebol;
using DTOs;
using EthicAI.EntityModel;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace CriptoVersus.API.Controllers;

[ApiController]
[Route("api/social")]
public sealed class SocialController : ControllerBase
{
    private readonly ISocialAutomationService _socialAutomationService;
    private readonly ISocialVsRenderService _socialVsRenderService;
    private readonly ISocialComposeFinalService _socialComposeFinalService;
    private readonly EthicAIDbContext _db;
    private readonly IConfiguration _configuration;
    private readonly IWebHostEnvironment _environment;
    private readonly ILogger<SocialController> _logger;

    public SocialController(
        EthicAIDbContext db,
        IConfiguration configuration,
        IWebHostEnvironment environment,
        ILogger<SocialController> logger,
        ISocialAutomationService socialAutomationService,
        ISocialVsRenderService socialVsRenderService,
        ISocialComposeFinalService socialComposeFinalService)
    {
        _db = db;
        _configuration = configuration;
        _environment = environment;
        _logger = logger;
        _socialAutomationService = socialAutomationService;
        _socialVsRenderService = socialVsRenderService;
        _socialComposeFinalService = socialComposeFinalService;
    }

    [AllowAnonymous]
    [HttpGet("hot-matches")]
    public async Task<ActionResult<IReadOnlyList<SocialHotMatchDto>>> GetHotMatches(CancellationToken ct)
    {
        var items = await _socialAutomationService.GetHotMatchesAsync(ct);
        return Ok(items);
    }
    // ==========================================================
    // GET /api/social/hot-matches/daily?hours=24&take=100
    //
    // Candidatos exclusivos para o ranking "Hot Matches do Dia".
    // Inclui partidas ativas e encerradas na janela informada.
    // Não altera o endpoint /api/social/hot-matches existente.
    // ==========================================================
    [AllowAnonymous]
    [HttpGet("hot-matches/daily")]
    public async Task<ActionResult<IReadOnlyList<MatchDto>>> GetDailyHotMatchCandidates(
        [FromQuery] int hours = 24,
        [FromQuery] int take = 100,
        CancellationToken ct = default)
    {
        var startedAtUtc = DateTime.UtcNow;

        hours = Math.Clamp(hours, 1, 72);
        take = Math.Clamp(take, 1, 500);

        var nowUtc = DateTime.UtcNow;
        var cutoffUtc = nowUtc.AddHours(-hours);

        var matches = await _db.Set<Match>()
            .AsNoTracking()
            .Include(m => m.TeamA)
                .ThenInclude(t => t.Currency)
            .Include(m => m.TeamB)
                .ThenInclude(t => t.Currency)
            .Include(m => m.WinnerTeam)
                .ThenInclude(t => t!.Currency)
            .Where(m =>
                m.Status != MatchStatus.Cancelled &&
                m.ScoreA + m.ScoreB > 0 &&
                (
                    // Partida encerrada dentro da janela.
                    (
                        m.EndTime.HasValue &&
                        m.EndTime.Value >= cutoffUtc &&
                        m.EndTime.Value <= nowUtc
                    )

                    ||

                    // Partida ainda sem EndTime, iniciada dentro da janela.
                    (
                        !m.EndTime.HasValue &&
                        m.StartTime.HasValue &&
                        m.StartTime.Value >= cutoffUtc &&
                        m.StartTime.Value <= nowUtc
                    )
                ))
            .OrderByDescending(m => m.EndTime ?? m.StartTime ?? DateTime.MinValue)
            .ThenByDescending(m => m.ScoreA + m.ScoreB)
            .Take(take)
            .ToListAsync(ct);

        matches = matches
            .Where(m => !MatchPairRules.IsForbiddenPair(
                m.TeamA?.Currency?.Symbol,
                m.TeamB?.Currency?.Symbol,
                _configuration))
            .ToList();

        if (matches.Count == 0)
        {
            _logger.LogInformation(
                "[SOCIAL_DAILY_HOT_MATCHES] No candidates. Hours={Hours} CutoffUtc={CutoffUtc:o}",
                hours,
                cutoffUtc);

            return Ok(Array.Empty<MatchDto>());
        }

        var matchIds = matches
            .Select(m => m.MatchId)
            .ToList();

        var aggregates = await _db.Set<Bet>()
            .AsNoTracking()
            .Where(b => matchIds.Contains(b.MatchId))
            .GroupBy(b => new
            {
                b.MatchId,
                b.TeamId
            })
            .Select(g => new DailyHotMatchSideAggregate
            {
                MatchId = g.Key.MatchId,
                TeamId = g.Key.TeamId,
                TotalAmount = g.Sum(x => x.Amount),
                BetCount = g.Count(),
                WalletCount = g
                    .Select(x => x.UserId)
                    .Distinct()
                    .Count()
            })
            .ToListAsync(ct);

        var items = matches
            .Select(match =>
            {
                var teamA = match.TeamA?.Currency;
                var teamB = match.TeamB?.Currency;
                var winner = match.WinnerTeam?.Currency;

                var teamAStats = aggregates.FirstOrDefault(x =>
                    x.MatchId == match.MatchId &&
                    x.TeamId == match.TeamAId);

                var teamBStats = aggregates.FirstOrDefault(x =>
                    x.MatchId == match.MatchId &&
                    x.TeamId == match.TeamBId);

                var totalAmountTeamA = teamAStats?.TotalAmount ?? 0m;
                var totalAmountTeamB = teamBStats?.TotalAmount ?? 0m;

                var walletCountTeamA = teamAStats?.WalletCount ?? 0;
                var walletCountTeamB = teamBStats?.WalletCount ?? 0;

                var betCountTeamA = teamAStats?.BetCount ?? 0;
                var betCountTeamB = teamBStats?.BetCount ?? 0;

                var totalPool = totalAmountTeamA + totalAmountTeamB;
                var totalWalletCount = walletCountTeamA + walletCountTeamB;

                var finished =
                    match.Status is MatchStatus.Completed or MatchStatus.Cancelled ||
                    match.EndTime.HasValue;

                var elapsedMinutes = 0;

                if (match.StartTime.HasValue)
                {
                    var referenceTime = match.EndTime ?? nowUtc;

                    elapsedMinutes = (int)Math.Max(
                        0,
                        (referenceTime - match.StartTime.Value).TotalMinutes);
                }

                var effectiveWinnerTeamId = match.WinnerTeamId;

                if (!effectiveWinnerTeamId.HasValue &&
                    match.Status == MatchStatus.Completed)
                {
                    effectiveWinnerTeamId = match.ScoreA > match.ScoreB
                        ? match.TeamAId
                        : match.ScoreB > match.ScoreA
                            ? match.TeamBId
                            : null;
                }

                return new MatchDto
                {
                    MatchId = match.MatchId,

                    TeamA = teamA?.Symbol ?? $"Team#{match.TeamAId}",
                    TeamB = teamB?.Symbol ?? $"Team#{match.TeamBId}",

                    TeamAId = match.TeamAId,
                    TeamBId = match.TeamBId,

                    ScoreA = match.ScoreA,
                    ScoreB = match.ScoreB,

                    Status = match.Status.ToString(),
                    StartTime = match.StartTime,
                    EndTime = match.EndTime,

                    ElapsedMinutes = elapsedMinutes,
                    RemainingMinutes = finished ? 0 : Math.Max(0, 90 - elapsedMinutes),
                    IsFinished = finished,

                    PctA = (decimal?)teamA?.PercentageChange,
                    PctB = (decimal?)teamB?.PercentageChange,

                    QuoteVolumeA = teamA?.QuoteVolume,
                    QuoteVolumeB = teamB?.QuoteVolume,

                    ScoringRuleType = match.ScoringRuleType.ToString(),

                    WinnerTeamId = effectiveWinnerTeamId,
                    WinnerTeamSymbol =
                        winner?.Symbol ??
                        (
                            effectiveWinnerTeamId == match.TeamAId
                                ? teamA?.Symbol
                                : effectiveWinnerTeamId == match.TeamBId
                                    ? teamB?.Symbol
                                    : null
                        ),

                    TotalAmountTeamA = totalAmountTeamA,
                    TotalAmountTeamB = totalAmountTeamB,

                    WalletCountTeamA = walletCountTeamA,
                    WalletCountTeamB = walletCountTeamB,

                    BetCountTeamA = betCountTeamA,
                    BetCountTeamB = betCountTeamB,

                    TotalPool = totalPool,
                    TotalPoolAmount = totalPool,
                    TotalWalletCount = totalWalletCount,

                    HasBetsOnBothSides =
                        totalAmountTeamA > 0m &&
                        totalAmountTeamB > 0m &&
                        walletCountTeamA > 0 &&
                        walletCountTeamB > 0,

                    PoolStrengthTeamA = CalculateDailyPoolStrength(
                        walletCountTeamA,
                        totalWalletCount,
                        totalAmountTeamA,
                        totalPool),

                    PoolStrengthTeamB = CalculateDailyPoolStrength(
                        walletCountTeamB,
                        totalWalletCount,
                        totalAmountTeamB,
                        totalPool),

                    Participants = []
                };
            })
            .ToList();

        _logger.LogInformation(
            "[SOCIAL_DAILY_HOT_MATCHES] Hours={Hours} CutoffUtc={CutoffUtc:o} SourceCount={SourceCount} ResultCount={ResultCount} ElapsedMs={ElapsedMs}",
            hours,
            cutoffUtc,
            matches.Count,
            items.Count,
            (DateTime.UtcNow - startedAtUtc).TotalMilliseconds);

        return Ok(items);
    }
    [AllowAnonymous]
    [HttpGet("matches/{matchId:int}/goal-logs")]
    public async Task<ActionResult<IReadOnlyList<SocialGoalLogDto>>> GetGoalLogs(int matchId, CancellationToken ct)
    {
        var items = await _socialAutomationService.GetGoalLogsAsync(matchId, ct);
        return items is null ? NotFound() : Ok(items);
    }

    [AllowAnonymous]
    [HttpGet("matches/{matchId:int}/share-card")]
    public async Task<ActionResult<SocialShareCardDto>> GetShareCard(int matchId, CancellationToken ct)
    {
        var item = await _socialAutomationService.GetShareCardAsync(matchId, ct);
        return item is null ? NotFound() : Ok(item);
    }

    [AllowAnonymous]
    [HttpGet("matches/{matchId:int}/image")]
    public async Task<ActionResult<SocialMatchImageDto>> GetMatchImage(int matchId, CancellationToken ct)
    {
        var item = await _socialAutomationService.GetMatchImageAsync(matchId, ct);
        return item is null ? NotFound() : Ok(item);
    }

    [AllowAnonymous]
    [HttpGet("coin-profile/{symbol}")]
    public async Task<ActionResult<CoinSocialProfileDto>> GetCoinProfile(string symbol, CancellationToken ct)
    {
        var normalizedSymbol = NormalizeSymbol(symbol);
        if (string.IsNullOrWhiteSpace(normalizedSymbol))
            return BadRequest(new { message = "Symbol obrigatorio." });

        var entity = await _db.CoinSocialProfile
            .AsNoTracking()
            .FirstOrDefaultAsync(x => x.Symbol == normalizedSymbol, ct);

        if (entity is null)
            return NotFound(new { message = $"Perfil social nao encontrado para {normalizedSymbol}." });

        return Ok(ToDto(entity));
    }

    [AllowAnonymous]
    [HttpGet("coin-profiles")]
    public async Task<ActionResult<IReadOnlyList<CoinSocialProfileDto>>> GetCoinProfiles(
        [FromQuery] string? symbols,
        CancellationToken ct)
    {
        var normalizedSymbols = (symbols ?? string.Empty)
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(NormalizeSymbol)
            .Where(x => !string.IsNullOrWhiteSpace(x))
            .Distinct(StringComparer.Ordinal)
            .ToArray();

        if (normalizedSymbols.Length == 0)
            return Ok(Array.Empty<CoinSocialProfileDto>());

        var items = await _db.CoinSocialProfile
            .AsNoTracking()
            .Where(x => normalizedSymbols.Contains(x.Symbol))
            .OrderBy(x => x.Symbol)
            .Select(x => ToDto(x))
            .ToListAsync(ct);

        return Ok(items);
    }

    [AllowAnonymous]
    [HttpPost("coin-profile")]
    public async Task<ActionResult<CoinSocialProfileUpsertResponse>> UpsertCoinProfile(
        [FromBody] UpsertCoinSocialProfileRequest request,
        CancellationToken ct)
    {
        if (!TryAuthorizeSocialWrite(out var error))
            return error;

        var normalizedSymbol = request.HasSymbol ? NormalizeSymbol(request.Symbol) : null;
        var coinGeckoId = request.HasCoinGeckoId ? TrimOrNull(request.CoinGeckoId) : null;
        if (string.IsNullOrWhiteSpace(normalizedSymbol) && string.IsNullOrWhiteSpace(coinGeckoId))
            return BadRequest(new { message = "Informe symbol ou coingeckoId." });

        var nowUtc = DateTime.UtcNow;
        CoinSocialProfile? entityByCoinGecko = null;
        CoinSocialProfile? entityBySymbol = null;

        if (!string.IsNullOrWhiteSpace(coinGeckoId))
        {
            entityByCoinGecko = await _db.CoinSocialProfile
                .FirstOrDefaultAsync(x => x.CoinGeckoId == coinGeckoId, ct);
        }

        if (!string.IsNullOrWhiteSpace(normalizedSymbol))
        {
            entityBySymbol = await _db.CoinSocialProfile
                .FirstOrDefaultAsync(x => x.Symbol == normalizedSymbol, ct);
        }

        if (entityByCoinGecko is not null &&
            entityBySymbol is not null &&
            entityByCoinGecko.Id != entityBySymbol.Id)
        {
            return Conflict(new { message = "Ja existem perfis distintos para o symbol e o coingeckoId informados." });
        }

        var entity = entityByCoinGecko ?? entityBySymbol;

        var isNew = entity is null;
        if (isNew)
        {
            if (string.IsNullOrWhiteSpace(normalizedSymbol))
                return BadRequest(new { message = "Symbol obrigatorio para criar novo perfil." });

            entity = new CoinSocialProfile
            {
                Symbol = normalizedSymbol,
                CreatedAtUtc = nowUtc
            };

            _db.CoinSocialProfile.Add(entity);
        }

        var changed = isNew;

        if (request.HasSymbol && !string.IsNullOrWhiteSpace(normalizedSymbol))
            changed |= SetIfDifferent(entity, x => x.Symbol, (x, value) => x.Symbol = value, normalizedSymbol);

        if (request.HasCoinGeckoId)
            changed |= SetIfDifferent(entity, x => x.CoinGeckoId, (x, value) => x.CoinGeckoId = value, coinGeckoId);

        if (request.HasContractAddress)
            changed |= SetIfDifferent(entity, x => x.ContractAddress, (x, value) => x.ContractAddress = value, TrimOrNull(request.ContractAddress));

        if (request.HasName)
            changed |= SetIfDifferent(entity, x => x.Name, (x, value) => x.Name = value, TrimOrNull(request.Name));

        if (request.HasThumbUrl)
            changed |= SetIfDifferent(entity, x => x.ThumbUrl, (x, value) => x.ThumbUrl = value, TrimOrNull(request.ThumbUrl));

        if (request.HasLargeImageUrl)
            changed |= SetIfDifferent(entity, x => x.LargeImageUrl, (x, value) => x.LargeImageUrl = value, TrimOrNull(request.LargeImageUrl));

        if (request.HasMarketCapRank)
            changed |= SetIfDifferent(entity, x => x.MarketCapRank, (x, value) => x.MarketCapRank = value, request.MarketCapRank);

        if (request.HasIsMemeCoin)
            changed |= SetIfDifferent(entity, x => x.IsMemeCoin, (x, value) => x.IsMemeCoin = value, request.IsMemeCoin);

        if (request.HasPrimaryColor)
            changed |= SetIfDifferent(entity, x => x.PrimaryColor, (x, value) => x.PrimaryColor = value, TrimOrNull(request.PrimaryColor));

        if (request.HasSecondaryColor)
            changed |= SetIfDifferent(entity, x => x.SecondaryColor, (x, value) => x.SecondaryColor = value, TrimOrNull(request.SecondaryColor));

        if (request.HasVisualStyle)
            changed |= SetIfDifferent(entity, x => x.VisualStyle, (x, value) => x.VisualStyle = value, TrimOrNull(request.VisualStyle));

        if (request.HasTwitterHandle)
            changed |= SetIfDifferent(entity, x => x.TwitterHandle, (x, value) => x.TwitterHandle = value, NormalizeTwitterHandle(request.TwitterHandle));

        if (request.HasTelegramUrl)
            changed |= SetIfDifferent(entity, x => x.TelegramUrl, (x, value) => x.TelegramUrl = value, TrimOrNull(request.TelegramUrl));

        if (request.HasWebsiteUrl)
            changed |= SetIfDifferent(entity, x => x.WebsiteUrl, (x, value) => x.WebsiteUrl = value, TrimOrNull(request.WebsiteUrl));

        if (request.HasSource)
            changed |= SetIfDifferent(entity, x => x.Source, (x, value) => x.Source = value, TrimOrNull(request.Source));

        var lastCheckedUtc = request.HasLastCheckedUtc ? request.LastCheckedUtc ?? nowUtc : nowUtc;
        changed |= SetIfDifferent(entity, x => x.LastCheckedUtc, (x, value) => x.LastCheckedUtc = value, lastCheckedUtc);

        if (changed)
            entity.UpdatedAtUtc = nowUtc;

        await _db.SaveChangesAsync(ct);

        return Ok(new CoinSocialProfileUpsertResponse
        {
            Ok = true,
            Profile = ToDto(entity)
        });
    }

    [AllowAnonymous]
    [HttpPost("posts/register")]
    public async Task<ActionResult> RegisterPost([FromBody] RegisterSocialPostRequest request, CancellationToken ct)
    {
        var result = await _socialAutomationService.RegisterPostAsync(request, ct);

        if (result.NotFoundMatch)
            return NotFound(new { message = result.Error });

        if (!result.Success)
            return Conflict(new { message = result.Error });

        return Ok(new
        {
            id = result.Id,
            createdAtUtc = result.CreatedAtUtc
        });
    }

    [AllowAnonymous]
    [HttpPost("render-vs")]
    public async Task<IActionResult> RenderVs([FromBody] SocialVsRenderRequest request, CancellationToken ct)
    {
        try
        {
            var bytes = await _socialVsRenderService.RenderAsync(request, ct);
            return File(bytes, "image/png");
        }
        catch (ArgumentException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    [AllowAnonymous]
    [HttpGet("render-vs-test")]
    public async Task<IActionResult> RenderVsTest(
        [FromQuery(Name = "left")] string left,
        [FromQuery(Name = "right")] string right,
        [FromQuery] string? score,
        CancellationToken ct)
    {
        try
        {
            var bytes = await _socialVsRenderService.RenderAsync(new SocialVsRenderRequest
            {
                LeftSymbol = left,
                RightSymbol = right,
                Score = score
            }, ct);

            return File(bytes, "image/png");
        }
        catch (ArgumentException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    [AllowAnonymous]
    [HttpPost("compose-final")]
    public async Task<IActionResult> ComposeFinal([FromBody] SocialComposeFinalRequest request, CancellationToken ct)
    {
        try
        {
            var result = await _socialComposeFinalService.ComposeAsync(request, ct);
            Response.Headers["X-Generated-FileName"] = result.FileName;
            return File(result.Bytes, "image/png");
        }
        catch (ArgumentException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    [AllowAnonymous]
    [HttpPost("compose-final-test")]
    public async Task<IActionResult> ComposeFinalTest([FromBody] SocialComposeFinalRequest request, CancellationToken ct)
    {
        try
        {
            var result = await _socialComposeFinalService.ComposeAsync(request, ct);
            Response.Headers["X-Generated-FileName"] = result.FileName;
            return File(result.Bytes, "image/png");
        }
        catch (ArgumentException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    [AllowAnonymous]
    [HttpGet("/public/social/generated/{fileName}")]
    public IActionResult GetGeneratedSocialImage(string fileName)
    {
        if (!SocialGeneratedImageStorage.TryCreateGeneratedImagePath(_environment, fileName, out _, out var filePath, out var contentType))
            return NotFound();

        var exists = System.IO.File.Exists(filePath);
        _logger.LogInformation("Public generated image requested: {FileName} -> {FullPath} Exists={Exists}", fileName, filePath, exists);

        if (!exists)
            return NotFound();

        Response.Headers.CacheControl = "public,max-age=3600";
        return PhysicalFile(filePath, contentType);
    }

    private bool TryAuthorizeSocialWrite(out ActionResult error)
    {
        if (User.Identity?.IsAuthenticated == true)
        {
            error = Ok();
            return true;
        }

        var expectedKey = _configuration["SocialAutomation:ApiKey"];
        if (string.IsNullOrWhiteSpace(expectedKey))
        {
            error = Ok();
            return true;
        }

        if (!Request.Headers.TryGetValue("X-Social-Key", out var providedKey) ||
            !string.Equals(providedKey.ToString(), expectedKey, StringComparison.Ordinal))
        {
            error = Unauthorized(new { message = "Chave de automacao invalida. Informe X-Social-Key ou use JWT." });
            return false;
        }

        error = Ok();
        return true;
    }
    private static int CalculateDailyPoolStrength(
    int walletCountTeam,
    int totalWalletCount,
    decimal totalAmountTeam,
    decimal totalPoolAmount)
    {
        const decimal walletWeight = 0.5m;
        const decimal amountWeight = 0.5m;

        var walletShare = totalWalletCount > 0
            ? (decimal)walletCountTeam / totalWalletCount
            : 0m;

        var amountShare = totalPoolAmount > 0m
            ? totalAmountTeam / totalPoolAmount
            : 0m;

        var strength =
            (walletShare * walletWeight + amountShare * amountWeight) * 100m;

        return (int)Math.Clamp(
            Math.Round(strength, MidpointRounding.AwayFromZero),
            0m,
            100m);
    }

    private sealed class DailyHotMatchSideAggregate
    {
        public int MatchId { get; init; }

        public int TeamId { get; init; }

        public decimal TotalAmount { get; init; }

        public int BetCount { get; init; }

        public int WalletCount { get; init; }
    }
    private static CoinSocialProfileDto ToDto(CoinSocialProfile entity) => new()
    {
        Id = entity.Id,
        Symbol = entity.Symbol,
        CoinGeckoId = entity.CoinGeckoId,
        ContractAddress = entity.ContractAddress,
        Name = entity.Name,
        ThumbUrl = entity.ThumbUrl,
        LargeImageUrl = entity.LargeImageUrl,
        MarketCapRank = entity.MarketCapRank,
        IsMemeCoin = entity.IsMemeCoin,
        PrimaryColor = entity.PrimaryColor,
        SecondaryColor = entity.SecondaryColor,
        VisualStyle = entity.VisualStyle,
        TwitterHandle = entity.TwitterHandle,
        TelegramUrl = entity.TelegramUrl,
        WebsiteUrl = entity.WebsiteUrl,
        Source = entity.Source,
        LastCheckedUtc = entity.LastCheckedUtc,
        CreatedAtUtc = entity.CreatedAtUtc,
        UpdatedAtUtc = entity.UpdatedAtUtc
    };

    private static string NormalizeSymbol(string? symbol)
    {
        if (string.IsNullOrWhiteSpace(symbol))
            return string.Empty;

        return symbol.Trim()
            .ToUpperInvariant()
            .Replace("USDT", string.Empty, StringComparison.Ordinal);
    }

    private static string? NormalizeTwitterHandle(string? value)
    {
        var trimmed = TrimOrNull(value);
        if (trimmed is null)
            return null;

        return $"@{trimmed.TrimStart('@')}";
    }

    private static string? TrimOrNull(string? value)
        => string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    private static bool SetIfDifferent<T>(CoinSocialProfile entity, Func<CoinSocialProfile, T> getter, Action<CoinSocialProfile, T> setter, T value)
    {
        if (EqualityComparer<T>.Default.Equals(getter(entity), value))
            return false;

        setter(entity, value);
        return true;
    }
}
