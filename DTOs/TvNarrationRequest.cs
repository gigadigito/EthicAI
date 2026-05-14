namespace DTOs;

public sealed class TvNarrationRequest
{
    public string? EventType { get; set; }
    public string? Culture { get; set; }
    public bool ForceRefresh { get; set; }
}
