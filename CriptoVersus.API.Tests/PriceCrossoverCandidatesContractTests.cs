using System.Text.Json;
using CriptoVersus.API.Services;
using DAL.NftFutebol;
using DTOs;
using EthicAI.EntityModel;
using Microsoft.Extensions.Options;
using static CriptoVersus.API.Tests.PriceCrossoverTestHelpers;

namespace CriptoVersus.API.Tests;

/// <summary>
/// Contrato de <c>GET /api/social/price-crossover/highlights/candidates</c> usado pelo n8n:
/// candidatos completos, piso de interesse, limite de resultados, ausencia de moedas e
/// rotacao de moedas. Nenhum teste inventa dado: simbolos, canPost, dataQuality e
/// publicUrl sao sempre derivados de dados persistidos e das regras reais de elegibilidade.
/// </summary>
public sealed class PriceCrossoverCandidatesContractTests
{
    private const string PublicBase = "https://www.criptoversus.com";

    // ---- Candidatos completos ----

    [Fact]
    public async Task Candidates_ExposeCompleteEligibilityContract()
    {
        using var db = CreateDbContext();
        SeedMatch(db, 1, symbolA: "AAAUSDT", symbolB: "BBBUSDT",
            endTimeUtc: DateTime.UtcNow.AddHours(-1),
            pricesA: Strong(1), pricesB: Strong(-1));
        SeedMatch(db, 2, symbolA: "CCCUSDT", symbolB: "DDDUSDT",
            endTimeUtc: DateTime.UtcNow.AddHours(-2),
            pricesA: Strong(1), pricesB: Strong(-1));

        var result = await CreateSelector(db).GetCandidatesAsync(6, 10, null, default);

        Assert.Equal(2, result.Candidates.Count);
        Assert.Equal(10, result.Take);
        Assert.Equal(50, result.MinInterestScore);
        Assert.Equal(2, result.EligibleCount);

        foreach (var candidate in result.Candidates)
        {
            // Identificacao real dos ativos, no formato assetA.symbol esperado pelo n8n.
            Assert.False(string.IsNullOrWhiteSpace(candidate.AssetA.Symbol));
            Assert.False(string.IsNullOrWhiteSpace(candidate.AssetB.Symbol));
            Assert.Equal(candidate.AssetA.Symbol, candidate.AssetASymbol);
            Assert.Equal(candidate.AssetB.Symbol, candidate.AssetBSymbol);
            Assert.False(string.IsNullOrWhiteSpace(candidate.AssetA.BaseAsset));
            Assert.False(string.IsNullOrWhiteSpace(candidate.AssetB.BaseAsset));

            // Avaliacao real de elegibilidade, nunca presumida.
            Assert.True(candidate.CanPost);
            Assert.Null(candidate.SkipReason);
            Assert.True(candidate.DataQuality.IsSufficient);
            Assert.True(candidate.DataQuality.CanReconstructChart);
            Assert.True(candidate.IsEligible);
            Assert.Empty(candidate.RejectionReasons);
            Assert.False(candidate.AlreadyPublished);
            Assert.Null(candidate.PublicationStatus);

            Assert.True(candidate.PublicUrlAvailable);
            Assert.Equal($"{PublicBase}/pt/social/price-crossover/{candidate.MatchId}", candidate.PublicUrl);

            Assert.NotNull(candidate.Narrative);
            Assert.False(string.IsNullOrWhiteSpace(candidate.Narrative!.SuggestedPostText));
        }

        // Desempate deterministico: mesmo interesse, a mais recente vence.
        Assert.Equal(1, result.SelectedMatchId);
        Assert.True(result.Candidates.Single(x => x.MatchId == 1).IsSelected);
        Assert.False(result.Candidates.Single(x => x.MatchId == 2).IsSelected);

        // Selecionar nunca publica nem reserva.
        Assert.Empty(db.SocialPostHistory);
    }

    [Fact]
    public async Task Candidates_SerializedJsonKeepsN8nContractFieldNames()
    {
        using var db = CreateDbContext();
        SeedMatch(db, 1, symbolA: "AAAUSDT", symbolB: "BBBUSDT",
            pricesA: Strong(1), pricesB: Strong(-1));

        var result = await CreateSelector(db).GetCandidatesAsync(6, 10, null, default);

        var json = JsonSerializer.Serialize(result, new JsonSerializerOptions(JsonSerializerDefaults.Web));
        using var document = JsonDocument.Parse(json);

        var candidate = document.RootElement.GetProperty("candidates")[0];
        Assert.Equal("AAAUSDT", candidate.GetProperty("assetA").GetProperty("symbol").GetString());
        Assert.Equal("BBBUSDT", candidate.GetProperty("assetB").GetProperty("symbol").GetString());
        Assert.True(candidate.GetProperty("canPost").GetBoolean());
        Assert.True(candidate.GetProperty("dataQuality").GetProperty("isSufficient").GetBoolean());
        Assert.True(candidate.GetProperty("publicUrlAvailable").GetBoolean());
        Assert.False(string.IsNullOrWhiteSpace(candidate.GetProperty("publicUrl").GetString()));
    }

