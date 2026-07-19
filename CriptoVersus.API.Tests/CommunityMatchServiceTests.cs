using System.Net;
using System.Security.Claims;
using BLL.GameRules;
using CriptoVersus.API.Hubs;
using CriptoVersus.API.Services;
using DAL.NftFutebol;
using DTOs;
using EthicAI.EntityModel;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;

namespace CriptoVersus.API.Tests;

public sealed class CommunityMatchServiceTests
{
    private static readonly InMemoryDatabaseRoot SharedDatabaseRoot = new();

    [Fact]
    public async Task CreateAsync_WhenValidRequest_CreatesCommunityMatch()
    {
        using var db = CreateInMemoryDbContext();
        SeedAssets(db);
        var service = CreateService(db, captchaValidator: new AllowAllCaptchaValidator(), anonymousDailyLimit: 3);

        var result = await service.CreateAsync(
            new CommunityMatchCreateRequestDto
            {
                HomeSymbol = "BTC",
                AwaySymbol = "ETH",
                CaptchaToken = "captcha-token"
            },
            user: null,
            remoteIpAddress: "203.0.113.10",
            CancellationToken.None);

        Assert.Equal(HttpStatusCode.OK, result.StatusCode);
        Assert.True(result.Response?.Created);
        Assert.False(result.Response?.AlreadyExists);
        Assert.Equal("battleCreatedSuccessfully", result.Response?.MessageCode);

        var match = Assert.Single(db.Match.Where(m => m.Origin == MatchOrigin.Community));
        Assert.Equal(MatchStatus.Pending, match.Status);
        Assert.Equal(MatchOrigin.Community, match.Origin);
        Assert.NotNull(match.CommunityCreatedAt);
        Assert.NotNull(match.CommunityPairKey);
        Assert.Equal("1:2", match.CommunityPairKey);
    }

    [Fact]
    public async Task CreateAsync_WhenSameAssetSelected_ReturnsBadRequest()
    {
        using var db = CreateInMemoryDbContext();
        SeedAssets(db);
        var service = CreateService(db);

        var result = await service.CreateAsync(
            new CommunityMatchCreateRequestDto
            {
                HomeSymbol = "BTC",
                AwaySymbol = "BTC",
                CaptchaToken = "captcha-token"
            },
            user: null,
            remoteIpAddress: "203.0.113.11",
            CancellationToken.None);

        Assert.Equal(HttpStatusCode.BadRequest, result.StatusCode);
        Assert.Equal("sameAssetNotAllowed", result.MessageCode);
        Assert.Null(result.Response);
    }

    [Fact]
    public async Task CreateAsync_WhenSymbolDoesNotExist_ReturnsBadRequest()
    {
        using var db = CreateInMemoryDbContext();
        SeedAssets(db);
        var service = CreateService(db);

        var result = await service.CreateAsync(
            new CommunityMatchCreateRequestDto
            {
                HomeSymbol = "BTC",
                AwaySymbol = "DOGE",
                CaptchaToken = "captcha-token"
            },
            user: null,
            remoteIpAddress: "203.0.113.12",
            CancellationToken.None);

        Assert.Equal(HttpStatusCode.BadRequest, result.StatusCode);
        Assert.Equal("invalidAsset", result.MessageCode);
        Assert.Null(result.Response);
    }

    [Fact]
    public async Task CreateAsync_WhenSymbolIsStale_ReturnsBadRequest()
    {
        using var db = CreateInMemoryDbContext();
        SeedAssets(db, staleEth: true);
        var service = CreateService(db);

        var result = await service.CreateAsync(
            new CommunityMatchCreateRequestDto
            {
                HomeSymbol = "BTC",
                AwaySymbol = "ETH",
                CaptchaToken = "captcha-token"
            },
            user: null,
            remoteIpAddress: "203.0.113.13",
            CancellationToken.None);

        Assert.Equal(HttpStatusCode.BadRequest, result.StatusCode);
        Assert.Equal("assetNotAvailable", result.MessageCode);
        Assert.Null(result.Response);
    }

