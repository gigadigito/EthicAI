using System.Text.Json;
using System.Text.Json.Nodes;
using BLL.NFTFutebol;
using CriptoVersus.API.Controllers;
using CriptoVersus.API.Services;
using DAL.NftFutebol;
using DTOs;
using EthicAI.EntityModel;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using static CriptoVersus.API.Tests.PriceCrossoverTestHelpers;

namespace CriptoVersus.API.Tests;

public sealed class CandleBattleBroadcastSelectionTests
{
    // Base temporal proxima do relogio real: os servicos sociais consultam DateTime.UtcNow.
    private static readonly DateTime Now = Align(DateTime.UtcNow);

    // 1. Selecao da LIVE mais interessante.

    [Fact]
    public async Task Next_PrefersTheMostInterestingLiveBattle()
    {
        using var db = CreateDbContext();
        var start = Align(Now).AddMinutes(-40);
        // Interesse alto: placar equilibrado, tres alternancias de lideranca e atividade recente.
        SeedLiveBattle(db, 11, "ALTUSDT", "GTCUSDT", start, 12,
            i => i % 4 is 0 or 3 ? "left" : "right");
        // Interesse baixo: placar decidido, sem alternancia.
        SeedLiveBattle(db, 12, "AVAXUSDT", "OPUSDT", start, 12, _ => "left");

        var result = await CreateService(db).GetNextAsync(null, null, default);

        Assert.True(result.Available);
        Assert.Equal(CandleBattleBroadcastModes.Live, result.Mode);
        Assert.Equal(11, result.MatchId);
        Assert.Equal(80, result.InterestScore);
        Assert.Equal("11:5m", result.BattleId);
        Assert.Equal(6, result.ScoreA);
        Assert.Equal(6, result.ScoreB);
        Assert.Contains(CandleBattleBroadcastInterest.ReasonBalancedScore, result.SelectionReasons);
        Assert.Contains(CandleBattleBroadcastInterest.ReasonLeadAlternations, result.SelectionReasons);
        Assert.Contains(CandleBattleBroadcastInterest.ReasonRecentActivity, result.SelectionReasons);
        Assert.Contains(CandleBattleBroadcastInterest.ReasonLongRemaining, result.SelectionReasons);
        Assert.Equal("Ongoing", result.MatchStatus);
        Assert.False(result.IsFinished);
        Assert.Equal(3000, result.RemainingSeconds);
    }

    // 2. Exclusao de partidas encerradas da selecao LIVE.

    [Fact]
    public async Task Next_NeverReturnsFinishedMatchAsLive()
    {
        using var db = CreateDbContext();
        // Status ainda Ongoing (Worker atrasado), mas o fim real ja passou.
        SeedLiveBattle(db, 21, "ALTUSDT", "GTCUSDT", Align(Now).AddMinutes(-95), 0, _ => "left");

        var laggardOnly = await CreateService(db).GetNextAsync(null, null, default);
        Assert.False(laggardOnly.Available);
        Assert.Equal(CandleBattleBroadcastSkipReasons.NoContent, laggardOnly.SkipReason);
        Assert.NotEqual(CandleBattleBroadcastModes.Live, laggardOnly.Mode);

        SeedCompletedBattle(db, 22, "AVAXUSDT", "OPUSDT", Align(Now).AddMinutes(-180), 18, i => i < 11 ? "left" : "right");
        var result = await CreateService(db).GetNextAsync(null, null, default);
        Assert.True(result.Available);
        Assert.Equal(CandleBattleBroadcastModes.Replay, result.Mode);
        Assert.Equal(22, result.MatchId);
    }

    // 3. Exclusao de partidas canceladas.

    [Fact]
    public async Task Next_IgnoresCancelledMatches()
    {
        using var db = CreateDbContext();
        SeedCompletedBattle(db, 31, "ALTUSDT", "GTCUSDT", Align(Now).AddMinutes(-180), 18,
            i => i < 11 ? "left" : "right", MatchStatus.Cancelled);

        var result = await CreateService(db).GetNextAsync(null, null, default);
        Assert.False(result.Available);
        Assert.Equal(CandleBattleBroadcastSkipReasons.NoContent, result.SkipReason);

        var status = await CreateService(db).GetBroadcastStatusAsync(31, default);
        Assert.NotNull(status);
        Assert.Equal(CandleBattleBroadcastModes.None, status.Mode);
        Assert.True(status.IsFinished);
        Assert.True(status.ShouldSwitch);
        Assert.Equal(CandleBattleBroadcastSwitchReasons.MatchEnded, status.SwitchReason);
    }

    // 4. Ausencia de dados suficientes para renderizacao.

