using System.Globalization;
using BLL.GameRules;
using static BLL.BinanceService;

namespace CriptoVersus.Worker;

public static class PriceSymbolSetBuilder
{
    public static string NormalizeSymbol(string? symbol)
    {
        var normalized = new string((symbol ?? string.Empty).Trim().ToUpperInvariant().Where(char.IsLetterOrDigit).ToArray());
        if (string.IsNullOrWhiteSpace(normalized))
            return string.Empty;

        return normalized.EndsWith("USDT", StringComparison.OrdinalIgnoreCase)
            ? normalized
            : normalized + "USDT";
    }

    public static HashSet<string> BuildRequiredSymbols(
        IEnumerable<string> topGainerSymbols,
        IEnumerable<string> activeMatchSymbols,
        IEnumerable<string> conversionSymbols)
    {
        var set = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        AddNormalized(set, topGainerSymbols);
        AddNormalized(set, activeMatchSymbols);
        AddNormalized(set, conversionSymbols);
        return set;
    }

    public static List<GainerEntry> BuildSnapshot(IEnumerable<Crypto> allUsdt, ISet<string> requiredSymbols)
    {
        return allUsdt
            .Where(c => !string.IsNullOrWhiteSpace(c.Symbol))
            .Where(c => requiredSymbols.Contains(NormalizeSymbol(c.Symbol)))
            .Select((c, idx) => new GainerEntry
            {
                Symbol = NormalizeSymbol(c.Symbol),
                Rank = idx + 1,
                PercentageChange = ParsePercent(c.PriceChangePercent),
                LastPrice = ParseNullableDecimal(c.LastPrice),
                QuoteVolume = ParseDecimal(c.QuoteVolume),
                TradeCount = c.Count
            })
            .ToList();
    }

    public static HashSet<string> NormalizeSymbols(IEnumerable<string?> symbols)
    {
        var set = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        AddNormalized(set, symbols);
        return set;
    }

    private static void AddNormalized(HashSet<string> target, IEnumerable<string?> symbols)
    {
        foreach (var symbol in symbols)
        {
            var normalized = NormalizeSymbol(symbol);
            if (!string.IsNullOrWhiteSpace(normalized))
                target.Add(normalized);
        }
    }

    private static decimal ParsePercent(string? value)
        => decimal.TryParse(value, NumberStyles.Any, CultureInfo.InvariantCulture, out var parsed) ? parsed : 0m;

    private static decimal? ParseNullableDecimal(string? value)
        => decimal.TryParse(value, NumberStyles.Any, CultureInfo.InvariantCulture, out var parsed) ? parsed : null;

    private static decimal ParseDecimal(string? value)
        => decimal.TryParse(value, NumberStyles.Any, CultureInfo.InvariantCulture, out var parsed) ? parsed : 0m;
}

