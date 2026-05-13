namespace DTOs;

public sealed class TvHotMatchDto
{
    public bool HasMatch { get; set; }
    public int MatchId { get; set; }
    public string Slug { get; set; } = string.Empty;
    public string LeftSymbol { get; set; } = string.Empty;
    public string RightSymbol { get; set; } = string.Empty;
    public string LeftName { get; set; } = string.Empty;
    public string RightName { get; set; } = string.Empty;
    public int LeftScore { get; set; }
    public int RightScore { get; set; }
    public string LeftLogoUrl { get; set; } = string.Empty;
    public string RightLogoUrl { get; set; } = string.Empty;
    public int HotScore { get; set; }
    public string Reason { get; set; } = string.Empty;
    public string WatchUrl { get; set; } = string.Empty;
    public string VolumeLabel { get; set; } = string.Empty;
    public string MomentumLabel { get; set; } = string.Empty;
    public string RemainingTimeLabel { get; set; } = string.Empty;
    public bool HasRecentReversal { get; set; }
}
