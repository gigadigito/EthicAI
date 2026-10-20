using CriptoVersus.API.Controllers;
using CriptoVersus.API.Services;
using DAL.NftFutebol;
using DTOs;
using EthicAI.EntityModel;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using static CriptoVersus.API.Tests.PriceCrossoverTestHelpers;

namespace CriptoVersus.API.Tests;

/// <summary>
/// Contrato de <c>publicUrl</c>/<c>publicUrlAvailable</c> e integracao do endpoint
/// <c>/api/social/price-crossover/highlight</c> usados pelo workflow n8n (captura Browserless).
/// Cobre os testes A-G da correcao de disponibilidade da pagina social.
/// </summary>
public sealed class PriceCrossoverPublicUrlTests
{
    private const string PublicBase = "https://www.criptoversus.com";

    // ---- Teste A: partida concluida e pagina disponivel ----

    [Fact]
    public async Task CompletedMatch_PageReady_ReturnsPublicUrlAndAvailability()
    {
        using var db = CreateDbContext();
        SeedMatch(db, 41393);

        var service = CreateSocialService(db);
        var result = await service.GetByMatchIdAsync(41393, "pt-BR", false, default);

        Assert.NotNull(result);
        Assert.True(result!.CanPost);
        Assert.True(result.PublicUrlAvailable);
        Assert.Equal($"{PublicBase}/pt/social/price-crossover/41393", result.PublicUrl);
    }

    [Theory]
    [InlineData("pt-BR", "pt")]
    [InlineData("pt", "pt")]
    [InlineData("en-US", "en")]
    [InlineData("en", "en")]
    [InlineData("zh-CN", "zh")]
    [InlineData("es-ES", "es")]
    [InlineData("fr-FR", "fr")]
    [InlineData("de-DE", "de")]
    [InlineData("it-IT", "it")]
    [InlineData("ja-JP", "ja")]
    [InlineData("ko-KR", "pt")]
    [InlineData("", "pt")]
    public async Task PublicUrl_RespectsRouteSupportedCulture(string language, string routeCulture)
    {
        using var db = CreateDbContext();
        SeedMatch(db, 1);

        var service = CreateSocialService(db);
        var result = await service.GetByMatchIdAsync(1, language, false, default);

        Assert.True(result!.PublicUrlAvailable);
        Assert.Equal($"{PublicBase}/{routeCulture}/social/price-crossover/1", result.PublicUrl);
    }

    [Fact]
    public async Task PublicUrl_UsesExplicitPriceCrossoverOrigin()
    {
        using var db = CreateDbContext();
        SeedMatch(db, 1);

        var options = new PriceCrossoverOptions { PublicBaseUrl = "https://example.org/" };
        var service = CreateSocialService(db, options);
        var result = await service.GetByMatchIdAsync(1, "pt-BR", false, default);

        Assert.True(result!.PublicUrlAvailable);
        Assert.Equal("https://example.org/pt/social/price-crossover/1", result.PublicUrl);
    }

    [Fact]
    public async Task PublicUrl_FallsBackToSitePublicBaseUrlConfiguration()
    {
        using var db = CreateDbContext();
        SeedMatch(db, 1);

        var configuration = CreateConfiguration(
            ("CriptoVersus:PublicBaseUrl", "https://site.example"),
            ("SocialAutomation:PublicBaseUrl", "https://ignored.example"));

        var service = CreateSocialService(db, new PriceCrossoverOptions(), configuration);
        var result = await service.GetByMatchIdAsync(1, "pt-BR", false, default);

        Assert.True(result!.PublicUrlAvailable);
        Assert.Equal("https://site.example/pt/social/price-crossover/1", result.PublicUrl);
    }

    [Theory]
    [InlineData("javascript:alert(1)")]
    [InlineData("ftp://example.org")]
    [InlineData("not-an-absolute-url")]
    public async Task InvalidPublicOrigin_IsNeverDeclaredAvailable(string publicBaseUrl)
    {
        using var db = CreateDbContext();
        SeedMatch(db, 1);

        var options = new PriceCrossoverOptions { PublicBaseUrl = publicBaseUrl };
        var service = CreateSocialService(db, options, CreateConfiguration());
        var result = await service.GetByMatchIdAsync(1, "pt-BR", false, default);

        // Origem invalida: falha fechada, nunca monta URL artificial.
        Assert.False(result!.PublicUrlAvailable);
        Assert.Null(result.PublicUrl);
    }

    [Fact]
    public async Task PublicUrl_MatchIdAlwaysMatchesTheAnalyzedMatch()
    {
        using var db = CreateDbContext();
        SeedMatch(db, 1);
        SeedMatch(db, 2);

        var service = CreateSocialService(db);
        var result = await service.GetByMatchIdAsync(2, "pt-BR", false, default);

        Assert.Equal(2, result!.MatchId);
        Assert.EndsWith("/2", result.PublicUrl);
        Assert.DoesNotContain("/1", result.PublicUrl);
    }

    // ---- Teste B: partida inexistente ----

