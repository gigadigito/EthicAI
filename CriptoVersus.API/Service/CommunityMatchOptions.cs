namespace CriptoVersus.API.Services;

public sealed class CommunityMatchOptions
{
    public const string SectionName = "CommunityMatch";

    public bool Enabled { get; set; } = true;
    public int CooldownMinutes { get; set; } = 15;
    public int AnonymousDailyLimit { get; set; } = 3;
    public int AuthenticatedDailyLimit { get; set; } = 10;
    public int SuccessRedirectDelayMilliseconds { get; set; } = 900;
    public int StartDelayMinutes { get; set; } = 10;
    public int BettingCloseOffsetMinutes { get; set; } = 2;
    public int MarketDataFreshnessMinutes { get; set; } = 15;
    public string CreatorIpSalt { get; set; } = string.Empty;
    public List<string> ActiveDuplicateStatuses { get; set; } = ["Pending", "Ongoing"];
}
