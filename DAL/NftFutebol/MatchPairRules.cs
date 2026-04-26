using System;
using System.Collections.Generic;
using System.Linq;
using Microsoft.Extensions.Configuration;

namespace DAL.NftFutebol
{
    public static class MatchPairRules
    {
        private static readonly string[] KnownQuoteSymbols =
        {
            "USDT",
            "USDC",
            "BUSD",
            "BRL",
            "EUR",
            "BTC",
            "ETH"
        };

        private static readonly string[] DefaultForbiddenStablecoins =
        {
            "USDC",
            "USDT",
            "FDUSD",
            "EUR"
        };

        public static IReadOnlyCollection<string> GetForbiddenStablecoins(IConfiguration? configuration)
        {
            var configured = configuration?
                .GetSection("CriptoVersus:Match:ForbiddenStablecoins")
                .GetChildren()
                .Select(x => x.Value)
                .Where(x => !string.IsNullOrWhiteSpace(x))
                .ToArray();

            if (configured is null || configured.Length == 0)
                return DefaultForbiddenStablecoins;

            return configured
                .Where(x => !string.IsNullOrWhiteSpace(x))
                .Select(x => x.Trim().ToUpperInvariant())
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToArray();
        }

        public static bool IsForbiddenStablecoin(string? symbol, IConfiguration? configuration = null)
        {
            if (string.IsNullOrWhiteSpace(symbol))
                return false;

            var forbiddenStablecoins = GetForbiddenStablecoins(configuration);
            var normalized = symbol.Trim().ToUpperInvariant();
            if (forbiddenStablecoins.Contains(normalized, StringComparer.OrdinalIgnoreCase))
                return true;

            var baseSymbol = TryExtractBaseSymbol(normalized);
            return baseSymbol is not null
                && forbiddenStablecoins.Contains(baseSymbol, StringComparer.OrdinalIgnoreCase);
        }

        public static bool IsForbiddenPair(string? symbolA, string? symbolB, IConfiguration? configuration = null)
            => IsForbiddenStablecoin(symbolA, configuration) || IsForbiddenStablecoin(symbolB, configuration);

        public static string GetForbiddenPairReason(string? symbolA, string? symbolB, IConfiguration? configuration = null)
        {
            var a = string.IsNullOrWhiteSpace(symbolA) ? "?" : symbolA.Trim().ToUpperInvariant();
            var b = string.IsNullOrWhiteSpace(symbolB) ? "?" : symbolB.Trim().ToUpperInvariant();
            var blocked = string.Join(", ", GetForbiddenStablecoins(configuration));
            return $"Partidas com stablecoins nao sao permitidas. Par recebido: {a} vs {b}. Ativos bloqueados: {blocked}.";
        }

        private static string? TryExtractBaseSymbol(string normalizedSymbol)
        {
            foreach (var quote in KnownQuoteSymbols)
            {
                if (!normalizedSymbol.EndsWith(quote, StringComparison.OrdinalIgnoreCase))
                    continue;

                if (normalizedSymbol.Length <= quote.Length)
                    return null;

                return normalizedSymbol[..^quote.Length];
            }

            return null;
        }
    }
}
