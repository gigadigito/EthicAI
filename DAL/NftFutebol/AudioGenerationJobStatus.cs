namespace DAL.NftFutebol;

public static class AudioGenerationJobStatus
{
    public const string Pending = "pending";
    public const string Leased = "leased";
    public const string Generating = "generating";
    public const string Completed = "completed";
    public const string Failed = "failed";
    public const string Cancelled = "cancelled";
}
