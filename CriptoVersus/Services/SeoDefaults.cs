using Microsoft.AspNetCore.Components;

namespace CriptoVersus.Web.Services;

public static class SeoDefaults
{
    private static readonly Uri DefaultPublicBaseUri = new("https://www.criptoversus.com/");

    public const string GlobalKeywords = "CriptoVersus, #CriptoVersus, crypto battles, live crypto matches, crypto arena, crypto football, market battles, blockchain game, crypto scoreboard, live crypto competition, Bitcoin vs Ethereum, Binance crypto battles";
    public const string DefaultSocialImagePath = "/favicon-round-preview.png";

    public static string BuildAbsoluteUrl(IConfiguration configuration, NavigationManager navigationManager, string relativePath)
        => BuildPublicAbsoluteUrl(configuration, navigationManager, relativePath);

    public static string BuildPublicAbsoluteUrl(IConfiguration configuration, string relativePath)
        => BuildPublicAbsoluteUrl(configuration, navigationManager: null, relativePath);

    public static string BuildPublicAbsoluteUrl(IConfiguration configuration, NavigationManager? navigationManager, string relativePath)
    {
        var baseUrl = ResolvePublicBaseUrl(configuration, navigationManager);
        return new Uri(new Uri(baseUrl + "/"), relativePath.TrimStart('/')).ToString();
    }

    public static string BuildCanonicalRootUrl(IConfiguration configuration, NavigationManager navigationManager)
    {
        return BuildPublicBaseUrl(configuration, navigationManager);
    }

    public static string BuildPublicBaseUrl(IConfiguration configuration, NavigationManager navigationManager)
    {
        return ResolvePublicBaseUrl(configuration, navigationManager);
    }

    private static string ResolvePublicBaseUrl(IConfiguration configuration, NavigationManager? navigationManager)
    {
        var configuredBaseUrl = configuration["CriptoVersus:PublicBaseUrl"]?.Trim();
        if (string.IsNullOrWhiteSpace(configuredBaseUrl))
            return DefaultPublicBaseUri.ToString().TrimEnd('/');

        if (!Uri.TryCreate(configuredBaseUrl.EndsWith('/') ? configuredBaseUrl : configuredBaseUrl + "/", UriKind.Absolute, out var baseUri))
            return navigationManager?.BaseUri.TrimEnd('/') ?? DefaultPublicBaseUri.ToString().TrimEnd('/');

        if (IsLoopbackHost(baseUri.Host))
            return DefaultPublicBaseUri.ToString().TrimEnd('/');

        if (baseUri.Host.EndsWith("criptoversus.com", StringComparison.OrdinalIgnoreCase))
        {
            var builder = new UriBuilder(baseUri)
            {
                Scheme = Uri.UriSchemeHttps,
                Host = baseUri.Host.StartsWith("www.", StringComparison.OrdinalIgnoreCase)
                    ? baseUri.Host
                    : "www.criptoversus.com",
                Port = -1
            };

            return builder.Uri.ToString().TrimEnd('/');
        }

        return baseUri.ToString().TrimEnd('/');
    }

    private static bool IsLoopbackHost(string host)
        => host.Equals("localhost", StringComparison.OrdinalIgnoreCase)
            || host.Equals("127.0.0.1", StringComparison.OrdinalIgnoreCase)
            || host.Equals("::1", StringComparison.OrdinalIgnoreCase);
}
