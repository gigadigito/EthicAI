using System.Text.Json;
using System.Text.Json.Nodes;
using BLL.NFTFutebol;
using CriptoVersus.API.Controllers;
using CriptoVersus.API.Services;
using DAL.NftFutebol;
using DTOs;
using EthicAI.EntityModel;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Authorization;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using static CriptoVersus.API.Tests.PriceCrossoverTestHelpers;

namespace CriptoVersus.API.Tests;

public sealed class CandleBattleSocialTests
{
    [Fact]
    public async Task ExistingCompletedBattle_UsesPersistedArcadeResultAndPublicUrl()
    {
        using var db = CreateDbContext();
        SeedBattle(db, 41, "ALTUSDT", "GTCUSDT");
        var service = CreateService(db);
        var result = await service.GetByMatchIdAsync(41, "pt-BR", true, default);
        Assert.NotNull(result);
        Assert.Equal("ALT/USDT", result.AssetA.Pair);
        Assert.Equal("GTC/USDT", result.AssetB.Pair);
        Assert.Equal(18, result.ConfrontationCount);
        Assert.Equal(18, result.Rounds.Count);
        Assert.Equal(result.Rounds.Count(x => x.Winner == "left"), result.ScoreA);
        Assert.Equal(result.Rounds.Count(x => x.Winner == "right"), result.ScoreB);
        Assert.NotEqual(99, result.ScoreA);
        Assert.True(result.CanPost);
        Assert.True(result.PublicUrlAvailable);
        Assert.Equal("https://www.criptoversus.com/pt/social/candle-battle/41", result.PublicUrl);
        Assert.Equal(result.ScoreA > result.ScoreB ? "ALTUSDT" : result.ScoreB > result.ScoreA ? "GTCUSDT" : null, result.WinnerSymbol);

        var feed = Assert.IsType<CandleBattlesFeedDto>(Assert.IsType<OkObjectResult>(
            (await new CandleBattlesController(db).Get(41)).Result).Value);
        Assert.Equal(feed.ScoreLeft, result.ScoreA);
        Assert.Equal(feed.ScoreRight, result.ScoreB);
        Assert.Equal(feed.Rounds.Select(x => x.Winner), result.Rounds.Select(x => x.Winner));
    }

    [Fact]
    public async Task MissingOngoingAndIncompleteBattles_NeverBecomeCandidates()
    {
        using var db = CreateDbContext();
        var service = CreateService(db);
        Assert.Null(await service.GetByMatchIdAsync(999, "pt-BR", true, default));
        var controller = new CandleBattleSocialController(service, CreatePublication(db), NullLogger<CandleBattleSocialController>.Instance);
        Assert.IsType<NotFoundResult>((await controller.GetByMatchId(999)).Result);

        SeedBattle(db, 42, "AVAXUSDT", "OPUSDT", MatchStatus.Ongoing);
        var ongoing = await service.GetByMatchIdAsync(42, "pt-BR", true, default);
        Assert.False(ongoing!.CanPost);
        Assert.Equal("match_not_completed", ongoing.SkipReason);
        Assert.Null(ongoing.PublicUrl);

        SeedBattle(db, 43, "COMPUSDT", "ONDOUSDT", rounds: 17);
        var incomplete = await service.GetByMatchIdAsync(43, "pt-BR", true, default);
        Assert.False(incomplete!.CanPost);
        Assert.Equal("incomplete_battle_data", incomplete.SkipReason);
        Assert.True(incomplete.ReplayAvailable);

        SeedMatch(db, 44, "AAVEUSDT", "LINKUSDT", skipSnapshots: true);
        var absent = await service.GetByMatchIdAsync(44, "pt-BR", true, default);
        Assert.False(absent!.ReplayAvailable);
        Assert.Empty(absent.Rounds);
    }

