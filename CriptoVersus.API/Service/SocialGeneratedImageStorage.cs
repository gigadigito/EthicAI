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

    internal static bool TryResolveGeneratedImagePath(
        IWebHostEnvironment environment,
        string? fileName,
        out string physicalPath,
        out string contentType)
    {
        physicalPath = string.Empty;
        contentType = string.Empty;

        if (string.IsNullOrWhiteSpace(fileName))
            return false;

        var trimmedFileName = fileName.Trim();
        var safeFileName = Path.GetFileName(trimmedFileName);
        if (string.IsNullOrWhiteSpace(safeFileName))
            return false;

        if (!string.Equals(trimmedFileName, safeFileName, StringComparison.Ordinal))
            return false;

        if (!TryGetContentType(safeFileName, out contentType))
            return false;

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

        if (!File.Exists(normalizedCandidate))
            return false;

        physicalPath = normalizedCandidate;
        return true;
    }

    private static bool TryGetContentType(string fileName, out string contentType)
    {
        var extension = Path.GetExtension(fileName);
        return ContentTypes.TryGetValue(extension, out contentType!);
    }

    // TODO: add a background cleanup worker to delete generated images older than 24 hours.
}