    // ---- Filtros: piso de interesse ----

    [Fact]
    public async Task Candidates_MinInterestScore_FiltersWeakMatches_WithoutLoweringTheFloor()
    {
        using var db = CreateDbContext();

        // Cinco partidas sem movimento: acima da qualidade minima, abaixo do piso de interesse.
        for (var i = 1; i <= 5; i++)
        {
            SeedMatch(db, i, symbolA: $"W{i}AUSDT", symbolB: $"W{i}BUSDT",
                endTimeUtc: DateTime.UtcNow.AddMinutes(-i),
                pricesA: Flat(20), pricesB: Flat(20));
        }

        SeedMatch(db, 6, symbolA: "AAAUSDT", symbolB: "BBBUSDT",
            endTimeUtc: DateTime.UtcNow.AddMinutes(-6),
            pricesA: Strong(1), pricesB: Strong(-1));

        var selector = CreateSelector(db);
        var result = await selector.GetCandidatesAsync(6, 10, null, default);

        // O piso padrao e 50 e nao e rebaixado para "achar" candidatos.
        Assert.Equal(50, result.MinInterestScore);
        Assert.Equal(6, result.MatchesScanned);
        Assert.Equal(5, result.FilteredByMinInterestScore);
        var only = Assert.Single(result.Candidates);
        Assert.Equal(6, only.MatchId);
        Assert.True(only.InterestScore >= 50);

        // Piso explicito menor apenas relaxa a consulta; o padrao continua 50.
        var relaxed = await selector.GetCandidatesAsync(6, 10, 0, default);
        Assert.Equal(0, relaxed.MinInterestScore);
        Assert.Equal(6, relaxed.Candidates.Count);

        // Piso mais alto reduz o conjunto.
        var strict = await selector.GetCandidatesAsync(6, 10, 100, default);
        Assert.Equal(100, strict.MinInterestScore);
        Assert.Empty(strict.Candidates);
        Assert.Null(strict.SelectedMatchId);
    }

    [Fact]
    public async Task Candidates_ExpandsScan_WhenScoredCandidatesAreScarce()
    {
        using var db = CreateDbContext();

        // Lote inicial (MaxCandidates = 25) inteiro abaixo do piso; o candidato bom e o mais antigo.
        for (var i = 1; i <= 25; i++)
        {
            SeedMatch(db, i, symbolA: $"W{i}AUSDT", symbolB: $"W{i}BUSDT",
                endTimeUtc: DateTime.UtcNow.AddMinutes(-i),
                pricesA: Flat(20), pricesB: Flat(20));
        }

        SeedMatch(db, 26, symbolA: "AAAUSDT", symbolB: "BBBUSDT",
            endTimeUtc: DateTime.UtcNow.AddMinutes(-26),
            pricesA: Strong(1), pricesB: Strong(-1));

        var result = await CreateSelector(db).GetCandidatesAsync(6, 1, null, default);

        // A ampliacao procura MAIS partidas: o candidato acima do piso e encontrado
        // sem rebaixar o minInterestScore.
        Assert.Equal(50, result.MinInterestScore);
        Assert.Equal(26, result.MatchesScanned);
        Assert.Equal(25, result.FilteredByMinInterestScore);
        var only = Assert.Single(result.Candidates);
        Assert.Equal(26, only.MatchId);
        Assert.True(only.IsEligible);
    }

    // ---- Limite de resultados ----

    [Fact]
    public async Task Candidates_RespectTakeLimit()
    {
        using var db = CreateDbContext();
        for (var i = 1; i <= 6; i++)
        {
            SeedMatch(db, i, symbolA: $"AAAUSDT", symbolB: "BBBUSDT",
                endTimeUtc: DateTime.UtcNow.AddMinutes(-i),
                pricesA: Strong(1), pricesB: Strong(-1));
        }

        var selector = CreateSelector(db);

        var limited = await selector.GetCandidatesAsync(6, 2, null, default);
        Assert.Equal(2, limited.Take);
        Assert.Equal(2, limited.Candidates.Count);
        Assert.Equal(6, limited.MatchesScanned);
        Assert.NotNull(limited.SelectedMatchId);
        Assert.Single(limited.Candidates, x => x.IsSelected);

        var clampedHigh = await selector.GetCandidatesAsync(6, 500, null, default);
        Assert.Equal(50, clampedHigh.Take);
        Assert.Equal(6, clampedHigh.Candidates.Count);

        var clampedLow = await selector.GetCandidatesAsync(6, 0, null, default);
        Assert.Equal(1, clampedLow.Take);
        Assert.Single(clampedLow.Candidates);
    }