    [Fact]
    public async Task Next_RequiresRenderDataForLiveSelection()
    {
        using var db = CreateDbContext();
        // Ongoing com dois ativos validos, mas sem estado arcade e sem rounds: nada a renderizar.
        SeedMatch(db, 41, "ALTUSDT", "GTCUSDT", MatchStatus.Ongoing,
            Align(Now).AddMinutes(-30), Align(Now).AddMinutes(60));

        var result = await CreateService(db).GetNextAsync(null, null, default);
        Assert.False(result.Available);
        Assert.Equal(CandleBattleBroadcastSkipReasons.NoContent, result.SkipReason);

        // Com estado arcade a partida passa a ser elegivel.
        SeedState(db, 41, Align(Now).AddMinutes(-30), 0, false, "live");
        var withState = await CreateService(db).GetNextAsync(null, null, default);
        Assert.True(withState.Available);
        Assert.Equal(CandleBattleBroadcastModes.Live, withState.Mode);
        Assert.Equal(41, withState.MatchId);
    }

    // 5. Fallback para replay.

    [Fact]
    public async Task Next_FallsBackToReplayWhenNoLiveIsAvailable()
    {
        using var db = CreateDbContext();
        SeedCompletedBattle(db, 51, "ALTUSDT", "GTCUSDT", Align(Now).AddMinutes(-180), 18, i => i < 11 ? "left" : "right");

        var result = await CreateService(db).GetNextAsync(null, null, default);

        Assert.True(result.Available);
        Assert.Equal(CandleBattleBroadcastModes.Replay, result.Mode);
        Assert.Equal(51, result.MatchId);
        Assert.Equal("51:5m", result.BattleId);
        Assert.True(result.IsFinished);
        Assert.True(result.ReplayAvailable);
        Assert.Equal("finished", result.BattleStatus);
        Assert.Equal("Completed", result.MatchStatus);
        Assert.Equal(11, result.ScoreA);
        Assert.Equal(7, result.ScoreB);
        Assert.Equal("ALTUSDT", result.WinnerSymbol);
        Assert.True(result.InterestScore > 0);
        Assert.NotEmpty(result.SelectionReasons);
        Assert.Null(result.RemainingSeconds);
        Assert.Equal("https://criptoversus.com/pt/tv/candle/51/alt-vs-gtc", result.PlaybackUrl);
    }

    // 6. Replay indisponivel.

    [Fact]
    public async Task Next_RejectsUnavailableOrIncompleteReplays()
    {
        using var db = CreateDbContext();
        // Sem rounds persistidos.
        SeedMatch(db, 61, "ALTUSDT", "GTCUSDT", MatchStatus.Completed,
            Align(Now).AddMinutes(-180), Align(Now).AddMinutes(-90));
        var noRounds = await CreateService(db).GetNextAsync(null, null, default);
        Assert.False(noRounds.Available);
        Assert.Equal(CandleBattleBroadcastSkipReasons.NoContent, noRounds.SkipReason);

        // Rounds com lacuna real: 17 de 18 confrontos exigidos.
        SeedCompletedBattle(db, 62, "AVAXUSDT", "OPUSDT", Align(Now).AddMinutes(-180), 17, _ => "left");
        var gap = await CreateService(db).GetNextAsync(null, null, default);
        Assert.False(gap.Available);
        Assert.Equal(CandleBattleBroadcastSkipReasons.NoContent, gap.SkipReason);

        // Dados completos mas estado arcade incompleto.
        SeedCompletedBattle(db, 63, "NEARUSDT", "TAOUSDT", Align(Now).AddMinutes(-180), 18, _ => "left");
        var state = db.Set<CandleBattlesState>().Single(x => x.MatchId == 63);
        state.Complete = false;
        state.Status = "incomplete";
        await db.SaveChangesAsync();
        var incomplete = await CreateService(db).GetNextAsync(null, null, default);
        Assert.False(incomplete.Available);
        Assert.Equal(CandleBattleBroadcastSkipReasons.NoContent, incomplete.SkipReason);
    }

    // 7. Historico anti-repeticao.

    [Fact]
    public async Task Next_AvoidsRepeatingTheSameReplay()
    {
        using var db = CreateDbContext();
        var clock = new FakeTimeProvider(Now);
        var session = new CandleBattleBroadcastSessionStore();
        // Reviravolta (comeback) = maior interesse.
        SeedCompletedBattle(db, 71, "ALTUSDT", "GTCUSDT", Align(Now).AddMinutes(-180), 18, i => i < 4 ? "left" : "right");
        SeedCompletedBattle(db, 72, "AVAXUSDT", "OPUSDT", Align(Now).AddMinutes(-180), 18, _ => "left");

        var service = CreateService(db, session: session, timeProvider: clock);

        var first = await service.GetNextAsync(null, null, default);
        Assert.Equal(71, first.MatchId);
        Assert.Contains("comeback", first.SelectionReasons);

        clock.UtcNowValue = Now.AddSeconds(250);
        var second = await service.GetNextAsync(null, null, default);
        Assert.Equal(72, second.MatchId);

        clock.UtcNowValue = Now.AddSeconds(500);
        var third = await service.GetNextAsync(null, null, default);
        Assert.Equal(71, third.MatchId);
    }

