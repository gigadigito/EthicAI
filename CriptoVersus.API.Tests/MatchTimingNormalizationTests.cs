using BLL.ArenaSentiment;
using CriptoVersus.API.Controllers;
using CriptoVersus.API.Hubs;
using CriptoVersus.API.Services;
using DAL.NftFutebol;
using DTOs;
using EthicAI.EntityModel;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;

namespace CriptoVersus.API.Tests;

public sealed class MatchTimingNormalizationTests
{
    [Fact]
    public async Task GetById_WhenOngoingMatchIsPastDuration_MarksItAsFinishedForUi()
    {
        using var db = CreateDbContext();
        SeedMatch(
            db,
            status: MatchStatus.Ongoing,
            startTimeUtc: DateTime.UtcNow.AddHours(-6),
            endTimeUtc: null);

        var controller = CreateController(db);

        var result = await controller.GetById(1, includeParticipants: false, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var dto = Assert.IsType<MatchDto>(ok.Value);

        Assert.Equal("Ongoing", dto.Status);
        Assert.True(dto.IsFinished);
        Assert.Equal(0, dto.RemainingMinutes);
        Assert.Equal(90, dto.ElapsedMinutes);
    }

    [Fact]
    public async Task GetById_WhenMatchIsFreshOngoing_KeepsItLive()
    {
        using var db = CreateDbContext();
        SeedMatch(
            db,
            status: MatchStatus.Ongoing,
            startTimeUtc: DateTime.UtcNow.AddMinutes(-25),
            endTimeUtc: null);

        var controller = CreateController(db);

        var result = await controller.GetById(1, includeParticipants: false, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var dto = Assert.IsType<MatchDto>(ok.Value);

        Assert.False(dto.IsFinished);
        Assert.InRange(dto.ElapsedMinutes, 24, 26);
        Assert.InRange(dto.RemainingMinutes, 64, 66);
    }

    [Fact]
    public async Task GetById_WhenScoreStateExists_ReturnsScoreVersionAndUpdatedAtUtc()
    {
        using var db = CreateDbContext();
        SeedMatch(
            db,
            status: MatchStatus.Ongoing,
            startTimeUtc: DateTime.UtcNow.AddMinutes(-25),
            endTimeUtc: null);

        db.MatchScoreState.Add(new MatchScoreState
        {
            MatchId = 1,
            CreatedAtUtc = new DateTime(2026, 06, 02, 15, 0, 0, DateTimeKind.Utc),
            LastEventSequence = 17,
            UpdatedAtUtc = new DateTime(2026, 06, 02, 15, 42, 0, DateTimeKind.Utc)
        });
        db.SaveChanges();

        var controller = CreateController(db);

        var result = await controller.GetById(1, includeParticipants: false, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var dto = Assert.IsType<MatchDto>(ok.Value);

        Assert.Equal(17, dto.ScoreVersion);
        Assert.Equal(new DateTime(2026, 06, 02, 15, 42, 0, DateTimeKind.Utc), dto.ScoreUpdatedAtUtc);
    }
    private static MatchesController CreateController(EthicAIDbContext db)
    {
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["CriptoVersusWorker:MatchDurationMinutes"] = "90"
            })
            .Build();

        return new MatchesController(
            db,
            new NullDashboardHubContext(),
            new StubMatchScoreRebuildService(),
            configuration,
            new StubArenaSentimentService(),
            new StubAudioAssetResolverService(),
            new StubAudioGenerationQueueService(),
            Options.Create(new ProceduralAudioFeatureOptions()),
            NullLogger<MatchesController>.Instance);
    }

    private static EthicAIDbContext CreateDbContext()
    {
        var options = new DbContextOptionsBuilder<EthicAIDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString("N"))
            .Options;

        return new EthicAIDbContext(options);
    }

