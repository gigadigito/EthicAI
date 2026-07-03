using CriptoVersus.API.Services;
using DAL.NftFutebol;
using DTOs;
using EthicAI.EntityModel;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;

namespace CriptoVersus.API.Tests;

public sealed class AudioGenerationQueueServiceTests
{
    [Fact]
    public async Task EnqueueManualTestAsync_PreservesAccentsAndRepairsMojibakeBeforePersisting()
    {
        await using var db = CreateDbContext();
        var service = CreateService(db);

        var queued = await service.EnqueueManualTestAsync(new AudioAssetTestGenerateRequestDto
        {
            EventType = "momentum_shift",
            Language = "pt-BR",
            TeamSymbol = "PENDLE",
            TeamName = "PENDLE",
            ContextKey = "non_possession_defense",
            Intensity = "normal",
            OverrideTextPrompt = "PENDLE mesmo sem posse de bola protege bem a sua área."
        }, CancellationToken.None);

        var job = await db.AudioGenerationQueueItem.SingleAsync(x => x.Id == queued.JobId);

        Assert.True(queued.Queued);
        Assert.Equal("PENDLE mesmo sem posse de bola protege bem a sua área.", job.TextPrompt);
        Assert.Equal("pendle mesmo sem posse de bola protege bem a sua area", job.NormalizedText);
        Assert.DoesNotContain("Ã", job.TextPrompt, StringComparison.Ordinal);
        Assert.DoesNotContain("Â", job.TextPrompt, StringComparison.Ordinal);
        Assert.DoesNotContain("Æ", job.TextPrompt, StringComparison.Ordinal);
        Assert.DoesNotContain("â€", job.TextPrompt, StringComparison.Ordinal);
        Assert.DoesNotContain("Ãƒ", job.TextPrompt, StringComparison.Ordinal);
    }

    [Fact]
    public async Task EnqueueManualTestAsync_RepairsCommonUtf8MojibakeVariants()
    {
        await using var db = CreateDbContext();
        var service = CreateService(db);

        var queued = await service.EnqueueManualTestAsync(new AudioAssetTestGenerateRequestDto
        {
            EventType = "momentum_shift",
            Language = "pt-BR",
            TeamSymbol = "PENDLE",
            TeamName = "PENDLE",
            ContextKey = "non_possession_defense",
            Intensity = "normal",
            OverrideTextPrompt = "PENDLE mesmo sem posse de bola protege bem a sua ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¡rea."
        }, CancellationToken.None);

        var job = await db.AudioGenerationQueueItem.SingleAsync(x => x.Id == queued.JobId);

        Assert.Equal("PENDLE mesmo sem posse de bola protege bem a sua área.", job.TextPrompt);
        Assert.Equal("pendle mesmo sem posse de bola protege bem a sua area", job.NormalizedText);
    }

    private static AudioGenerationQueueService CreateService(EthicAIDbContext db)
    {
        var narrativeResolver = new AudioNarrativeResolverService(db, NullLogger<AudioNarrativeResolverService>.Instance);
        return new AudioGenerationQueueService(
            db,
            new TestAudioStorageService(),
            narrativeResolver,
            Options.Create(new AudioGenerationOptions { LeaseDurationSeconds = 300, KeepWavFiles = false }),
            Options.Create(new ProceduralAudioFeatureOptions { Enabled = true, AllowQueueGeneration = true }),
            NullLogger<AudioGenerationQueueService>.Instance);
    }

    private static EthicAIDbContext CreateDbContext()
    {
        var options = new DbContextOptionsBuilder<EthicAIDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString("N"))
            .Options;

        return new EthicAIDbContext(options);
    }

    private sealed class TestAudioStorageService : IAudioStorageService
    {
        public Task<AudioStoredFile> SaveGeneratedAudioAsync(AudioGenerationJobDto job, IFormFile audioFile, CancellationToken ct)
            => throw new NotSupportedException();

        public Task<AudioStoredFileDeletionResult> DeleteStoredAudioAsync(string relativePath, CancellationToken ct)
            => throw new NotSupportedException();

        public bool StoredAudioExists(string? relativePath) => true;

        public AudioStoredPathDiagnostics InspectStoredAudio(string? relativePath)
            => new(relativePath ?? string.Empty, null, relativePath ?? string.Empty, true, null);

        public IReadOnlyList<AudioStoredFilesystemEntry> EnumerateStoredAudioFiles() => Array.Empty<AudioStoredFilesystemEntry>();

        public string? GetPrimaryAudioRootPath() => null;
    }
}


