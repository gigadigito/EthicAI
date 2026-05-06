namespace CriptoVersus.Web.Services;

public sealed class SitemapOptions
{
    public const string SectionName = "Sitemap";

    public int ApiTake { get; set; } = 500;

    public int MaxMatchEntriesPerCulture { get; set; } = 500;

    public int RecentMatchWindowDays { get; set; } = 30;

    public bool IncludeOngoingMatches { get; set; } = true;

    public bool IncludePendingMatches { get; set; } = true;

    public bool IncludeFinishedMatches { get; set; } = true;
}