    [Theory]
    [InlineData("XEC", "ZBT")]
    [InlineData("XECUSDT", "ZBTUSDT")]
    [InlineData("XEC", "ZBTUSDT")]
    [InlineData("XECUSDT", "ZBT")]
    public async Task CreateAsync_WhenSymbolsNormalizeWithOrWithoutUsdt_CreatesMatch(string homeSymbol, string awaySymbol)
    {
        using var db = CreateInMemoryDbContext();
        SeedSpotAssets(db);
        var service = CreateService(db, anonymousDailyLimit: 3);

        var result = await service.CreateAsync(
            new CommunityMatchCreateRequestDto
            {
                HomeSymbol = homeSymbol,
                AwaySymbol = awaySymbol,
                CaptchaToken = "captcha-token"
            },
            user: null,
            remoteIpAddress: "203.0.113.13",
            CancellationToken.None);

        Assert.Equal(HttpStatusCode.OK, result.StatusCode);
        Assert.True(result.Response?.Created);
        Assert.Equal("battleCreatedSuccessfully", result.Response?.MessageCode);
    }

    [Fact]
    public async Task CreateAsync_WhenSpotAssetIsFreshAndFuturesAreUnavailable_StillCreatesMatch()
    {
        using var db = CreateInMemoryDbContext();
        SeedSpotAssets(db);
        var service = CreateService(db, anonymousDailyLimit: 3);

        var result = await service.CreateAsync(
            new CommunityMatchCreateRequestDto
            {
                HomeSymbol = "XEC",
                AwaySymbol = "ZBT",
                CaptchaToken = "captcha-token"
            },
            user: null,
            remoteIpAddress: "203.0.113.14",
            CancellationToken.None);

        Assert.Equal(HttpStatusCode.OK, result.StatusCode);
        Assert.True(result.Response?.Created);
        Assert.Equal("battleCreatedSuccessfully", result.Response?.MessageCode);
    }

    [Fact]
    public async Task CreateAsync_WhenSpotPairIsUnsupported_ReturnsAssetNotAvailable()
    {
        using var db = CreateInMemoryDbContext();
        SeedUnsupportedSpotAsset(db);
        var service = CreateService(db, anonymousDailyLimit: 3);

        var result = await service.CreateAsync(
            new CommunityMatchCreateRequestDto
            {
                HomeSymbol = "XECBTC",
                AwaySymbol = "ZBT",
                CaptchaToken = "captcha-token"
            },
            user: null,
            remoteIpAddress: "203.0.113.15",
            CancellationToken.None);

        Assert.Equal(HttpStatusCode.BadRequest, result.StatusCode);
        Assert.Equal("assetNotAvailable", result.MessageCode);
        Assert.Contains("spotPairUnsupported", result.Detail ?? string.Empty);
    }

    [Fact]
    public async Task CreateAsync_WhenSpotAssetIsStale_ReturnsAssetNotAvailable()
    {
        using var db = CreateInMemoryDbContext();
        SeedSpotAssets(db, staleXec: true);
        var service = CreateService(db, freshnessMinutes: 10);

        var result = await service.CreateAsync(
            new CommunityMatchCreateRequestDto
            {
                HomeSymbol = "XEC",
                AwaySymbol = "ZBT",
                CaptchaToken = "captcha-token"
            },
            user: null,
            remoteIpAddress: "203.0.113.16",
            CancellationToken.None);

        Assert.Equal(HttpStatusCode.BadRequest, result.StatusCode);
        Assert.Equal("assetNotAvailable", result.MessageCode);
        Assert.Contains("assetPriceStale", result.Detail ?? string.Empty);
    }

    [Fact]
    public async Task CreateAsync_WhenAssetDoesNotExist_ReturnsInvalidAsset()
    {
        using var db = CreateInMemoryDbContext();
        SeedSpotAssets(db);
        var service = CreateService(db);

        var result = await service.CreateAsync(
            new CommunityMatchCreateRequestDto
            {
                HomeSymbol = "BTC",
                AwaySymbol = "DOGE",
                CaptchaToken = "captcha-token"
            },
            user: null,
            remoteIpAddress: "203.0.113.17",
            CancellationToken.None);

        Assert.Equal(HttpStatusCode.BadRequest, result.StatusCode);
        Assert.Equal("invalidAsset", result.MessageCode);
        Assert.Contains("assetNotFound", result.Detail ?? string.Empty);
    }