    [Fact]
    public async Task Next_ReplayHoldIsNotInterruptedByPeriodicPolling()
    {
        using var db = CreateDbContext();
        var clock = new FakeTimeProvider(Now);
        SeedCompletedBattle(db, 75, "ALTUSDT", "GTCUSDT", Align(Now).AddMinutes(-180), 18, i => i < 4 ? "left" : "right");
        var service = CreateService(db, timeProvider: clock);

        var first = await service.GetNextAsync(null, null, default);
        Assert.Equal(75, first.MatchId);

        // Consultas periodicas durante o orcamento de exibicao mantem o mesmo replay.
        foreach (var offset in new[] { 10, 30, 60, 120 })
        {
            clock.UtcNowValue = Now.AddSeconds(offset);
            var held = await service.GetNextAsync(75, null, default);
            Assert.Equal(75, held.MatchId);
            Assert.Equal(CandleBattleBroadcastModes.Replay, held.Mode);
        }

        clock.UtcNowValue = Now.AddSeconds(250);
        var status = await service.GetBroadcastStatusAsync(75, default);
        Assert.NotNull(status);
        Assert.True(status.ShouldSwitch);
        Assert.Equal(CandleBattleBroadcastSwitchReasons.ReplayBudgetElapsed, status.SwitchReason);
    }

    // 8. Ausencia de qualquer conteudo.

    [Fact]
    public async Task Next_ReportsUnavailableWhenNoContentExists()
    {
        using var db = CreateDbContext();
        var result = await CreateService(db).GetNextAsync(null, null, default);
        Assert.False(result.Available);
        Assert.Equal(CandleBattleBroadcastModes.None, result.Mode);
        Assert.Equal(CandleBattleBroadcastSkipReasons.NoContent, result.SkipReason);
        Assert.Null(result.MatchId);
        Assert.Null(result.PlaybackUrl);
    }

    // 9. Empate na pontuacao e desempate deterministico.

    [Fact]
    public async Task Next_TieBreaksEqualScoresDeterministically()
    {
        foreach (var reverseSeedOrder in new[] { false, true })
        {
            using var db = CreateDbContext();
            var start = Align(Now).AddMinutes(-40);
            Func<int, string> pattern = i => i % 4 is 0 or 3 ? "left" : "right";
            if (reverseSeedOrder)
            {
                SeedLiveBattle(db, 22, "CCCUSDT", "DDDUSDT", start, 12, pattern);
                SeedLiveBattle(db, 21, "AAAUSDT", "BBBUSDT", start, 12, pattern);
            }
            else
            {
                SeedLiveBattle(db, 21, "AAAUSDT", "BBBUSDT", start, 12, pattern);
                SeedLiveBattle(db, 22, "CCCUSDT", "DDDUSDT", start, 12, pattern);
            }

            var result = await CreateService(db).GetNextAsync(null, null, default);
            Assert.Equal(CandleBattleBroadcastModes.Live, result.Mode);
            Assert.Equal(21, result.MatchId);
        }
    }

    // 10. Erros temporarios dos servicos de origem.

    [Fact]
    public async Task Next_ReportsSourceUnavailableOnTransientErrors()
    {
        using var db = CreateDbContext();
        SeedCompletedBattle(db, 81, "ALTUSDT", "GTCUSDT", Align(Now).AddMinutes(-180), 18, _ => "left");
        var social = new CountingSocialService(CreateRealSocialService(db)) { Throw = true };

        var result = await CreateService(db, social: social).GetNextAsync(null, null, default);

        Assert.False(result.Available);
        Assert.Equal(CandleBattleBroadcastSkipReasons.SourceUnavailable, result.SkipReason);

        var controller = new TvController(new StubHotMatchService(), new StubNarrationService(),
            CreateService(db, social: social), NullLogger<TvController>.Instance);
        var response = Assert.IsType<ObjectResult>((await controller.GetNextCandleBattle(null, null, default)).Result);
        Assert.Equal(StatusCodes.Status503ServiceUnavailable, response.StatusCode);
    }

    [Fact]
    public async Task Next_KeepsCurrentContentOnTransientErrors()
    {
        using var db = CreateDbContext();
        SeedCompletedBattle(db, 82, "ALTUSDT", "GTCUSDT", Align(Now).AddMinutes(-180), 18, i => i < 4 ? "left" : "right");
        var clock = new FakeTimeProvider(Now);
        var session = new CandleBattleBroadcastSessionStore();
        var social = new CountingSocialService(CreateRealSocialService(db));
        var service = CreateService(db, session: session, social: social, timeProvider: clock);

        var first = await service.GetNextAsync(null, null, default);
        Assert.Equal(82, first.MatchId);

        social.Throw = true;
        clock.UtcNowValue = Now.AddSeconds(30);
        var held = await service.GetNextAsync(82, null, default);

        Assert.True(held.Available);
        Assert.Equal(82, held.MatchId);
        Assert.Equal(CandleBattleBroadcastModes.Replay, held.Mode);
    }

