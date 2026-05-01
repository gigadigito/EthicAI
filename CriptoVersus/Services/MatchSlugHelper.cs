namespace CriptoVersus.Web.Services;

public sealed class MatchSlugHelper
{
    private static readonly string[] QuoteSuffixes =
    [
        "USDT",
        "USDC",
        "BUSD",
        "FDUSD",
        "BRL",
        "EUR",
        "BTC",
        "ETH"
    ];

    public string NormalizeTicker(string? ticker)
    {
        if (string.IsNullOrWhiteSpace(ticker))
            return string.Empty;

        var normalized = new string(
            ticker.Trim().ToUpperInvariant().Where(char.IsLetterOrDigit).ToArray());

        foreach (var suffix in QuoteSuffixes)
        {
            if (normalized.Length > suffix.Length
                && normalized.EndsWith(suffix, StringComparison.Ordinal))
            {
                normalized = normalized[..^suffix.Length];
                break;
            }
        }

        return normalized.ToLowerInvariant();
    }

    public string BuildSlug(string? tickerA, string? tickerB)
    {
        var coinA = NormalizeTicker(tickerA);
        var coinB = NormalizeTicker(tickerB);

        return string.IsNullOrWhiteSpace(coinA) || string.IsNullOrWhiteSpace(coinB)
            ? string.Empty
            : $"{coinA}-vs-{coinB}";
    }

    public string ParseLegacySlug(string? legacySlug)
    {
        if (string.IsNullOrWhiteSpace(legacySlug))
            return string.Empty;

        const string separator = "-vs-";
        var normalized = legacySlug.Trim().ToLowerInvariant().Replace("_", "-");
        var index = normalized.IndexOf(separator, StringComparison.Ordinal);

        if (index < 0)
            return NormalizeTicker(normalized);

        var coinA = normalized[..index];
        var coinB = normalized[(index + separator.Length)..];

        return BuildSlug(coinA, coinB);
    }
}
