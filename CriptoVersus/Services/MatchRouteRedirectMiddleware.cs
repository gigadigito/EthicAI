namespace CriptoVersus.Web.Services;

public sealed class MatchRouteRedirectMiddleware
{
    private readonly RequestDelegate _next;
    private readonly MatchRouteRedirectResolver _resolver;
    private readonly ILogger<MatchRouteRedirectMiddleware> _logger;
    private readonly LandingEntryOptions _landingEntry;

    public MatchRouteRedirectMiddleware(
        RequestDelegate next,
        MatchRouteRedirectResolver resolver,
        ILogger<MatchRouteRedirectMiddleware> logger,
        Microsoft.Extensions.Options.IOptions<LandingEntryOptions> landingEntryOptions)
    {
        _next = next;
        _resolver = resolver;
        _logger = logger;
        _landingEntry = landingEntryOptions.Value;
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

        string? redirectPath = null;
        try
        {
            redirectPath = await _resolver.ResolveRedirectPathAsync(
                path,
                context.Request.QueryString.Value,
                context,
                appCultureService,
                matchRouteLookup,
                matchSlugHelper,
                routeLocalization,
                context.RequestAborted);
        }
        catch (HttpRequestException ex) when (!context.RequestAborted.IsCancellationRequested)
        {
            _logger.LogWarning(
                ex,
                "Skipping match route canonicalization because the API is unavailable. Path={Path}",
                path);
        }
        catch (TimeoutException ex) when (!context.RequestAborted.IsCancellationRequested)
        {
            _logger.LogWarning(
                ex,
                "Skipping match route canonicalization because the API timed out. Path={Path}",
                path);
        }

        if (!string.IsNullOrWhiteSpace(redirectPath))
        {
            // Culture selection depends on the visitor (cookie/browser language/region), so it must not
            // be cached by browsers or CDNs. Canonical slug/id corrections remain permanent.
            var requestHasExplicitCulture = appCultureService.TryGetExplicitCultureFromPath(path) is not null;
            var redirectHasExplicitCulture = appCultureService.TryGetExplicitCultureFromPath(redirectPath) is not null;
            var isCultureSelection = !requestHasExplicitCulture && redirectHasExplicitCulture;

            if (path == "/")
            {
                // The root target varies by cookie and language signals. A shared cache must never
                // replay one visitor's destination to another visitor.
                context.Response.Headers.CacheControl = "private, no-store";
                context.Response.Headers.Pragma = "no-cache";

                if (redirectPath.StartsWith($"/{appCultureService.DetectPreferredRouteCulture(context)}/landing", StringComparison.OrdinalIgnoreCase))
                    MarkLandingSeen(context);
            }

            context.Response.Redirect(redirectPath, permanent: !isCultureSelection);
            return;
        }

        RegisterDirectLocalizedVisit(context, path, appCultureService);
        await _next(context);
    }

    private void RegisterDirectLocalizedVisit(HttpContext context, string path, AppCultureService appCultureService)
    {
        if (!_landingEntry.Enabled
            || context.Request.Cookies.ContainsKey(LandingEntryOptions.SeenCookieName)
            || !IsHtmlNavigation(context)
            || !IsPublicLocalizedPath(path, appCultureService))
        {
            return;
        }

        context.Response.OnStarting(() =>
        {
            if (context.Response.StatusCode < StatusCodes.Status400BadRequest)
                MarkLandingSeen(context);

            return Task.CompletedTask;
        });
    }

    private void MarkLandingSeen(HttpContext context)
    {
        if (context.Request.Cookies.ContainsKey(LandingEntryOptions.SeenCookieName)
            || !CanPersistNonEssentialCookie(context))
        {
            return;
        }

        var days = Math.Clamp(_landingEntry.SeenCookieDays, 1, 365);
        context.Response.Cookies.Append(LandingEntryOptions.SeenCookieName, "1", new CookieOptions
        {
            Expires = DateTimeOffset.UtcNow.AddDays(days),
            HttpOnly = true,
            IsEssential = false,
            SameSite = SameSiteMode.Lax,
            Secure = context.Request.IsHttps
        });
    }

    private static bool CanPersistNonEssentialCookie(HttpContext context)
        => context.Features.Get<Microsoft.AspNetCore.Http.Features.ITrackingConsentFeature>()?.CanTrack ?? true;

    private static bool IsHtmlNavigation(HttpContext context)
        => context.Request.Headers.Accept.Any(value => value?.Contains("text/html", StringComparison.OrdinalIgnoreCase) == true)
           || string.Equals(context.Request.Headers["Sec-Fetch-Dest"], "document", StringComparison.OrdinalIgnoreCase);

    private static bool IsPublicLocalizedPath(string path, AppCultureService appCultureService)
    {
        var segments = path.Trim('/').Split('/', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        if (segments.Length == 0 || !appCultureService.IsSupportedCulture(segments[0]))
            return false;

        var firstRouteSegment = segments.Length > 1 ? segments[1] : string.Empty;
        return !firstRouteSegment.Equals("admin", StringComparison.OrdinalIgnoreCase)
            && !firstRouteSegment.Equals("admin-sistema", StringComparison.OrdinalIgnoreCase)
            && !firstRouteSegment.Equals("intranet", StringComparison.OrdinalIgnoreCase)
            && !firstRouteSegment.Equals("minha-carteira", StringComparison.OrdinalIgnoreCase)
            && !firstRouteSegment.Equals("my-wallet", StringComparison.OrdinalIgnoreCase);
    }
}