    // 11. Nao interferencia nos endpoints sociais.

    [Fact]
    public async Task BroadcastSelection_DoesNotTouchSocialPublicationFlow()
    {
        using var db = CreateDbContext();
        SeedCompletedBattle(db, 91, "ALTUSDT", "GTCUSDT", Align(Now).AddMinutes(-180), 18, i => i < 11 ? "left" : "right");
        var social = CreateRealSocialService(db);
        var before = await social.GetHighlightAsync(6, "pt-BR", false, default);
        Assert.True(before.HasHighlight);
        Assert.True(before.Highlight!.CanPost);
        var interestBefore = before.Highlight.InterestScore;

        var broadcast = CreateService(db, social: social);
        var selection = await broadcast.GetNextAsync(null, null, default);
        await broadcast.GetBroadcastStatusAsync(91, default);

        Assert.Equal(91, selection.MatchId);
        Assert.Empty(db.SocialPostHistory);
        var after = await social.GetHighlightAsync(6, "pt-BR", false, default);
        Assert.True(after.HasHighlight);
        Assert.Equal(interestBefore, after.Highlight!.InterestScore);
        Assert.True(after.Highlight.CanPost);
        Assert.False(after.Highlight.AlreadyPublished);

        // Contratos sociais existentes continuam intactos.
        var controller = typeof(CandleBattleSocialController);
        Assert.NotNull(controller.GetMethod(nameof(CandleBattleSocialController.GetHighlight))!
            .GetCustomAttributes(typeof(AllowAnonymousAttribute), false).SingleOrDefault());
        foreach (var method in new[] { nameof(CandleBattleSocialController.Reserve),
                     nameof(CandleBattleSocialController.Confirm), nameof(CandleBattleSocialController.Release),
                     nameof(CandleBattleSocialController.GetCandidates) })
            Assert.Equal(SocialAutomationDefaults.PolicyName,
                Assert.Single(controller.GetMethod(method)!.GetCustomAttributes(typeof(AuthorizeAttribute), false)
                    .Cast<AuthorizeAttribute>()).Policy);
    }

    // 12. Nao alteracao das regras de pontuacao ou de candles.

    [Fact]
    public void CandleBattleRulesRemainUnchanged()
    {
        Assert.Equal("return-v1-pct-strength-tiebreak", CandleBattlesResolver.Version);
        Assert.Equal("strength-v1-b45-v25-r20-m10-h20", CandleBattlesResolver.LegacyStrengthVersion);
        Assert.Equal(300_000L, CandleBattlesResolver.PeriodMs);
        Assert.Equal(18, CandleBattlesResolver.ExpectedRounds);
        Assert.Equal(15 * 60_000L, CandleBattlesResolver.ConfirmationGraceMs);
        Assert.Equal(20, CandleBattlesResolver.HistoryLength);
        Assert.Equal(3, CandleBattleScoringService.CandleBattleDominanceThreshold);

        var winner = Candle("LEFTUSDT", 300_000, 102m);
        var loser = Candle("RIGHTUSDT", 300_000, 99m);
        Assert.Equal("left", CandleBattlesResolver.ResolveWinner(winner, loser, 50m, 50m));
        Assert.Equal("draw", CandleBattlesResolver.ResolveWinner(winner, loser with { Close = 102m }, 50m, 50m));
    }

    // 13. Construcao correta da URL publica.

    [Fact]
    public async Task Next_BuildsThePublicPlaybackUrlFromConfiguration()
    {
        using var db = CreateDbContext();
        SeedCompletedBattle(db, 101, "NEARUSDT", "TAOUSDT", Align(Now).AddMinutes(-180), 18, _ => "left");
        var withCulture = await CreateService(db).GetNextAsync(null, "en-US", default);
        Assert.Equal("https://criptoversus.com/en/tv/candle/101/near-vs-tao", withCulture.PlaybackUrl);

        var withBase = CreateService(db, new CandleBattleBroadcastOptions { PublicBaseUrl = "https://tv.example/" });
        Assert.Equal("https://tv.example/pt/tv/candle/101/near-vs-tao", withBase.GetNextAsync(null, null, default).Result.PlaybackUrl);

        Assert.False(TvCandleBattlePublicUrl.TryBuild(null, 1, "NEARUSDT", "TAOUSDT", "pt", out _));
        Assert.False(TvCandleBattlePublicUrl.TryBuild("https://criptoversus.com", 0, "NEARUSDT", "TAOUSDT", "pt", out _));
        Assert.False(TvCandleBattlePublicUrl.TryBuild("not-a-url", 1, "NEARUSDT", "TAOUSDT", "pt", out _));
        Assert.True(TvCandleBattlePublicUrl.TryBuild("https://criptoversus.com", 1, "NEARUSDT", "TAOUSDT", "ja-JP", out var url));
        Assert.Equal("https://criptoversus.com/ja/tv/candle/1/near-vs-tao", url);
    }