    // ---- Ausencia de moedas ----

    [Fact]
    public async Task Candidates_MissingCurrency_NeverInventSymbols()
    {
        using var db = CreateDbContext();

        // Times sem moeda cadastrada.
        SeedMatch(db, 1, missingCurrency: true,
            pricesA: Strong(1), pricesB: Strong(-1));

        // Moeda cadastrada sem simbolo.
        SeedMatch(db, 2, symbolA: "", symbolB: "",
            endTimeUtc: DateTime.UtcNow.AddHours(-1),
            pricesA: Strong(1), pricesB: Strong(-1));

        var result = await CreateSelector(db).GetCandidatesAsync(6, 10, null, default);

        Assert.Equal(2, result.Candidates.Count);

        foreach (var candidate in result.Candidates)
        {
            // Simbolo desconhecido permanece vazio: nada e inventado.
            Assert.Equal(string.Empty, candidate.AssetA.Symbol);
            Assert.Equal(string.Empty, candidate.AssetB.Symbol);
            Assert.Equal(string.Empty, candidate.AssetASymbol);
            Assert.Equal(string.Empty, candidate.AssetBSymbol);
            Assert.Equal(string.Empty, candidate.AssetA.BaseAsset);

            Assert.False(candidate.CanPost);
            Assert.Equal("missing_asset_symbols", candidate.SkipReason);
            Assert.Contains("missing_asset_symbols", candidate.RejectionReasons);
            Assert.False(candidate.IsEligible);
            Assert.False(candidate.PublicUrlAvailable);
            Assert.Null(candidate.PublicUrl);
            Assert.False(candidate.AlreadyPublished);
        }

        Assert.Null(result.SelectedMatchId);
    }

    // ---- Rotacao de moedas e repeticao de publicacoes ----

    [Fact]
    public async Task Candidates_CoinRotation_AvoidsAssetsPublishedTodayAndRepeatedPairs()
    {
        using var db = CreateDbContext();
        var now = DateTime.UtcNow;

        // Partida publicada hoje (AAA vs BBB).
        SeedMatch(db, 1, symbolA: "AAAUSDT", symbolB: "BBBUSDT",
            endTimeUtc: now.AddHours(-5), pricesA: Strong(1), pricesB: Strong(-1));
        var publication = new PriceCrossoverPublicationService(db, Options.Create(new PriceCrossoverOptions()));
        await publication.ReserveAsync(1, new PriceCrossoverReserveRequest(), default);
        await publication.ConfirmAsync(1, new PriceCrossoverConfirmRequest { Outcome = "posted" }, default);

        // Reusa ativo AAA publicado hoje.
        SeedMatch(db, 2, symbolA: "AAAUSDT", symbolB: "CCCUSDT",
            endTimeUtc: now.AddHours(-1), pricesA: Strong(1), pricesB: Strong(-1));

        // Repete o par DDD/EEE publicado ha 30h (dentro de 72h, fora do dia atual).
        SeedMatch(db, 3, symbolA: "DDDUSDT", symbolB: "EEEUSDT",
            endTimeUtc: now.AddHours(-2), pricesA: Strong(1), pricesB: Strong(-1));
        SeedMatch(db, 9, symbolA: "DDDUSDT", symbolB: "EEEUSDT",
            endTimeUtc: now.AddHours(-90), skipSnapshots: true);
        InsertPosted(db, matchId: 9, postedAtUtc: now.AddHours(-30));

        // Par FFF/GGG publicado ha 100h: ja fora da janela de 72h.
        SeedMatch(db, 4, symbolA: "FFFUSDT", symbolB: "GGGUSDT",
            endTimeUtc: now.AddHours(-3), pricesA: Strong(1), pricesB: Strong(-1));
        SeedMatch(db, 10, symbolA: "FFFUSDT", symbolB: "GGGUSDT",
            endTimeUtc: now.AddHours(-110), skipSnapshots: true);
        InsertPosted(db, matchId: 10, postedAtUtc: now.AddHours(-100));

        var result = await CreateSelector(db).GetCandidatesAsync(6, 10, null, default);

        var match1 = result.Candidates.Single(x => x.MatchId == 1);
        Assert.False(match1.IsEligible);
        Assert.True(match1.AlreadyPublished);
        Assert.Equal("posted", match1.PublicationStatus);
        Assert.Contains("already_published", match1.RejectionReasons);

        var match2 = result.Candidates.Single(x => x.MatchId == 2);
        Assert.False(match2.IsEligible);
        Assert.Contains("asset_already_published_today", match2.RejectionReasons);
        Assert.DoesNotContain("pair_recently_published", match2.RejectionReasons);
        Assert.DoesNotContain("already_published", match2.RejectionReasons);

        var match3 = result.Candidates.Single(x => x.MatchId == 3);
        Assert.False(match3.IsEligible);
        Assert.Contains("pair_recently_published", match3.RejectionReasons);
        Assert.DoesNotContain("asset_already_published_today", match3.RejectionReasons);

        var match4 = result.Candidates.Single(x => x.MatchId == 4);
        Assert.True(match4.IsEligible);
        Assert.Empty(match4.RejectionReasons);
        Assert.Equal(4, result.SelectedMatchId);
        Assert.True(match4.IsSelected);
    }

