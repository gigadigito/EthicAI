namespace CriptoVersus.Web.Services;

public static class MatchScorePresentationVersionGuard
{
    public static bool ShouldApply(int incomingVersion, int currentVersion)
        => incomingVersion >= currentVersion;

    public static bool ShouldApply(int? incomingVersion, int? currentVersion)
    {
        if (!incomingVersion.HasValue)
            return true;

        if (!currentVersion.HasValue)
            return true;

        return incomingVersion.Value >= currentVersion.Value;
    }
}
