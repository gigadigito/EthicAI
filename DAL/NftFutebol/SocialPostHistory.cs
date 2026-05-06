namespace DAL.NftFutebol;

public class SocialPostHistory
{
    public long Id { get; set; }
    public int MatchId { get; set; }
    public string Platform { get; set; } = string.Empty;
    public string PostText { get; set; } = string.Empty;
    public string? PostUrl { get; set; }
    public string? ExternalPostId { get; set; }
    public int HotScore { get; set; }
    public string? Reason { get; set; }
    public DateTime CreatedAt { get; set; }

    public Match Match { get; set; } = null!;
}
