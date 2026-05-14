namespace DAL.NftFutebol;

public sealed class MatchAiNarrationHistory
{
    public int Id { get; set; }
    public int MatchId { get; set; }
    public string EventType { get; set; } = string.Empty;
    public string Culture { get; set; } = "pt-BR";
    public string Text { get; set; } = string.Empty;
    public string? PromptHash { get; set; }
    public string? ContextHash { get; set; }
    public string Source { get; set; } = "ai";
    public string? Model { get; set; }
    public DateTime CreatedAtUtc { get; set; }
    public int? HotScoreSnapshot { get; set; }
    public int? LeftScoreSnapshot { get; set; }
    public int? RightScoreSnapshot { get; set; }
    public string? LeaderSymbolSnapshot { get; set; }
    public string? MetadataJson { get; set; }

    public Match Match { get; set; } = null!;
}
