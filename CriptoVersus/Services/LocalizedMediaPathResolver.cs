using System.Collections.Concurrent;
using Microsoft.AspNetCore.Hosting;

namespace CriptoVersus.Web.Services;

public sealed class LocalizedMediaPathResolver
{
    private readonly IWebHostEnvironment _environment;
    private readonly AppCultureService _appCulture;
    private readonly ILogger<LocalizedMediaPathResolver> _logger;
    private readonly ConcurrentDictionary<string, string?> _pathCache = new(StringComparer.OrdinalIgnoreCase);
    private readonly ConcurrentDictionary<string, IReadOnlyList<LocalizedMediaDirectory>> _directoryCache = new(StringComparer.OrdinalIgnoreCase);

    public LocalizedMediaPathResolver(
        IWebHostEnvironment environment,
        AppCultureService appCulture,
        ILogger<LocalizedMediaPathResolver> logger)
    {
        _environment = environment;
        _appCulture = appCulture;
        _logger = logger;
    }

    public string NormalizeCulture(string? culture)
        => _appCulture.NormalizeRouteCulture(culture);

    public IReadOnlyList<string> GetCultureFallbackChain(string? culture)
    {
        var current = NormalizeCulture(culture);
        return [current, AppCultureService.DefaultRouteCulture, AppCultureService.SecondaryRouteCulture]
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();
    }

    public string? ResolveAudioWebPath(
        string fileName,
        string? culture,
        string context = "tv",
        string legacyRelativeDirectory = "audio/tv",
        string legacyWebPrefix = "/audio/tv",
        string? version = null)
        => ResolveMediaWebPath("audio", fileName, culture, context, legacyRelativeDirectory, legacyWebPrefix, version);

    public string? ResolveVideoWebPath(
        string fileName,
        string? culture,
        string context,
        string legacyRelativeDirectory,
        string legacyWebPrefix,
        string? version = null)
        => ResolveMediaWebPath("video", fileName, culture, context, legacyRelativeDirectory, legacyWebPrefix, version);

    public IReadOnlyList<LocalizedMediaDirectory> ResolveVideoDirectories(
        string? culture,
        string context,
        string legacyRelativeDirectory,
        string legacyWebPrefix)
        => ResolveMediaDirectories("video", culture, context, legacyRelativeDirectory, legacyWebPrefix);

    private string? ResolveMediaWebPath(
        string mediaType,
        string fileName,
        string? culture,
        string context,
        string legacyRelativeDirectory,
        string legacyWebPrefix,
        string? version)
    {
        if (string.IsNullOrWhiteSpace(fileName) || string.IsNullOrWhiteSpace(_environment.WebRootPath))
            return null;

        var normalizedFileName = fileName.Trim().TrimStart('/', '\\');
        var normalizedCulture = NormalizeCulture(culture);
        var cacheKey = $"{mediaType}|{normalizedCulture}|{context}|{legacyRelativeDirectory}|{normalizedFileName}|{version}";

        return _pathCache.GetOrAdd(cacheKey, _ =>
        {
            foreach (var candidateCulture in GetCultureFallbackChain(normalizedCulture))
            {
                var localizedDirectory = Path.Combine(_environment.WebRootPath, "media", mediaType, candidateCulture, context);
                var localizedPhysicalPath = Path.Combine(localizedDirectory, normalizedFileName);
                if (!File.Exists(localizedPhysicalPath))
                    continue;

                var webPath = BuildLocalizedWebPath(mediaType, candidateCulture, context, normalizedFileName);
                _logger.LogInformation(
                    "Localized media resolved. MediaType={MediaType} RequestedCulture={RequestedCulture} ResolvedCulture={ResolvedCulture} Context={Context} File={FileName} Path={Path} FallbackUsed={FallbackUsed}",
                    mediaType,
                    normalizedCulture,
                    candidateCulture,
                    context,
                    normalizedFileName,
                    webPath,
                    !string.Equals(candidateCulture, normalizedCulture, StringComparison.OrdinalIgnoreCase));
                return AppendVersion(webPath, version);
            }

            var legacyPhysicalPath = Path.Combine(_environment.WebRootPath, legacyRelativeDirectory.Replace('/', Path.DirectorySeparatorChar));
            var legacyFullPath = Path.Combine(legacyPhysicalPath, normalizedFileName);
            if (File.Exists(legacyFullPath))
            {
                var legacyWebPath = $"{legacyWebPrefix.TrimEnd('/')}/{Uri.EscapeDataString(normalizedFileName)}";
                _logger.LogWarning(
                    "Localized media fallback to legacy. MediaType={MediaType} RequestedCulture={RequestedCulture} Context={Context} File={FileName} Path={Path}",
                    mediaType,
                    normalizedCulture,
                    context,
                    normalizedFileName,
                    legacyWebPath);
                return AppendVersion(legacyWebPath, version);
            }

            _logger.LogWarning(
                "Localized media not found. MediaType={MediaType} Culture={Culture} Context={Context} File={FileName}",
                mediaType,
                normalizedCulture,
                context,
                normalizedFileName);

            return null;
        });
    }

