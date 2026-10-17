using CriptoVersus.API.Services;
using DAL.NftFutebol;
using DTOs;
using EthicAI.EntityModel;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace CriptoVersus.API.Tests;

public sealed class PriceCrossoverPublicationTests
{
    [Fact]
    public async Task Reserve_CreatesReservedRow_WithIdempotencyKey()
    {
        using var db = CreateDbContext();
        SeedMatch(db, 1);

        var service = CreateService(db);
        var result = await service.ReserveAsync(1, new PriceCrossoverReserveRequest { Owner = "n8n" }, default);

        Assert.True(result.Success);
        Assert.Equal("reserved", result.Result);
        Assert.Equal(PriceCrossoverPublicationStatuses.Reserved, result.Publication!.Status);
        Assert.Equal("price_crossover_highlight:1", result.Publication!.IdempotencyKey);
        Assert.NotNull(result.Publication!.LeaseExpiresAtUtc);
    }

    [Fact]
    public async Task Reserve_IsIdempotentPerMatch_BlocksSecondReservation()
    {
        using var db = CreateDbContext();
        SeedMatch(db, 1);

        var service = CreateService(db);
        await service.ReserveAsync(1, new PriceCrossoverReserveRequest(), default);
        var second = await service.ReserveAsync(1, new PriceCrossoverReserveRequest(), default);

        Assert.False(second.Success);
        Assert.Equal("already_reserved", second.Result);
    }

    [Fact]
    public async Task Reserve_ReclaimsExpiredLease()
    {
        using var db = CreateDbContext();
        SeedMatch(db, 1);

        var service = CreateService(db);
        await service.ReserveAsync(1, new PriceCrossoverReserveRequest { LeaseSeconds = 1 }, default);

        // Forca o lease a expirar.
        var row = db.SocialPostHistory.Single(x => x.IdempotencyKey == "price_crossover_highlight:1");
        row.LeaseExpiresAtUtc = DateTime.UtcNow.AddMinutes(-5);
        await db.SaveChangesAsync();

        var reclaim = await service.ReserveAsync(1, new PriceCrossoverReserveRequest(), default);

        Assert.True(reclaim.Success);
        Assert.Equal("reserved", reclaim.Result);
    }

    [Fact]
    public async Task Confirm_Posted_RecordsExternalIds()
    {
        using var db = CreateDbContext();
        SeedMatch(db, 1);

        var service = CreateService(db);
        await service.ReserveAsync(1, new PriceCrossoverReserveRequest(), default);

        var confirm = await service.ConfirmAsync(1, new PriceCrossoverConfirmRequest
        {
            Outcome = "posted",
            ExternalPostId = "binance-post-99",
            ExternalPostUrl = "https://example.invalid/p/99"
        }, default);

        Assert.True(confirm.Success);
        Assert.Equal("posted", confirm.Publication!.Status);
        Assert.Equal("binance-post-99", confirm.Publication!.ExternalPostId);
        Assert.NotNull(confirm.Publication!.PostedAtUtc);
    }

    [Fact]
    public async Task Confirm_UnknownOutcome_RequiresReconciliation_AndBlocksRepublish()
    {
        using var db = CreateDbContext();
        SeedMatch(db, 1);

        var service = CreateService(db);
        await service.ReserveAsync(1, new PriceCrossoverReserveRequest(), default);

        var confirm = await service.ConfirmAsync(1, new PriceCrossoverConfirmRequest
        {
            Outcome = "unknown",
            Error = "timeout do browserless"
        }, default);

        Assert.True(confirm.Success);
        Assert.Equal(PriceCrossoverPublicationStatuses.ReconciliationRequired, confirm.Publication!.Status);
        Assert.Contains("timeout", confirm.Publication!.LastError);

        // Nenhuma nova reserva e permitida enquanto a reconciliacao nao for resolvida.
        var retry = await service.ReserveAsync(1, new PriceCrossoverReserveRequest(), default);
        Assert.False(retry.Success);
        Assert.Equal("reconciliation_required", retry.Result);

        var retryConfirm = await service.ConfirmAsync(1, new PriceCrossoverConfirmRequest { Outcome = "posted" }, default);
        Assert.False(retryConfirm.Success);
        Assert.Equal("reconciliation_required", retryConfirm.Result);
    }

    [Fact]
    public async Task Release_ClearsReservation()
    {
        using var db = CreateDbContext();
        SeedMatch(db, 1);

        var service = CreateService(db);
        await service.ReserveAsync(1, new PriceCrossoverReserveRequest(), default);

        var release = await service.ReleaseAsync(1, "cancelado pelo workflow", default);

        Assert.True(release.Success);
        Assert.Equal("released", release.Result);

        // Apos liberar, uma nova reserva volta a ser permitida.
        var again = await service.ReserveAsync(1, new PriceCrossoverReserveRequest(), default);
        Assert.True(again.Success);
    }

