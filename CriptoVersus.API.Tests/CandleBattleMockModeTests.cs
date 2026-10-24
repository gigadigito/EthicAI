using CriptoVersus.Web.Services;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Hosting;

namespace CriptoVersus.API.Tests;

public class CandleBattleMockModeTests
{
    private sealed class FakeEnvironment(string environmentName) : IHostEnvironment
    {
        public string EnvironmentName { get; set; } = environmentName;
        public string ApplicationName { get; set; } = "tests";
        public string ContentRootPath { get; set; } = AppContext.BaseDirectory;
        public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
    }

    [Fact]
    public void Mock_is_disabled_by_default()
    {
        var options = new CandleBattleMockOptions();
        Assert.False(options.Enabled);
        Assert.False(CandleBattleMockOptions.IsAllowed(options, new FakeEnvironment("Development")));
    }

    [Theory]
    [InlineData("Production")]
    [InlineData("Staging")]
    [InlineData("QA")]
    public void Mock_cannot_activate_outside_development_even_when_enabled(string environmentName)
    {
        var options = new CandleBattleMockOptions { Enabled = true };
        Assert.False(CandleBattleMockOptions.IsAllowed(options, new FakeEnvironment(environmentName)));
    }

    [Fact]
    public void Mock_activates_in_development_when_explicitly_enabled()
    {
        var options = new CandleBattleMockOptions { Enabled = true };
        Assert.True(CandleBattleMockOptions.IsAllowed(options, new FakeEnvironment("Development")));
    }

    [Fact]
    public void Mock_data_source_refuses_to_build_outside_development()
    {
        var catalog = new CandleBattleScenarioCatalog(CandleBattleScenarioTests.FixtureDirectory());
        var exception = Assert.Throws<InvalidOperationException>(() =>
            new MockCandleBattleDataSource(catalog, new FakeEnvironment("Production")));
        Assert.Contains("Development", exception.Message);
    }

    [Fact]
    public void Real_source_preserves_the_current_api_contract()
    {
        var real = typeof(RealCandleBattleDataSource).GetInterfaces();
        Assert.Contains(typeof(ICandleBattleDataSource), real);
        var mock = typeof(MockCandleBattleDataSource).GetInterfaces();
        Assert.Contains(typeof(ICandleBattleDataSource), mock);
    }

    [Fact]
    public async Task Mock_serves_only_fixture_match_ids()
    {
        var source = NewMockSource();
        foreach (var matchId in new[] { 910001, 910002, 910003, 910004, 910005, 910006, 910007 })
        {
            Assert.NotNull(await source.GetFeedAsync(matchId, null, CancellationToken.None));
            Assert.NotNull(await source.GetSocialAsync(matchId, "en-US", true, CancellationToken.None));
        }
        foreach (var matchId in new[] { 1, 41, 42, 12345, int.MaxValue })
        {
            Assert.Null(await source.GetFeedAsync(matchId, null, CancellationToken.None));
            Assert.Null(await source.GetSocialAsync(matchId, "en-US", true, CancellationToken.None));
        }
    }

    [Fact]
    public async Task Mock_is_static_and_has_no_live_notifications()
    {
        var source = NewMockSource();
        Assert.Null(source.UpdateInterval);
        Assert.False(source.UsesLiveNotifications);
        Assert.NotNull(await source.GetFeedAsync(910001, null, CancellationToken.None));
    }

    [Fact]
    public void Mock_stack_never_calls_http_or_touches_the_database()
    {
        foreach (var type in new[]
                 {
                     typeof(MockCandleBattleDataSource), typeof(CandleBattleScenarioCatalog),
                     typeof(CandleBattleScenarioCompiler), typeof(CandleBattleScenarioGenerator),
                     typeof(CandleBattleScenario)
                 })
        {
            Assert.Null(type.GetField("_http", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance));
            foreach (var field in type.GetFields(System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.Static))
                Assert.DoesNotContain("HttpClient", field.FieldType.Name);
            foreach (var constructor in type.GetConstructors())
                foreach (var parameter in constructor.GetParameters())
                {
                    Assert.DoesNotContain("HttpClient", parameter.ParameterType.Name);
                    Assert.DoesNotContain("DbContext", parameter.ParameterType.Name);
                    Assert.DoesNotContain("EthicAIDbContext", parameter.ParameterType.Name);
                }
        }
    }

    [Fact]
    public async Task Mock_social_preview_is_never_publishable()
    {
        var source = NewMockSource();
        foreach (var matchId in new[] { 910001, 910002, 910003, 910004, 910005, 910006, 910007 })
        {
            var social = await source.GetSocialAsync(matchId, "en-US", true, CancellationToken.None);
            Assert.NotNull(social);
            Assert.False(social!.CanPost);
            Assert.False(social.AlreadyPublished);
            Assert.Null(social.Publication);
            Assert.Null(social.PublicUrl);
            Assert.False(social.PublicUrlAvailable);
            Assert.Equal("mock_preview", social.SkipReason);
        }
    }

    [Fact]
    public void Mock_feed_has_no_financial_side_channels()
    {
        foreach (var scenario in new CandleBattleScenarioCatalog(CandleBattleScenarioTests.FixtureDirectory()).Scenarios)
        {
            var feed = scenario.Feed;
            // Fictional ids live outside the production sequence and the feed
            // carries only market presentation data.
            Assert.InRange(scenario.MatchId, 910001, 910007);
            Assert.Equal(scenario.LeftSymbol, feed.LeftSymbol);
            Assert.Equal(scenario.RightSymbol, feed.RightSymbol);
            Assert.Equal(18, feed.ExpectedRounds);
        }
    }

    [Fact]
    public async Task Mock_resolves_the_scenario_by_match_id_only()
    {
        var source = NewMockSource();
        var bullish = await source.GetFeedAsync(910001, null, CancellationToken.None);
        var bearish = await source.GetFeedAsync(910003, null, CancellationToken.None);
        Assert.Equal("BTCUSDT", bullish!.LeftSymbol);
        Assert.Equal("ETHUSDT", bullish.RightSymbol);
        Assert.Equal("ETHUSDT", bearish!.LeftSymbol);
        Assert.Equal("BTCUSDT", bearish.RightSymbol);
        Assert.NotEqual(bullish.Rounds[0].Id, bearish.Rounds[0].Id);
    }

    [Fact]
    public async Task Mock_local_logos_avoid_external_icon_services()
    {
        var source = NewMockSource();
        var logos = source.GetLocalLogos(910001);
        Assert.Equal(2, logos.Count);
        foreach (var logo in logos.Values)
            Assert.StartsWith("data:image/svg+xml;base64,", logo);
        Assert.Empty(source.GetLocalLogos(1));
    }

    private static MockCandleBattleDataSource NewMockSource()
    {
        var catalog = new CandleBattleScenarioCatalog(CandleBattleScenarioTests.FixtureDirectory());
        return new MockCandleBattleDataSource(catalog, new FakeEnvironment("Development"));
    }
}