    private static void SeedMatch(EthicAIDbContext db, MatchStatus status, DateTime startTimeUtc, DateTime? endTimeUtc)
    {
        db.Currency.AddRange(
            new Currency
            {
                CurrencyId = 100,
                Name = "Bitcoin",
                Symbol = "BTCUSDT",
                PercentageChange = 4.2,
                QuoteVolume = 1000m,
                TradesCount = 100,
                LastUpdated = DateTime.UtcNow
            },
            new Currency
            {
                CurrencyId = 200,
                Name = "Ethereum",
                Symbol = "ETHUSDT",
                PercentageChange = 3.1,
                QuoteVolume = 900m,
                TradesCount = 90,
                LastUpdated = DateTime.UtcNow
            });

        db.Team.AddRange(
            new Team { TeamId = 10, CurrencyId = 100 },
            new Team { TeamId = 20, CurrencyId = 200 });

        db.Match.Add(new Match
        {
            MatchId = 1,
            TeamAId = 10,
            TeamBId = 20,
            ScoreA = 2,
            ScoreB = 1,
            Status = status,
            StartTime = startTimeUtc,
            EndTime = endTimeUtc
        });

        db.SaveChanges();
    }

    private sealed class StubMatchScoreRebuildService : global::CriptoVersus.API.Services.IMatchScoreRebuildService
    {
        public Task<global::CriptoVersus.API.Services.MatchScoreRebuildResult> RebuildAsync(int matchId, CancellationToken ct)
            => throw new NotSupportedException();
    }

    private sealed class StubArenaSentimentService : global::BLL.ArenaSentiment.IArenaSentimentService
    {
        public Task<global::BLL.ArenaSentiment.ArenaPressureGoalResult> CalculateArenaPressureGoalAsync(int matchId, CancellationToken ct = default)
            => throw new NotSupportedException();

        public Task<ArenaSentimentDto> GetArenaSentimentAsync(string symbol, CancellationToken ct = default)
            => throw new NotSupportedException();

        public Task<ArenaSentimentPairDto> GetArenaSentimentForMatchAsync(string homeSymbol, string awaySymbol, CancellationToken ct = default)
            => throw new NotSupportedException();
    }

    private sealed class StubAudioAssetResolverService : IAudioAssetResolverService
    {
        public Task<AudioAssetResolveResult?> ResolveAsync(AudioResolveRequest request, CancellationToken ct = default)
            => Task.FromResult<AudioAssetResolveResult?>(null);

        public Task<AudioResolveDiagnosticResult> DiagnoseAsync(AudioResolveRequest request, bool incrementUsage, CancellationToken ct = default)
            => throw new NotSupportedException();
    }

    private sealed class StubAudioGenerationQueueService : IAudioGenerationQueueService
    {
        public Task<AudioQueueEnqueueResult> EnqueueIfMissingAsync(AudioResolveRequest request, CancellationToken ct = default)
            => Task.FromResult(new AudioQueueEnqueueResult(false, false, "skipped", "test"));

        public Task<IReadOnlyList<AudioGenerationJobDto>> LeaseJobsAsync(AudioGenerationJobLeaseRequest request, CancellationToken ct = default)
            => throw new NotSupportedException();

        public Task<AudioAsset> CompleteJobAsync(long id, AudioGenerationCompleteRequest request, IFormFile audioFile, CancellationToken ct = default)
            => throw new NotSupportedException();

        public Task<bool> FailJobAsync(long id, AudioGenerationFailRequest request, CancellationToken ct = default)
            => throw new NotSupportedException();

        public Task<AudioAssetTestGenerateResponseDto> EnqueueManualTestAsync(AudioAssetTestGenerateRequestDto request, CancellationToken ct = default)
            => throw new NotSupportedException();

        public Task<AudioAssetTestStatusResponseDto?> GetJobStatusAsync(long id, CancellationToken ct = default)
            => throw new NotSupportedException();
    }

    private sealed class NullDashboardHubContext : IHubContext<global::CriptoVersus.API.Hubs.DashboardHub>
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

