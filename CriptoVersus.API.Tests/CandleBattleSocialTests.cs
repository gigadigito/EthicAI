using System.Text.Json;
using BLL.NFTFutebol;
using CriptoVersus.API.Controllers;
using CriptoVersus.API.Services;
using DAL.NftFutebol;
using DTOs;
using EthicAI.EntityModel;
using Microsoft.AspNetCore.Mvc;
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
        var controller = new CandleBattleSocialController(service, CreatePublication(db));
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
        var posted = await candle.ConfirmAsync(47, new PriceCrossoverConfirmRequest { Outcome = "posted", ExternalPostId = "verified-47" }, default);
        Assert.True(posted.Success);
        Assert.Equal("already_published", (await candle.ConfirmAsync(47, new PriceCrossoverConfirmRequest { Outcome = "posted" }, default)).Result);
        Assert.Single(db.SocialPostHistory.Where(x => x.IdempotencyKey == "candle_battle_highlight:47"));
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