    [Fact]
    public async Task Candidates_OrderByInterest_AndReturnNoneWhenNoEligibleBattle()
    {
        using var db = CreateDbContext();
        SeedBattle(db, 45, "ALTUSDT", "GTCUSDT", pattern: i => i < 9 ? "left" : "right");
        SeedBattle(db, 46, "AVAXUSDT", "OPUSDT", pattern: i => i < 16 ? "left" : "right");
        var service = CreateService(db);
        var candidates = await service.GetCandidatesAsync(6, 10, default);
        Assert.Equal(2, candidates.EligibleCount);
        Assert.Equal(candidates.Candidates.Max(x => x.InterestScore), candidates.Candidates[0].InterestScore);
        Assert.Equal(candidates.Candidates[0].MatchId, candidates.SelectedMatchId);
        Assert.True((await service.GetHighlightAsync(6, "pt-BR", false, default)).HasHighlight);

        using var emptyDb = CreateDbContext();
        var empty = await CreateService(emptyDb).GetHighlightAsync(6, "pt-BR", true, default);
        Assert.False(empty.HasHighlight);
        Assert.Null(empty.Highlight);
        Assert.Equal("no_completed_matches_in_window", empty.SkipReason);
    }

    [Fact]
    public async Task Publication_UsesSharedStateMachine_WithSeparateCategoryAndUnknownOutcomeBlock()
    {
        using var db = CreateDbContext();
        SeedBattle(db, 47, "ALTUSDT", "GTCUSDT");
        var candle = CreatePublication(db);
        var price = new PriceCrossoverPublicationService(db, Options.Create(new PriceCrossoverOptions()));
        var first = await candle.ReserveAsync(47, new PriceCrossoverReserveRequest { Owner = "n8n" }, default);
        Assert.True(first.Success);
        Assert.Equal("candle_battle_highlight:47", first.Publication!.IdempotencyKey);
        Assert.True((await price.ReserveAsync(47, new PriceCrossoverReserveRequest(), default)).Success);
        var duplicate = await candle.ReserveAsync(47, new PriceCrossoverReserveRequest(), default);
        Assert.False(duplicate.Success);
        Assert.Equal("already_reserved", duplicate.Result);
        var reservedPage = await CreateService(db).GetByMatchIdAsync(47, "pt-BR", false, default);
        Assert.False(reservedPage!.CanPost);
        Assert.True(reservedPage.PublicUrlAvailable);

        var row = db.SocialPostHistory.Single(x => x.IdempotencyKey == "candle_battle_highlight:47");
        row.LeaseExpiresAtUtc = null;
        await db.SaveChangesAsync();
        Assert.Equal("already_reserved", (await CreateService(db).GetByMatchIdAsync(47, "pt-BR", false, default))!.SkipReason);
        row.LeaseExpiresAtUtc = DateTime.UtcNow.AddMinutes(-1);
        await db.SaveChangesAsync();
        Assert.True((await candle.ReserveAsync(47, new PriceCrossoverReserveRequest(), default)).Success);

        var unknown = await candle.ConfirmAsync(47, new PriceCrossoverConfirmRequest { Outcome = "unknown" }, default);
        Assert.Equal(PriceCrossoverPublicationStatuses.ReconciliationRequired, unknown.Publication!.Status);
        Assert.Equal("reconciliation_required", (await candle.ReserveAsync(47, new PriceCrossoverReserveRequest(), default)).Result);
        Assert.True((await candle.ReleaseAsync(47, "reconciled", default)).Success);
        Assert.True((await candle.ReserveAsync(47, new PriceCrossoverReserveRequest(), default)).Success);
        Assert.Equal("failed", (await candle.ConfirmAsync(47, new PriceCrossoverConfirmRequest { Outcome = "failed" }, default)).Result);
        Assert.True((await candle.ReserveAsync(47, new PriceCrossoverReserveRequest(), default)).Success);
        var currentReservation = await candle.GetStateAsync(47, default);
        var posted = await candle.ConfirmAsync(47, new PriceCrossoverConfirmRequest
        {
            Outcome = "posted", ExternalPostId = "verified-47", ReservedAtUtc = currentReservation!.ReservedAtUtc
        }, default);
        Assert.True(posted.Success);
        Assert.Equal("posted", (await candle.ConfirmAsync(47, new PriceCrossoverConfirmRequest
        {
            Outcome = "posted", ExternalPostId = "verified-47", ReservedAtUtc = currentReservation.ReservedAtUtc
        }, default)).Result);
        Assert.Equal("already_published", (await candle.ConfirmAsync(47, new PriceCrossoverConfirmRequest { Outcome = "posted" }, default)).Result);
        Assert.Single(db.SocialPostHistory.Where(x => x.IdempotencyKey == "candle_battle_highlight:47"));
    }

