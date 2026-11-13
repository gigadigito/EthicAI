using System.Text.Json.Nodes;
using CriptoVersus.Web.Services;
using Microsoft.AspNetCore.Components;

namespace EthicAI.test;

public sealed class WhaleOceanPageTests
{
    private static readonly string[] RouteCultures = ["en", "pt", "zh", "es", "fr", "de", "it", "ja", "hi"];
    private static readonly string[] CultureCodes = ["en-US", "pt-BR", "zh-CN", "es-ES", "fr-FR", "de-DE", "it-IT", "ja-JP", "hi-IN"];

    [Fact]
    public void WhaleOceanRoutes_ExistForEverySupportedCulture()
    {
        var page = System.Reflection.Assembly.Load("CriptoVersus.Web").GetTypes()
            .Single(type => type.Name == "WhaleOceanPage");
        var routes = page.GetCustomAttributes(typeof(RouteAttribute), false)
            .Cast<RouteAttribute>().Select(x => x.Template).ToHashSet();
        var localizer = new RouteLocalizationService(new AppCultureService());

        Assert.Contains("/tv/whale-ocean/{MatchId:int}/{Slug}", routes);
        foreach (var culture in RouteCultures)
        {
            Assert.Contains($"/{culture}/tv/whale-ocean/{{MatchId:int}}/{{Slug}}", routes);
            Assert.Equal($"/{culture}/tv/whale-ocean/41/btc-vs-eth", localizer.BuildWhaleOceanPath(culture, 41, "btc-vs-eth"));
        }
    }

    [Fact]
    public void WhaleOceanPage_IsAsyncDisposableAndDisposesJsSafely()
    {
        var page = System.Reflection.Assembly.Load("CriptoVersus.Web").GetTypes()
            .Single(type => type.Name == "WhaleOceanPage");
        Assert.Contains(typeof(IAsyncDisposable), page.GetInterfaces());

        var razor = File.ReadAllText(Path.Combine(
            RazorRouteScanner.FindCriptoVersusRoot(),
            "CriptoVersus", "Components", "Pages", "Internet", "WhaleOceanPage.razor"));

        Assert.Contains("DisposeJsAsync", razor);
        Assert.Contains("DisposeJsCoreAsync", razor);
        Assert.DoesNotContain("_module.InvokeVoidAsync", razor);
        Assert.Contains("catch (JSDisconnectedException)", razor);
    }

    [Fact]
    public void WhaleOceanPage_TranslationsExistInEverySupportedCulture()
    {
        var keys = new[]
        {
            "pageTitle", "title", "tagline", "backToHome", "pause", "resume",
            "quality", "qualityLow", "qualityMedium", "qualityHigh",
            "loading", "loadFailed", "matchNotFound", "rendererFailed",
            "bootstrapPending", "live", "finalized", "statusUnavailable",
            "stageAria", "demoModeOff", "direction", "buy", "sell",
            "buyAggressor", "sellAggressor", "events", "alertWhale", "alertShark",
            "windowVolume", "endedAt"
        };

        var directory = new DirectoryInfo(AppContext.BaseDirectory);
        while (directory is not null && !File.Exists(Path.Combine(directory.FullName, "CriptoVersus", "i18n.pt-BR.json")))
            directory = directory.Parent;
        Assert.NotNull(directory);
        var root = Path.Combine(directory.FullName, "CriptoVersus");
        foreach (var culture in CultureCodes)
        {
            var json = JsonNode.Parse(File.ReadAllText(Path.Combine(root, $"i18n.{culture}.json")));
            var block = json?["whaleOcean"];
            Assert.NotNull(block);
            foreach (var key in keys)
                Assert.False(string.IsNullOrWhiteSpace(block[key]?.GetValue<string>()), $"{culture}: whaleOcean.{key}");
        }
    }
}