    [Fact]
    public async Task CreateAsync_WhenCaptchaIsInvalid_ReturnsForbidden()
    {
        using var db = CreateInMemoryDbContext();
        SeedAssets(db);
        var service = CreateService(db, captchaValidator: new InvalidCaptchaValidator());

        var result = await service.CreateAsync(
            new CommunityMatchCreateRequestDto
            {
                HomeSymbol = "BTC",
                AwaySymbol = "ETH",
                CaptchaToken = "bad-token"
            },
            user: null,
            remoteIpAddress: "203.0.113.14",
            CancellationToken.None);

        Assert.Equal(HttpStatusCode.Forbidden, result.StatusCode);
        Assert.Equal("invalidCaptcha", result.MessageCode);
        Assert.Null(result.Response);
    }

    [Fact]
    public async Task CreateAsync_WhenTurnstileUnavailable_ReturnsServiceUnavailable()
    {
        using var db = CreateInMemoryDbContext();
        SeedAssets(db);
        var service = CreateService(db, captchaValidator: new UnavailableCaptchaValidator());

        var result = await service.CreateAsync(
            new CommunityMatchCreateRequestDto
            {
                HomeSymbol = "BTC",
                AwaySymbol = "ETH",
                CaptchaToken = "captcha-token"
            },
            user: null,
            remoteIpAddress: "203.0.113.15",
            CancellationToken.None);

        Assert.Equal(HttpStatusCode.ServiceUnavailable, result.StatusCode);
        Assert.Equal("communityMatchesUnavailable", result.MessageCode);
        Assert.True(result.IsUnavailable);
        Assert.Null(result.Response);
    }

    [Fact]
    public async Task CreateAsync_WhenActiveCommunityMatchExists_ReusesExistingBattle()
    {
        using var db = CreateInMemoryDbContext();
        SeedAssets(db);
        SeedCommunityMatch(db, matchId: 42, status: MatchStatus.Pending, pairKey: "1:2");
        var service = CreateService(db);

        var result = await service.CreateAsync(
            new CommunityMatchCreateRequestDto
            {
                HomeSymbol = "BTC",
                AwaySymbol = "ETH",
                CaptchaToken = "captcha-token"
            },
            user: null,
            remoteIpAddress: "203.0.113.16",
            CancellationToken.None);

        Assert.Equal(HttpStatusCode.OK, result.StatusCode);
        Assert.True(result.Response?.AlreadyExists);
        Assert.False(result.Response?.Created);
        Assert.Equal(42, result.Response?.MatchId);
        Assert.Equal("battleAlreadyExists", result.Response?.MessageCode);
    }

    [Fact]
    public async Task CreateAsync_WhenSymbolsAreReversed_ReusesSamePairKey()
    {
        using var db = CreateInMemoryDbContext();
        SeedAssets(db);
        var service = CreateService(db);

        var first = await service.CreateAsync(
            new CommunityMatchCreateRequestDto
            {
                HomeSymbol = "BTC",
                AwaySymbol = "ETH",
                CaptchaToken = "captcha-token"
            },
            user: null,
            remoteIpAddress: "203.0.113.17",
            CancellationToken.None);

        var second = await service.CreateAsync(
            new CommunityMatchCreateRequestDto
            {
                HomeSymbol = "ETH",
                AwaySymbol = "BTC",
                CaptchaToken = "captcha-token"
            },
            user: null,
            remoteIpAddress: "203.0.113.27",
            CancellationToken.None);

        Assert.True(first.Response?.Created);
        Assert.False(second.Response?.Created);
        Assert.True(second.Response?.AlreadyExists);
        Assert.Equal(first.Response?.MatchId, second.Response?.MatchId);
        Assert.Equal("1:2", db.Match.Single(m => m.MatchId == first.Response!.MatchId).CommunityPairKey);
    }

    [Fact]
    public async Task CreateAsync_WhenRateLimited_ReturnsTooManyRequestsAndRetryAfter()
    {
        using var db = CreateInMemoryDbContext();
        SeedAssets(db);
        SeedCommunityMatch(db, matchId: 41, status: MatchStatus.Pending, pairKey: "1:2", createdAtUtc: DateTimeOffset.UtcNow.AddMinutes(-2), userId: null, creatorIpHash: HashCreatorIpForTest("203.0.113.18", "unit-test-salt"));
        var service = CreateService(db, anonymousDailyLimit: 1);

        var result = await service.CreateAsync(
            new CommunityMatchCreateRequestDto
            {
                HomeSymbol = "BTC",
                AwaySymbol = "ETH",
                CaptchaToken = "captcha-token"
            },
            user: null,
            remoteIpAddress: "203.0.113.18",
            CancellationToken.None);

        Assert.Equal(HttpStatusCode.TooManyRequests, result.StatusCode);
        Assert.Equal("tooManyRequests", result.MessageCode);
        Assert.True(result.RetryAfterSeconds is > 0);
    }

