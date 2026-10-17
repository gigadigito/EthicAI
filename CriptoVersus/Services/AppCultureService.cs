using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Components;
using Microsoft.Net.Http.Headers;
using System.Globalization;

namespace CriptoVersus.Web.Services;

/// <summary>
/// Resolves the culture used by a navigation. Priority:
/// 1. explicit culture in the request path;
/// 2. persisted user preference (cookie/localStorage mirror);
/// 3. browser language (Accept-Language, mirroring navigator.languages order);
/// 4. approximate region from the infrastructure-provided country header (no GPS, no external geo API);
/// 5. <see cref="DefaultRouteCulture"/>.
/// </summary>
public sealed class AppCultureService
{
    public const string DefaultRouteCulture = "en";
    public const string DefaultCultureCode = "en-US";
    public const string SecondaryRouteCulture = "pt";
    public const string SecondaryCultureCode = "pt-BR";
    public const string TertiaryRouteCulture = "zh";
    public const string TertiaryCultureCode = "zh-CN";
    public const string PreferenceCookieName = "cv_culture";
    public const string CountryHeaderName = "CF-IPCountry";

    // Country hints are used only when the browser language is unusable.
    // Ambiguous/multilingual countries (for example CH, BE, CA) are intentionally omitted.
    private static readonly IReadOnlyDictionary<string, string> CountryRouteCultures =
        new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            ["BR"] = SecondaryRouteCulture,
            ["PT"] = SecondaryRouteCulture,
            ["US"] = DefaultRouteCulture,
            ["GB"] = DefaultRouteCulture,
            ["UK"] = DefaultRouteCulture,
            ["IE"] = DefaultRouteCulture,
            ["AU"] = DefaultRouteCulture,
            ["NZ"] = DefaultRouteCulture,
            ["ES"] = "es",
            ["MX"] = "es",
            ["AR"] = "es",
            ["CO"] = "es",
            ["CL"] = "es",
            ["PE"] = "es",
            ["VE"] = "es",
            ["EC"] = "es",
            ["UY"] = "es",
            ["PY"] = "es",
            ["BO"] = "es",
            ["CR"] = "es",
            ["PA"] = "es",
            ["DO"] = "es",
            ["GT"] = "es",
            ["HN"] = "es",
            ["SV"] = "es",
            ["NI"] = "es",
            ["CU"] = "es",
            ["PR"] = "es",
            ["GQ"] = "es",
            ["FR"] = "fr",
            ["MC"] = "fr",
            ["LU"] = "fr",
            ["DE"] = "de",
            ["AT"] = "de",
            ["LI"] = "de",
            ["IT"] = "it",
            ["SM"] = "it",
            ["VA"] = "it",
            ["JP"] = "ja",
            ["CN"] = TertiaryRouteCulture
        };

    private readonly SupportedLanguageCatalog _languages;

    public AppCultureService()
        : this(new SupportedLanguageCatalog())
    {
    }

    public AppCultureService(SupportedLanguageCatalog languages)
    {
        _languages = languages;
    }

    public IReadOnlyList<SupportedLanguage> SupportedLanguages => _languages.EnabledLanguages;

    public string NormalizeRouteCulture(string? culture)
        => _languages.GetOrDefault(culture).RouteCulture;

    public bool TryNormalizeRouteCulture(string? culture, out string normalizedCulture)
    {
        if (_languages.TryGet(culture, out var language))
        {
            normalizedCulture = language.RouteCulture;
            return true;
        }

        normalizedCulture = DefaultRouteCulture;
        return false;
    }

    public bool IsSupportedCulture(string? culture)
        => _languages.TryGet(culture, out _);

    public string ToCultureCode(string? culture)
        => _languages.GetOrDefault(culture).Culture;

    public string ToHtmlLang(string? culture)
        => ToCultureCode(culture);

    public string ToHrefLang(string? culture)
        => ToCultureCode(culture);

    public string ToOgLocale(string? culture)
        => _languages.GetOrDefault(culture).OgLocale;

    // Kept for existing metadata consumers. New code should enumerate SupportedLanguages when it needs every alternate.
    public string GetAlternateOgLocale(string? culture)
        => SupportedLanguages.FirstOrDefault(language => !language.RouteCulture.Equals(NormalizeRouteCulture(culture), StringComparison.OrdinalIgnoreCase))?.OgLocale
           ?? _languages.DefaultLanguage.OgLocale;

    public string GetCurrentRouteCulture(NavigationManager navigationManager)
        => GetRouteCultureFromRelativePath(navigationManager.ToBaseRelativePath(navigationManager.Uri));

    public string GetRouteCultureFromRelativePath(string? relativePath)
    {
        if (string.IsNullOrWhiteSpace(relativePath))
            return DefaultRouteCulture;

        var firstSegment = relativePath
            .Split('?', '#')[0]
            .Trim('/')
            .Split('/', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .FirstOrDefault();

        return NormalizeRouteCulture(firstSegment);
    }

    public string DetectPreferredRouteCulture(HttpContext? httpContext)
    {
        var explicitCulture = TryGetExplicitCultureFromPath(httpContext?.Request.Path.Value);
        if (explicitCulture is not null)
            return explicitCulture;

        var cookieCulture = NormalizeCookieCulture(httpContext?.Request.Cookies[PreferenceCookieName]);
        if (cookieCulture is not null)
            return cookieCulture;

        var acceptLanguageCulture = NormalizeAcceptLanguage(httpContext?.Request.Headers[HeaderNames.AcceptLanguage].ToString());
        if (acceptLanguageCulture is not null)
            return acceptLanguageCulture;

        var countryCulture = NormalizeCountryCulture(TryGetCountryCode(httpContext));
        if (countryCulture is not null)
            return countryCulture;

        return DefaultRouteCulture;
    }

    /// <summary>
    /// Resolves the culture for interactive rendering, where <see cref="HttpContext"/> is not available.
    /// The route culture wins so the current navigation keeps its explicit language.
    /// </summary>
    public string ResolveNavigationCulture(NavigationManager navigationManager, HttpContext? httpContext)
    {
        var relativePath = navigationManager.ToBaseRelativePath(navigationManager.Uri);
        var explicitCulture = TryGetExplicitCultureFromPath(relativePath);
        return explicitCulture ?? DetectPreferredRouteCulture(httpContext);
    }

    public string? TryGetExplicitCultureFromPath(string? path)
    {
        if (string.IsNullOrWhiteSpace(path))
            return null;

        var firstSegment = path.Trim('/')
            .Split('/', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .FirstOrDefault();

        return TryNormalizeRouteCulture(firstSegment, out var culture) ? culture : null;
    }

    /// <summary>
    /// Matches a single BCP-47 language tag (for example "pt-BR" or "pt") to a supported route culture.
    /// Regional variants fall back to the supported language ("pt-PT" -> "pt-BR", "es-MX" -> "es-ES").
    /// </summary>
    public string? MatchLanguageTag(string? languageTag)
    {
        if (string.IsNullOrWhiteSpace(languageTag))
            return null;

        var candidate = languageTag.Trim();
        if (_languages.TryGet(candidate, out var exact))
            return exact.RouteCulture;

        var neutralLanguage = candidate
            .Split('-', '_', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .FirstOrDefault();

        if (!string.IsNullOrWhiteSpace(neutralLanguage) && _languages.TryGet(neutralLanguage, out var neutral))
            return neutral.RouteCulture;

        return null;
    }

    /// <summary>
    /// Resolves the best supported culture for an ordered list of browser language tags,
    /// preserving the user's preference order (navigator.languages).
    /// </summary>
    public string? ResolveBrowserCulture(IEnumerable<string?>? languageTags)
    {
        if (languageTags is null)
            return null;

        foreach (var tag in languageTags)
        {
            var match = MatchLanguageTag(tag);
            if (match is not null)
                return match;
        }

        return null;
    }

    public string? MatchCountryCulture(string? country)
        => NormalizeCountryCulture(country);

    private string? NormalizeCookieCulture(string? rawCulture)
    {
        if (string.IsNullOrWhiteSpace(rawCulture))
            return null;

        return TryNormalizeRouteCulture(rawCulture, out var culture) ? culture : null;
    }

    private string? NormalizeAcceptLanguage(string? rawHeader)
    {
        if (string.IsNullOrWhiteSpace(rawHeader))
            return null;

        var entries = new List<(string Tag, double Quality, int Order)>();
        var order = 0;

        foreach (var item in rawHeader.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            var parts = item.Split(';', StringSplitOptions.TrimEntries);
            var tag = parts[0];
            var quality = 1d;

            for (var index = 1; index < parts.Length; index++)
            {
                var parameter = parts[index];
                if (parameter.StartsWith("q=", StringComparison.OrdinalIgnoreCase)
                    && double.TryParse(parameter.AsSpan(2), NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture, out var parsedQuality))
                {
                    quality = parsedQuality;
                }
            }

            if (!string.IsNullOrWhiteSpace(tag) && quality > 0d)
                entries.Add((tag, quality, order));

            order++;
        }

        foreach (var entry in entries.OrderByDescending(entry => entry.Quality).ThenBy(entry => entry.Order))
        {
            var match = MatchLanguageTag(entry.Tag);
            if (match is not null)
                return match;
        }

        return null;
    }

    private string? NormalizeCountryCulture(string? country)
    {
        if (string.IsNullOrWhiteSpace(country))
            return null;

        var candidate = country.Trim();
        if (candidate.Length != 2 || candidate.Equals("XX", StringComparison.OrdinalIgnoreCase))
            return null;

        return CountryRouteCultures.TryGetValue(candidate, out var routeCulture) ? routeCulture : null;
    }

    private static string? TryGetCountryCode(HttpContext? httpContext)
    {
        if (httpContext is null)
            return null;

        var country = httpContext.Request.Headers[CountryHeaderName].ToString();
        return string.IsNullOrWhiteSpace(country) ? null : country;
    }
}