    // 14. Identificacao do encerramento real da partida.

    [Fact]
    public async Task BroadcastStatus_DetectsRealMatchEndAndFinalResultWindow()
    {
        using var db = CreateDbContext();
        var start = Align(Now).AddMinutes(-85);
        var end = start.AddMinutes(90);
        SeedMatch(db, 111, "ALTUSDT", "GTCUSDT", MatchStatus.Ongoing, start, end);
        SeedState(db, 111, start, 0, false, "live");
        var clock = new FakeTimeProvider(Now);
        var service = CreateService(db, timeProvider: clock);

        var live = await service.GetBroadcastStatusAsync(111, default);
        Assert.NotNull(live);
        Assert.Equal(CandleBattleBroadcastModes.Live, live.Mode);
        Assert.False(live.IsFinished);
        Assert.False(live.ShouldSwitch);
        Assert.Equal(300, live.RemainingSeconds);

        // Um candle de cinco minutos fechando nao encerra a partida.
        clock.UtcNowValue = end.AddMinutes(-5);
        var beforeEnd = await service.GetBroadcastStatusAsync(111, default);
        Assert.False(beforeEnd!.IsFinished);
        Assert.False(beforeEnd.ShouldSwitch);

        // Fim real + janela de resultado final: o conteudo continua no ar.
        clock.UtcNowValue = end.AddSeconds(5);
        var justEnded = await service.GetBroadcastStatusAsync(111, default);
        Assert.True(justEnded!.IsFinished);
        Assert.Equal(CandleBattleBroadcastModes.Live, justEnded.Mode);
        Assert.False(justEnded.ShouldSwitch);
        Assert.Equal(0, justEnded.RemainingSeconds);

        // Depois da janela o diretor troca de conteudo.
        clock.UtcNowValue = end.AddSeconds(15);
        var afterHold = await service.GetBroadcastStatusAsync(111, default);
        Assert.True(afterHold!.IsFinished);
        Assert.True(afterHold.ShouldSwitch);
        Assert.Equal(CandleBattleBroadcastSwitchReasons.FinalResultDisplayed, afterHold.SwitchReason);
    }

    [Fact]
    public async Task BroadcastStatus_FallsBackToConfiguredMatchDurationWhenEndTimeIsMissing()
    {
        using var db = CreateDbContext();
        var start = Align(Now).AddMinutes(-20);
        SeedMatch(db, 112, "ALTUSDT", "GTCUSDT", MatchStatus.Ongoing, start, null);
        SeedState(db, 112, start, 0, false, "live");

        var status = await CreateService(db).GetBroadcastStatusAsync(112, default);

        Assert.NotNull(status);
        Assert.False(status.IsFinished);
        Assert.Equal(70 * 60, status.RemainingSeconds);
    }

    // 15. Comportamento do cache durante transicoes de estado.

    [Fact]
    public async Task Next_CachesEmptyResultsUntilTheCacheExpires()
    {
        using var db = CreateDbContext();
        SeedMatch(db, 121, "ALTUSDT", "GTCUSDT", MatchStatus.Completed,
            Align(Now).AddMinutes(-180), Align(Now).AddMinutes(-90));
        var clock = new FakeTimeProvider(Now);
        var social = new CountingSocialService(CreateRealSocialService(db));
        var service = CreateService(db, social: social, timeProvider: clock);

        var first = await service.GetNextAsync(null, null, default);
        Assert.False(first.Available);
        Assert.Equal(1, social.Calls);

        clock.UtcNowValue = Now.AddSeconds(10);
        var cached = await service.GetNextAsync(null, null, default);
        Assert.False(cached.Available);
        Assert.Equal(CandleBattleBroadcastSkipReasons.NoContent, cached.SkipReason);
        Assert.Equal(1, social.Calls);

        clock.UtcNowValue = Now.AddSeconds(16);
        var afterExpiry = await service.GetNextAsync(null, null, default);
        Assert.False(afterExpiry.Available);
        Assert.Equal(2, social.Calls);
    }

