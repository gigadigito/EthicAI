namespace CriptoVersus.Web.Services;

/// <summary>
/// Configuration for the Candle Battle mock mode. The mock only ever runs in
/// Development: <see cref="IsAllowed"/> is the single decision point used by the
/// composition root, and every default keeps production on the real source.
/// </summary>
public sealed class CandleBattleMockOptions
{
    public const string SectionName = "CandleBattle:Mock";

    /// <summary>Master switch. Defaults to <c>false</c>; ignored outside Development.</summary>
    public bool Enabled { get; set; }

    /// <summary>Scenario key opened by default on the dev arena page (the scenario data is still resolved per MatchId).</summary>
    public string Scenario { get; set; } = "complete-match";

    /// <summary>Whether a fictional match starts playing automatically (dev pages may override per instance).</summary>
    public bool AutoPlay { get; set; } = true;

    /// <summary>Initial playback speed for fictional matches (1, 2, 5 or 10).</summary>
    public double PlaybackSpeed { get; set; } = 1.0;

    /// <summary>
    /// The only activation check. Production refuses the mock even when the
    /// configuration is wrong, and no request/URL can flip this at runtime.
    /// </summary>
    public static bool IsAllowed(CandleBattleMockOptions options, IHostEnvironment environment)
        => options is { Enabled: true } && environment.IsDevelopment();
}
