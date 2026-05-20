namespace CriptoVersus.Web.Services;

internal static class EnvironmentIsolationGuard
{
    private static readonly string[] ProductionUrlMarkers =
    [
        "criptoversus.com",
        "api.criptoversus.com",
        "duckdns"
    ];

    public static void AssertDevelopmentConfiguration(IConfiguration configuration, IHostEnvironment environment)
    {
        if (!environment.IsDevelopment())
            return;

        ValidateDevelopmentUri(configuration["Api:BaseUrl"], "Api:BaseUrl");
        ValidateDevelopmentUri(configuration["CriptoVersus:PublicBaseUrl"], "CriptoVersus:PublicBaseUrl");
    }

    public static string BuildApiUrl(IConfiguration configuration, string relativePath)
    {
        var baseUri = GetRequiredApiBaseUri(configuration);

        if (Uri.TryCreate(relativePath, UriKind.Absolute, out var absoluteUri))
            return NormalizeSecureUri(absoluteUri).ToString();

        return NormalizeSecureUri(new Uri(baseUri, relativePath.TrimStart('/'))).ToString();
    }

    public static Uri GetRequiredApiBaseUri(IConfiguration configuration)
    {
        var apiBaseUrl = configuration["Api:BaseUrl"]?.Trim();
        if (string.IsNullOrWhiteSpace(apiBaseUrl))
            throw new InvalidOperationException("Api:BaseUrl não configurado.");

        if (!Uri.TryCreate(AppendTrailingSlash(apiBaseUrl), UriKind.Absolute, out var uri))
            throw new InvalidOperationException($"Api:BaseUrl inválido: {apiBaseUrl}");

        return uri;
    }

    private static void ValidateDevelopmentUri(string? rawUrl, string settingName)
    {
        if (string.IsNullOrWhiteSpace(rawUrl))
            throw new InvalidOperationException($"Development exige {settingName} configurado.");

        if (!Uri.TryCreate(rawUrl, UriKind.Absolute, out var uri))
            throw new InvalidOperationException($"{settingName} inválido: {rawUrl}");

        var normalized = rawUrl.Trim();
        if (ContainsProductionMarker(normalized) || !IsLoopbackHost(uri.Host))
        {
            throw new InvalidOperationException(
                $"Unsafe Development URL detected in {settingName}: {rawUrl}");
        }
    }

    private static bool ContainsProductionMarker(string value)
        => ProductionUrlMarkers.Any(marker => value.Contains(marker, StringComparison.OrdinalIgnoreCase));

    private static bool IsLoopbackHost(string host)
        => host.Equals("localhost", StringComparison.OrdinalIgnoreCase)
            || host.Equals("127.0.0.1", StringComparison.OrdinalIgnoreCase)
            || host.Equals("::1", StringComparison.OrdinalIgnoreCase);

    private static Uri NormalizeSecureUri(Uri uri)
    {
        if (uri.Scheme.Equals(Uri.UriSchemeHttp, StringComparison.OrdinalIgnoreCase) && !IsLoopbackHost(uri.Host))
        {
            var builder = new UriBuilder(uri)
            {
                Scheme = Uri.UriSchemeHttps,
                Port = uri.IsDefaultPort ? -1 : uri.Port
            };

            return builder.Uri;
        }

        return uri;
    }

    private static string AppendTrailingSlash(string url)
        => url.EndsWith("/", StringComparison.Ordinal) ? url : url + "/";
}
