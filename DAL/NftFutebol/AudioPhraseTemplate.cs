namespace DAL.NftFutebol;

public sealed class AudioPhraseTemplate
{
    public long Id { get; set; }
    public string TemplateKey { get; set; } = string.Empty;
    public string EventType { get; set; } = string.Empty;
    public string Language { get; set; } = string.Empty;
    public string? ContextKey { get; set; }
    public string? Intensity { get; set; }
    public string TemplateText { get; set; } = string.Empty;
    public bool IsActive { get; set; } = true;
    public int Priority { get; set; }
    public DateTime CreatedAtUtc { get; set; }
    public DateTime UpdatedAtUtc { get; set; }
}