    [Fact]
    public async Task Next_DropsCachedLiveContentWhenTheMatchEnds()
    {
        using var db = CreateDbContext();
        var start = Align(Now).AddMinutes(-40);
        SeedLiveBattle(db, 131, "ALTUSDT", "GTCUSDT", start, 10, _ => "left");
        SeedCompletedBattle(db, 132, "AVAXUSDT", "OPUSDT", Align(Now).AddMinutes(-180), 18, _ => "left");
        var clock = new FakeTimeProvider(Now);
        var session = new CandleBattleBroadcastSessionStore();
        var service = CreateService(db, session: session, timeProvider: clock);

        var first = await service.GetNextAsync(null, null, default);
        Assert.Equal(131, first.MatchId);
        Assert.Equal(CandleBattleBroadcastModes.Live, first.Mode);
        var selectedAt = session.SelectedAtUtc;

        // A partida termina de fato (fim real ja passou) e o Worker a finaliza.
        var match = db.Match.Single(x => x.MatchId == 131);
        match.Status = MatchStatus.Completed;
        match.EndTime = start.AddMinutes(90);
        db.Set<CandleBattlesState>().Single(x => x.MatchId == 131).Status = "finished";
        await db.SaveChangesAsync();

        clock.UtcNowValue = start.AddMinutes(90).AddSeconds(15);
        var afterEnd = await service.GetNextAsync(131, null, default);

        Assert.NotEqual(CandleBattleBroadcastModes.Live, afterEnd.Mode);
        Assert.Equal(132, afterEnd.MatchId);
        Assert.NotEqual(selectedAt, session.SelectedAtUtc);
    }

    // Contrato JSON e codigos HTTP.

    [Fact]
    public async Task Controller_ExposesJsonContractAndStatusCodes()
    {
        using var db = CreateDbContext();
        var start = Align(Now).AddMinutes(-40);
        SeedLiveBattle(db, 141, "ALTUSDT", "GTCUSDT", start, 12, i => i % 4 is 0 or 3 ? "left" : "right");
        var service = CreateService(db);
        var controller = new TvController(new StubHotMatchService(), new StubNarrationService(), service,
            NullLogger<TvController>.Instance);

        var next = Assert.IsType<CandleBattleBroadcastSelectionDto>(
            Assert.IsType<OkObjectResult>((await controller.GetNextCandleBattle(null, null, default)).Result).Value);
        var json = JsonNode.Parse(JsonSerializer.Serialize(next, new JsonSerializerOptions(JsonSerializerDefaults.Web)))!;
        Assert.True(json["available"]!.GetValue<bool>());
        Assert.Equal("live", json["mode"]!.GetValue<string>());
        Assert.Equal(141, json["matchId"]!.GetValue<int>());
        Assert.Equal("141:5m", json["battleId"]!.GetValue<string>());
        Assert.Equal("ALTUSDT", json["assetA"]!.GetValue<string>());
        Assert.Equal(80, json["interestScore"]!.GetValue<int>());
        Assert.Equal("Ongoing", json["matchStatus"]!.GetValue<string>());
        Assert.False(json["isFinished"]!.GetValue<bool>());
        Assert.Equal(3000, json["remainingSeconds"]!.GetValue<int>());
        Assert.Equal("https://criptoversus.com/pt/tv/candle/141/alt-vs-gtc", json["playbackUrl"]!.GetValue<string>());
        Assert.Equal(10, json["finalResultDisplaySeconds"]!.GetValue<int>());
        Assert.Equal(10, json["statusPollingSeconds"]!.GetValue<int>());
        Assert.True(json["selectionReasons"]!.AsArray().Count >= 2);
        Assert.False(string.IsNullOrWhiteSpace(json["generatedAtUtc"]!.GetValue<string>()));

        var status = Assert.IsType<CandleBattleBroadcastStatusDto>(
            Assert.IsType<OkObjectResult>((await controller.GetCandleBattleBroadcastStatus(141, default)).Result).Value);
        var statusJson = JsonNode.Parse(JsonSerializer.Serialize(status, new JsonSerializerOptions(JsonSerializerDefaults.Web)))!;
        Assert.Equal(141, statusJson["matchId"]!.GetValue<int>());
        Assert.Equal("live", statusJson["mode"]!.GetValue<string>());
        Assert.False(statusJson["shouldSwitch"]!.GetValue<bool>());
        Assert.Null(statusJson["switchReason"]?.GetValue<string>());

        Assert.IsType<NotFoundResult>((await controller.GetCandleBattleBroadcastStatus(999, default)).Result);
        Assert.IsType<BadRequestObjectResult>((await controller.GetCandleBattleBroadcastStatus(0, default)).Result);
    }

    // Validacao de configuracao: valores fora de faixa viram limites seguros.

