using CriptoVersus.API.Services;
using DTOs;

namespace CriptoVersus.API.Tests;

public sealed class PriceCrossoverNarrativeTests
{
    private readonly PriceCrossoverSocialNarrativeService _service = new();

    [Fact]
    public void Narrative_ComebackPattern_OnlyWhenEffectiveLeadReversal()
    {
        var response = BuildResponse(hasComeback: true, winnerTeamId: 1001);

        var narrative = _service.Build(response, "pt-BR", 280);

        Assert.Equal("comeback", narrative.Pattern);
        Assert.Contains("ficou para tras", narrative.Summary);
        Assert.Contains("Reviravolta", narrative.SuggestedPostText);
        Assert.Contains(
            "reversao efetiva de lideranca",
            string.Join(" ", narrative.Highlights));
    }

    [Fact]
    public void Narrative_DominantWin_WithoutComebackEvidence()
    {
        var response = BuildResponse(hasComeback: false, winnerTeamId: 1001);

        var narrative = _service.Build(response, "pt-BR", 280);

        Assert.NotEqual("comeback", narrative.Pattern);
        Assert.DoesNotContain("Reviravolta", narrative.Summary);
    }

    [Fact]
    public void Narrative_BalancedMatch()
    {
        var response = BuildResponse(hasComeback: false, winnerTeamId: 1001, competitiveness: 85, totalCrossovers: 1);

        var narrative = _service.Build(response, "pt-BR", 280);

        Assert.Equal("balanced", narrative.Pattern);
        Assert.Contains("proximos", narrative.Summary);
        Assert.Contains("equilibrado", narrative.SuggestedPostText);
    }

    [Fact]
    public void Narrative_OppositeMoves()
    {
        var response = BuildResponse(
            hasComeback: false,
            winnerTeamId: 1001,
            perfA: 9m,
            perfB: -2m,
            totalCrossovers: 1);

        var narrative = _service.Build(response, "pt-BR", 280);

        Assert.Equal("opposite_moves", narrative.Pattern);
        Assert.Contains("direcoes opostas", narrative.Headline);
    }

    [Fact]
    public void Narrative_JointDecline()
    {
        var response = BuildResponse(
            hasComeback: false,
            winnerTeamId: 1001,
            perfA: -5m,
            perfB: -12m,
            totalCrossovers: 1);

        var narrative = _service.Build(response, "pt-BR", 280);

        Assert.Equal("joint_decline", narrative.Pattern);
        Assert.Contains("desvalorizacao", narrative.Summary);
    }

    [Fact]
    public void Narrative_CrossoverDuel_ReferencesCurveCrossingNotScore()
    {
        var response = BuildResponse(hasComeback: false, winnerTeamId: 1001, totalCrossovers: 5, leadAlternated: true);

        var narrative = _service.Build(response, "pt-BR", 280);

        Assert.Equal("crossover_duel", narrative.Pattern);
        Assert.Contains("curvas de desempenho relativo se cruzaram", narrative.Summary);
    }

    [Fact]
    public void Narrative_PostText_ContainsDisclaimer()
    {
        var response = BuildResponse(hasComeback: false, winnerTeamId: 1001);

        var narrative = _service.Build(response, "pt-BR", 280);

        Assert.Contains("Nao constitui recomendacao financeira", narrative.SuggestedPostText);
    }

    [Fact]
    public void Narrative_PostText_EnglishDisclaimer()
    {
        var response = BuildResponse(hasComeback: false, winnerTeamId: 1001);

        var narrative = _service.Build(response, "en-US", 280);

        Assert.Contains("Not financial advice", narrative.SuggestedPostText);
        Assert.Equal("en-US", narrative.Language);
    }

    [Fact]
    public void Narrative_PostText_RespectsCharacterLimit()
    {
        var response = BuildResponse(hasComeback: false, winnerTeamId: 1001);

        var narrative = _service.Build(response, "pt-BR", 120);

        Assert.True(narrative.SuggestedPostText.Length <= 160, $"len={narrative.SuggestedPostText.Length}");
        Assert.Equal(narrative.SuggestedPostText.Length, narrative.CharacterCount);
        Assert.Equal(120, narrative.MaxCharacters);
    }

    [Fact]
    public void Narrative_IsDeterministic()
    {
        var response = BuildResponse(hasComeback: true, winnerTeamId: 1001);

        var first = _service.Build(response, "pt-BR", 280);
        var second = _service.Build(response, "pt-BR", 280);

        Assert.Equal(first.SuggestedPostText, second.SuggestedPostText);
        Assert.Equal(first.Headline, second.Headline);
        Assert.Equal(first.Pattern, second.Pattern);
    }

    [Fact]
    public void Narrative_HighlightsIncludeConfirmedStatistics()
    {
        var response = BuildResponse(hasComeback: false, winnerTeamId: 1001, perfA: 9m, perfB: -2m);

        var narrative = _service.Build(response, "pt-BR", 280);

        var all = string.Join(" ", narrative.Highlights);
        Assert.Contains("EPIC", all);
        Assert.Contains("EIGEN", all);
        Assert.Contains("11,0", all);
        Assert.Contains("Placar final", all);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("this is not a culture")]
    public void Narrative_InvalidCulture_FallsBackToPtBr(string language)
    {
        var response = BuildResponse(hasComeback: false, winnerTeamId: 1001);

        var narrative = _service.Build(response, language, 280);

        Assert.Equal("pt-BR", narrative.Language);
    }

    private static PriceCrossoverSocialResponse BuildResponse(
        bool hasComeback,
        int? winnerTeamId,
        int competitiveness = 40,
        int totalCrossovers = 1,
        bool leadAlternated = false,
        decimal perfA = 5m,
        decimal perfB = 1m)
        => new()
        {
            MatchId = 1,
            Status = "Completed",
            Official = new PriceCrossoverOfficialResult
            {
                ScoreA = 3,
                ScoreB = 1,
                WinnerTeamId = winnerTeamId,
                WinnerSymbol = winnerTeamId == 1001 ? "EPICUSDT" : "EIGENUSDT",
                EndReasonCode = "TIME_LIMIT"
            },
            AssetA = new PriceCrossoverAssetStats
            {
                TeamId = 1001,
                Symbol = "EPICUSDT",
                BaseAsset = "EPIC",
                QuoteAsset = "USDT",
                PerformancePercent = perfA
            },
            AssetB = new PriceCrossoverAssetStats
            {
                TeamId = 1002,
                Symbol = "EIGENUSDT",
                BaseAsset = "EIGEN",
                QuoteAsset = "USDT",
                PerformancePercent = perfB
            },
            Comparative = new PriceCrossoverComparativeStats
            {
                PerformanceDifferencePercent = perfA - perfB,
                TotalCrossovers = totalCrossovers,
                RelevantCrossovers = totalCrossovers,
                HasComeback = hasComeback,
                LeadAlternated = leadAlternated || totalCrossovers >= 3,
                Competitiveness = competitiveness
            }
        };
}
