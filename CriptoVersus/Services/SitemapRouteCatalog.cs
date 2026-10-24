namespace CriptoVersus.Web.Services;

/// <summary>
/// Static public page emitted in the pages sitemap. <see cref="BuildPath"/> is the single
/// source of truth for the localized path shape, so sitemap entries, hreflang alternates and
/// x-default always agree with <see cref="RouteLocalizationService"/>.
/// </summary>
public sealed record SitemapStaticPage(
    string Key,
    string RouteShape,
    Func<RouteLocalizationService, string?, string> BuildPath,
    string ChangeFrequency,
    decimal Priority,
    bool Localized = true,
    decimal? NonDefaultCulturePriority = null,
    bool UseStatsLastModified = false);

/// <summary>
/// Per-match page family emitted in the per-culture match sitemaps.
/// </summary>
public sealed record SitemapMatchFamily(
    string Key,
    string RouteShape,
    Func<RouteLocalizationService, string?, int, string, string> BuildPath,
    string OngoingChangeFrequency,
    decimal OngoingPriority,
    string FinishedChangeFrequency,
    decimal FinishedPriority);

/// <summary>
/// Data-driven page family (teams, converters) documented for route discovery but generated
/// inside <see cref="SitemapService"/> from API data.
/// </summary>
public sealed record SitemapDynamicFamily(
    string Key,
    string RouteShape,
    string Owner,
    Func<RouteLocalizationService, string?, string> BuildPath,
    string ChangeFrequency,
    decimal Priority);

public enum SitemapExclusionKind
{
    AliasRedirect,
    Noindex,
    Private,
    Diagnostic,
    Template
}

/// <summary>
/// Public route that must stay out of the sitemap, with the reason kept next to the shape.
/// </summary>
public sealed record SitemapExcludedRoute(
    string Key,
    SitemapExclusionKind Kind,
    string Reason,
    params string[] RouteShapes);

/// <summary>
/// Centralized registry of indexable public routes. A new public page must be added here
/// (or excluded with a reason); <c>SitemapRouteCoverageTests</c> fails otherwise.
/// </summary>
public static class SitemapRouteCatalog
{
    public const string PagesOwner = "pages";
    public const string MatchesOwner = "matches";
    public const string StatsTeamsOwner = "stats-teams";
    public const string ConverterOwner = "converter";

    public const int SampleMatchId = 42;
    public const string SampleMatchSlug = "btc-vs-eth";
    public const string SampleTeamSlug = "btc";
    public const string SampleFromSymbol = "btc";
    public const string SampleToSymbol = "eth";

    public static IReadOnlyList<SitemapStaticPage> StaticPages { get; } =
    [
        new("home", "/{culture}",
            (routes, culture) => routes.BuildHomePath(culture),
            "daily", 1.0m, NonDefaultCulturePriority: 0.9m),
        new("faq", "/{culture}/faq",
            (routes, culture) => routes.BuildFaqPath(culture),
            "weekly", 0.86m),
        new("tv", "/{culture}/tv",
            (routes, culture) => routes.BuildTvPath(culture),
            "hourly", 0.9m),
        new("tv-broadcast", "/{culture}/tv/broadcast",
            (routes, culture) => routes.BuildTvBroadcastPath(culture),
            "hourly", 0.95m),
        new("stats", "/{culture}/stats",
            (routes, culture) => routes.BuildStatsPath(culture),
            "hourly", 0.85m, UseStatsLastModified: true),
        new("stats-matches", "/{culture}/stats/matches",
            (routes, culture) => routes.BuildStatsMatchesPath(culture),
            "daily", 0.78m, UseStatsLastModified: true),
        new("stats-teams", "/{culture}/stats/teams",
            (routes, culture) => routes.BuildStatsTeamsPath(culture),
            "daily", 0.8m, UseStatsLastModified: true),
        new("stats-rankings", "/{culture}/stats/rankings",
            (routes, culture) => routes.BuildStatsRankingsPath(culture),
            "daily", 0.78m, UseStatsLastModified: true),
        new("stats-records", "/{culture}/stats/records",
            (routes, culture) => routes.BuildStatsRecordsPath(culture),
            "daily", 0.75m, UseStatsLastModified: true),
        new("token", "/{culture}/token",
            (routes, culture) => routes.BuildTokenPath(culture),
            "weekly", 0.74m),
        new("roadmap", "/{culture}/roadmap",
            (routes, culture) => routes.BuildRoadmapPath(culture),
            "weekly", 0.8m),
        new("how-it-works", "/{culture}/how-it-works",
            (routes, culture) => routes.BuildHowItWorksPath(culture),
            "weekly", 0.8m),
        new("about", "/{culture}/about",
            (routes, culture) => routes.BuildAboutPath(culture),
            "weekly", 0.78m),
        new("scoring-rules", "/{culture}/scoring-rules",
            (routes, culture) => routes.BuildScoringRulesPath(culture),
            "weekly", 0.76m),
        new("risk-disclaimer", "/{culture}/risk-disclaimer",
            (routes, culture) => routes.BuildRiskDisclaimerPath(culture),
            "weekly", 0.74m),
        new("candle-battles-demo", "/{culture}/games/candle-battles/demo",
            (routes, culture) => routes.BuildCandleBattlesDemoPath(culture),
            "weekly", 0.72m),
        new("tokenomics-match-rules", "/tokenomics/regras-das-partidas",
            (_, _) => "/tokenomics/regras-das-partidas",
            "weekly", 0.7m, Localized: false)
    ];

