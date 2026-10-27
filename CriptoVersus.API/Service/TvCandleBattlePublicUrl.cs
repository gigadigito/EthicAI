using System.Globalization;

namespace CriptoVersus.API.Services;

/// <summary>
/// Monta a URL publica da pagina de TV arcade de Candle Battle usada pelo transmissor.
///
/// O caminho espelha <c>RouteLocalizationService.BuildCandleBattlesPath</c> e o slug de
/// <c>MatchSlugHelper.BuildSlug</c> (Web): <c>/{cultura}/tv/candle/{matchId}/{slug}</c>,
/// com <c>slug = {ativo-a}-vs-{ativo-b}</c> em minusculas e sem o sufixo da cotacao.
/// A Web e a dona da rota; a API mantem este espelho porque nao pode referenciar o projeto Web.
///
/// A origem vem SOMENTE de configuracao (nunca de cabecalhos HTTP do request) e nenhuma URL e
/// montada sem uma origem absoluta http(s) valida.
/// </summary>
public static class TvCandleBattlePublicUrl
{
    private static readonly string[] QuoteSuffixes =
        ["USDT", "USDC", "BUSD", "FDUSD", "BRL", "EUR", "BTC", "ETH"];

    public static bool TryBuild(string? publicBaseUrl, int matchId, string? symbolA, string? symbolB,
        string? language, out string playbackUrl)
    {
        playbackUrl = string.Empty;

        if (matchId <= 0 || string.IsNullOrWhiteSpace(publicBaseUrl))
            return false;

        var origin = publicBaseUrl.Trim().TrimEnd('/');
        if (!Uri.TryCreate(origin, UriKind.Absolute, out var uri))
            return false;
        if (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps)
            return false;

        var coinA = SlugPart(symbolA, "team-a");
        var coinB = SlugPart(symbolB, "team-b");
        if (coinA.Length == 0 || coinB.Length == 0)
            return false;

        playbackUrl = string.Create(CultureInfo.InvariantCulture,
            $"{origin}/{PriceCrossoverSocialPublicUrl.ResolveRouteCulture(language)}/tv/candle/{matchId}/{coinA}-vs-{coinB}");
        return true;
    }

    private static string SlugPart(string? symbol, string fallback)
    {
        if (string.IsNullOrWhiteSpace(symbol))
            return fallback;

        var normalized = new string(symbol.Trim().ToUpperInvariant().Where(char.IsLetterOrDigit).ToArray());
        foreach (var suffix in QuoteSuffixes)
        {
            if (normalized.Length > suffix.Length && normalized.EndsWith(suffix, StringComparison.Ordinal))
            {
                normalized = normalized[..^suffix.Length];
                break;
            }
        }

        normalized = normalized.ToLowerInvariant();
        return normalized.Length == 0 ? fallback : normalized;
    }
}
