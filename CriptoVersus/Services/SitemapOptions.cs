namespace CriptoVersus.Web.Services;

public sealed class SitemapOptions
{
    public const string SectionName = "Sitemap";

    public int ApiTake { get; set; } = 200;

    /// <summary>
    /// Maximum number of matches per culture. Use zero to include every eligible match.
    /// </summary>
    public int MaxMatchEntriesPerCulture { get; set; }

    /// <summary>
    /// Maximum number of URLs in one match sitemap file. The sitemap protocol allows up to 50,000.
    /// </summary>
    public int MaxUrlsPerMatchSitemap { get; set; } = 50_000;

    /// <summary>
    /// Limits pending and completed matches to a recent window. Use zero to include all history.
    /// </summary>
    public int RecentMatchWindowDays { get; set; }

    public bool IncludeOngoingMatches { get; set; } = true;

    public bool IncludePendingMatches { get; set; } = true;

    public bool IncludeFinishedMatches { get; set; } = true;
}