    [Fact]
    public void Options_NormalizeClampsUnsafeValuesToSafeDefaults()
    {
        var options = new CandleBattleBroadcastOptions
        {
            MinimumLiveRemainingSeconds = -5,
            FinalResultDisplaySeconds = 100_000,
            SelectionCacheSeconds = -1,
            StatusPollingSeconds = 0,
            ReplayHistorySize = 100_000,
            ReplayDisplaySeconds = 1,
            ReplayMinimumDisplaySeconds = 99_999,
            ReplayLookbackHours = 0,
            MaxReplayCandidates = 0,
            MatchDurationMinutes = 0,
            WeightBalance = -10,
            SignificantCandleMovementPercent = 0m,
            ComfortableRemainingSeconds = 0,
            MaxExpectedLeadAlternations = 0,
            ActivityWindowMinutes = 0,
            RecentVolatilityRounds = 0,
            PlaybackCulture = "   "
        };

        options.Normalize();

        Assert.Equal(0, options.MinimumLiveRemainingSeconds);
        Assert.Equal(300, options.FinalResultDisplaySeconds);
        Assert.Equal(0, options.SelectionCacheSeconds);
        Assert.Equal(1, options.StatusPollingSeconds);
        Assert.Equal(200, options.ReplayHistorySize);
        Assert.Equal(30, options.ReplayDisplaySeconds);
        Assert.Equal(30, options.ReplayMinimumDisplaySeconds);
        Assert.Equal(1, options.ReplayLookbackHours);
        Assert.Equal(1, options.MaxReplayCandidates);
        Assert.Equal(1, options.MatchDurationMinutes);
        Assert.Equal(0, options.WeightBalance);
        Assert.Equal(.01m, options.SignificantCandleMovementPercent);
        Assert.Equal(60, options.ComfortableRemainingSeconds);
        Assert.Equal(1, options.MaxExpectedLeadAlternations);
        Assert.Equal(5, options.ActivityWindowMinutes);
        Assert.Equal(1, options.RecentVolatilityRounds);
        Assert.Equal("pt", options.PlaybackCulture);

        // Padroes sao seguros mesmo sem nenhuma secao de configuracao.
        var defaults = new CandleBattleBroadcastOptions();
        defaults.Normalize();
        Assert.True(defaults.Enabled);
        Assert.True(defaults.PreferLive);
        Assert.True(defaults.AllowReplayFallback);
        Assert.Equal(600, defaults.MinimumLiveRemainingSeconds);
        Assert.Equal(10, defaults.FinalResultDisplaySeconds);
        Assert.Equal(15, defaults.SelectionCacheSeconds);
    }

    // ------------------------------------------------------------------ helpers

    private static DateTime Align(DateTime value)
        => new(value.Year, value.Month, value.Day, value.Hour, value.Minute / 5 * 5, 0, DateTimeKind.Utc);

    private static CandleBattleBroadcastSelectionService CreateService(EthicAIDbContext db,
        CandleBattleBroadcastOptions? options = null, ICandleBattleBroadcastSessionStore? session = null,
        ICandleBattleSocialService? social = null, TimeProvider? timeProvider = null)
        => new(db, social ?? CreateRealSocialService(db), session ?? new CandleBattleBroadcastSessionStore(),
            Options.Create(options ?? new CandleBattleBroadcastOptions()), CreateConfiguration(),
            NullLogger<CandleBattleBroadcastSelectionService>.Instance, timeProvider ?? new FakeTimeProvider(Now));

    private static CandleBattleSocialService CreateRealSocialService(EthicAIDbContext db)
        => new(db, new CandleBattlePublicationService(db, Options.Create(new CandleBattleSocialOptions())),
            Options.Create(new CandleBattleSocialOptions()), CreateConfiguration(),
            NullLogger<CandleBattleSocialService>.Instance);

    private static Match SeedMatch(EthicAIDbContext db, int matchId, string symbolA, string symbolB,
        MatchStatus status, DateTime? startTimeUtc, DateTime? endTimeUtc)
    {
        var baseId = matchId * 1000;
        var currencyA = new Currency { CurrencyId = baseId + 1, Name = symbolA, Symbol = symbolA, LastUpdated = Now };
        var currencyB = new Currency { CurrencyId = baseId + 2, Name = symbolB, Symbol = symbolB, LastUpdated = Now };
        var teamA = new Team { TeamId = baseId + 11, CurrencyId = currencyA.CurrencyId, Currency = currencyA };
        var teamB = new Team { TeamId = baseId + 12, CurrencyId = currencyB.CurrencyId, Currency = currencyB };
        db.Currency.AddRange(currencyA, currencyB);
        db.Team.AddRange(teamA, teamB);
        var match = new Match
        {
            MatchId = matchId,
            TeamAId = teamA.TeamId,
            TeamBId = teamB.TeamId,
            TeamA = teamA,
            TeamB = teamB,
            Status = status,
            StartTime = startTimeUtc,
            EndTime = endTimeUtc
        };
        db.Match.Add(match);
        db.SaveChanges();
        return match;
    }

