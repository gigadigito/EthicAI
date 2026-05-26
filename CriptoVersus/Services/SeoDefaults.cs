using Microsoft.AspNetCore.Components;

namespace CriptoVersus.Web.Services;

public static class SeoDefaults
{
    public const string GlobalKeywords = "CriptoVersus, #CriptoVersus, crypto battles, live crypto matches, crypto arena, crypto football, market battles, blockchain game, crypto scoreboard, live crypto competition, Bitcoin vs Ethereum, Binance crypto battles";
    public const string DefaultSocialImagePath = "/favicon-round-preview.png";

    public static string BuildAbsoluteUrl(IConfiguration configuration, NavigationManager navigationManager, string relativePath)
    {
        var baseUrl = configuration["CriptoVersus:PublicBaseUrl"]?.TrimEnd('/') ?? navigationManager.BaseUri.TrimEnd('/');
        return $"{baseUrl}{relativePath}";
    }

    public static string BuildCanonicalRootUrl(IConfiguration configuration, NavigationManager navigationManager)
    {
        var absoluteBaseUrl = BuildAbsoluteUrl(configuration, navigationManager, "/");
        var uri = new Uri(absoluteBaseUrl);
        var host = uri.Host.StartsWith("www.", StringComparison.OrdinalIgnoreCase)
            ? uri.Host[4..]
            : uri.Host;

        return $"{uri.Scheme}://{host}/";
    }
}
