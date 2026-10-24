using DTOs;

namespace CriptoVersus.Web.Services;

/// <summary>
/// Deterministic fictional data source. Serves compiled scenarios by MatchId
/// only — no HTTP, no SignalR, no database, no persistence and no publication
/// side effects. Requests for ids outside the fixtures return <c>null</c>, so
/// fictional data can never mix with real matches.
/// </summary>
public sealed class MockCandleBattleDataSource : ICandleBattleDataSource
{
    private readonly CandleBattleScenarioCatalog _catalog;

    public MockCandleBattleDataSource(CandleBattleScenarioCatalog catalog, IHostEnvironment environment)
    {
        if (!environment.IsDevelopment())
            throw new InvalidOperationException("Candle Battle mock data source is only available in Development.");
        _catalog = catalog;
    }

    public TimeSpan? UpdateInterval => null;

    public bool UsesLiveNotifications => false;

    public Task<CandleBattlesFeedDto?> GetFeedAsync(int matchId, long? after, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var scenario = _catalog.FindByMatchId(matchId);
        if (scenario is null) return Task.FromResult<CandleBattlesFeedDto?>(null);

        var rounds = after is null
            ? scenario.Rounds
            : scenario.Rounds.Where(r => r.Left.OpenTime > after.Value).ToArray();
        var feed = scenario.Feed with { Rounds = rounds, HasMore = false };
        return Task.FromResult<CandleBattlesFeedDto?>(feed);
    }

    public Task<CandleBattleSocialResponse?> GetSocialAsync(int matchId, string language, bool includeRounds, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var scenario = _catalog.FindByMatchId(matchId);
        if (scenario is null) return Task.FromResult<CandleBattleSocialResponse?>(null);

        var social = scenario.Social;
        if (!includeRounds) social = CloneWithoutRounds(social);
        return Task.FromResult<CandleBattleSocialResponse?>(social);
    }

    public IReadOnlyDictionary<string, string> GetLocalLogos(int matchId)
        => _catalog.FindByMatchId(matchId)?.Logos ?? EmptyLogos;

    private static CandleBattleSocialResponse CloneWithoutRounds(CandleBattleSocialResponse social)
    {
        var clone = new CandleBattleSocialResponse
        {
            Category = social.Category,
            MatchId = social.MatchId,
            BattleId = social.BattleId,
            BattleType = social.BattleType,
            Status = social.Status,
            BattleStatus = social.BattleStatus,
            StartTimeUtc = social.StartTimeUtc,
            EndTimeUtc = social.EndTimeUtc,
            DurationMinutes = social.DurationMinutes,
            AssetA = social.AssetA,
            AssetB = social.AssetB,
            ScoreA = social.ScoreA,
            ScoreB = social.ScoreB,
            WinnerSymbol = social.WinnerSymbol,
            ConfrontationCount = social.ConfrontationCount,
            ExpectedConfrontations = social.ExpectedConfrontations,
            InterestScore = social.InterestScore,
            SelectionReasons = social.SelectionReasons,
            ReplayAvailable = social.ReplayAvailable,
            ReplayUnavailableReason = social.ReplayUnavailableReason,
            CanPost = social.CanPost,
            SkipReason = social.SkipReason,
            AlreadyPublished = social.AlreadyPublished,
            Publication = social.Publication,
            PublicUrl = social.PublicUrl,
            PublicUrlAvailable = social.PublicUrlAvailable,
            GeneratedAtUtc = social.GeneratedAtUtc
        };
        return clone;
    }

    private static readonly IReadOnlyDictionary<string, string> EmptyLogos = new Dictionary<string, string>();
}
