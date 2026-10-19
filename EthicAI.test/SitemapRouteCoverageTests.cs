using CriptoVersus.Web.Services;

namespace EthicAI.test;

public sealed class SitemapRouteCoverageTests
{
    [Fact]
    public void EveryRazorRoute_IsRegisteredInSitemapCatalogOrExplicitlyExcluded()
    {
        var routes = new RouteLocalizationService(new AppCultureService());
        var templates = RazorRouteScanner.GetPageRouteTemplates();
        Assert.NotEmpty(templates);

        var result = SitemapRouteAuditor.Audit(templates, routes);

        Assert.True(
            result.UnregisteredTemplates.Count == 0,
            "Rotas publicas sem cadastro no SitemapRouteCatalog (adicione ao catalogo ou registre a exclusao com justificativa): "
            + string.Join(", ", result.UnregisteredTemplates));
    }

    [Fact]
    public void EveryCatalogPath_IsServedByAnExistingRazorRoute()
    {
        var routes = new RouteLocalizationService(new AppCultureService());
        var templates = RazorRouteScanner.GetPageRouteTemplates();

        var result = SitemapRouteAuditor.Audit(templates, routes);

        Assert.True(
            result.CatalogPathsWithoutPage.Count == 0,
            "URLs do catalogo sem pagina correspondente (nao cadastre URLs inexistentes): "
            + string.Join(", ", result.CatalogPathsWithoutPage));
    }

    [Fact]
    public void Auditor_DetectsUnregisteredPublicRoute()
    {
        var routes = new RouteLocalizationService(new AppCultureService());
        var templates = RazorRouteScanner.GetPageRouteTemplates().Append("/{culture}/brand-new-seo-page").ToArray();

        var result = SitemapRouteAuditor.Audit(templates, routes);

        Assert.Contains("/{*}/brand-new-seo-page", result.UnregisteredTemplates);
    }

    [Fact]
    public void Auditor_DetectsCatalogPathWithoutPage()
    {
        var routes = new RouteLocalizationService(new AppCultureService());
        var templates = RazorRouteScanner.GetPageRouteTemplates()
            .Where(template => !SitemapRouteAuditor.TemplateToRegex(template).IsMatch("/en/faq"))
            .ToArray();

        var result = SitemapRouteAuditor.Audit(templates, routes);

        Assert.Contains("/en/faq", result.CatalogPathsWithoutPage);
    }

    [Fact]
    public void Auditor_DoesNotFlagExcludedNoindexRoutesAsUnregistered()
    {
        var routes = new RouteLocalizationService(new AppCultureService());
        var templates = RazorRouteScanner.GetPageRouteTemplates();

        var result = SitemapRouteAuditor.Audit(templates, routes);

        Assert.DoesNotContain(result.UnregisteredTemplates, template => template.Contains("social"));
    }

    [Fact]
    public void NoindexExclusions_StillDeclareNoindexInPageSource()
    {
        var pageRoutes = RazorRouteScanner.GetPageRoutes();

        foreach (var excluded in SitemapRouteCatalog.ExcludedRoutes.Where(route => route.Kind == SitemapExclusionKind.Noindex))
        {
            foreach (var shape in excluded.RouteShapes)
            {
                var shapeRegex = SitemapRouteAuditor.TemplateToRegex(shape);
                var matchingFiles = pageRoutes
                    .Where(route => shapeRegex.IsMatch(route.Template))
                    .Select(route => route.FilePath)
                    .Distinct(StringComparer.OrdinalIgnoreCase)
                    .ToArray();

                Assert.True(
                    matchingFiles.Length > 0,
                    $"A exclusao '{excluded.Key}' referencia a rota '{shape}', que nenhuma pagina declara.");

                Assert.True(
                    matchingFiles.Any(file => File.ReadAllText(file).Contains("noindex", StringComparison.OrdinalIgnoreCase)),
                    $"A exclusao '{excluded.Key}' marca '{shape}' como noindex, mas a pagina nao declara noindex.");
            }
        }
    }

    [Fact]
    public void PrivateRoutes_AreNeverRegisteredAsIndexable()
    {
        var routes = new RouteLocalizationService(new AppCultureService());
        var samplePaths = SitemapRouteAuditor.BuildCatalogSamplePaths(routes);

        foreach (var path in samplePaths)
        {
            Assert.DoesNotContain("/admin", path);
            Assert.DoesNotContain("/intranet", path);
            Assert.DoesNotContain("minha-carteira", path);
            Assert.DoesNotContain("my-wallet", path);
            Assert.DoesNotContain("/social/", path);
            Assert.DoesNotContain("/_diag", path);
            Assert.DoesNotContain("/lab/", path);
        }
    }

    [Fact]
    public void CandleBattlesRoutes_AreRegisteredForEveryCulture()
    {
        var routes = new RouteLocalizationService(new AppCultureService());
        var catalog = new SupportedLanguageCatalog();
        var samplePaths = SitemapRouteAuditor.BuildCatalogSamplePaths(routes);

        foreach (var language in catalog.EnabledLanguages)
        {
            Assert.Contains(routes.BuildCandleBattlesDemoPath(language.RouteCulture), samplePaths);
            Assert.Contains(routes.BuildCandleBattlesPath(language.RouteCulture, SitemapRouteCatalog.SampleMatchId, SitemapRouteCatalog.SampleMatchSlug), samplePaths);
            Assert.Contains(routes.BuildCandleBattleV2Path(language.RouteCulture, SitemapRouteCatalog.SampleMatchId, SitemapRouteCatalog.SampleMatchSlug), samplePaths);
        }
    }

    [Fact]
    public void StaticPageCatalog_CoversEveryIndexableStaticFamily()
    {
        var keys = SitemapRouteCatalog.StaticPages.Select(page => page.Key).ToArray();

        string[] expected =
        [
            "home", "faq", "tv", "tv-broadcast", "stats", "stats-matches", "stats-teams",
            "stats-rankings", "stats-records", "token", "roadmap", "how-it-works", "about",
            "scoring-rules", "risk-disclaimer", "candle-battles-demo", "tokenomics-match-rules"
        ];

        foreach (var key in expected)
            Assert.Contains(key, keys);
    }
}
