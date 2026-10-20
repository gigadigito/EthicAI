using System.Globalization;

namespace CriptoVersus.API.Services;

/// <summary>
/// Monta a URL publica da pagina de captura social do Price Crossover.
///
/// O caminho espelha <c>RouteLocalizationService.BuildPriceCrossoverSocialPath</c> (Web):
/// <c>/{cultura}/social/price-crossover/{matchId}</c>. A Web e a dona da rota; a API mantem
/// este espelho porque nao pode referenciar o projeto Web.
///
/// A origem vem SOMENTE de configuracao (nunca de cabecalhos HTTP do request).
/// Nenhuma URL e montada sem uma origem absoluta http(s) valida: a disponibilidade
/// da pagina nunca e presumida a partir da existencia do matchId.
/// </summary>
public static class PriceCrossoverSocialPublicUrl
{
    /// <summary>
    /// Cultura de rota usada quando o idioma pedido nao e suportado.
    /// Mesmo fallback de cultura da captura da imagem (pt-BR), ver
    /// <c>PriceCrossoverSocial.razor</c> e o README do workflow n8n.
    /// </summary>
    public const string FallbackRouteCulture = "pt";

    /// <summary>Ultimo recurso de origem quando nenhuma chave de configuracao resolve.</summary>
    public const string DefaultPublicBaseUrl = "https://www.criptoversus.com";

    /// <summary>
    /// Culturas de rota suportadas por <c>PriceCrossoverSocial.razor</c>.
    /// Espelho de <c>SupportedLanguageCatalog</c> (Web), incluindo o formato de prefixo de caminho.
    /// </summary>
    public static readonly IReadOnlyCollection<string> SupportedRouteCultures =
        ["en", "pt", "zh", "es", "fr", "de", "it", "ja"];

    /// <summary>
    /// Normaliza o idioma pedido para a cultura de rota da pagina.
    /// Aceita cultura completa (<c>pt-BR</c>), cultura de rota (<c>pt</c>) ou alias;
    /// idioma nao suportado cai no fallback da captura.
    /// </summary>
    public static string ResolveRouteCulture(string? language)
    {
        if (string.IsNullOrWhiteSpace(language))
            return FallbackRouteCulture;

        var token = language.Trim().Replace('_', '-').Split('-', 2)[0].ToLowerInvariant();

        foreach (var culture in SupportedRouteCultures)
        {
            if (string.Equals(culture, token, StringComparison.Ordinal))
                return culture;
        }

        return FallbackRouteCulture;
    }

    /// <summary>
    /// Monta <c>{origem}/{cultura}/social/price-crossover/{matchId}</c>.
    /// Retorna false sem URL quando a origem e invalida ou o matchId nao e positivo.
    /// </summary>
    public static bool TryBuild(string? publicBaseUrl, int matchId, string? language, out string publicUrl)
        => TryBuildForRoute(publicBaseUrl, matchId, language, "price-crossover", out publicUrl);

    public static bool TryBuildCandleBattle(string? publicBaseUrl, int matchId, string? language, out string publicUrl)
        => TryBuildForRoute(publicBaseUrl, matchId, language, "candle-battle", out publicUrl);

    private static bool TryBuildForRoute(string? publicBaseUrl, int matchId, string? language, string route, out string publicUrl)
    {
        publicUrl = string.Empty;

        if (matchId <= 0 || string.IsNullOrWhiteSpace(publicBaseUrl))
            return false;

        var origin = publicBaseUrl.Trim().TrimEnd('/');

        if (!Uri.TryCreate(origin, UriKind.Absolute, out var uri))
            return false;

        if (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps)
            return false;

        publicUrl = string.Create(
            CultureInfo.InvariantCulture,
            $"{origin}/{ResolveRouteCulture(language)}/social/{route}/{matchId}");

        return true;
    }
}
