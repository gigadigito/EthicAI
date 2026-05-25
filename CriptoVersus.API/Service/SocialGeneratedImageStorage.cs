using Microsoft.AspNetCore.Hosting;

namespace CriptoVersus.API.Services;

internal static class SocialGeneratedImageStorage
{
    private static readonly IReadOnlyDictionary<string, string> ContentTypes =
        new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            [".png"] = "image/png",
            [".jpg"] = "image/jpeg",
            [".jpeg"] = "image/jpeg",
            [".webp"] = "image/webp"
        };

    internal static string GetGeneratedImagesDirectory(IWebHostEnvironment environment)
    {
        if (string.IsNullOrWhiteSpace(environment.WebRootPath))
            return string.Empty;

        return Path.Combine(environment.WebRootPath, "social", "generated");
    }

    internal static string CreateGeneratedImageFileName(string extension = ".png")
    {
        var normalizedExtension = NormalizeExtension(extension);
        return $"criptoversus-{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}{normalizedExtension}";
    }

    internal static bool TryCreateGeneratedImagePath(
        IWebHostEnvironment environment,
        string? fileName,
        out string safeFileName,
        out string physicalPath,
        out string contentType)
    {
        safeFileName = string.Empty;
        physicalPath = string.Empty;
        contentType = string.Empty;

        if (!TrySanitizeFileName(fileName, out safeFileName))
            return false;

        if (!TryGetContentType(safeFileName, out contentType))
            return false;

        return TryBuildPhysicalPath(environment, safeFileName, out physicalPath);
    }

    internal static bool TryResolveGeneratedImagePath(
        IWebHostEnvironment environment,
        string? fileName,
        out string physicalPath,
        out string contentType)
    {
        physicalPath = string.Empty;
        contentType = string.Empty;

        if (!TryCreateGeneratedImagePath(environment, fileName, out _, out var candidatePath, out contentType))
            return false;

        if (!File.Exists(candidatePath))
            return false;

        physicalPath = candidatePath;
        return true;
    }

    internal static async Task<string> SaveGeneratedImageAsync(
        IWebHostEnvironment environment,
        byte[] bytes,
        string fileName,
        CancellationToken ct)
    {
        if (!TryCreateGeneratedImagePath(environment, fileName, out _, out var physicalPath, out _))
            throw new InvalidOperationException("Could not resolve generated image path.");

        var directory = Path.GetDirectoryName(physicalPath);
        if (string.IsNullOrWhiteSpace(directory))
            throw new InvalidOperationException("Could not resolve generated image directory.");

        Directory.CreateDirectory(directory);
        await File.WriteAllBytesAsync(physicalPath, bytes, ct);
        return physicalPath;
    }

    private static bool TrySanitizeFileName(string? fileName, out string safeFileName)
    {
        safeFileName = string.Empty;

        if (string.IsNullOrWhiteSpace(fileName))
            return false;

        var trimmedFileName = fileName.Trim();
        safeFileName = Path.GetFileName(trimmedFileName);
        if (string.IsNullOrWhiteSpace(safeFileName))
            return false;

        if (!string.Equals(trimmedFileName, safeFileName, StringComparison.Ordinal))
            return false;

        return true;
    }

    private static bool TryBuildPhysicalPath(
        IWebHostEnvironment environment,
        string safeFileName,
        out string physicalPath)
    {
        physicalPath = string.Empty;

        var generatedDirectory = GetGeneratedImagesDirectory(environment);
        if (string.IsNullOrWhiteSpace(generatedDirectory))
            return false;

        var normalizedDirectory = Path.GetFullPath(generatedDirectory);
        var normalizedCandidate = Path.GetFullPath(Path.Combine(normalizedDirectory, safeFileName));
        var directoryPrefix = normalizedDirectory.EndsWith(Path.DirectorySeparatorChar)
            ? normalizedDirectory
            : normalizedDirectory + Path.DirectorySeparatorChar;
        var pathComparison = OperatingSystem.IsWindows()
            ? StringComparison.OrdinalIgnoreCase
            : StringComparison.Ordinal;

        if (!normalizedCandidate.StartsWith(directoryPrefix, pathComparison))
            return false;

        physicalPath = normalizedCandidate;
        return true;
    }

    private static bool TryGetContentType(string fileName, out string contentType)
    {
        var extension = Path.GetExtension(fileName);
        return ContentTypes.TryGetValue(extension, out contentType!);
    }

    private static string NormalizeExtension(string extension)
    {
        var normalizedExtension = extension.StartsWith(".", StringComparison.Ordinal)
            ? extension
            : "." + extension;

        if (!ContentTypes.ContainsKey(normalizedExtension))
            throw new ArgumentException($"Unsupported generated image extension: {extension}", nameof(extension));

        return normalizedExtension;
    }

    // TODO: add a background cleanup worker to delete generated images older than 24 hours.
}
