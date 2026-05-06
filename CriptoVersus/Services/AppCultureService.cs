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
    public const string PreferenceCookieName = "cv_culture";

    public string NormalizeRouteCulture(string? culture)
    {
        if (string.IsNullOrWhiteSpace(culture))
            return DefaultRouteCulture;

        var normalized = culture.Trim().ToLowerInvariant();
        return normalized switch
        {
            "en" or "en-us" => DefaultRouteCulture,
            "pt" or "pt-br" => SecondaryRouteCulture,
            _ => DefaultRouteCulture
        };
    }

    public string ToCultureCode(string? culture)
        => NormalizeRouteCulture(culture) == SecondaryRouteCulture
            ? SecondaryCultureCode
            : DefaultCultureCode;

    public string ToHtmlLang(string? culture)
        => ToCultureCode(culture);

    public string ToHrefLang(string? culture)
        => NormalizeRouteCulture(culture) == SecondaryRouteCulture
            ? "pt-BR"
            : "en-US";

    public string ToOgLocale(string? culture)
        => NormalizeRouteCulture(culture) == SecondaryRouteCulture
            ? "pt_BR"
            : "en_US";

    public string GetAlternateOgLocale(string? culture)
        => NormalizeRouteCulture(culture) == SecondaryRouteCulture ? "en_US" : "pt_BR";

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

        return firstSegment is null
            ? null
            : firstSegment.Equals("en", StringComparison.OrdinalIgnoreCase) || firstSegment.Equals("pt", StringComparison.OrdinalIgnoreCase)
                ? NormalizeRouteCulture(firstSegment)
                : null;
    }

    private string? NormalizeCookieCulture(string? rawCulture)
    {
        if (string.IsNullOrWhiteSpace(rawCulture))
            return null;

        return NormalizeRouteCulture(rawCulture);
    }

    private string? NormalizeAcceptLanguage(string? rawHeader)
    {
        if (string.IsNullOrWhiteSpace(rawHeader))
            return null;

        foreach (var item in rawHeader.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            var language = item.Split(';', StringSplitOptions.TrimEntries)[0];
            if (language.StartsWith("pt", StringComparison.OrdinalIgnoreCase))
                return SecondaryRouteCulture;

            if (language.StartsWith("en", StringComparison.OrdinalIgnoreCase))
                return DefaultRouteCulture;
        }

        return null;
    }
}
