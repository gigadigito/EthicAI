using System.Text.Json;
using CriptoVersus.Web.Services;

namespace CriptoVersus.API.Tests;

public class CandleBattleScenarioTests
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        WriteIndented = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase
    };

    internal static string RepositoryRoot()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null && !File.Exists(Path.Combine(dir.FullName, "CriptoVersus", "CriptoVersus.Web.csproj")))
            dir = dir.Parent;
        return dir?.FullName ?? throw new InvalidOperationException("Repository root not found.");
    }

    internal static string FixtureDirectory()
        => Path.Combine(RepositoryRoot(), "CriptoVersus", "mock-data", "candle-battles", "scenarios");

    private static CandleBattleScenarioCatalog NewCatalog() => new(FixtureDirectory());

    [Fact]
    public void Fixtures_on_disk_match_the_deterministic_generator()
    {
        var directory = FixtureDirectory();
        if (Environment.GetEnvironmentVariable("CANDLE_BATTLE_FIXTURES") == "regenerate")
            CandleBattleScenarioGenerator.WriteAll(directory);

        Assert.True(Directory.Exists(directory), $"Missing fixture directory '{directory}'.");
        foreach (var file in CandleBattleScenarioGenerator.BuildAll())
        {
            var path = Path.Combine(directory, file.Scenario + ".json");
            Assert.True(File.Exists(path), $"Missing fixture '{path}'. Use CANDLE_BATTLE_FIXTURES=regenerate to create it.");
            var expected = JsonSerializer.Serialize(file, JsonOptions) + Environment.NewLine;
            Assert.Equal(expected, File.ReadAllText(path));
        }
    }

    [Fact]
    public void Scenarios_are_deterministic_across_loads()
    {
        var first = NewCatalog().Scenarios.Select(s => JsonSerializer.Serialize(s.Feed)).ToArray();
        var second = NewCatalog().Scenarios.Select(s => JsonSerializer.Serialize(s.Feed)).ToArray();
        Assert.Equal(first, second);
    }

    [Fact]
    public void Catalog_requires_unique_match_ids_per_scenario()
    {
        var catalog = NewCatalog();
        Assert.Equal(catalog.Scenarios.Count, catalog.Scenarios.Select(s => s.MatchId).Distinct().Count());
        Assert.Equal(7, catalog.Scenarios.Count);
        foreach (var scenario in catalog.Scenarios)
            Assert.Same(scenario, catalog.FindByMatchId(scenario.MatchId));
    }

    [Theory]
    [InlineData(910001)]
    [InlineData(910002)]
    [InlineData(910003)]
    [InlineData(910004)]
    [InlineData(910005)]
    [InlineData(910006)]
    [InlineData(910007)]
    public void Scenario_candles_are_temporally_coherent(int matchId)
    {
        var scenario = NewCatalog().FindByMatchId(matchId)!;
        var feed = scenario.Feed;

        Assert.Equal(0L, (feed.MatchStartTime ?? 0) % CandleBattlesResolverBridge.PeriodMs);
        Assert.Equal(0, scenario.MatchStartMs % CandleBattlesResolverBridge.PeriodMs);
        Assert.Equal(CandleBattlesResolverBridge.ExpectedRounds * CandleBattlesResolverBridge.PeriodMs,
            scenario.MatchEndMs - scenario.MatchStartMs);

        foreach (var round in feed.Rounds)
        {
            Assert.Equal(0, round.Left.OpenTime % CandleBattlesResolverBridge.PeriodMs);
            Assert.Equal(round.Left.OpenTime, round.Right.OpenTime);
            Assert.Equal(round.Left.OpenTime + CandleBattlesResolverBridge.PeriodMs, round.Left.CloseTime);
            Assert.Equal(round.Right.OpenTime + CandleBattlesResolverBridge.PeriodMs, round.Right.CloseTime);
            Assert.Equal($"{matchId}:5m:{round.Left.OpenTime}", round.Id);
        }
        for (var i = 1; i < feed.Rounds.Count; i++)
            Assert.Equal(feed.Rounds[i - 1].Left.OpenTime + CandleBattlesResolverBridge.PeriodMs, feed.Rounds[i].Left.OpenTime);

        if (feed.Rounds.Count > 0)
        {
            var expectedFirst = scenario.MatchStartMs + CandleBattlesResolverBridge.PeriodMs;
            Assert.Equal(expectedFirst, feed.Rounds[0].Left.CloseTime);
        }
    }

    [Fact]
    public void Scenario_winners_follow_the_production_combat_rules()
    {
        foreach (var scenario in NewCatalog().Scenarios)
        {
            foreach (var round in scenario.Rounds)
            {
                Assert.True(BLL.NFTFutebol.CandleBattlesResolver.IsValid(round.Left));
                Assert.True(BLL.NFTFutebol.CandleBattlesResolver.IsValid(round.Right));
                Assert.Equal(round.Winner, BLL.NFTFutebol.CandleBattlesResolver.ResolveWinner(
                    round.Left, round.Right, round.LeftStrength, round.RightStrength));
                Assert.Equal(BLL.NFTFutebol.CandleBattlesResolver.Version, round.RuleVersion);
            }
            Assert.Equal(scenario.Rounds.Count(r => r.Winner == "left"), scenario.Feed.ScoreLeft);
            Assert.Equal(scenario.Rounds.Count(r => r.Winner == "right"), scenario.Feed.ScoreRight);
        }
    }

    [Fact]
    public void Green_beats_red_and_smaller_red_beats_larger_red()
    {
        foreach (var scenario in NewCatalog().Scenarios)
        {
            foreach (var round in scenario.Rounds)
            {
                var leftGreen = round.Left.Close > round.Left.Open;
                var rightGreen = round.Right.Close > round.Right.Open;
                if (leftGreen != rightGreen)
                {
                    Assert.Equal(leftGreen ? "left" : "right", round.Winner);
                    continue;
                }
                if (round.Winner is not ("left" or "right")) continue;
                var winner = round.Winner == "left" ? round.Left : round.Right;
                var loser = round.Winner == "left" ? round.Right : round.Left;
                var winnerReturn = BLL.NFTFutebol.CandleBattlesResolver.PercentageChange(winner);
                var loserReturn = BLL.NFTFutebol.CandleBattlesResolver.PercentageChange(loser);
                Assert.True(winnerReturn > loserReturn
                    || Math.Abs(winnerReturn - loserReturn) <= BLL.NFTFutebol.CandleBattlesResolver.ComparisonTolerance
                       && round.LeftStrength != round.RightStrength);
                if (leftGreen && rightGreen) Assert.True(winnerReturn >= loserReturn);
                if (!leftGreen && !rightGreen && winnerReturn != loserReturn) Assert.True(winnerReturn > loserReturn);
            }
        }
    }

    [Fact]
    public void Arena_feed_and_social_card_agree_on_the_result()
    {
        foreach (var scenario in NewCatalog().Scenarios)
        {
            var feed = scenario.Feed;
            var social = scenario.Social;
            Assert.Equal(feed.ScoreLeft, social.ScoreA);
            Assert.Equal(feed.ScoreRight, social.ScoreB);
            Assert.Equal(feed.Rounds.Count, social.ConfrontationCount);
            Assert.Equal(scenario.Finished, social.Status == "Completed");
            Assert.Equal(feed.Rounds.Select(r => r.Id), social.Rounds.Select(r => r.Id));
            if (!scenario.Finished || feed.ScoreLeft == feed.ScoreRight) Assert.Null(social.WinnerSymbol);
            else
            {
                var expectedSymbol = feed.ScoreLeft > feed.ScoreRight ? scenario.LeftSymbol : scenario.RightSymbol;
                Assert.Equal(expectedSymbol, social.WinnerSymbol);
            }
            Assert.False(social.CanPost);
            Assert.False(social.AlreadyPublished);
            Assert.Null(social.Publication);
            Assert.Null(social.PublicUrl);
            Assert.False(social.PublicUrlAvailable);
            Assert.Equal("mock_preview", social.SkipReason);
        }
    }

    [Fact]
    public void Complete_match_contains_draws_and_a_decisive_winner()
    {
        var scenario = NewCatalog().FindByMatchId(910006)!;
        Assert.Equal(18, scenario.Rounds.Count);
        Assert.Contains(scenario.Rounds, r => r.Winner == "draw");
        Assert.Contains(scenario.Rounds, r => r.Winner == "left");
        Assert.Contains(scenario.Rounds, r => r.Winner == "right");
        Assert.True(scenario.Feed.ScoreLeft > scenario.Feed.ScoreRight);
        Assert.Equal(scenario.LeftSymbol, scenario.Social.WinnerSymbol);
    }

    [Fact]
    public void Bullish_vs_bearish_favors_the_green_side()
    {
        var scenario = NewCatalog().FindByMatchId(910001)!;
        Assert.True(scenario.Feed.ScoreLeft >= 12);
        Assert.True(scenario.Feed.ScoreLeft > scenario.Feed.ScoreRight);
    }

    [Fact]
    public void Bearish_vs_bearish_favors_the_smaller_red_candle()
    {
        var scenario = NewCatalog().FindByMatchId(910003)!;
        Assert.True(scenario.Feed.ScoreRight > scenario.Feed.ScoreLeft);
        Assert.Equal(scenario.RightSymbol, scenario.Social.WinnerSymbol);
    }

    [Fact]
    public void Reversal_scenario_flips_the_leader()
    {
        var scenario = NewCatalog().FindByMatchId(910004)!;
        var rounds = scenario.Rounds;
        var firstHalfLeft = rounds.Take(8).Count(r => r.Winner == "left");
        var firstHalfRight = rounds.Take(8).Count(r => r.Winner == "right");
        var secondHalfLeft = rounds.Skip(8).Count(r => r.Winner == "left");
        Assert.True(firstHalfRight > firstHalfLeft);
        Assert.True(secondHalfLeft > rounds.Skip(8).Count(r => r.Winner == "right"));
        Assert.True(scenario.Feed.ScoreLeft > scenario.Feed.ScoreRight);
    }

    [Fact]
    public void Volatility_scenario_is_in_progress_with_wide_wicks()
    {
        var scenario = NewCatalog().FindByMatchId(910005)!;
        Assert.False(scenario.Finished);
        Assert.Equal(14, scenario.Rounds.Count);
        Assert.Equal("live", scenario.Feed.Status);
        Assert.Null(scenario.Feed.MatchEndTime);
        Assert.NotNull(scenario.Feed.Left);
        Assert.False(scenario.Feed.Left!.Confirmed);
        Assert.Contains(scenario.Rounds, r => (r.Left.High - r.Left.Low) / r.Left.Open > 0.02m);
    }

    [Fact]
    public void Waiting_scenario_has_no_rounds_and_forms_the_first_candle()
    {
        var scenario = NewCatalog().FindByMatchId(910007)!;
        Assert.Empty(scenario.Rounds);
        Assert.Equal("waiting", scenario.Feed.Status);
        Assert.NotNull(scenario.Feed.Left);
        Assert.Equal(scenario.MatchStartMs, scenario.Feed.Left!.OpenTime);
        Assert.False(scenario.Feed.Left.Confirmed);
    }

    [Fact]
    public void Feed_round_trips_through_the_public_json_contract()
    {
        foreach (var scenario in NewCatalog().Scenarios)
        {
            var json = JsonSerializer.Serialize(scenario.Feed, new JsonSerializerOptions
            {
                PropertyNamingPolicy = JsonNamingPolicy.CamelCase
            });
            var restored = JsonSerializer.Deserialize<DTOs.CandleBattlesFeedDto>(json, new JsonSerializerOptions
            {
                PropertyNameCaseInsensitive = true
            });
            Assert.NotNull(restored);
            Assert.Equal(scenario.Feed.MatchId, restored!.MatchId);
            Assert.Equal(scenario.Feed.Rounds.Count, restored.Rounds.Count);
            Assert.Equal(scenario.Feed.ScoreLeft, restored.ScoreLeft);
            Assert.Equal(18, restored.ExpectedRounds);
        }
    }
}

/// <summary>Typed aliases so tests read against the shared constants.</summary>
internal static class CandleBattlesResolverBridge
{
    public const long PeriodMs = BLL.NFTFutebol.CandleBattlesResolver.PeriodMs;
    public const int ExpectedRounds = BLL.NFTFutebol.CandleBattlesResolver.ExpectedRounds;
}
