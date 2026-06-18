using System.Text;

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
        => NormalizeTickerValue(ticker);

    private static string NormalizeTickerValue(string? ticker)
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
        var coinA = BuildSlugPart(tickerA, "team-a");
        var coinB = BuildSlugPart(tickerB, "team-b");
        return $"{coinA}-vs-{coinB}";
    }

    public string ParseLegacySlug(string? legacySlug)
    {
        if (string.IsNullOrWhiteSpace(legacySlug))
            return string.Empty;

        const string separator = "-vs-";
        var normalized = SafeUnescape(legacySlug).Trim().ToLowerInvariant().Replace("_", "-");
        var index = normalized.IndexOf(separator, StringComparison.Ordinal);

        if (index < 0)
            return BuildSlugPart(normalized, "match");

        var coinA = normalized[..index];
        var coinB = normalized[(index + separator.Length)..];

        return BuildSlug(coinA, coinB);
    }

    private static string BuildSlugPart(string? value, string fallback)
    {
        var tickerNormalized = NormalizeTickerValue(value);
        if (!string.IsNullOrWhiteSpace(tickerNormalized))
            return tickerNormalized;

        var textNormalized = NormalizeSlugText(value);
        return string.IsNullOrWhiteSpace(textNormalized)
            ? fallback
            : textNormalized;
    }

    private static string NormalizeSlugText(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
            return string.Empty;

        var normalized = value.Trim();
        var builder = new System.Text.StringBuilder(normalized.Length);
        var lastWasDash = false;

        foreach (var ch in normalized.Normalize(NormalizationForm.FormKC))
        {
            if (char.IsLetterOrDigit(ch))
            {
                builder.Append(char.ToLowerInvariant(ch));
                lastWasDash = false;
                continue;
            }

            if (char.IsWhiteSpace(ch) || ch is '-' or '_' or '.' or '/' or '\\')
            {
                if (builder.Length > 0 && !lastWasDash)
                {
                    builder.Append('-');
                    lastWasDash = true;
                }
            }
        }

        return builder.ToString().Trim('-');
    }

    private static string SafeUnescape(string value)
    {
        try
        {
            return Uri.UnescapeDataString(value);
        }
        catch
        {
            return value;
        }
    }
}