    [Fact]
    public async Task CreateAsync_WhenFeatureFlagDisabled_ReturnsForbidden()
    {
        using var db = CreateInMemoryDbContext();
        SeedAssets(db);
        var service = CreateService(db, enabled: false);

        var result = await service.CreateAsync(
            new CommunityMatchCreateRequestDto
            {
                HomeSymbol = "BTC",
                AwaySymbol = "ETH",
                CaptchaToken = "captcha-token"
            },
            user: null,
            remoteIpAddress: "203.0.113.19",
            CancellationToken.None);

        Assert.Equal(HttpStatusCode.Forbidden, result.StatusCode);
        Assert.Equal("communityMatchesUnavailable", result.MessageCode);
        Assert.Null(result.Response);
    }

    [Fact]
    public async Task CreateAsync_WhenAuthenticatedUserCreatesMatch_UsesCommunityOrigin()
    {
        using var db = CreateInMemoryDbContext();
        SeedAssets(db);
        var service = CreateService(db);
        var user = BuildUser(17);

        var result = await service.CreateAsync(
            new CommunityMatchCreateRequestDto
            {
                HomeSymbol = "BTC",
                AwaySymbol = "ETH",
                CaptchaToken = "captcha-token"
            },
            user,
            remoteIpAddress: "203.0.113.20",
            CancellationToken.None);

        Assert.Equal(HttpStatusCode.OK, result.StatusCode);
        var match = Assert.Single(db.Match.Where(m => m.Origin == MatchOrigin.Community));
        Assert.Equal(MatchOrigin.Community, match.Origin);
        Assert.Equal(17, match.CreatedByUserId);
    }

    [Fact]
    public async Task CreateAsync_WhenTwoRequestsArriveTogether_CreatesOnlyOneMatch()
    {
        const string databaseName = "community-match-concurrency-test";
        using var setup = CreateInMemoryDbContext(databaseName, SharedDatabaseRoot);
        SeedAssets(setup);

        using var db1 = CreateInMemoryDbContext(databaseName, SharedDatabaseRoot);
        using var db2 = CreateInMemoryDbContext(databaseName, SharedDatabaseRoot);
        var captcha = new BarrierCaptchaValidator(2);
        var service1 = CreateService(db1, captchaValidator: captcha);
        var service2 = CreateService(db2, captchaValidator: captcha);
        var request = new CommunityMatchCreateRequestDto
        {
            HomeSymbol = "BTC",
            AwaySymbol = "ETH",
            CaptchaToken = "captcha-token"
        };

        var task1 = service1.CreateAsync(request, null, "203.0.113.21", CancellationToken.None);
        var task2 = service2.CreateAsync(request, null, "203.0.113.21", CancellationToken.None);
        var results = await Task.WhenAll(task1, task2);

        Assert.Contains(results, r => r.Response?.Created == true);
        Assert.Contains(results, r => r.Response?.AlreadyExists == true);
        Assert.Single(setup.Match.Where(m => m.Origin == MatchOrigin.Community));
    }

