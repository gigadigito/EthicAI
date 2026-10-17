using CriptoVersus.API.Services;
using DAL.NftFutebol;
using DTOs;
using Microsoft.Extensions.Options;
using static CriptoVersus.API.Tests.PriceCrossoverTestHelpers;

namespace CriptoVersus.API.Tests;

public sealed class PriceCrossoverHighlightSelectorTests
{
    private static readonly DateTime WindowEnd = DateTime.UtcNow;

    [Fact]
    public async Task Highlight_SelectsMostInteresting_NotJustLatest()
    {
        using var db = CreateDbContext();

        // Partida antiga e equilibrada, com varios cruzamentos relevantes.
        SeedMatch(
            db,
            1,
            endTimeUtc: WindowEnd.AddHours(-3),
            pricesA: Oscillating(20, 1.00m, 0.05m),
            pricesB: Oscillating(20, 1.00m, -0.05m));

        // Partida recentissima, mas sem movimento algum.
        SeedMatch(
            db,
            2,
            endTimeUtc: WindowEnd.AddMinutes(-5),
            pricesA: BuildPrices(20, 1.00m, 0m),
            pricesB: BuildPrices(20, 1.00m, 0m));

        var selector = CreateSelector(db);
        var result = await selector.GetHighlightAsync(6, "pt-BR", false, default);

        Assert.True(result.HasHighlight);
        Assert.Equal(1, result.Highlight!.MatchId);
    }

    [Fact]
    public async Task Highlight_ReturnsSkipReason_WhenNoMatchInWindow()
    {
        using var db = CreateDbContext();

        var selector = CreateSelector(db);
        var result = await selector.GetHighlightAsync(6, "pt-BR", false, default);

        Assert.False(result.HasHighlight);
        Assert.Null(result.Highlight);
        Assert.Equal("no_completed_matches_in_window", result.SkipReason);
    }

    [Fact]
    public async Task Highlight_ExcludesMatchesOutsideWindow()
    {
        using var db = CreateDbContext();
        SeedMatch(db, 1, endTimeUtc: WindowEnd.AddHours(-30));

        var selector = CreateSelector(db);
        var result = await selector.GetHighlightAsync(6, "pt-BR", false, default);

        Assert.False(result.HasHighlight);
        Assert.Equal(0, result.MatchesScanned);
    }

    [Fact]
    public async Task Highlight_RejectsInsufficientData()
    {
        using var db = CreateDbContext();
        SeedMatch(db, 1, pricesA: [1.00m], pricesB: [1.00m]);

        var selector = CreateSelector(db);
        var result = await selector.GetHighlightAsync(6, "pt-BR", false, default);

        Assert.False(result.HasHighlight);
        Assert.Equal("all_candidates_unreliable_data", result.SkipReason);
    }

    [Fact]
    public async Task Highlight_RejectsAlreadyPublished()
    {
        using var db = CreateDbContext();
        SeedMatch(db, 1);

        var publication = new CriptoVersus.API.Services.PriceCrossoverPublicationService(
            db, Options.Create(new PriceCrossoverOptions()));
        await publication.ReserveAsync(1, new PriceCrossoverReserveRequest(), default);
        await publication.ConfirmAsync(1, new PriceCrossoverConfirmRequest { Outcome = "posted" }, default);

        var selector = CreateSelector(db);
        var result = await selector.GetHighlightAsync(6, "pt-BR", false, default);

        Assert.False(result.HasHighlight);
        Assert.Equal("all_candidates_already_published_or_reserved", result.SkipReason);
    }

    [Fact]
    public async Task Highlight_SkipsOngoingMatches()
    {
        using var db = CreateDbContext();
        SeedMatch(db, 1, status: MatchStatus.Ongoing, endTimeUtc: null, startTimeUtc: WindowEnd.AddMinutes(-20));

        var selector = CreateSelector(db);
        var result = await selector.GetHighlightAsync(6, "pt-BR", false, default);

        Assert.False(result.HasHighlight);
        Assert.Equal("no_completed_matches_in_window", result.SkipReason);
    }

    [Fact]
    public async Task Highlight_PrefersComebackOverFlatMatch()
    {
        using var db = CreateDbContext();

        // Reviravolta: A cai muito e depois recupera, vencendo o placar.
        SeedMatch(
            db,
            1,
            scoreA: 4,
            scoreB: 2,
            endTimeUtc: WindowEnd.AddHours(-2),
            pricesA: ComebackPrices(),
            pricesB: BuildPrices(20, 1.00m, 0m));

        // Partida sem nenhum movimento.
        SeedMatch(
            db,
            2,
            scoreA: 1,
            scoreB: 0,
            endTimeUtc: WindowEnd.AddMinutes(-10),
            pricesA: BuildPrices(20, 1.00m, 0m),
            pricesB: BuildPrices(20, 1.00m, 0m));

        var selector = CreateSelector(db);
        var result = await selector.GetHighlightAsync(6, "pt-BR", false, default);

        Assert.True(result.HasHighlight);
        Assert.Equal(1, result.Highlight!.MatchId);
        Assert.True(result.Highlight.Comparative.HasComeback);
    }

