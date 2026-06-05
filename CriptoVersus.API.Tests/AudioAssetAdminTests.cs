using CriptoVersus.API.Services;
using DAL.NftFutebol;
using DTOs;
using EthicAI.EntityModel;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;

namespace CriptoVersus.API.Tests;

public sealed class AudioAssetAdminTests
{
    [Fact]
    public void SuspicionInspector_FlagsLegacyNarrativeLeaks()
    {
        var asset = new AudioAsset
        {
            Language = "pt-BR",
            RawSymbol = "BTCUSDT",
            TeamName = "BTCUSDT",
            TextPrompt = "Goal call for PT-BR using BTCUSDT and extra USDT"
        };

        var rules = AudioAssetSuspicionInspector.Evaluate(asset);

        Assert.Contains("contains_usdt", rules);
        Assert.Contains("contains_language_code", rules);
        Assert.Contains("raw_symbol_leak", rules);
        Assert.Contains("team_name_equals_raw_symbol", rules);
    }

    [Fact]
    public async Task Resolver_OnlyReturnsReadyAssets()
    {
        var dbName = Guid.NewGuid().ToString("N");
        var options = new DbContextOptionsBuilder<EthicAIDbContext>()
            .UseInMemoryDatabase(dbName)
            .Options;

        await using (var seed = new EthicAIDbContext(options))
        {
            seed.AudioAsset.AddRange(
                new AudioAsset
                {
                    Id = 1,
                    EventType = "goal",
                    Language = "pt-BR",
                    TeamSymbol = "BTC",
                    AudioUrl = "/audio/disabled.mp3",
                    RelativePath = "audio/test/disabled.mp3",
                    FileName = "disabled.mp3",
                    Status = AudioAssetStatus.Disabled,
                    CreatedAtUtc = DateTime.UtcNow,
                    UpdatedAtUtc = DateTime.UtcNow
                },
                new AudioAsset
                {
                    Id = 2,
                    EventType = "goal",
                    Language = "pt-BR",
                    TeamSymbol = "BTC",
                    AudioUrl = "/audio/ready.mp3",
                    RelativePath = "audio/test/ready.mp3",
                    FileName = "ready.mp3",
                    Status = AudioAssetStatus.Ready,
                    CreatedAtUtc = DateTime.UtcNow,
                    UpdatedAtUtc = DateTime.UtcNow
                });

            await seed.SaveChangesAsync();
        }

        await using var db = new EthicAIDbContext(options);
        var service = new AudioAssetResolverService(
            db,
            Options.Create(new ProceduralAudioFeatureOptions { Enabled = true }),
            NullLogger<AudioAssetResolverService>.Instance);

        var result = await service.ResolveAsync(new AudioResolveRequest
        {
            EventType = "goal",
            Language = "pt-BR",
            TeamSymbol = "BTC",
            QueueIfMissing = false
        });

        Assert.NotNull(result);
        Assert.Equal(2, result!.Asset.Id);
    }
}
