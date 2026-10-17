using CriptoVersus.API.Services;
using DAL.NftFutebol;
using DTOs;
using Microsoft.Extensions.Options;
using static CriptoVersus.API.Tests.PriceCrossoverTestHelpers;

namespace CriptoVersus.API.Tests;

public sealed class PriceCrossoverSocialServiceTests
{
    [Fact]
    public async Task GetByMatchId_ReturnsAnalysis_WithOfficialResultPreserved()
    {
        using var db = CreateDbContext();
        SeedMatch(db, 1, scoreA: 3, scoreB: 1);

        var service = CreateSocialService(db);
        var result = await service.GetByMatchIdAsync(1, "pt-BR", true, default);

        Assert.NotNull(result);
        Assert.Equal(1, result!.MatchId);
        Assert.Equal(3, result.Official.ScoreA);
        Assert.Equal(1, result.Official.ScoreB);
        Assert.Equal("TIME_LIMIT", result.Official.EndReasonCode);
        Assert.NotNull(result.Narrative);
        Assert.True(result.CanPost);
        Assert.Null(result.SkipReason);
    }

    [Fact]
    public async Task GetByMatchId_UnknownMatch_ReturnsNull()
    {
        using var db = CreateDbContext();

        var service = CreateSocialService(db);
        var result = await service.GetByMatchIdAsync(999, "pt-BR", true, default);

        Assert.Null(result);
    }

    [Fact]
    public async Task OngoingMatch_IsNotEligible()
    {
        using var db = CreateDbContext();
        SeedMatch(db, 1, status: MatchStatus.Ongoing, endTimeUtc: null);

        var service = CreateSocialService(db);
        var result = await service.GetByMatchIdAsync(1, "pt-BR", false, default);

        Assert.NotNull(result);
        Assert.False(result!.CanPost);
        Assert.Equal("match_not_completed", result.SkipReason);
    }

    [Fact]
    public async Task IncompleteHistory_BlocksPublication()
    {
        using var db = CreateDbContext();
        SeedMatch(
            db,
            1,
            pricesA: [1.00m],
            pricesB: [1.00m]);

        var service = CreateSocialService(db);
        var result = await service.GetByMatchIdAsync(1, "pt-BR", false, default);

        Assert.NotNull(result);
        Assert.False(result!.CanPost);
        Assert.Equal("insufficient_data_quality", result.SkipReason);
        Assert.False(result.DataQuality.IsSufficient);
    }

    [Fact]
    public async Task Series_Optional_ReturnedOnlyWhenRequested()
    {
        using var db = CreateDbContext();
        SeedMatch(db, 1);

        var service = CreateSocialService(db);

        var withSeries = await service.GetByMatchIdAsync(1, "pt-BR", true, default);
        var withoutSeries = await service.GetByMatchIdAsync(1, "pt-BR", false, default);

        Assert.NotEmpty(withSeries!.Series);
        Assert.Empty(withoutSeries!.Series);
        // Metadados da serie continuam presentes mesmo sem os pontos.
        Assert.True(withoutSeries.SeriesInfo.CompletePointCount > 0);
    }

    [Fact]
    public async Task ChartDivergence_ReportsScreenVersusApi()
    {
        using var db = CreateDbContext();
        SeedMatch(db, 1);

        var service = CreateSocialService(db);
        var result = await service.GetByMatchIdAsync(1, "pt-BR", false, default);

        Assert.NotNull(result);
        Assert.Equal("timestamp", result!.ChartDivergence.ApiPairingMode);
        Assert.Equal("index", result.ChartDivergence.ScreenPairingMode);
        Assert.NotNull(result.ChartDivergence.Differences);
    }