    private static void SeedRounds(EthicAIDbContext db, int matchId, DateTime alignedStart, string symbolA,
        string symbolB, int rounds, Func<int, string> winnerAt)
    {
        var first = new DateTimeOffset(alignedStart).ToUnixTimeMilliseconds();
        for (var i = 0; i < rounds; i++)
        {
            var open = first + i * CandleBattlesResolver.PeriodMs;
            var winner = winnerAt(i);
            var left = Candle(symbolA, open, winner == "left" ? 102m : 99m);
            var right = Candle(symbolB, open, winner == "right" ? 102m : 99m);
            db.Set<CandleBattlesRound>().Add(new CandleBattlesRound
            {
                MatchId = matchId,
                OpenTimeUtc = DateTimeOffset.FromUnixTimeMilliseconds(open).UtcDateTime,
                LeftCandleJson = JsonSerializer.Serialize(left),
                RightCandleJson = JsonSerializer.Serialize(right),
                LeftStrength = 50m,
                RightStrength = 50m,
                Winner = CandleBattlesResolver.ResolveWinner(left, right, 50m, 50m),
                RuleVersion = CandleBattlesResolver.Version,
                ConfirmedAtUtc = DateTimeOffset.FromUnixTimeMilliseconds(open + CandleBattlesResolver.PeriodMs).UtcDateTime
            });
        }
        db.SaveChanges();
    }

    private static void SeedState(EthicAIDbContext db, int matchId, DateTime alignedStart, int rounds,
        bool complete, string status)
    {
        db.Set<CandleBattlesState>().Add(new CandleBattlesState
        {
            MatchId = matchId,
            NextOpenUtc = alignedStart.AddMinutes(rounds * 5),
            UpdatedAtUtc = Now,
            Complete = complete,
            Status = status
        });
        db.SaveChanges();
    }

    private static void SeedLiveBattle(EthicAIDbContext db, int matchId, string symbolA, string symbolB,
        DateTime startTimeUtc, int rounds, Func<int, string> winnerAt)
    {
        var start = Align(startTimeUtc);
        SeedMatch(db, matchId, symbolA, symbolB, MatchStatus.Ongoing, start, start.AddMinutes(90));
        SeedRounds(db, matchId, start, symbolA, symbolB, rounds, winnerAt);
        SeedState(db, matchId, start, rounds, false, "live");
    }

    private static void SeedCompletedBattle(EthicAIDbContext db, int matchId, string symbolA, string symbolB,
        DateTime startTimeUtc, int rounds, Func<int, string> winnerAt,
        MatchStatus status = MatchStatus.Completed)
    {
        var start = Align(startTimeUtc);
        SeedMatch(db, matchId, symbolA, symbolB, status, start, start.AddMinutes(90));
        SeedRounds(db, matchId, start, symbolA, symbolB, rounds, winnerAt);
        SeedState(db, matchId, start, rounds, status == MatchStatus.Completed, status == MatchStatus.Completed ? "finished" : "live");
    }

    private static CandleBattlesCandleDto Candle(string symbol, long openMs, decimal close)
        => new(symbol, openMs, openMs + CandleBattlesResolver.PeriodMs, openMs + CandleBattlesResolver.PeriodMs,
            100m, Math.Max(100m, close), Math.Min(100m, close), close, 1000m, true, 50m);

    private sealed class FakeTimeProvider(DateTime utcNow) : TimeProvider
    {
        public DateTime UtcNowValue { get; set; } = utcNow;
        public override DateTimeOffset GetUtcNow()
            => new(DateTime.SpecifyKind(UtcNowValue, DateTimeKind.Utc), TimeSpan.Zero);
    }

    private sealed class CountingSocialService(ICandleBattleSocialService inner) : ICandleBattleSocialService
    {
        public int Calls { get; private set; }
        public bool Throw { get; set; }

        public Task<CandleBattleSocialResponse?> GetByMatchIdAsync(int matchId, string language, bool includeRounds, CancellationToken ct)
        {
            Calls++;
            if (Throw) throw new InvalidOperationException("transient source failure");
            return inner.GetByMatchIdAsync(matchId, language, includeRounds, ct);
        }

        public Task<CandleBattleHighlightResponse> GetHighlightAsync(int lookbackHours, string language, bool includeRounds, CancellationToken ct)
            => inner.GetHighlightAsync(lookbackHours, language, includeRounds, ct);

        public Task<CandleBattleCandidatesResponse> GetCandidatesAsync(int lookbackHours, int take, CancellationToken ct)
            => inner.GetCandidatesAsync(lookbackHours, take, ct);
    }

    private sealed class StubHotMatchService : ITvHotMatchService
    {
        public Task<TvHotMatchDto> GetHotMatchAsync(CancellationToken ct) => Task.FromResult(new TvHotMatchDto());
        public Task<TvHotMatchDto?> GetMatchBroadcastAsync(int matchId, CancellationToken ct) => Task.FromResult<TvHotMatchDto?>(null);
    }

    private sealed class StubNarrationService : ITvAiNarrationService
    {
        public Task<TvNarrationResponse> GenerateNarrationAsync(int matchId, TvNarrationRequest request, CancellationToken ct)
            => Task.FromResult(new TvNarrationResponse());
    }
}
