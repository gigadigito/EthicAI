namespace CriptoVersus.Web.Services;

public static class ArenaPressurePageRouting
{
    public static bool IsVideoCaptureRequest(Uri uri)
    {
        var query = Microsoft.AspNetCore.WebUtilities.QueryHelpers.ParseQuery(uri.Query);
        return query.TryGetValue("mode", out var mode)
               && string.Equals(mode.ToString(), "videoCapture", StringComparison.Ordinal)
               && query.TryGetValue("speed", out var speed)
               && string.Equals(speed.ToString(), "4", StringComparison.Ordinal);
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
