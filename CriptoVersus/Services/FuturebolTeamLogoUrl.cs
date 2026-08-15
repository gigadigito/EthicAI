namespace CriptoVersus.Web.Services;

internal static class FuturebolTeamLogoUrl
{
    internal const string ProxyRoutePrefix = "/futurebol/team-logo/";
    private const string OfficialIconRouteMarker = "/api/icons/binance/";

    public static string? Resolve(string? logoUrl, string? fallbackSymbol)
    {
        var candidate = logoUrl?.Trim();
        var officialSymbol = ExtractOfficialIconSymbol(candidate);
        if (!string.IsNullOrWhiteSpace(officialSymbol))
            return BuildProxyUrl(officialSymbol);

        if (!string.IsNullOrWhiteSpace(candidate))
            return candidate;

        return BuildProxyUrl(fallbackSymbol);
    }

    public static string? BuildProxyUrl(string? symbol)
    {
        var normalized = EnvironmentIsolationGuard.NormalizeBinanceIconSymbol(symbol);
        return string.IsNullOrWhiteSpace(normalized)
            ? null
            : $"{ProxyRoutePrefix}{Uri.EscapeDataString(normalized)}";
    }

    private static string? ExtractOfficialIconSymbol(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
            return null;

        var normalized = value.Replace('\\', '/');
        var marker = normalized.IndexOf(OfficialIconRouteMarker, StringComparison.OrdinalIgnoreCase);
        if (marker < 0)
            return null;

        var symbolStart = marker + OfficialIconRouteMarker.Length;
        var symbolEnd = normalized.IndexOfAny(['?', '#'], symbolStart);
        var encodedSymbol = symbolEnd < 0
            ? normalized[symbolStart..]
            : normalized[symbolStart..symbolEnd];

        return Uri.UnescapeDataString(encodedSymbol).Trim('/');
    }
}
