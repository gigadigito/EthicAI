namespace CriptoVersus.Web.Services;

/// <summary>
/// Controls the optional first-visit presentation reached through the culture-less root URL.
/// </summary>
public sealed class LandingEntryOptions
{
    public const string SectionName = "LandingEntry";
    public const string SeenCookieName = "cv_landing_seen";

    public bool Enabled { get; set; }

    public bool ShowToFirstTimeVisitors { get; set; } = true;

    public int SeenCookieDays { get; set; } = 30;
}
