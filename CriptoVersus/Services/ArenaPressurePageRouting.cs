namespace CriptoVersus.Web.Services;

public static class ArenaPressurePageRouting
{
    public const string AuthorizedCaptureStateKey = "arena-pressure-authorized-video-capture";

    public static bool IsVideoCaptureRequest(Uri uri)
    {
        if (!IsArenaPressureRoute(uri.AbsolutePath))
            return false;

        var query = Microsoft.AspNetCore.WebUtilities.QueryHelpers.ParseQuery(uri.Query);
        return query.TryGetValue("mode", out var mode)
               && string.Equals(mode.ToString(), "videoCapture", StringComparison.Ordinal)
               && query.TryGetValue("speed", out var speed)
               && string.Equals(speed.ToString(), "4", StringComparison.Ordinal);
    }

    private static bool IsArenaPressureRoute(string path)
    {
        var segments = path.Split('/', StringSplitOptions.RemoveEmptyEntries);
        var offset = segments.Length == 5 ? 1 : 0;

        return segments.Length - offset == 4
               && string.Equals(segments[offset], "tv", StringComparison.OrdinalIgnoreCase)
               && string.Equals(segments[offset + 1], "pressure", StringComparison.OrdinalIgnoreCase)
               && int.TryParse(segments[offset + 2], out var matchId)
               && matchId > 0
               && !string.IsNullOrWhiteSpace(segments[offset + 3]);
    }

    public static bool ResolveAuthorizedVideoCapture(
        bool requested,
        bool? persistedAuthorization,
        bool initialRequestAuthorized)
        => requested && (persistedAuthorization ?? initialRequestAuthorized);

    public static bool ShouldRedirectToCanonical(
        bool authorizedVideoCapture,
        string currentPath,
        string canonicalPath)
        => !authorizedVideoCapture && !PathsEquivalent(currentPath, canonicalPath);

    public static bool PathsEquivalent(string left, string right)
        => SafeUnescape(left).Equals(SafeUnescape(right), StringComparison.OrdinalIgnoreCase);

    private static string SafeUnescape(string value)
    {
        try
        {
            return Uri.UnescapeDataString(value);
        }
        catch
        {
            return value;
        }
    }
}
