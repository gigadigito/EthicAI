using System.Reflection;

namespace CriptoVersus.Web.Services;

public sealed class PublishedVersionService
{
    public PublishedVersionService(IWebHostEnvironment environment)
    {
        var assembly = typeof(Program).Assembly;
        var informationalVersion = assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion;
        var assemblyVersion = assembly.GetName().Version?.ToString();
        var assemblyPath = assembly.Location;
        var publishedAtUtc = File.Exists(assemblyPath)
            ? File.GetLastWriteTimeUtc(assemblyPath)
            : DateTime.UtcNow;

        EnvironmentName = environment.EnvironmentName;
        VersionValue = string.IsNullOrWhiteSpace(informationalVersion)
            ? assemblyVersion ?? "unknown"
            : informationalVersion;
        PublishedAtUtc = publishedAtUtc.ToString("yyyy-MM-dd HH:mm:ss 'UTC'");
        VersionTag = $"{EnvironmentName} | {VersionValue} | published {PublishedAtUtc}";
    }

    public string EnvironmentName { get; }

    public string VersionValue { get; }

    public string PublishedAtUtc { get; }

    public string VersionTag { get; }
}