    public static IReadOnlyList<SitemapMatchFamily> MatchFamilies { get; } =
    [
        new("match-detail", "/{culture}/{match|partida}/{matchId}/{slug}",
            (routes, culture, id, slug) => routes.BuildLocalizedPath(culture!, id, slug),
            "daily", 0.7m, "monthly", 0.6m),
        new("tv-match", "/{culture}/tv/match/{matchId}/{slug}",
            (routes, culture, id, slug) => routes.BuildTvMatchPath(culture, id, slug),
            "daily", 0.65m, "monthly", 0.55m),
        new("candle-battles-arcade", "/{culture}/tv/candle/{matchId}/{slug}",
            (routes, culture, id, slug) => routes.BuildCandleBattlesPath(culture, id, slug),
            "daily", 0.68m, "monthly", 0.58m),
        new("candle-battles-classic", "/{culture}/candle/{matchId}/{slug}",
            (routes, culture, id, slug) => routes.BuildCandleBattleV2Path(culture, id, slug),
            "daily", 0.66m, "monthly", 0.56m)
    ];

    public static IReadOnlyList<SitemapDynamicFamily> DynamicFamilies { get; } =
    [
        new("stats-team-detail", "/{culture}/stats/teams/{slug}", StatsTeamsOwner,
            (routes, culture) => routes.BuildStatsTeamDetailPath(culture, SampleTeamSlug),
            "daily", 0.65m),
        new("stats-converter", "/{culture}/stats/{fromSymbol}-(to|para)-{toSymbol}", ConverterOwner,
            (routes, culture) => RouteLocalizationService.BuildConverterPath(culture!, SampleFromSymbol, SampleToSymbol),
            "hourly", 0.72m)
    ];

    public static IReadOnlyList<SitemapExcludedRoute> ExcludedRoutes { get; } =
    [
        new("cultureless-redirect-aliases", SitemapExclusionKind.AliasRedirect,
            "Culture-less alias; MatchRouteRedirectMiddleware redirects to the visitor's localized canonical URL.",
            "/", "/roadmap", "/faq", "/tokenomics", "/token", "/tv", "/tv/broadcast",
            "/social/hot-matches", "/social/win-rate-24h", "/social/price-crossover/{matchId}"),
        new("cultureless-canonical-aliases", SitemapExclusionKind.AliasRedirect,
            "Culture-less alias; the page canonicalizes to the localized URL already listed in the sitemap.",
            "/stats", "/stats/matches", "/stats/teams", "/stats/rankings", "/stats/records",
            "/stats/teams/{slug}", "/match/{matchId}/{slug}", "/tv/match/{matchId}/{slug}"),
        new("localized-match-route-aliases", SitemapExclusionKind.AliasRedirect,
            "Alias of the canonical match route (pt uses /partida, other cultures use /match); the middleware 301-redirects to the canonical form.",
            "/pt/match/{matchId}/{slug}",
            "/en/partida/{matchId}/{slug}", "/zh/partida/{matchId}/{slug}", "/es/partida/{matchId}/{slug}",
            "/fr/partida/{matchId}/{slug}", "/de/partida/{matchId}/{slug}", "/it/partida/{matchId}/{slug}",
            "/ja/partida/{matchId}/{slug}"),
        new("legacy-match-versus-slugs", SitemapExclusionKind.Noindex,
            "Legacy match URLs; the page declares noindex and the middleware redirects to the canonical match route.",
            "/match/{slugA}-vs-{slugB}", "/match/{slugA}-vs-{slugB}/{matchId}"),
        new("social-card-pages", SitemapExclusionKind.Noindex,
            "Social share-card pages declare noindex,nofollow,noarchive.",
            "/social/hot-matches", "/{culture}/social/hot-matches",
            "/social/win-rate-24h", "/{culture}/social/win-rate-24h",
            "/social/price-crossover/{matchId}", "/{culture}/social/price-crossover/{matchId}"),
        new("legacy-home-placeholder", SitemapExclusionKind.Noindex,
            "Legacy placeholder home; the page declares noindex,nofollow,noarchive.",
            "/home"),
        new("futurebol-lab", SitemapExclusionKind.Noindex,
            "Experimental Futurebol lab; the page declares noindex,nofollow,noarchive.",
            "/lab/futurebol"),
        new("candle-battle-mock-lab", SitemapExclusionKind.Diagnostic,
            "Candle Battle mock mode lab (Development only); the gate answers 404 in production.",
            "/dev/candle-battle", "/dev/candle-battle/replay/{matchId}", "/dev/candle-battle/social/{matchId}"),
        new("intranet-private-pages", SitemapExclusionKind.Private,
            "Authenticated back-office and wallet pages; never indexable.",
            "/admin/audio-assets", "/pt/admin/audio-assets", "/en/admin/audio-assets",
            "/admin-sistema", "/pt/admin-sistema", "/en/admin-system",
            "/intranet/dashboard",
            "/minha-carteira", "/pt/minha-carteira", "/en/my-wallet", "/zh/my-wallet"),
        new("diagnostic-harness", SitemapExclusionKind.Diagnostic,
            "Internal diagnostic harness for Candle Battles rendering.",
            "/_diag/candle-battle"),
        new("template-and-error-pages", SitemapExclusionKind.Template,
            "Scaffolding and technical error routes without public SEO value.",
            "/counter", "/weather", "/error")
    ];
}
