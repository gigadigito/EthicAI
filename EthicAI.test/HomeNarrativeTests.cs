using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using CriptoVersus.Web.Services;

namespace EthicAI.test;

public sealed class HomeNarrativeTests
{
    private static readonly string[] CultureCodes = ["en-US", "pt-BR", "zh-CN", "es-ES", "fr-FR", "de-DE", "it-IT", "ja-JP", "hi-IN"];

    private static readonly string[] RouteCultures = ["en", "pt", "zh", "es", "fr", "de", "it", "ja", "hi"];

    private static readonly string[] RequiredKeys =
    [
        "eyebrow", "title", "description", "explore", "howItWorks",
        "demonstrationEyebrow", "demonstrationTitle", "demonstrationDescription", "illustrativeNotice",
        "demonstrationAria", "visualRead", "example", "balanceAria", "stateAria",
        "balance", "momentum", "reversal", "balanceReading", "continueHome"
    ];

    private static readonly string[] AllowedBrandLiterals = ["Bitcoin", "BTC", "Ethereum", "ETH"];

    private static string Root => Path.Combine(RazorRouteScanner.FindCriptoVersusRoot(), "CriptoVersus");

    [Fact]
    public void HomeNarrativeTranslationsExistInEverySupportedCulture()
    {
        foreach (var culture in CultureCodes)
        {
            var json = JsonNode.Parse(File.ReadAllText(Path.Combine(Root, $"i18n.homeNarrative.{culture}.json")));
            Assert.NotNull(json);
            foreach (var key in RequiredKeys)
                Assert.False(string.IsNullOrWhiteSpace(json![key]?.GetValue<string>()), $"{culture}: homeNarrative.{key}");
        }
    }

    [Fact]
    public void HomeNarrativeComponent_ReferencesOnlyExistingKeys()
    {
        var razor = File.ReadAllText(Path.Combine(Root, "Components", "Shared", "HomeNarrative.razor"));

        var scopedKeys = Regex.Matches(razor, "T\\(\"([a-zA-Z0-9.]+)\"\\)")
            .Select(match => match.Groups[1].Value)
            .Distinct(StringComparer.Ordinal)
            .ToArray();
        Assert.NotEmpty(scopedKeys);
        foreach (var key in scopedKeys)
            Assert.Contains(key, RequiredKeys);

        var enResources = JsonNode.Parse(File.ReadAllText(Path.Combine(Root, "i18n.en-US.json")));
        var sharedKeys = Regex.Matches(razor, "L\\.T\\(\"([a-zA-Z0-9.]+)\"")
            .Select(match => match.Groups[1].Value)
            .Distinct(StringComparer.Ordinal)
            .ToArray();
        Assert.NotEmpty(sharedKeys);
        foreach (var key in sharedKeys)
        {
            var node = enResources;
            foreach (var segment in key.Split('.'))
                node = node?[segment];

            Assert.False(string.IsNullOrWhiteSpace(node?.GetValue<string>()), $"i18n.en-US.json: {key}");
        }
    }

    [Fact]
    public void HomeNarrativeMarkup_HasNoHardcodedUserVisibleStrings()
    {
        var razor = File.ReadAllText(Path.Combine(Root, "Components", "Shared", "HomeNarrative.razor"));

        foreach (Match match in Regex.Matches(razor, "<[^>]+>([^<@]+)<"))
        {
            var text = match.Groups[1].Value.Trim();
            if (string.IsNullOrWhiteSpace(text))
                continue;

            Assert.Contains(text, AllowedBrandLiterals);
        }
    }

    [Fact]
    public void PublicHome_IncludesHomeNarrative()
    {
        var razor = File.ReadAllText(Path.Combine(Root, "Components", "Pages", "Internet", "PublicHome.razor"));
        Assert.Contains("<HomeNarrative Culture=\"@CurrentCulture\" />", razor);
    }

    [Fact]
    public void HomeLanguageSwitch_StaysOnHomeForEveryCulturePair()
    {
        var routes = new RouteLocalizationService(new AppCultureService());

        foreach (var source in RouteCultures)
        {
            foreach (var target in RouteCultures)
            {
                Assert.Equal($"/{target}", routes.BuildLocalizedPathForCurrentPage(target, $"/{source}"));
            }
        }
    }
}
