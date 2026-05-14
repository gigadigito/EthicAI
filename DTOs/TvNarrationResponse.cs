namespace DTOs;

public sealed class TvNarrationResponse
{
    public int MatchId { get; set; }
    public string Text { get; set; } = string.Empty;
    public string Source { get; set; } = string.Empty;
    public DateTime GeneratedAtUtc { get; set; }
    public int HistoryId { get; set; }
}
