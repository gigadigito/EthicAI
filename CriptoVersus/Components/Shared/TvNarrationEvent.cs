namespace CriptoVersus.Components.Shared;

public sealed class TvNarrationEvent
{
    public string Id { get; set; } = string.Empty;
    public string Type { get; set; } = string.Empty;
    public string Severity { get; set; } = "medium";
    public string Text { get; set; } = string.Empty;
    public string? Subtitle { get; set; }
    public string? Asset { get; set; }
    public string? Side { get; set; }
    public string Animation { get; set; } = "grow";
    public int DurationMs { get; set; } = 3200;
    public int CooldownMs { get; set; } = 250;
}