    [Fact]
    public async Task Controller_PublicGetContracts_ExposePersistedBattleAndCandidates()
    {
        using var db = CreateDbContext();
        SeedBattle(db, 49, "ALTUSDT", "GTCUSDT");
        var controller = new CandleBattleSocialController(CreateService(db), CreatePublication(db), NullLogger<CandleBattleSocialController>.Instance);

        var battle = Assert.IsType<CandleBattleSocialResponse>(Assert.IsType<OkObjectResult>(
            (await controller.GetByMatchId(49)).Result).Value);
        var json = JsonNode.Parse(JsonSerializer.Serialize(battle, new JsonSerializerOptions(JsonSerializerDefaults.Web)))!;
        Assert.Equal(49, json["matchId"]!.GetValue<int>());
        Assert.Equal(11, json["scoreA"]!.GetValue<int>());
        Assert.Equal(7, json["scoreB"]!.GetValue<int>());
        Assert.Equal(18, json["rounds"]!.AsArray().Count);
        Assert.Equal("ALT/USDT", json["assetA"]!["pair"]!.GetValue<string>());
        Assert.True(json["publicUrlAvailable"]!.GetValue<bool>());

        var highlight = Assert.IsType<CandleBattleHighlightResponse>(Assert.IsType<OkObjectResult>(
            (await controller.GetHighlight()).Result).Value);
        Assert.True(highlight.HasHighlight);
        Assert.Equal(49, highlight.Highlight!.MatchId);

        var candidates = Assert.IsType<CandleBattleCandidatesResponse>(Assert.IsType<OkObjectResult>(
            (await controller.GetCandidates()).Result).Value);
        Assert.Equal(49, candidates.SelectedMatchId);
        Assert.Single(candidates.Candidates);
    }

    [Fact]
    public async Task Controller_RequiresAutomationPolicyAndCurrentReservationToken()
    {
        using var db = CreateDbContext();
        SeedBattle(db, 48, "ALTUSDT", "GTCUSDT");
        var controller = new CandleBattleSocialController(CreateService(db), CreatePublication(db), NullLogger<CandleBattleSocialController>.Instance);
        Assert.NotNull(typeof(CandleBattleSocialController).GetMethod(nameof(CandleBattleSocialController.GetByMatchId))!
            .GetCustomAttributes(typeof(AllowAnonymousAttribute), false).SingleOrDefault());
        foreach (var method in new[] { nameof(CandleBattleSocialController.GetCandidates),
                     nameof(CandleBattleSocialController.Reserve), nameof(CandleBattleSocialController.Confirm),
                     nameof(CandleBattleSocialController.Release) })
            Assert.Equal(SocialAutomationDefaults.PolicyName,
                Assert.Single(typeof(CandleBattleSocialController).GetMethod(method)!
                    .GetCustomAttributes(typeof(AuthorizeAttribute), false).Cast<AuthorizeAttribute>()).Policy);

        var reserve = Assert.IsType<OkObjectResult>((await controller.Reserve(48, new PriceCrossoverReserveRequest())).Result);
        var token = Assert.IsType<PriceCrossoverPublicationResult>(reserve.Value).Publication!.ReservedAtUtc;
        Assert.NotNull(token);
        var duplicate = Assert.IsType<ConflictObjectResult>((await controller.Reserve(48, new PriceCrossoverReserveRequest())).Result);
        Assert.Equal("already_reserved", Assert.IsType<PriceCrossoverPublicationResult>(duplicate.Value).Result);
        Assert.IsType<BadRequestObjectResult>((await controller.Confirm(48,
            new PriceCrossoverConfirmRequest { Outcome = "posted", ExternalPostId = "verified-48" })).Result);
        Assert.IsType<BadRequestObjectResult>((await controller.Confirm(48,
            new PriceCrossoverConfirmRequest { Outcome = "posted", ReservedAtUtc = token })).Result);
        Assert.IsType<BadRequestObjectResult>((await controller.Release(48,
            new PriceCrossoverReleaseRequest { Reason = "retry" })).Result);

        var stale = token!.Value.AddSeconds(-1);
        var conflict = Assert.IsType<ConflictObjectResult>((await controller.Confirm(48,
            new PriceCrossoverConfirmRequest { Outcome = "failed", ReservedAtUtc = stale })).Result);
        Assert.Equal("stale_reservation", Assert.IsType<PriceCrossoverPublicationResult>(conflict.Value).Result);
        Assert.IsType<OkObjectResult>((await controller.Release(48,
            new PriceCrossoverReleaseRequest { Reason = "retry", ReservedAtUtc = token })).Result);
    }

