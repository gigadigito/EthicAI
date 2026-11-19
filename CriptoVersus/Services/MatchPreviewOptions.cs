namespace CriptoVersus.Web.Services;

/// <summary>
/// Explicit opt-in for the local Match preview. The route is never enabled by a
/// query string and is refused outside Development.
/// </summary>
public sealed class MatchPreviewOptions
{
    public const string SectionName = "MatchPreview";

    public bool Enabled { get; set; }
    public int Seed { get; set; } = 20261118;

    public static bool IsAllowed(MatchPreviewOptions options, IHostEnvironment environment)
        => options is { Enabled: true } && environment.IsDevelopment();
}