    [Fact]
    public async Task Confirm_WithoutReservation_Fails()
    {
        using var db = CreateDbContext();
        SeedMatch(db, 1);

        var service = CreateService(db);
        var result = await service.ConfirmAsync(1, new PriceCrossoverConfirmRequest { Outcome = "posted" }, default);

        Assert.False(result.Success);
        Assert.Equal("not_reserved", result.Result);
    }

    [Fact]
    public async Task Confirm_Posted_CannotBeChangedOrRepublished()
    {
        using var db = CreateDbContext();
        SeedMatch(db, 1);

        var service = CreateService(db);
        await service.ReserveAsync(1, new PriceCrossoverReserveRequest(), default);
        await service.ConfirmAsync(1, new PriceCrossoverConfirmRequest { Outcome = "posted", ExternalPostId = "p1" }, default);

        var again = await service.ConfirmAsync(1, new PriceCrossoverConfirmRequest { Outcome = "posted" }, default);
        Assert.False(again.Success);
        Assert.Equal("already_published", again.Result);

        var reReserve = await service.ReserveAsync(1, new PriceCrossoverReserveRequest(), default);
        Assert.False(reReserve.Success);
        Assert.Equal("already_published", reReserve.Result);
    }

    [Fact]
    public async Task Reserve_ConcurrentSecondCall_IsRejected()
    {
        using var db = CreateDbContext();
        SeedMatch(db, 1);

        var service = CreateService(db);

        var first = await service.ReserveAsync(1, new PriceCrossoverReserveRequest(), default);
        var second = await service.ReserveAsync(1, new PriceCrossoverReserveRequest(), default);

        Assert.True(first.Success);
        Assert.False(second.Success);
        Assert.Equal("already_reserved", second.Result);

        // Existe exatamente uma linha de controle para a partida.
        var rows = db.SocialPostHistory
            .Where(x => x.IdempotencyKey == "price_crossover_highlight:1")
            .ToList();
        Assert.Single(rows);
    }

    [Fact]
    public async Task LegacyRows_AreUnaffected_CategoryScopedCooldown()
    {
        using var db = CreateDbContext();
        SeedMatch(db, 1);

        // Registro legado (Win Rate 24H / hot matches): Category nulo.
        db.SocialPostHistory.Add(new SocialPostHistory
        {
            MatchId = 1,
            Platform = "binance_square",
            PostText = "post legado",
            HotScore = 80,
            CreatedAt = DateTime.UtcNow
        });
        await db.SaveChangesAsync();

        var service = CreateService(db);
        var reserve = await service.ReserveAsync(1, new PriceCrossoverReserveRequest(), default);

        // A reserva da categoria nova nao e bloqueada pelo cooldown de outra categoria.
        Assert.True(reserve.Success);

        // E a linha legada permanece intacta.
        var legacy = db.SocialPostHistory.Single(x => x.PostText == "post legado");
        Assert.Null(legacy.Category);
        Assert.Null(legacy.Status);
        Assert.Null(legacy.IdempotencyKey);
    }

    [Fact]
    public async Task GetState_ReturnsNullWhenNothingRegistered()
    {
        using var db = CreateDbContext();
        SeedMatch(db, 1);

        var service = CreateService(db);
        var state = await service.GetStateAsync(1, default);

        Assert.Null(state);
    }

    private static EthicAIDbContext CreateDbContext()
    {
        var options = new DbContextOptionsBuilder<EthicAIDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString("N"))
            .Options;

        return new EthicAIDbContext(options);
    }

    private static PriceCrossoverPublicationService CreateService(EthicAIDbContext db)
        => new(db, Options.Create(new PriceCrossoverOptions()));

    private static void SeedMatch(EthicAIDbContext db, int matchId)
    {
        var currencyA = new Currency
        {
            CurrencyId = matchId * 100 + 1,
            Name = "EPICUSDT",
            Symbol = "EPICUSDT",
            LastUpdated = DateTime.UtcNow
        };
        var currencyB = new Currency
        {
            CurrencyId = matchId * 100 + 2,
            Name = "EIGENUSDT",
            Symbol = "EIGENUSDT",
            LastUpdated = DateTime.UtcNow
        };

        var teamA = new Team { TeamId = matchId * 100 + 11, CurrencyId = currencyA.CurrencyId, Currency = currencyA };
        var teamB = new Team { TeamId = matchId * 100 + 12, CurrencyId = currencyB.CurrencyId, Currency = currencyB };

        db.Currency.AddRange(currencyA, currencyB);
        db.Team.AddRange(teamA, teamB);
        db.Match.Add(new Match
        {
            MatchId = matchId,
            TeamAId = teamA.TeamId,
            TeamBId = teamB.TeamId,
            TeamA = teamA,
            TeamB = teamB,
            Status = MatchStatus.Completed,
            StartTime = DateTime.UtcNow.AddHours(-2),
            EndTime = DateTime.UtcNow.AddMinutes(-30),
            ScoreA = 3,
            ScoreB = 1,
            WinnerTeamId = teamA.TeamId
        });

        db.SaveChanges();
    }
}