    private static CommunityMatchService CreateService(
        EthicAIDbContext db,
        ICaptchaValidator? captchaValidator = null,
        bool enabled = true,
        int anonymousDailyLimit = 10,
        int authenticatedDailyLimit = 10,
        int cooldownMinutes = 15,
        int startDelayMinutes = 10,
        int bettingCloseOffsetMinutes = 2,
        int freshnessMinutes = 15,
        string salt = "unit-test-salt",
        IReadOnlyList<string>? activeStatuses = null,
        IConfiguration? configuration = null)
    {
        configuration ??= new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["CriptoVersus:Match:ForbiddenStablecoins:0"] = "USDT",
                ["CommunityMatch:CreatorIpSalt"] = salt
            })
            .Build();

        return new CommunityMatchService(
            db,
            Options.Create(new CommunityMatchOptions
            {
                Enabled = enabled,
                CooldownMinutes = cooldownMinutes,
                AnonymousDailyLimit = anonymousDailyLimit,
                AuthenticatedDailyLimit = authenticatedDailyLimit,
                StartDelayMinutes = startDelayMinutes,
                BettingCloseOffsetMinutes = bettingCloseOffsetMinutes,
                MarketDataFreshnessMinutes = freshnessMinutes,
                CreatorIpSalt = salt,
                ActiveDuplicateStatuses = activeStatuses?.ToList() ?? ["Pending", "Ongoing"]
            }),
            captchaValidator ?? new AllowAllCaptchaValidator(),
            configuration,
            new NullDashboardHubContext(),
            NullLogger<CommunityMatchService>.Instance);
    }

    private static EthicAIDbContext CreateInMemoryDbContext(string? databaseName = null, InMemoryDatabaseRoot? root = null)
    {
        var builder = new DbContextOptionsBuilder<EthicAIDbContext>();
        if (root is null)
            builder.UseInMemoryDatabase(databaseName ?? Guid.NewGuid().ToString("N"));
        else
            builder.UseInMemoryDatabase(databaseName ?? Guid.NewGuid().ToString("N"), root);

        var db = new EthicAIDbContext(builder.Options);
        db.Database.EnsureCreated();
        return db;
    }

    private static void SeedAssets(EthicAIDbContext db, bool staleEth = false)
    {
        var now = DateTime.UtcNow;
        db.Currency.AddRange(
            new Currency
            {
                CurrencyId = 1,
                Name = "Bitcoin",
                Symbol = "BTCUSDT",
                PercentageChange = 5.1,
                QuoteVolume = 1000m,
                TradesCount = 100,
                LastUpdated = now
            },
            new Currency
            {
                CurrencyId = 2,
                Name = "Ethereum",
                Symbol = "ETHUSDT",
                PercentageChange = 4.2,
                QuoteVolume = 900m,
                TradesCount = 90,
                LastUpdated = staleEth ? now.AddMinutes(-60) : now
            });

        db.Team.AddRange(
            new Team { TeamId = 1, CurrencyId = 1 },
            new Team { TeamId = 2, CurrencyId = 2 });

        db.SaveChanges();
    }

    private static void SeedSpotAssets(EthicAIDbContext db, bool includeXec = true, bool staleXec = false)
    {
        var now = DateTime.UtcNow;
        if (includeXec)
        {
            db.Currency.Add(new Currency
            {
                CurrencyId = 3,
                Name = "XEC",
                Symbol = "XECUSDT",
                PercentageChange = 8.1,
                QuoteVolume = 1500m,
                TradesCount = 120,
                LastUpdated = staleXec ? now.AddMinutes(-60) : now
            });
        }

        db.Currency.Add(new Currency
        {
            CurrencyId = 4,
            Name = "ZBT",
            Symbol = "ZBTUSDT",
            PercentageChange = 6.4,
            QuoteVolume = 1800m,
            TradesCount = 130,
            LastUpdated = now
        });

        db.Team.AddRange(
            new Team { TeamId = 3, CurrencyId = includeXec ? 3 : 4 },
            new Team { TeamId = 4, CurrencyId = 4 });

        db.SaveChanges();
    }

    private static void SeedUnsupportedSpotAsset(EthicAIDbContext db)
    {
        var now = DateTime.UtcNow;
        db.Currency.AddRange(
            new Currency
            {
                CurrencyId = 5,
                Name = "XECBTC",
                Symbol = "XECBTC",
                PercentageChange = 1.2,
                QuoteVolume = 100m,
                TradesCount = 10,
                LastUpdated = now
            },
            new Currency
            {
                CurrencyId = 6,
                Name = "ZBT",
                Symbol = "ZBTUSDT",
                PercentageChange = 6.4,
                QuoteVolume = 1800m,
                TradesCount = 130,
                LastUpdated = now
            });

        db.Team.AddRange(
            new Team { TeamId = 5, CurrencyId = 5 },
            new Team { TeamId = 6, CurrencyId = 6 });

        db.SaveChanges();
    }

    private static void SeedCommunityMatch(
        EthicAIDbContext db,
        int matchId,
        MatchStatus status,
        string pairKey,
        DateTimeOffset? createdAtUtc = null,
        int? userId = null,
        string? creatorIpHash = null)
    {
        db.Match.Add(new Match
        {
            MatchId = matchId,
            TeamAId = 1,
            TeamBId = 2,
            Status = status,
            Origin = MatchOrigin.Community,
            CommunityCreatedAt = createdAtUtc ?? DateTimeOffset.UtcNow.AddMinutes(-5),
            CreatedByUserId = userId,
            CreatorIpHash = creatorIpHash,
            CommunityPairKey = pairKey,
            StartTime = DateTime.UtcNow.AddMinutes(5),
            BettingCloseTime = DateTimeOffset.UtcNow.AddMinutes(3),
            ScoreA = 0,
            ScoreB = 0
        });

        db.SaveChanges();
    }

    private static ClaimsPrincipal BuildUser(int userId)
        => new(new ClaimsIdentity(new[]
        {
            new Claim(ClaimTypes.NameIdentifier, userId.ToString())
        }, authenticationType: "test"));

    private static string HashCreatorIpForTest(string remoteIpAddress, string salt)
    {
        using var hmac = new System.Security.Cryptography.HMACSHA256(System.Text.Encoding.UTF8.GetBytes(salt));
        return Convert.ToHexString(hmac.ComputeHash(System.Text.Encoding.UTF8.GetBytes(remoteIpAddress))).ToLowerInvariant();
    }

    private sealed class AllowAllCaptchaValidator : ICaptchaValidator
    {
        public Task<CaptchaValidationResult> ValidateAsync(string token, string? remoteIpAddress, CancellationToken ct = default)
            => Task.FromResult(CaptchaValidationResult.Success());
    }

    private sealed class InvalidCaptchaValidator : ICaptchaValidator
    {
        public Task<CaptchaValidationResult> ValidateAsync(string token, string? remoteIpAddress, CancellationToken ct = default)
            => Task.FromResult(CaptchaValidationResult.Invalid("invalidCaptcha"));
    }

    private sealed class UnavailableCaptchaValidator : ICaptchaValidator
    {
        public Task<CaptchaValidationResult> ValidateAsync(string token, string? remoteIpAddress, CancellationToken ct = default)
            => Task.FromResult(CaptchaValidationResult.Unavailable("communityMatchesUnavailable", "captcha-unavailable"));
    }

    private sealed class BarrierCaptchaValidator : ICaptchaValidator
    {
        private readonly int _parties;
        private int _count;
        private readonly TaskCompletionSource _gate = new(TaskCreationOptions.RunContinuationsAsynchronously);

        public BarrierCaptchaValidator(int parties)
        {
            _parties = parties;
        }

        public async Task<CaptchaValidationResult> ValidateAsync(string token, string? remoteIpAddress, CancellationToken ct = default)
        {
            if (Interlocked.Increment(ref _count) >= _parties)
                _gate.TrySetResult();

            await _gate.Task.WaitAsync(ct);
            return CaptchaValidationResult.Success();
        }
    }

    private sealed class NullDashboardHubContext : IHubContext<DashboardHub>
    {
        public IHubClients Clients { get; } = new NullHubClients();
        public IGroupManager Groups { get; } = new NullGroupManager();
    }

    private sealed class NullHubClients : IHubClients
    {
        private static readonly IClientProxy Proxy = new NullClientProxy();

        public IClientProxy All => Proxy;
        public IClientProxy AllExcept(IReadOnlyList<string> excludedConnectionIds) => Proxy;
        public IClientProxy Client(string connectionId) => Proxy;
        public IClientProxy Clients(IReadOnlyList<string> connectionIds) => Proxy;
        public IClientProxy Group(string groupName) => Proxy;
        public IClientProxy GroupExcept(string groupName, IReadOnlyList<string> excludedConnectionIds) => Proxy;
        public IClientProxy Groups(IReadOnlyList<string> groupNames) => Proxy;
        public IClientProxy User(string userId) => Proxy;
        public IClientProxy Users(IReadOnlyList<string> userIds) => Proxy;
    }

    private sealed class NullClientProxy : IClientProxy
    {
        public Task SendCoreAsync(string method, object?[] args, CancellationToken cancellationToken = default)
            => Task.CompletedTask;
    }

    private sealed class NullGroupManager : IGroupManager
    {
        public Task AddToGroupAsync(string connectionId, string groupName, CancellationToken cancellationToken = default)
            => Task.CompletedTask;

        public Task RemoveFromGroupAsync(string connectionId, string groupName, CancellationToken cancellationToken = default)
            => Task.CompletedTask;
    }
}