    [Fact]
    public async Task Winner_IsNeverInferredFromPerformance()
    {
        using var db = CreateDbContext();

        // A valoriza mais, mas B vence o placar oficial.
        var match = SeedMatch(
            db,
            1,
            scoreA: 0,
            scoreB: 3,
            pricesA: BuildPrices(30, 1.00m, 0.01m),
            pricesB: BuildPrices(30, 1.00m, -0.01m));

        var service = CreateSocialService(db);
        var result = await service.GetByMatchIdAsync(1, "pt-BR", false, default);

        Assert.NotNull(result);
        Assert.Equal(0, result!.Official.ScoreA);
        Assert.Equal(3, result.Official.ScoreB);
        Assert.Equal(match.TeamBId, result.Official.WinnerTeamId);
        Assert.True(result.Official.WinnerDiffersFromBestPerformance);
    }

    [Fact]
    public async Task Deterministic_SameDataProducesSameNumbers()
    {
        using var db = CreateDbContext();
        SeedMatch(db, 1);

        var service = CreateSocialService(db);

        var first = await service.GetByMatchIdAsync(1, "pt-BR", true, default);
        var second = await service.GetByMatchIdAsync(1, "pt-BR", true, default);

        Assert.Equal(first!.InterestScore, second!.InterestScore);
        Assert.Equal(first.Comparative.TotalCrossovers, second.Comparative.TotalCrossovers);
        Assert.Equal(first.AssetA.PerformancePercent, second.AssetA.PerformancePercent);
        Assert.Equal(first.Series.Count, second.Series.Count);
        Assert.Equal(first.ChartDivergence.ApiCrossoverCount, second.ChartDivergence.ApiCrossoverCount);
    }

    [Fact]
    public async Task PublicUrl_IsFlaggedUnavailable()
    {
        using var db = CreateDbContext();
        SeedMatch(db, 1);

        var service = CreateSocialService(db);
        var result = await service.GetByMatchIdAsync(1, "pt-BR", false, default);

        Assert.NotNull(result);
        Assert.Null(result!.PublicUrl);
        Assert.False(result.PublicUrlAvailable);
    }

    [Fact]
    public async Task AlreadyPublished_BlocksPosting()
    {
        using var db = CreateDbContext();
        SeedMatch(db, 1);

        var publication = new PriceCrossoverPublicationService(db, Options.Create(new PriceCrossoverOptions()));
        await publication.ReserveAsync(1, new PriceCrossoverReserveRequest(), default);
        await publication.ConfirmAsync(1, new PriceCrossoverConfirmRequest
        {
            Outcome = "posted",
            ExternalPostId = "p-1"
        }, default);

        var service = CreateSocialService(db);
        var result = await service.GetByMatchIdAsync(1, "pt-BR", false, default);

        Assert.False(result!.CanPost);
        Assert.Equal("already_published", result.SkipReason);
        Assert.True(result.AlreadyPublished);
    }

    [Fact]
    public async Task ReservedByOther_BlocksPosting()
    {
        using var db = CreateDbContext();
        SeedMatch(db, 1);

        var publication = new PriceCrossoverPublicationService(db, Options.Create(new PriceCrossoverOptions()));
        await publication.ReserveAsync(1, new PriceCrossoverReserveRequest(), default);

        var service = CreateSocialService(db);
        var result = await service.GetByMatchIdAsync(1, "pt-BR", false, default);

        Assert.False(result!.CanPost);
        Assert.Equal("already_reserved", result.SkipReason);
    }

    [Fact]
    public async Task Analysis_IsAvailableEvenWhenNotPostable()
    {
        using var db = CreateDbContext();
        SeedMatch(db, 1, status: MatchStatus.Ongoing, endTimeUtc: null);

        var service = CreateSocialService(db);
        var result = await service.GetByMatchIdAsync(1, "pt-BR", true, default);

        // A analise continua util para diagnostico, mesmo sem permissao de publicacao.
        Assert.NotNull(result);
        Assert.NotEmpty(result!.Series);
        Assert.NotNull(result.Narrative);
        Assert.False(result.CanPost);
    }
}
