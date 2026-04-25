using System;
using System.Collections.Generic;

namespace DAL.NftFutebol
{
    public static class MatchPairRules
    {
        private static readonly HashSet<string> ForbiddenStablecoins = new(StringComparer.OrdinalIgnoreCase)
        {
            "USDC",
            "USDT",
            "FDUSD",
            "EUR"
        };

        public static bool IsForbiddenStablecoin(string? symbol)
            => !string.IsNullOrWhiteSpace(symbol)
               && ForbiddenStablecoins.Contains(symbol.Trim().ToUpperInvariant());

        public static bool IsForbiddenPair(string? symbolA, string? symbolB)
            => IsForbiddenStablecoin(symbolA) || IsForbiddenStablecoin(symbolB);

        public static string GetForbiddenPairReason(string? symbolA, string? symbolB)
        {
            var a = string.IsNullOrWhiteSpace(symbolA) ? "?" : symbolA.Trim().ToUpperInvariant();
            var b = string.IsNullOrWhiteSpace(symbolB) ? "?" : symbolB.Trim().ToUpperInvariant();
            return $"Partidas com stablecoins nao sao permitidas. Par recebido: {a} vs {b}. Ativos bloqueados: USDC, USDT, FDUSD e EUR.";
        }
    }
}
