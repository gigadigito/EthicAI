using DTOs;

namespace CriptoVersus.Web.Services;

/// <summary>
/// Single acquisition boundary for Candle Battle presentation data. Blazor
/// components never call the API (or fixtures) directly: the composition root
/// picks the real or the mock implementation, so no component needs to know
/// which source is active.
/// </summary>
public interface ICandleBattleDataSource
{
    /// <summary>Feed refresh cadence for the arena host. <c>null</c> means the source is static and only explicit reloads are needed.</summary>
    TimeSpan? UpdateInterval { get; }

    /// <summary>Whether a live invalidation channel (SignalR) backs this source. Mock data is immutable and never subscribes.</summary>
    bool UsesLiveNotifications { get; }

    /// <summary>Feed of candles/rounds for one match. Returns <c>null</c> when the match is unknown to this source.</summary>
    Task<CandleBattlesFeedDto?> GetFeedAsync(int matchId, long? after, CancellationToken cancellationToken);

    /// <summary>Social card payload for one match. Returns <c>null</c> when the match is unknown to this source.</summary>
    Task<CandleBattleSocialResponse?> GetSocialAsync(int matchId, string language, bool includeRounds, CancellationToken cancellationToken);

    /// <summary>Symbol → logo URL for presentation assets served without external calls. Empty map means the standard logo routes apply.</summary>
    IReadOnlyDictionary<string, string> GetLocalLogos(int matchId);
}

/// <summary>Production source: delegates to the existing CriptoVersus API client without changing any rule or contract.</summary>
public sealed class RealCandleBattleDataSource(CriptoVersusApiClient api) : ICandleBattleDataSource
{
    public TimeSpan? UpdateInterval => TimeSpan.FromSeconds(10);

    public bool UsesLiveNotifications => true;

    public Task<CandleBattlesFeedDto?> GetFeedAsync(int matchId, long? after, CancellationToken cancellationToken)
        => api.GetCandleBattlesAsync(matchId, after, cancellationToken);

    public Task<CandleBattleSocialResponse?> GetSocialAsync(int matchId, string language, bool includeRounds, CancellationToken cancellationToken)
        => api.GetCandleBattleSocialAsync(matchId, language, includeRounds, cancellationToken);

    public IReadOnlyDictionary<string, string> GetLocalLogos(int matchId) => EmptyLogos;

    private static readonly IReadOnlyDictionary<string, string> EmptyLogos = new Dictionary<string, string>();
}
