using CriptoVersus.API.Services;
using EthicAI.EntityModel;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;

namespace CriptoVersus.API.Tests;

public sealed class AudioNarrativeResolverServiceTests
{
    [Fact]
    public async Task ResolveAsync_WhenExplicitTextPromptIsProvided_PreservesIt()
    {
        await using var db = CreateDbContext();
        var service = new AudioNarrativeResolverService(db, NullLogger<AudioNarrativeResolverService>.Instance);

        var request = new DTOs.AudioResolveRequest
        {
            EventType = "momentum_shift",
            Language = "pt-BR",
            RawSymbol = "FIDAUSDT",
            NormalizedSymbol = "FIDA",
            TeamSymbol = "FIDA",
            TeamName = "FIDA",
            TextPrompt = "FIDA mesmo sem posse de bola defende a sua area.",
            ContextKey = "non_possession_defense",
            Intensity = "normal"
        };

        var resolved = await service.ResolveAsync(request, CancellationToken.None);

        Assert.Equal("FIDA mesmo sem posse de bola defende a sua area.", resolved.TextPrompt);
    }

    [Fact]
    public async Task ResolveAsync_WhenTextPromptIsMissing_GeneratesTemplatePrompt()
    {
        await using var db = CreateDbContext();
        var service = new AudioNarrativeResolverService(db, NullLogger<AudioNarrativeResolverService>.Instance);

        var request = new DTOs.AudioResolveRequest
        {
            EventType = "momentum_shift",
            Language = "pt-BR",
            RawSymbol = "FIDAUSDT",
            NormalizedSymbol = "FIDA",
            TeamSymbol = "FIDA",
            TeamName = "FIDA",
            ContextKey = "dominance",
            Intensity = "normal"
        };

        var resolved = await service.ResolveAsync(request, CancellationToken.None);

        Assert.Equal("FIDA assume o controle da partida e muda completamente o ritmo da arena!", resolved.TextPrompt);
    }

    private static EthicAIDbContext CreateDbContext()
    {
        var options = new DbContextOptionsBuilder<EthicAIDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString("N"))
            .Options;

        return new EthicAIDbContext(options);
    }
}