    [Fact]
    public async Task Candidates_IncludeRejectionReasons()
    {
        using var db = CreateDbContext();
        SeedMatch(db, 1, pricesA: [1.00m], pricesB: [1.00m]);
        SeedMatch(db, 2);

        var selector = CreateSelector(db);
        var result = await selector.GetCandidatesAsync(6, 10, default);

        Assert.Equal(2, result.Candidates.Count);

        var rejected = result.Candidates.Single(x => x.MatchId == 1);
        Assert.False(rejected.IsEligible);
        Assert.Contains("insufficient_data_quality", rejected.RejectionReasons);

        var eligible = result.Candidates.Single(x => x.MatchId == 2);
        Assert.True(eligible.IsEligible);
        Assert.Equal(2, result.SelectedMatchId);
    }

    [Fact]
    public async Task Candidates_OrderIsDeterministic_ForSimilarScores()
    {
        using var db = CreateDbContext();

        // Duas partidas identicas: a ordenacao deve ser estavel e repetivel.
        for (var i = 1; i <= 3; i++)
        {
            SeedMatch(
                db,
                i,
                endTimeUtc: WindowEnd.AddHours(-i),
                pricesA: BuildPrices(20, 1.00m, 0.01m),
                pricesB: BuildPrices(20, 1.00m, -0.01m));
        }

        var selector = CreateSelector(db);
        var first = await selector.GetCandidatesAsync(6, 10, default);
        var second = await selector.GetCandidatesAsync(6, 10, default);

        Assert.Equal(
            first.Candidates.Select(x => x.MatchId).ToList(),
            second.Candidates.Select(x => x.MatchId).ToList());
    }

    [Fact]
    public async Task Symmetry_SwappingAssetOrderYieldsSameSelection()
    {
        using var dbA = CreateDbContext();
        using var dbB = CreateDbContext();

        SeedMatch(dbA, 1, symbolA: "AAAUSDT", symbolB: "BBBUSDT",
            pricesA: Oscillating(20, 1.00m, 0.04m),
            pricesB: Oscillating(20, 1.00m, -0.04m));

        // Mesmo confronto com A e B invertidos.
        SeedMatch(dbB, 1, symbolA: "BBBUSDT", symbolB: "AAAUSDT",
            pricesA: Oscillating(20, 1.00m, -0.04m),
            pricesB: Oscillating(20, 1.00m, 0.04m));

        var selectorA = CreateSelector(dbA);
        var selectorB = CreateSelector(dbB);

        var resultA = await selectorA.GetHighlightAsync(6, "pt-BR", false, default);
        var resultB = await selectorB.GetHighlightAsync(6, "pt-BR", false, default);

        Assert.True(resultA.HasHighlight);
        Assert.True(resultB.HasHighlight);
        Assert.Equal(resultA.Highlight!.InterestScore, resultB.Highlight!.InterestScore);
        Assert.Equal(
            resultA.Highlight.Comparative.TotalCrossovers,
            resultB.Highlight.Comparative.TotalCrossovers);
    }

    [Fact]
    public async Task Highlight_LookbackHours_IsClamped()
    {
        using var db = CreateDbContext();
        SeedMatch(db, 1, endTimeUtc: WindowEnd.AddHours(-40));

        var selector = CreateSelector(db);

        // 500 horas e limitado ao maximo configurado (48): a partida de 40h deve entrar.
        var result = await selector.GetHighlightAsync(500, "pt-BR", false, default);

        Assert.Equal(48, result.LookbackHours);
        Assert.True(result.HasHighlight);
    }

    // ------------------------------------------------------------------

    private static decimal[] Oscillating(int count, decimal startPrice, decimal amplitudePercent)
    {
        var prices = new decimal[count];
        for (var i = 0; i < count; i++)
        {
            var factor = i % 2 == 0 ? 1m : -1m;
            prices[i] = decimal.Round(startPrice * (1m + factor * amplitudePercent), 8, MidpointRounding.AwayFromZero);
        }

        return prices;
    }

    private static decimal[] ComebackPrices()
    {
        var prices = new decimal[20];
        for (var i = 0; i < 20; i++)
        {
            prices[i] = i < 10
                ? 1.00m - (i * 0.03m)   // queda ate 0.73
                : 0.73m + ((i - 9) * 0.06m); // recuperacao ate 1.39
        }

        return prices;
    }
}
