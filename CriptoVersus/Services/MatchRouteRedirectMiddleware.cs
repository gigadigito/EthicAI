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
            matchRouteLookup,
            matchSlugHelper,
            routeLocalization,
            context.RequestAborted);

        if (!string.IsNullOrWhiteSpace(redirectPath))
        {
            context.Response.Redirect(redirectPath, permanent: true);
            return;
        }

        await _next(context);
    }
}
