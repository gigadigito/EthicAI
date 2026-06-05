using DTOs;

namespace CriptoVersus.API.Tests;

public sealed class ProceduralNarrativeTextTests
{
    [Fact]
    public void GoalPrompt_ForEpicUsdt_UsesFriendlyNameWithoutTechnicalPair()
    {
        var normalizedSymbol = ProceduralAudioNormalization.NormalizeTeamSymbol("EPICUSDT");
        var teamName = ProceduralNarrativeText.ResolveFriendlyName("EPICUSDT", normalizedSymbol, null, null, null);
        var prompt = ProceduralNarrativeText.BuildTextPrompt("goal", "pt-BR", teamName);

        Assert.True(prompt.Contains("Epic", StringComparison.OrdinalIgnoreCase));
        Assert.False(prompt.Contains("EPICUSDT", StringComparison.OrdinalIgnoreCase));
        Assert.False(prompt.Contains("PT-BR", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public void GoalPrompt_ForBtcUsdt_UsesBitcoinWithoutTechnicalPair()
    {
        var normalizedSymbol = ProceduralAudioNormalization.NormalizeTeamSymbol("BTCUSDT");
        var teamName = ProceduralNarrativeText.ResolveFriendlyName("BTCUSDT", normalizedSymbol, null, null, null);
        var prompt = ProceduralNarrativeText.BuildTextPrompt("goal", "pt-BR", teamName);

        Assert.True(prompt.Contains("Bitcoin", StringComparison.OrdinalIgnoreCase));
        Assert.False(prompt.Contains("BTCUSDT", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public void CrossoverUp_ForTrxUsdt_MapsToNarrativeEventAndHumanPrompt()
    {
        var descriptor = ProceduralAudioEventMapper.MapScoreEvent(
            "PERCENTAGE_CROSSOVER_UP",
            null,
            5m,
            "TRXUSDT");

        Assert.True(
            descriptor.EventType is "momentum_shift" or "volatility_spike",
            $"Unexpected mapped event type: {descriptor.EventType}");

        var teamName = ProceduralNarrativeText.ResolveFriendlyName(
            "TRXUSDT",
            descriptor.NormalizedTeamSymbol,
            null,
            null,
            null);
        var prompt = ProceduralNarrativeText.BuildTextPrompt(descriptor.EventType, "pt-BR", teamName);

        Assert.True(
            prompt.Contains("Tron", StringComparison.OrdinalIgnoreCase)
            || prompt.Contains("TRX", StringComparison.OrdinalIgnoreCase),
            $"Expected humanized Tron prompt but got: {prompt}");
        Assert.False(prompt.Contains("TRXUSDT", StringComparison.OrdinalIgnoreCase));
    }
}