    [Fact]
    public async Task Candidates_ReservationOrFailedAttempt_AreNeverTreatedAsPublished()
    {
        using var db = CreateDbContext();
        SeedMatch(db, 1, symbolA: "AAAUSDT", symbolB: "BBBUSDT",
            pricesA: Strong(1), pricesB: Strong(-1));

        var publication = new PriceCrossoverPublicationService(db, Options.Create(new PriceCrossoverOptions()));
        await publication.ReserveAsync(1, new PriceCrossoverReserveRequest(), default);

        var selector = CreateSelector(db);
        var reserved = await selector.GetCandidatesAsync(6, 10, null, default);

        var held = Assert.Single(reserved.Candidates);
        Assert.False(held.IsEligible);
        Assert.False(held.AlreadyPublished);
        Assert.Equal("reserved", held.PublicationStatus);
        Assert.Equal("already_reserved", held.SkipReason);
        Assert.Contains("already_reserved", held.RejectionReasons);
        Assert.DoesNotContain("already_published", held.RejectionReasons);

        await publication.ReleaseAsync(1, "captura falhou", default);

        var released = await selector.GetCandidatesAsync(6, 10, null, default);
        var candidate = Assert.Single(released.Candidates);

        // Tentativa que nao virou publicacao: continua elegivel e nunca aparece como publicada.
        Assert.True(candidate.IsEligible);
        Assert.True(candidate.CanPost);
        Assert.False(candidate.AlreadyPublished);
        Assert.Equal("failed", candidate.PublicationStatus);
        Assert.Equal(1, released.SelectedMatchId);

        // A tentativa falha tambem nao bloqueia a rotacao de moedas.
        Assert.Empty(candidate.RejectionReasons);
    }

    [Fact]
    public async Task Candidates_FailedAttempt_DoesNotBlockRepeatedPair()
    {
        using var db = CreateDbContext();
        SeedMatch(db, 1, symbolA: "AAAUSDT", symbolB: "BBBUSDT",
            endTimeUtc: DateTime.UtcNow.AddHours(-4), pricesA: Strong(1), pricesB: Strong(-1));
        SeedMatch(db, 2, symbolA: "AAAUSDT", symbolB: "BBBUSDT",
            endTimeUtc: DateTime.UtcNow.AddHours(-1), pricesA: Strong(1), pricesB: Strong(-1));

        var publication = new PriceCrossoverPublicationService(db, Options.Create(new PriceCrossoverOptions()));
        await publication.ReserveAsync(1, new PriceCrossoverReserveRequest(), default);
        await publication.ConfirmAsync(1, new PriceCrossoverConfirmRequest { Outcome = "failed", Error = "timeout" }, default);

        var result = await CreateSelector(db).GetCandidatesAsync(6, 10, null, default);

        // Sem publicacao confirmada nao ha rotacao: o par pode ser usado de novo.
        Assert.All(result.Candidates, x => Assert.DoesNotContain("pair_recently_published", x.RejectionReasons));
        Assert.Contains(result.Candidates, x => x.MatchId == 2 && x.IsEligible);
    }

    // ------------------------------------------------------------------

    private static decimal[] Strong(int direction)
        => Oscillating(20, 1.00m, 0.05m * direction);

    private static decimal[] Flat(int count)
        => BuildPrices(count, 1.00m, 0m);

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

    private static void InsertPosted(EthicAIDbContext db, int matchId, DateTime postedAtUtc)
    {
        db.SocialPostHistory.Add(new SocialPostHistory
        {
            MatchId = matchId,
            Platform = "binance_square",
            PostText = string.Empty,
            HotScore = 0,
            CreatedAt = postedAtUtc,
            Category = PriceCrossoverCategories.PriceCrossoverHighlight,
            Status = PriceCrossoverPublicationStatuses.Posted,
            IdempotencyKey = PriceCrossoverCategories.BuildIdempotencyKey(matchId),
            ReservedAtUtc = postedAtUtc,
            PostedAtUtc = postedAtUtc
        });
        db.SaveChanges();
    }
}