    private static CandleBattleSocialService CreateService(EthicAIDbContext db)
        => new(db, CreatePublication(db), Options.Create(new CandleBattleSocialOptions()), CreateConfiguration());

    private static CandleBattlePublicationService CreatePublication(EthicAIDbContext db)
        => new(db, Options.Create(new CandleBattleSocialOptions()));

    private static void SeedBattle(EthicAIDbContext db, int id, string left, string right,
        MatchStatus status = MatchStatus.Completed, int rounds = 18, Func<int, string>? pattern = null)
    {
        var now = DateTime.UtcNow.AddHours(-2);
        var aligned = new DateTime(now.Year, now.Month, now.Day, now.Hour, now.Minute / 5 * 5, 0, DateTimeKind.Utc);
        SeedMatch(db, id, left, right, status, scoreA: 99, scoreB: 0,
            startTimeUtc: aligned, endTimeUtc: aligned.AddMinutes(90), skipSnapshots: true);
        var first = new DateTimeOffset(aligned).ToUnixTimeMilliseconds();
        for (var i = 0; i < rounds; i++)
        {
            var open = first + i * CandleBattlesResolver.PeriodMs;
            var winner = pattern?.Invoke(i) ?? (i < 11 ? "left" : "right");
            var leftCandle = Candle(left, open, winner == "left" ? 102m : 99m);
            var rightCandle = Candle(right, open, winner == "right" ? 102m : 99m);
            db.Set<CandleBattlesRound>().Add(new CandleBattlesRound
            {
                MatchId = id, OpenTimeUtc = DateTimeOffset.FromUnixTimeMilliseconds(open).UtcDateTime,
                LeftCandleJson = JsonSerializer.Serialize(leftCandle), RightCandleJson = JsonSerializer.Serialize(rightCandle),
                LeftStrength = 50m, RightStrength = 50m,
                Winner = CandleBattlesResolver.ResolveWinner(leftCandle, rightCandle, 50m, 50m),
                RuleVersion = CandleBattlesResolver.Version,
                ConfirmedAtUtc = DateTimeOffset.FromUnixTimeMilliseconds(open + CandleBattlesResolver.PeriodMs).UtcDateTime
            });
        }
        db.Set<CandleBattlesState>().Add(new CandleBattlesState
        {
            MatchId = id, NextOpenUtc = aligned.AddMinutes(rounds * 5), UpdatedAtUtc = DateTime.UtcNow,
            Complete = status == MatchStatus.Completed, Status = status == MatchStatus.Completed ? "finished" : "live"
        });
        db.SaveChanges();
    }

    private static CandleBattlesCandleDto Candle(string symbol, long open, decimal close)
        => new(symbol, open, open + CandleBattlesResolver.PeriodMs,
            open + CandleBattlesResolver.PeriodMs, 100m, Math.Max(100m, close), Math.Min(100m, close), close,
            1000m, true, 50m);
}
