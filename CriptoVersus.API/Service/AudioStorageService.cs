using DTOs;
using Microsoft.Extensions.Options;

namespace CriptoVersus.API.Services;

public interface IAudioStorageService
{
    Task<AudioStoredFile> SaveGeneratedAudioAsync(AudioGenerationJobDto job, IFormFile audioFile, CancellationToken ct);
    Task<AudioStoredFileDeletionResult> DeleteStoredAudioAsync(string relativePath, CancellationToken ct);
    bool StoredAudioExists(string? relativePath);
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

        var fileName = !string.IsNullOrWhiteSpace(job.TargetFileName)
            ? job.TargetFileName!.Trim()
            : BuildDefaultFileName(job, audioFile.FileName);
        var relativePath = BuildRelativePath(job, fileName);

        string? primaryPhysicalPath = null;
        foreach (var root in roots)
        {
            var targetPath = ResolveSafePhysicalPath(root, relativePath);
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

    public Task<AudioStoredFileDeletionResult> DeleteStoredAudioAsync(string relativePath, CancellationToken ct)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(relativePath);

        var roots = ResolveTargetRoots();
        var deletedFiles = new List<string>();
        var missingFiles = new List<string>();

        foreach (var root in roots)
        {
            var targetPath = ResolveSafePhysicalPath(root, relativePath);
            if (File.Exists(targetPath))
            {
                File.Delete(targetPath);
                deletedFiles.Add(targetPath);
            }
            else
            {
                missingFiles.Add(targetPath);
            }
        }

        return Task.FromResult(new AudioStoredFileDeletionResult(
            RelativePath: relativePath.Replace('\\', '/'),
            DeletedPaths: deletedFiles,
            MissingPaths: missingFiles));
    }

    public bool StoredAudioExists(string? relativePath)
    {
        if (string.IsNullOrWhiteSpace(relativePath))
            return false;

        var roots = ResolveTargetRoots();
        foreach (var root in roots)
        {
            var targetPath = ResolveSafePhysicalPath(root, relativePath);
            if (File.Exists(targetPath))
                return true;
        }

        return false;
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

    private string BuildRelativePath(AudioGenerationJobDto job, string fileName)
    {
        if (!string.IsNullOrWhiteSpace(job.TargetRelativePath))
        {
            var sanitized = job.TargetRelativePath!.Trim().Trim('/', '\\').Replace('\\', '/');
            return $"{sanitized}/{fileName}".TrimStart('/');
        }

        var language = AudioRequestNormalizer.NormalizeLanguage(job.Language);
        var eventType = AudioRequestNormalizer.NormalizeEventType(job.EventType);
        var teamSegment = string.IsNullOrWhiteSpace(job.TeamSymbol) ? "generic" : job.TeamSymbol!.Trim().ToUpperInvariant();

        return Path.Combine(
            _options.Value.AudioRootFolder.Trim('/', '\\'),
            language,
            eventType,
            teamSegment,
            fileName).Replace('\\', '/');
    }

    private static string ResolveSafePhysicalPath(string root, string relativePath)
    {
        var fullRoot = Path.GetFullPath(root);
        var combined = Path.GetFullPath(Path.Combine(fullRoot, relativePath.Replace('/', Path.DirectorySeparatorChar)));

        if (!combined.StartsWith(fullRoot, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException($"Unsafe audio path detected: {relativePath}");

        return combined;
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

public sealed record AudioStoredFileDeletionResult(
    string RelativePath,
    IReadOnlyList<string> DeletedPaths,
    IReadOnlyList<string> MissingPaths);