    [Fact]
    public async Task UnknownMatch_DoesNotDeclarePageAvailable()
    {
        using var db = CreateDbContext();

        var service = CreateSocialService(db);
        var result = await service.GetByMatchIdAsync(999, "pt-BR", false, default);

        Assert.Null(result);

        var selector = CreateSelector(db);
        var highlight = await selector.GetHighlightAsync(6, "pt-BR", false, default);

        Assert.False(highlight.HasHighlight);
        Assert.Null(highlight.Highlight);
    }

    // ---- Teste C: dados insuficientes ----

    [Fact]
    public async Task InsufficientData_DoesNotReleaseCapture()
    {
        using var db = CreateDbContext();
        SeedMatch(db, 1, pricesA: [1.00m], pricesB: [1.00m]);

        var service = CreateSocialService(db);
        var result = await service.GetByMatchIdAsync(1, "pt-BR", false, default);

        Assert.NotNull(result);
        Assert.False(result!.CanPost);
        Assert.Equal("insufficient_data_quality", result.SkipReason);
        Assert.False(result.DataQuality.IsSufficient);
        Assert.False(result.PublicUrlAvailable);
        Assert.Null(result.PublicUrl);
    }

    // ---- Teste D: partida ainda em andamento ----

    [Fact]
    public async Task OngoingMatch_DoesNotDeclarePageReady()
    {
        using var db = CreateDbContext();
        SeedMatch(db, 1, status: MatchStatus.Ongoing, endTimeUtc: null);

        var service = CreateSocialService(db);
        var result = await service.GetByMatchIdAsync(1, "pt-BR", false, default);

        Assert.NotNull(result);
        Assert.Equal("Ongoing", result!.Status);
        Assert.False(result.CanPost);
        Assert.Equal("match_not_completed", result.SkipReason);
        Assert.False(result.PublicUrlAvailable);
        Assert.Null(result.PublicUrl);
    }

    // ---- Teste E: partida ja publicada ----

    [Fact]
    public async Task AlreadyPublished_KeepsIdempotencyAndEligibilityRules()
    {
        using var db = CreateDbContext();
        SeedMatch(db, 1);

        var options = new PriceCrossoverOptions();
        var publication = new PriceCrossoverPublicationService(db, Options.Create(options));
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
        Assert.False(result.PublicUrlAvailable);
        Assert.Null(result.PublicUrl);

        // Idempotencia preservada: publicacao confirmada nunca e reservada de novo.
        var second = await publication.ReserveAsync(1, new PriceCrossoverReserveRequest(), default);
        Assert.False(second.Success);
        Assert.Equal("already_published", second.Result);
        Assert.Equal("price_crossover_highlight:1", second.Publication!.IdempotencyKey);
    }

    // ---- Teste G: integracao do endpoint /highlight ----

    [Fact]
    public async Task Highlight_EndpointReturnsPublicUrlForSelectedMatch()
    {
        using var db = CreateDbContext();
        SeedMatch(db, 41393);

        var controller = CreateController(db);
        var action = await controller.GetHighlight(48, "pt-BR", false, default);

        var payload = Assert.IsType<PriceCrossoverHighlightResponse>(
            Assert.IsType<OkObjectResult>(action.Result).Value);

        Assert.True(payload.HasHighlight);
        Assert.Null(payload.SkipReason);
        Assert.NotNull(payload.Highlight);

        var highlight = payload.Highlight!;
        Assert.Equal(41393, highlight.MatchId);
        Assert.Equal("Completed", highlight.Status);
        Assert.True(highlight.CanPost);
        Assert.True(highlight.DataQuality.IsSufficient);
        Assert.False(highlight.AlreadyPublished);
        Assert.True(highlight.PublicUrlAvailable);
        Assert.Equal($"{PublicBase}/pt/social/price-crossover/41393", highlight.PublicUrl);
        Assert.False(string.IsNullOrWhiteSpace(highlight.Narrative?.SuggestedPostText));
    }

    [Fact]
    public async Task Highlight_Endpoint_WithoutMatches_DoesNotDeclarePage()
    {
        using var db = CreateDbContext();

        var controller = CreateController(db);
        var action = await controller.GetHighlight(48, "pt-BR", false, default);

        var payload = Assert.IsType<PriceCrossoverHighlightResponse>(
            Assert.IsType<OkObjectResult>(action.Result).Value);

        Assert.False(payload.HasHighlight);
        Assert.Null(payload.Highlight);
    }

    [Fact]
    public async Task GetByMatchId_Endpoint_UnknownMatch_ReturnsNotFound()
    {
        using var db = CreateDbContext();

        var controller = CreateController(db);
        var action = await controller.GetByMatchId(999, "pt-BR", false, default);

        Assert.IsType<NotFoundResult>(action.Result);
    }

    private static PriceCrossoverSocialController CreateController(EthicAIDbContext db)
    {
        var options = new PriceCrossoverOptions();
        return new PriceCrossoverSocialController(
            CreateSocialService(db, options),
            CreateSelector(db, options),
            new PriceCrossoverPublicationService(db, Options.Create(options)))
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext()
            }
        };
    }
}
