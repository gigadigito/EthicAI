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
    private readonly IConfiguration _configuration;

    public AudioStorageService(
        IWebHostEnvironment environment,
        IOptions<AudioGenerationOptions> options,
        IConfiguration configuration)
    {
        _environment = environment;
        _options = options;
        _configuration = configuration;
    }

    public async Task<AudioStoredFile> SaveGeneratedAudioAsync(AudioGenerationJobDto job, IFormFile audioFile, CancellationToken ct)
    {
        var roots = ResolveTargetRoots();
        if (roots.Count == 0)
            throw new InvalidOperationException("No public audio root could be resolved.");

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

        string? primaryPhysicalPath = null;
        foreach (var root in roots)
        {
            var targetPath = Path.Combine(root, relativePath.Replace('/', Path.DirectorySeparatorChar));
            var targetDirectory = Path.GetDirectoryName(targetPath)
                ?? throw new InvalidOperationException("Audio target directory could not be resolved.");

            Directory.CreateDirectory(targetDirectory);

            await using var fileStream = File.Create(targetPath);
            await audioFile.CopyToAsync(fileStream, ct);
            await fileStream.FlushAsync(ct);

            primaryPhysicalPath ??= targetPath;
        }

        if (primaryPhysicalPath is null)
            throw new InvalidOperationException("Audio file could not be stored.");

        return new AudioStoredFile(
            RelativePath: relativePath,
            AudioUrl: BuildPublicAudioUrl(relativePath),
            FileName: fileName,
            PhysicalPath: primaryPhysicalPath);
    }

    private List<string> ResolveTargetRoots()
    {
        var roots = new List<string>();
        AddIfValid(roots, _options.Value.PublicAudioRootPath);
        AddIfValid(roots, _environment.WebRootPath);
        return roots
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    private string BuildPublicAudioUrl(string relativePath)
    {
        var normalizedRelativePath = "/" + relativePath.TrimStart('/').Replace('\\', '/');
        var configuredBaseUrl = _options.Value.PublicBaseUrl?.Trim()
            ?? _configuration["SocialAutomation:PublicBaseUrl"]?.Trim()
            ?? _configuration["CriptoVersus:PublicBaseUrl"]?.Trim();

        if (string.IsNullOrWhiteSpace(configuredBaseUrl))
            return normalizedRelativePath;

        return $"{configuredBaseUrl.TrimEnd('/')}{normalizedRelativePath}";
    }

    private static void AddIfValid(List<string> roots, string? root)
    {
        if (string.IsNullOrWhiteSpace(root))
            return;

        roots.Add(root.Trim());
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
