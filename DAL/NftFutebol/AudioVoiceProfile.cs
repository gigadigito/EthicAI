namespace DAL.NftFutebol;

public sealed class AudioVoiceProfile
{
    public long Id { get; set; }
    public string VoiceKey { get; set; } = string.Empty;
    public string Language { get; set; } = string.Empty;
    public string DisplayName { get; set; } = string.Empty;
    public string SampleRelativePath { get; set; } = string.Empty;
    public string SampleUrl { get; set; } = string.Empty;
    public string? Provider { get; set; }
    public string? VoiceStyle { get; set; }
    public bool IsActive { get; set; } = true;
    public int Priority { get; set; }
    public DateTime CreatedAtUtc { get; set; }
    public DateTime UpdatedAtUtc { get; set; }
}
