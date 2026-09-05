using System.Text.Json;
using CriptoVersus.Web.Components.Shared;
using CriptoVersus.Web.Services;
using DTOs;
using Microsoft.AspNetCore.Components;
using Microsoft.AspNetCore.Components.Web;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Logging;

namespace CriptoVersus.API.Tests;

public sealed class CandleBattleRenderingTests
{
    [Fact]
    public async Task TacticalPanelAndScoreVersion_DoNotChangeChartMarkup()
    {
        var points = new[]
        {
            new Input(100, 100m, 200m), new Input(200, 102m, 201m),
            new Input(300, 102m, 203m), new Input(400, 101m, 202m),
            new Input(500, 103m, 202m), new Input(600, 104m, 201m)
        };
        // Optional frozen public-price capture for local browser verification.
        var inputPath = Environment.GetEnvironmentVariable("CANDLE_PARITY_INPUT");
        if (!string.IsNullOrEmpty(inputPath))
            points = JsonSerializer.Deserialize<Input[]>(await File.ReadAllTextAsync(inputPath))!;

        var left = points.Select(p => new TvPriceChartPoint(p.Time, p.Left)).ToArray();
        var right = points.Select(p => new TvPriceChartPoint(p.Time, p.Right)).ToArray();
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddSingleton<IWebHostEnvironment>(new TestEnvironment());
        services.AddSingleton<AppCultureService>();
        services.AddSingleton<LocalizationService>();
        await using var provider = services.BuildServiceProvider();
        await using var renderer = new HtmlRenderer(provider, provider.GetRequiredService<ILoggerFactory>());
        async Task<string> Render(bool tactical, int version) => await renderer.Dispatcher.InvokeAsync(async () =>
        {
            var result = await renderer.RenderComponentAsync<TvCandleBattle>(ParameterView.FromDictionary(new Dictionary<string, object?>
            {
                ["InstanceId"] = "parity", ["LeftTickerLabel"] = "ASTERUSDT", ["RightTickerLabel"] = "CHIPUSDT",
                ["LeftHeroLabel"] = "ASTER", ["RightHeroLabel"] = "CHIP",
                ["LeftLogoUrl"] = "", ["RightLogoUrl"] = "", ["Culture"] = "pt-BR",
                ["LeftPoints"] = left, ["RightPoints"] = right,
                ["OfficialScoreA"] = 4, ["OfficialScoreB"] = 3,
                ["ShowTacticalPanel"] = tactical, ["ScoreVersion"] = version
            }));
            return result.ToHtmlString();
        });
        var partida = await Render(true, 2);
        var tv = await Render(false, 0);
        static string Chart(string html) => html[html.IndexOf("<section class=\"tv-candle-battle-card\"", StringComparison.Ordinal)..html.IndexOf("</section>", html.IndexOf("<section class=\"tv-candle-battle-card\"", StringComparison.Ordinal), StringComparison.Ordinal)];
        Assert.Equal(Chart(partida), Chart(tv));
        Assert.Contains("tv-candle-battle__doji", partida);
        Assert.DoesNotContain("broadcast-compact", tv);
        Assert.DoesNotContain("data-measured-height", tv);

        var output = Environment.GetEnvironmentVariable("CANDLE_PARITY_OUTPUT");
        if (!string.IsNullOrEmpty(output))
        {
            Directory.CreateDirectory(output);
            await File.WriteAllTextAsync(Path.Combine(output, "partida-rendered.html"), partida);
            await File.WriteAllTextAsync(Path.Combine(output, "tv-rendered.html"), tv);
            var model = CandleBattleChartModelBuilder.Build(left, right);
            await File.WriteAllTextAsync(Path.Combine(output, "model.json"), JsonSerializer.Serialize(model));
        }
    }

    public sealed record Input(long Time, decimal Left, decimal Right);

    private sealed class TestEnvironment : IWebHostEnvironment
    {
        public string ApplicationName { get; set; } = "CandleBattleRenderingTests";
        public string EnvironmentName { get; set; } = "Testing";
        public string ContentRootPath { get; set; } = AppContext.BaseDirectory;
        public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
        public string WebRootPath { get; set; } = AppContext.BaseDirectory;
        public IFileProvider WebRootFileProvider { get; set; } = new NullFileProvider();
    }
}
