using System.Text;
using Microsoft.AspNetCore.Http;

namespace CriptoVersus.Web.Services;

/// <summary>
/// Shared GET/HEAD response semantics for the sitemap endpoints: same content type and
/// content length for both methods, empty body on HEAD.
/// </summary>
public static class SitemapHttpResults
{
    public const string XmlContentType = "application/xml; charset=utf-8";

    public static async Task<IResult> WriteXmlAsync(
        HttpContext httpContext,
        Func<CancellationToken, Task<string>> xmlFactory,
        CancellationToken ct)
    {
        var xml = await xmlFactory(ct);
        httpContext.Response.ContentType = XmlContentType;
        httpContext.Response.ContentLength = Encoding.UTF8.GetByteCount(xml);

        if (HttpMethods.IsHead(httpContext.Request.Method))
            return Results.Empty;

        return Results.Content(xml, XmlContentType);
    }
}
