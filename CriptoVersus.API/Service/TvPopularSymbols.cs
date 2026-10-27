namespace CriptoVersus.API.Services;

/// <summary>
/// Catalogo de ativos com reconhecimento de publico, compartilhado pela selecao de TV.
/// A fonte e o mesmo conjunto usado por <see cref="TvHotMatchService"/> para popularidade;
/// nenhum ranking arbitrario novo e criado. O casamento do cenario de Candle Battle e feito
/// por simbolo base (BTCUSDT casa com BTC), porque <c>Currency.Symbol</c> pode carregar o
/// sufixo da cotacao.
/// </summary>
public static class TvPopularSymbols
{
    public static readonly IReadOnlySet<string> Catalog = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
    {
        "BTC", "ETH", "SOL", "BNB", "XRP", "ADA", "DOGE", "AVAX", "LINK", "SUI"
    };

    private static readonly string[] QuoteSuffixes = ["USDT", "USDC", "BUSD", "FDUSD", "BRL", "EUR", "BTC", "ETH"];

    public static bool IsPopular(string? symbol)
    {
        if (string.IsNullOrWhiteSpace(symbol))
            return false;

        var normalized = symbol.Trim().ToUpperInvariant();
        if (Catalog.Contains(normalized))
            return true;

        foreach (var quote in QuoteSuffixes)
        {
            if (normalized.Length > quote.Length && normalized.EndsWith(quote, StringComparison.Ordinal))
                return Catalog.Contains(normalized[..^quote.Length]);
        }

        return false;
    }
}
