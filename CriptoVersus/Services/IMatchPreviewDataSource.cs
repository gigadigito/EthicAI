using DTOs;

namespace CriptoVersus.Web.Services;

/// <summary>
/// Session-local data seam used exclusively by the development preview. It has
/// the same read shapes consumed by MatchDetail, but no HTTP, SignalR or storage.
/// </summary>
public interface IMatchPreviewDataSource
{
    event Action? Changed;

    int Seed { get; }
    bool IsPlaying { get; }
    int Speed { get; }
    string Scenario { get; }
    string State { get; }

    Task<MatchDto?> GetMatchAsync(CancellationToken cancellationToken);
    Task<IReadOnlyList<MatchMetricSnapshotDto>> GetMetricSnapshotsAsync(CancellationToken cancellationToken);
    Task<IReadOnlyList<MatchScoreEventDto>> GetScoreEventsAsync(CancellationToken cancellationToken);
    Task<ArenaSentimentPairDto?> GetArenaSentimentAsync(CancellationToken cancellationToken);

    void Play();
    void Pause();
    void Restart();
    void Advance();
    void SetSpeed(int speed);
    void SetScenario(string scenario);
    void SetState(string state);
    void SetSeed(int seed);
}
