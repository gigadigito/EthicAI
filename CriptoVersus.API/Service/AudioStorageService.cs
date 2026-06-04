using DTOs;
using Microsoft.Extensions.Options;

namespace CriptoVersus.API.Services;

public interface IAudioStorageService
{
    Task<AudioStoredFile> SaveGeneratedAudioAsync(AudioGenerationJobDto job, IFormFile audioFile, CancellationToken ct);
}

public sealed class AudioStorageService : IAudioStorageService
{
    private readonly IWebHostEnvironment _environment;
    private readonly IOptions<AudioGenerationOptions> _options;

    public AudioStorageService(
        IWebHostEnvironment environment,
        IOptions<AudioGenerationOptions> options)
    {
        _environment = environment;
        _options = options;
    }

    public async Task<AudioStoredFile> SaveGeneratedAudioAsync(AudioGenerationJobDto job, IFormFile audioFile, CancellationToken ct)
    {
        var root = _environment.WebRootPath;
        if (string.IsNullOrWhiteSpace(root))
            throw new InvalidOperationException("API wwwroot path is not configured.");

        var language = AudioRequestNormalizer.NormalizeLanguage(job.Language);
        var eventType = AudioRequestNormalizer.NormalizeEventType(job.EventType);
        var teamSegment = string.IsNullOrWhiteSpace(job.TeamSymbol) ? "generic" : job.TeamSymbol!.Trim().ToUpperInvariant();
        var fileName = !string.IsNullOrWhiteSpace(job.TargetFileName)
            ? job.TargetFileName!.Trim()
            : BuildDefaultFileName(job, audioFile.FileName);

        var relativePath = Path.Combine(
            _options.Value.AudioRootFolder.Trim('/', '\\'),
            language,
            eventType,
            teamSegment,
            fileName).Replace('\\', '/');

        var physicalPath = Path.Combine(root, relativePath.Replace('/', Path.DirectorySeparatorChar));
        var physicalDirectory = Path.GetDirectoryName(physicalPath)
            ?? throw new InvalidOperationException("Audio target directory could not be resolved.");

        Directory.CreateDirectory(physicalDirectory);

        await using var fileStream = File.Create(physicalPath);
        await audioFile.CopyToAsync(fileStream, ct);

        return new AudioStoredFile(
            RelativePath: relativePath,
            AudioUrl: "/" + relativePath.TrimStart('/'),
            FileName: fileName,
            PhysicalPath: physicalPath);
    }

    private static string BuildDefaultFileName(AudioGenerationJobDto job, string uploadedName)
    {
        var extension = Path.GetExtension(uploadedName);
        if (string.IsNullOrWhiteSpace(extension))
            extension = ".mp3";

        var parts = new[]
        {
            job.EventType,
            string.IsNullOrWhiteSpace(job.TeamSymbol) ? "generic" : job.TeamSymbol,
            string.IsNullOrWhiteSpace(job.ContextKey) ? null : job.ContextKey,
            string.IsNullOrWhiteSpace(job.Intensity) ? null : job.Intensity,
            job.Id.ToString()
        };

        var safeName = string.Join("_", parts.Where(x => !string.IsNullOrWhiteSpace(x))
            .Select(x => x!.Trim().Replace(' ', '_').ToLowerInvariant()));

        return $"{safeName}{extension}";
    }
}

public sealed record AudioStoredFile(
    string RelativePath,
    string AudioUrl,
    string FileName,
    string PhysicalPath);