    private IReadOnlyList<LocalizedMediaDirectory> ResolveMediaDirectories(
        string mediaType,
        string? culture,
        string context,
        string legacyRelativeDirectory,
        string legacyWebPrefix)
    {
        if (string.IsNullOrWhiteSpace(_environment.WebRootPath))
            return [];

        var normalizedCulture = NormalizeCulture(culture);
        var cacheKey = $"{mediaType}|{normalizedCulture}|{context}|{legacyRelativeDirectory}";

        return _directoryCache.GetOrAdd(cacheKey, _ =>
        {
            var results = new List<LocalizedMediaDirectory>();

            foreach (var candidateCulture in GetCultureFallbackChain(normalizedCulture))
            {
                var physicalPath = Path.Combine(_environment.WebRootPath, "media", mediaType, candidateCulture, context);
                if (!Directory.Exists(physicalPath))
                    continue;

                _logger.LogInformation(
                    "Localized media directory resolved. MediaType={MediaType} RequestedCulture={RequestedCulture} ResolvedCulture={ResolvedCulture} Context={Context} Path={Path} FallbackUsed={FallbackUsed}",
                    mediaType,
                    normalizedCulture,
                    candidateCulture,
                    context,
                    physicalPath,
                    !string.Equals(candidateCulture, normalizedCulture, StringComparison.OrdinalIgnoreCase));
                results.Add(new LocalizedMediaDirectory(
                    physicalPath,
                    $"/media/{mediaType}/{candidateCulture}/{context}",
                    candidateCulture,
                    context,
                    IsLegacy: false));
            }

            var legacyPhysicalPath = Path.Combine(_environment.WebRootPath, legacyRelativeDirectory.Replace('/', Path.DirectorySeparatorChar));
            if (Directory.Exists(legacyPhysicalPath))
            {
                _logger.LogWarning(
                    "Localized media directory fallback to legacy. MediaType={MediaType} RequestedCulture={RequestedCulture} Context={Context} Path={Path}",
                    mediaType,
                    normalizedCulture,
                    context,
                    legacyPhysicalPath);
                results.Add(new LocalizedMediaDirectory(
                    legacyPhysicalPath,
                    legacyWebPrefix,
                    "legacy",
                    context,
                    IsLegacy: true));
            }

            if (results.Count == 0)
            {
                _logger.LogWarning(
                    "Localized media directories not found. MediaType={MediaType} Culture={Culture} Context={Context} LegacyDirectory={LegacyDirectory}",
                    mediaType,
                    normalizedCulture,
                    context,
                    legacyRelativeDirectory);
            }

            return results;
        });
    }

    private static string BuildLocalizedWebPath(string mediaType, string culture, string context, string fileName)
        => $"/media/{mediaType}/{culture}/{context}/{Uri.EscapeDataString(fileName)}";

    private static string AppendVersion(string path, string? version)
        => string.IsNullOrWhiteSpace(version)
            ? path
            : $"{path}?v={Uri.EscapeDataString(version)}";
}

public sealed record LocalizedMediaDirectory(
    string PhysicalPath,
    string WebPathPrefix,
    string Culture,
    string Context,
    bool IsLegacy);
