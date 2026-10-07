using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Components;
using Microsoft.Net.Http.Headers;

namespace CriptoVersus.Web.Services;

public sealed class AppCultureService
{
    public const string DefaultRouteCulture = "en";
    public const string DefaultCultureCode = "en-US";
    public const string SecondaryRouteCulture = "pt";
    public const string SecondaryCultureCode = "pt-BR";
    public const string TertiaryRouteCulture = "zh";
    public const string TertiaryCultureCode = "zh-CN";
    public const string PreferenceCookieName = "cv_culture";

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

        return DefaultRouteCulture;
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

        foreach (var item in rawHeader.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            var language = item.Split(';', StringSplitOptions.TrimEntries)[0];
            if (TryNormalizeRouteCulture(language, out var exact))
                return exact;

            var neutralLanguage = language.Split('-', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).FirstOrDefault();
            if (TryNormalizeRouteCulture(neutralLanguage, out var neutral))
                return neutral;
        }

        return null;
    }
}