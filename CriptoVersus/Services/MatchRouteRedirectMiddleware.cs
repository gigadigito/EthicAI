namespace CriptoVersus.Web.Services;

public sealed class MatchRouteRedirectMiddleware
{
    private readonly RequestDelegate _next;
    private readonly MatchRouteRedirectResolver _resolver;

    public MatchRouteRedirectMiddleware(
        RequestDelegate next,
        MatchRouteRedirectResolver resolver)
    {
        _next = next;
        _resolver = resolver;
    }

    public async Task InvokeAsync(
        HttpContext context,
        AppCultureService appCultureService,
        IMatchRouteLookupService matchRouteLookup,
        MatchSlugHelper matchSlugHelper,
        RouteLocalizationService routeLocalization)
    {
        if (!HttpMethods.IsGet(context.Request.Method) && !HttpMethods.IsHead(context.Request.Method))
        {
            await _next(context);
            return;
        }

        var path = context.Request.Path.Value;
        if (string.IsNullOrWhiteSpace(path))
        {
            await _next(context);
            return;
        }

        var redirectPath = await _resolver.ResolveRedirectPathAsync(
            path,
            context.Request.QueryString.Value,
            context,
            appCultureService,
            matchRouteLookup,
            matchSlugHelper,
            routeLocalization,
            context.RequestAborted);

        if (!string.IsNullOrWhiteSpace(redirectPath))
        {
            // Culture selection depends on the visitor (cookie/browser language/region), so it must not
            // be cached by browsers or CDNs. Canonical slug/id corrections remain permanent.
            var requestHasExplicitCulture = appCultureService.TryGetExplicitCultureFromPath(path) is not null;
            var redirectHasExplicitCulture = appCultureService.TryGetExplicitCultureFromPath(redirectPath) is not null;
            var isCultureSelection = !requestHasExplicitCulture && redirectHasExplicitCulture;

            context.Response.Redirect(redirectPath, permanent: !isCultureSelection);
            return;
        }

        await _next(context);
    }
}
