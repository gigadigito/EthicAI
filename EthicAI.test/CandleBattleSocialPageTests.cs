using System.Text.Json.Nodes;
using CriptoVersus.Web.Services;
using Microsoft.AspNetCore.Components;

namespace EthicAI.test;

public sealed class CandleBattleSocialPageTests
{
    [Fact]
    public void DirectSocialRoutes_ExistForEverySupportedCulture()
    {
        var page = System.Reflection.Assembly.Load("CriptoVersus.Web").GetTypes()
            .Single(type => type.Name == "CandleBattleSocial");
        var routes = page.GetCustomAttributes(typeof(RouteAttribute), false)
            .Cast<RouteAttribute>().Select(x => x.Template).ToHashSet();
        var localizer = new RouteLocalizationService(new AppCultureService());

        foreach (var culture in new[] { "en", "pt", "zh", "es", "fr", "de", "it", "ja" })
        {
            Assert.Contains($"/{culture}/social/candle-battle/{{MatchId:int}}", routes);
            Assert.Equal($"/{culture}/social/candle-battle/41", localizer.BuildCandleBattleSocialPath(culture, 41));
        }
    }

    [Fact]
    public void SocialPage_TranslationsExistInEverySupportedCulture()
    {
        var keys = new[] { "title", "descriptionGeneric", "description", "loading", "notFound",
            "error", "completed", "ongoing", "result", "winner", "loser", "draw", "replay", "noReplay",
            "duration", "minutes", "rounds", "green", "red", "chart", "opening", "closing", "disclaimer" };
        var captureKeys = new[] { "roundOf", "finalScore", "scoreFinalLabel", "winnerTag", "winnerLine",
            "bubble1", "bubble2", "bubble3", "bubble4", "bubble5", "bubble6",
            "finalWinner", "finalLoser", "finalDraw", "finalDrawReply" };
        var directory = new DirectoryInfo(AppContext.BaseDirectory);
        while (directory is not null && !File.Exists(Path.Combine(directory.FullName, "CriptoVersus", "i18n.pt-BR.json")))
            directory = directory.Parent;
        Assert.NotNull(directory);
        var root = Path.Combine(directory.FullName, "CriptoVersus");
        foreach (var culture in new[] { "en-US", "pt-BR", "zh-CN", "es-ES", "fr-FR", "de-DE", "it-IT", "ja-JP" })
        {
            var json = JsonNode.Parse(File.ReadAllText(Path.Combine(root, $"i18n.{culture}.json")));
            var block = json?["social"]?["candleBattle"];
            Assert.NotNull(block);
            foreach (var key in keys)
                Assert.False(string.IsNullOrWhiteSpace(block[key]?.GetValue<string>()), $"{culture}: social.candleBattle.{key}");
            var capture = block["capture"];
            Assert.NotNull(capture);
            foreach (var key in captureKeys)
                Assert.False(string.IsNullOrWhiteSpace(capture[key]?.GetValue<string>()), $"{culture}: social.candleBattle.capture.{key}");
        }
    }

    [Fact]
    public void SocialPage_ExposesCompactCaptureMode()
    {
        var assembly = System.Reflection.Assembly.Load("CriptoVersus.Web");
        var page = assembly.GetTypes().Single(type => type.Name == "CandleBattleSocial");
        var mode = page.GetProperty("Mode");
        Assert.NotNull(mode);
        Assert.Contains(mode.GetCustomAttributes(typeof(SupplyParameterFromQueryAttribute), false),
            attribute => attribute is SupplyParameterFromQueryAttribute query && query.Name == "mode");
        Assert.Contains(assembly.GetTypes(), type => type.Name == "CandleBattleSocialCapture");
    }
}
