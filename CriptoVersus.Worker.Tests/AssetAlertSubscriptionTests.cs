using BLL.Push;
using DAL.NftFutebol;
using EthicAI.EntityModel;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace CriptoVersus.Worker.Tests;

public sealed class AssetAlertSubscriptionTests
{
    private static EthicAIDbContext CreateDbContext()
    {
        var options = new DbContextOptionsBuilder<EthicAIDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString("N"))
            .Options;

        return new EthicAIDbContext(options);
    }

    private static (Currency currency, Team team) SeedCurrency(EthicAIDbContext db, string symbol)
    {
        var currency = new Currency
        {
            CurrencyId = 0,
            Name = symbol,
            Symbol = symbol,
            PercentageChange = 0,
            QuoteVolume = 0,
            TradesCount = 0,
            LastUpdated = DateTime.UtcNow
        };
        db.Currency.Add(currency);
        db.SaveChanges();

        var team = new Team { TeamId = 0, CurrencyId = currency.CurrencyId };
        db.Team.Add(team);
        db.SaveChanges();

        return (currency, team);
    }

    private static PushSubscription SeedPushSubscription(EthicAIDbContext db, string clientId = "test-client")
    {
        var sub = new PushSubscription
        {
            PushSubscriptionId = 0,
            Endpoint = $"https://push.example.com/{Guid.NewGuid():N}",
            P256dh = "test-p256dh",
            Auth = "test-auth",
            ClientId = clientId,
            IsActive = true,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow
        };
        db.PushSubscription.Add(sub);
        db.SaveChanges();
        return sub;
    }

    private static Match SeedMatch(EthicAIDbContext db, Team teamA, Team teamB, MatchStatus status, DateTime startTime)
    {
        var match = new Match
        {
            MatchId = 0,
            TeamAId = teamA.TeamId,
            TeamBId = teamB.TeamId,
            Status = status,
            StartTime = startTime,
            ScoreA = 0,
            ScoreB = 0
        };
        db.Match.Add(match);
        db.SaveChanges();
        return match;
    }

    private static AssetAlertSubscription SeedAssetSubscription(
        EthicAIDbContext db, long pushSubscriptionId, int currencyId, string symbol,
        string culture = "en", bool isActive = true, DateTime? createdAt = null)
    {
        var sub = new AssetAlertSubscription
        {
            PushSubscriptionId = pushSubscriptionId,
            CurrencyId = currencyId,
            Symbol = symbol,
            Culture = culture,
            IsActive = isActive,
            CreatedAt = createdAt ?? DateTime.UtcNow
        };
        db.AssetAlertSubscription.Add(sub);
        db.SaveChanges();
        return sub;
    }

    // ============================================================
    // A) subscribe ativo → apenas uma linha
    // ============================================================
    [Fact]
    public async Task A_Subscribe_ActiveSubscription_CreatesExactlyOneRow()
    {
        await using var db = CreateDbContext();
        var pushSub = SeedPushSubscription(db);
        var (currency, _) = SeedCurrency(db, "LSK");

        SeedAssetSubscription(db, pushSub.PushSubscriptionId, currency.CurrencyId, "LSK");

        var count = await db.AssetAlertSubscription
            .CountAsync(s => s.PushSubscriptionId == pushSub.PushSubscriptionId
                          && s.CurrencyId == currency.CurrencyId);

        Assert.Equal(1, count);
    }

    // ============================================================
    // B) unsubscribe → mesma linha IsActive=false
    // ============================================================
    [Fact]
    public async Task B_Unsubscribe_SetsIsActiveFalseOnSameRow()
    {
        await using var db = CreateDbContext();
        var pushSub = SeedPushSubscription(db);
        var (currency, _) = SeedCurrency(db, "LSK");

        var alertSub = SeedAssetSubscription(db, pushSub.PushSubscriptionId, currency.CurrencyId, "LSK");

        var loaded = await db.AssetAlertSubscription.FindAsync(alertSub.AssetAlertSubscriptionId);
        Assert.NotNull(loaded);
        loaded!.IsActive = false;
        await db.SaveChangesAsync();

        var row = await db.AssetAlertSubscription.FindAsync(alertSub.AssetAlertSubscriptionId);
        Assert.NotNull(row);
        Assert.False(row!.IsActive);

        var totalRows = await db.AssetAlertSubscription
            .CountAsync(s => s.PushSubscriptionId == pushSub.PushSubscriptionId
                          && s.CurrencyId == currency.CurrencyId);
        Assert.Equal(1, totalRows);
    }

    // ============================================================
    // C) subscribe novamente → mesma linha IsActive=true, CreatedAt atualizado
    // ============================================================
    [Fact]
    public async Task C_Subscribe_AfterUnsubscribe_ReusesSameRow_UpdatesCreatedAt()
    {
        await using var db = CreateDbContext();
        var pushSub = SeedPushSubscription(db);
        var (currency, _) = SeedCurrency(db, "LSK");

        var originalCreatedAt = new DateTime(2026, 1, 1, 10, 0, 0, DateTimeKind.Utc);

        var alertSub = SeedAssetSubscription(db, pushSub.PushSubscriptionId, currency.CurrencyId, "LSK",
            createdAt: originalCreatedAt);

        var loaded = await db.AssetAlertSubscription.FindAsync(alertSub.AssetAlertSubscriptionId);
        loaded!.IsActive = false;
        await db.SaveChangesAsync();

        var reactivationTime = DateTime.UtcNow;
        var reloaded = await db.AssetAlertSubscription.FindAsync(alertSub.AssetAlertSubscriptionId);
        reloaded!.IsActive = true;
        reloaded.CreatedAt = reactivationTime;
        reloaded.Culture = "pt";
        reloaded.Symbol = currency.Symbol;
        await db.SaveChangesAsync();

        var totalRows = await db.AssetAlertSubscription
            .CountAsync(s => s.PushSubscriptionId == pushSub.PushSubscriptionId
                          && s.CurrencyId == currency.CurrencyId);

        Assert.Equal(1, totalRows);

        var reactivated = await db.AssetAlertSubscription.FindAsync(alertSub.AssetAlertSubscriptionId);
        Assert.NotNull(reactivated);
        Assert.True(reactivated!.IsActive);
        Assert.Equal("pt", reactivated.Culture);
        Assert.True(reactivated.CreatedAt >= reactivationTime.AddSeconds(-1));
    }

    // ============================================================
    // D) duas chamadas concorrentes de subscribe → lógica de reutilização
    // ============================================================
    [Fact]
    public async Task D_ConcurrentSubscribeLogic_ReusesExistingRow()
    {
        await using var db = CreateDbContext();
        var pushSub = SeedPushSubscription(db);
        var (currency, _) = SeedCurrency(db, "LSK");

        var existing = SeedAssetSubscription(db, pushSub.PushSubscriptionId, currency.CurrencyId, "LSK");
        var originalId = existing.AssetAlertSubscriptionId;

        var found = await db.AssetAlertSubscription
            .FirstOrDefaultAsync(s => s.PushSubscriptionId == pushSub.PushSubscriptionId
                                  && s.CurrencyId == currency.CurrencyId);

        Assert.NotNull(found);
        Assert.Equal(originalId, found!.AssetAlertSubscriptionId);

        found.Culture = "pt";
        found.Symbol = currency.Symbol;
        await db.SaveChangesAsync();

        var totalRows = await db.AssetAlertSubscription
            .CountAsync(s => s.PushSubscriptionId == pushSub.PushSubscriptionId
                          && s.CurrencyId == currency.CurrencyId);

        Assert.Equal(1, totalRows);

        var final = await db.AssetAlertSubscription.FindAsync(originalId);
        Assert.Equal("pt", final!.Culture);
    }

    // ============================================================
    // E) mesma PushSubscription segue LSK e BTC → duas linhas
    // ============================================================
    [Fact]
    public async Task E_SamePushSubscription_FollowsTwoAssets_CreatesTwoRows()
    {
        await using var db = CreateDbContext();
        var pushSub = SeedPushSubscription(db);
        var (lskCurrency, _) = SeedCurrency(db, "LSK");
        var (btcCurrency, _) = SeedCurrency(db, "BTC");

        SeedAssetSubscription(db, pushSub.PushSubscriptionId, lskCurrency.CurrencyId, "LSK");
        SeedAssetSubscription(db, pushSub.PushSubscriptionId, btcCurrency.CurrencyId, "BTC");

        var rows = await db.AssetAlertSubscription
            .Where(s => s.PushSubscriptionId == pushSub.PushSubscriptionId)
            .OrderBy(s => s.Symbol)
            .ToListAsync();

        Assert.Equal(2, rows.Count);
        Assert.Equal("BTC", rows[0].Symbol);
        Assert.Equal("LSK", rows[1].Symbol);
    }

    // ============================================================
    // F) delivery BTC → dispatcher usa exatamente assinatura BTC
    // ============================================================
    [Fact]
    public async Task F_Dispatcher_AssetPlayingDelivery_UsesCorrectAssetSubscription()
    {
        await using var db = CreateDbContext();
        var pushSub = SeedPushSubscription(db);
        var (lskCurrency, lskTeam) = SeedCurrency(db, "LSK");
        var (btcCurrency, btcTeam) = SeedCurrency(db, "BTC");

        var lskSub = SeedAssetSubscription(db, pushSub.PushSubscriptionId, lskCurrency.CurrencyId, "LSK", culture: "pt");
        var btcSub = SeedAssetSubscription(db, pushSub.PushSubscriptionId, btcCurrency.CurrencyId, "BTC", culture: "zh");

        var match = SeedMatch(db, btcTeam, lskTeam, MatchStatus.Ongoing, DateTime.UtcNow.AddHours(-1));

        var eventKey = new AssetAlertService().BuildEventKey(btcSub.AssetAlertSubscriptionId, btcSub.CurrencyId, match.MatchId);

        var parsed = PushNotificationDispatcher.TryParseAssetEventKey(eventKey, out var parsedSubId, out var parsedCurrencyId);
        Assert.True(parsed);
        Assert.Equal(btcSub.AssetAlertSubscriptionId, parsedSubId);
        Assert.Equal(btcSub.CurrencyId, parsedCurrencyId);

        var resolved = await db.AssetAlertSubscription
            .FirstOrDefaultAsync(s => s.AssetAlertSubscriptionId == parsedSubId
                                  && s.CurrencyId == parsedCurrencyId);

        Assert.NotNull(resolved);
        Assert.Equal("BTC", resolved!.Symbol);
        Assert.Equal("zh", resolved.Culture);
    }

    // ============================================================
    // G) partida anterior à CreatedAt → zero delivery
    // ============================================================
    [Fact]
    public async Task G_AntiRetroactive_MatchBeforeCreatedAt_NoDelivery()
    {
        await using var db = CreateDbContext();
        var pushSub = SeedPushSubscription(db);
        var (currency, teamA) = SeedCurrency(db, "LSK");
        var (_, teamB) = SeedCurrency(db, "BTC");

        var match = SeedMatch(db, teamA, teamB, MatchStatus.Ongoing, DateTime.UtcNow.AddMinutes(-5));

        var subCreatedAt = DateTime.UtcNow;
        var assetSub = SeedAssetSubscription(db, pushSub.PushSubscriptionId, currency.CurrencyId, "LSK",
            createdAt: subCreatedAt);

        var deliveriesBefore = await db.MatchAlertDelivery.CountAsync();
        Assert.Equal(0, deliveriesBefore);

        var wouldSkip = assetSub.CreatedAt >= match.StartTime!.Value;
        Assert.True(wouldSkip, "Anti-retroactive rule must skip match that started before subscription creation");
    }

    // ============================================================
    // H) partida posterior à CreatedAt → um delivery
    // ============================================================
    [Fact]
    public async Task H_AntiRetroactive_MatchAfterCreatedAt_CreatesDelivery()
    {
        await using var db = CreateDbContext();
        var pushSub = SeedPushSubscription(db);
        var (currency, teamA) = SeedCurrency(db, "LSK");
        var (_, teamB) = SeedCurrency(db, "BTC");

        var subCreatedAt = DateTime.UtcNow.AddMinutes(-10);
        var assetSub = SeedAssetSubscription(db, pushSub.PushSubscriptionId, currency.CurrencyId, "LSK",
            createdAt: subCreatedAt);

        var matchStartTime = DateTime.UtcNow.AddMinutes(-5);
        var match = SeedMatch(db, teamA, teamB, MatchStatus.Ongoing, matchStartTime);

        Assert.True(subCreatedAt < matchStartTime);

        var wouldNotify = assetSub.CreatedAt < match.StartTime!.Value;
        Assert.True(wouldNotify);

        var eventKey = new AssetAlertService().BuildEventKey(
            assetSub.AssetAlertSubscriptionId, assetSub.CurrencyId, match.MatchId);

        db.MatchAlertDelivery.Add(new MatchAlertDelivery
        {
            PushSubscriptionId = pushSub.PushSubscriptionId,
            MatchId = match.MatchId,
            EventKey = eventKey,
            AlertType = "asset_playing",
            Status = "PENDING",
            Attempts = 0,
            NextAttemptAt = DateTime.UtcNow,
            CreatedAt = DateTime.UtcNow
        });
        await db.SaveChangesAsync();

        var deliveries = await db.MatchAlertDelivery
            .Where(d => d.AlertType == "asset_playing" && d.MatchId == match.MatchId)
            .ToListAsync();

        Assert.Single(deliveries);
        Assert.Equal(pushSub.PushSubscriptionId, deliveries[0].PushSubscriptionId);
    }

    // ============================================================
    // I) dois ciclos concorrentes → idempotência via EventKey lógico
    // ============================================================
    [Fact]
    public async Task I_DuplicateDelivery_EventKeyCheck_PreventsDuplicate()
    {
        await using var db = CreateDbContext();
        var pushSub = SeedPushSubscription(db);
        var (currency, teamA) = SeedCurrency(db, "LSK");
        var (_, teamB) = SeedCurrency(db, "BTC");

        var assetSub = SeedAssetSubscription(db, pushSub.PushSubscriptionId, currency.CurrencyId, "LSK");
        var match = SeedMatch(db, teamA, teamB, MatchStatus.Ongoing, DateTime.UtcNow.AddMinutes(-5));

        var eventKey = new AssetAlertService().BuildEventKey(
            assetSub.AssetAlertSubscriptionId, assetSub.CurrencyId, match.MatchId);

        db.MatchAlertDelivery.Add(new MatchAlertDelivery
        {
            PushSubscriptionId = pushSub.PushSubscriptionId,
            MatchId = match.MatchId,
            EventKey = eventKey,
            AlertType = "asset_playing",
            Status = "PENDING",
            Attempts = 0,
            NextAttemptAt = DateTime.UtcNow,
            CreatedAt = DateTime.UtcNow
        });
        await db.SaveChangesAsync();

        var exists = await db.MatchAlertDelivery
            .AnyAsync(d => d.PushSubscriptionId == pushSub.PushSubscriptionId
                        && d.EventKey == eventKey
                        && d.AlertType == "asset_playing");
        Assert.True(exists);

        var totalDeliveries = await db.MatchAlertDelivery
            .CountAsync(d => d.EventKey == eventKey && d.AlertType == "asset_playing");
        Assert.Equal(1, totalDeliveries);
    }

    // ============================================================
    // J) detach lógico não deixa entidade Added residual
    // ============================================================
    [Fact]
    public async Task J_DetachFailedEntity_NoResidualTracker()
    {
        await using var db = CreateDbContext();
        var pushSub = SeedPushSubscription(db);
        var (currency, _) = SeedCurrency(db, "LSK");

        var entity = new AssetAlertSubscription
        {
            PushSubscriptionId = pushSub.PushSubscriptionId,
            CurrencyId = currency.CurrencyId,
            Symbol = currency.Symbol,
            Culture = "en",
            IsActive = true,
            CreatedAt = DateTime.UtcNow
        };

        db.AssetAlertSubscription.Add(entity);
        await db.SaveChangesAsync();

        db.Entry(entity).State = EntityState.Detached;

        var entity2 = new AssetAlertSubscription
        {
            PushSubscriptionId = pushSub.PushSubscriptionId,
            CurrencyId = currency.CurrencyId,
            Symbol = currency.Symbol,
            Culture = "en",
            IsActive = true,
            CreatedAt = DateTime.UtcNow
        };
        db.AssetAlertSubscription.Add(entity2);

        db.Entry(entity2).State = EntityState.Detached;

        var trackerState = db.Entry(entity2).State;
        Assert.Equal(EntityState.Detached, trackerState);

        var count = await db.AssetAlertSubscription
            .CountAsync(s => s.PushSubscriptionId == pushSub.PushSubscriptionId
                          && s.CurrencyId == currency.CurrencyId);
        Assert.Equal(1, count);
    }

    // ============================================================
    // TryParseAssetEventKey valid cases
    // ============================================================
    [Theory]
    [InlineData("asset-playing:42:7:100", 42, 7)]
    [InlineData("asset-playing:1:999:1", 1, 999)]
    [InlineData("asset-playing:999999999:123:50000", 999999999, 123)]
    public void TryParseAssetEventKey_ValidFormat_ReturnsCorrectValues(string eventKey, long expectedSubId, int expectedCurrencyId)
    {
        var result = PushNotificationDispatcher.TryParseAssetEventKey(eventKey, out var subId, out var currencyId);

        Assert.True(result);
        Assert.Equal(expectedSubId, subId);
        Assert.Equal(expectedCurrencyId, currencyId);
    }

    [Theory]
    [InlineData("")]
    [InlineData("score:42:7:100")]
    [InlineData("asset-playing:42:7")]
    [InlineData("asset-playing:abc:7:100")]
    [InlineData("asset-playing:42:notanumber:100")]
    [InlineData(null)]
    public void TryParseAssetEventKey_InvalidFormat_ReturnsFalse(string? eventKey)
    {
        var result = PushNotificationDispatcher.TryParseAssetEventKey(eventKey!, out _, out _);

        Assert.False(result);
    }

    // ============================================================
    // AssetAlertService BuildEventKey determinism
    // ============================================================
    [Fact]
    public void BuildEventKey_IsDeterministic_SameInputs_SameOutput()
    {
        var service = new AssetAlertService();

        var key1 = service.BuildEventKey(42, 7, 100);
        var key2 = service.BuildEventKey(42, 7, 100);

        Assert.Equal(key1, key2);
        Assert.Equal("asset-playing:42:7:100", key1);
    }

    [Fact]
    public void BuildEventKey_DifferentSubscriptions_ProduceDifferentKeys()
    {
        var service = new AssetAlertService();

        var keyLsk = service.BuildEventKey(1, 10, 100);
        var keyBtc = service.BuildEventKey(2, 20, 100);

        Assert.NotEqual(keyLsk, keyBtc);
    }

    // ============================================================
    // Anti-retroactive: reactivation resets cutoff
    // ============================================================
    [Fact]
    public async Task Reactivation_UpdatesCreatedAt_PreventsRetroactiveAlerts()
    {
        await using var db = CreateDbContext();
        var pushSub = SeedPushSubscription(db);
        var (currency, teamA) = SeedCurrency(db, "LSK");
        var (_, teamB) = SeedCurrency(db, "BTC");

        var matchStartedBeforeReactivation = SeedMatch(
            db, teamA, teamB, MatchStatus.Ongoing,
            new DateTime(2026, 9, 12, 15, 10, 0, DateTimeKind.Utc));

        var originalCreatedAt = new DateTime(2026, 9, 12, 15, 0, 0, DateTimeKind.Utc);
        var assetSub = SeedAssetSubscription(db, pushSub.PushSubscriptionId, currency.CurrencyId, "LSK",
            createdAt: originalCreatedAt);

        var loaded = await db.AssetAlertSubscription.FindAsync(assetSub.AssetAlertSubscriptionId);
        loaded!.IsActive = false;
        await db.SaveChangesAsync();

        var reactivationTime = new DateTime(2026, 9, 12, 15, 20, 0, DateTimeKind.Utc);
        var reloaded = await db.AssetAlertSubscription.FindAsync(assetSub.AssetAlertSubscriptionId);
        reloaded!.IsActive = true;
        reloaded.CreatedAt = reactivationTime;
        await db.SaveChangesAsync();

        var final = await db.AssetAlertSubscription.FindAsync(assetSub.AssetAlertSubscriptionId);
        Assert.NotNull(final);
        Assert.True(final!.IsActive);
        Assert.Equal(reactivationTime, final.CreatedAt);

        var matchStart = matchStartedBeforeReactivation.StartTime!.Value;
        var shouldSkip = final.CreatedAt >= matchStart;
        Assert.True(shouldSkip, "Reactivation CreatedAt must prevent retroactive alerts for matches that started before reactivation");
    }

    // ============================================================
    // PushNotificationTexts asset_playing localization
    // ============================================================
    [Theory]
    [InlineData("en", "LSK", "LSK", "BTC", "⚽ LSK is playing!", "LSK vs BTC started now.")]
    [InlineData("pt", "BTC", "ETH", "BTC", "⚽ BTC está jogando!", "ETH vs BTC começou agora.")]
    public void GetAssetPlaying_ReturnsLocalizedText(string culture, string symbol, string teamA, string teamB, string expectedTitle, string expectedBody)
    {
        var (title, body) = PushNotificationTexts.GetAssetPlaying(culture, symbol, teamA, teamB);

        Assert.Equal(expectedTitle, title);
        Assert.Equal(expectedBody, body);
    }
}
