using System.Text.RegularExpressions;

namespace CriptoVersus.Web.Services;

public sealed record SitemapRouteAuditResult(
    IReadOnlyList<string> UnregisteredTemplates,
    IReadOnlyList<string> CatalogPathsWithoutPage)
{
    public bool IsClean => UnregisteredTemplates.Count == 0 && CatalogPathsWithoutPage.Count == 0;
}

/// <summary>
/// Compares the routes declared by Razor <c>@page</c> directives against
/// <see cref="SitemapRouteCatalog"/>. Reports routes that are neither registered in the
/// sitemap catalog nor explicitly excluded, and catalog paths that no page serves.
/// </summary>
public static class SitemapRouteAuditor
{
    private const string PlaceholderToken = "\u0001";
    private static readonly Regex PlaceholderPattern = new(@"\{[^}]+\}", RegexOptions.Compiled);

    public static SitemapRouteAuditResult Audit(
        IEnumerable<string> routeTemplates,
        RouteLocalizationService? routeLocalization = null)
    {
        var routes = routeLocalization ?? new RouteLocalizationService(new AppCultureService());
        var templates = routeTemplates
            .Select(template => (template ?? string.Empty).Split('?', '#')[0].Trim())
            .Where(template => !string.IsNullOrWhiteSpace(template))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();

        var samplePaths = BuildCatalogSamplePaths(routes);

        var excludedRegexes = SitemapRouteCatalog.ExcludedRoutes
            .SelectMany(route => route.RouteShapes)
            .Select(TemplateToRegex)
            .ToArray();

        var unregistered = new List<string>();
        foreach (var template in templates)
        {
            var templateRegex = TemplateToRegex(template);
            if (samplePaths.Any(templateRegex.IsMatch))
                continue;

            if (excludedRegexes.Any(regex => regex.IsMatch(template)))
                continue;

            unregistered.Add(NormalizeTemplate(template));
        }

        var templatesWithoutPage = samplePaths
            .Where(path => !templates.Any(template => TemplateToRegex(template).IsMatch(path)))
            .ToArray();

        return new SitemapRouteAuditResult(unregistered, templatesWithoutPage);
    }

    public static IReadOnlyList<string> BuildCatalogSamplePaths(RouteLocalizationService routes)
    {
        var paths = new List<string>();

        foreach (var page in SitemapRouteCatalog.StaticPages)
        {
            if (page.Localized)
            {
                foreach (var language in new SupportedLanguageCatalog().EnabledLanguages)
                    paths.Add(page.BuildPath(routes, language.RouteCulture));
            }
            else
            {
                paths.Add(page.BuildPath(routes, AppCultureService.DefaultRouteCulture));
            }
        }

        foreach (var family in SitemapRouteCatalog.MatchFamilies)
        {
            foreach (var language in new SupportedLanguageCatalog().EnabledLanguages)
                paths.Add(family.BuildPath(routes, language.RouteCulture, SitemapRouteCatalog.SampleMatchId, SitemapRouteCatalog.SampleMatchSlug));
        }

        foreach (var family in SitemapRouteCatalog.DynamicFamilies)
        {
            foreach (var language in new SupportedLanguageCatalog().EnabledLanguages)
                paths.Add(family.BuildPath(routes, language.RouteCulture));
        }

        return paths;
    }

    public static string NormalizeTemplate(string templateOrPath)
    {
        var cleaned = (templateOrPath ?? string.Empty).Split('?', '#')[0].Trim().TrimEnd('/');
        if (cleaned.Length == 0)
            return "/";

        return PlaceholderPattern.Replace(cleaned.ToLowerInvariant(), PlaceholderToken)
            .Replace(PlaceholderToken, "{*}");
    }

    public static Regex TemplateToRegex(string routeTemplate)
    {
        var cleaned = NormalizeTemplate(routeTemplate);
        var withTokens = PlaceholderPattern.Replace(cleaned, PlaceholderToken);
        var pattern = "^" + Regex.Escape(withTokens).Replace(PlaceholderToken, "[^/]+") + "$";
        return new Regex(pattern, RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
    }
}
