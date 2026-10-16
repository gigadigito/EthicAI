namespace DTOs;

public sealed record CandleBattlesCandleDto(
    string Symbol, long OpenTime, long CloseTime, long UpdatedAt,
    decimal Open, decimal High, decimal Low, decimal Close, decimal? Volume, bool Confirmed, decimal? Strength = null);

public sealed record CandleBattlesRoundDto(
    string Id, int MatchId, CandleBattlesCandleDto Left, CandleBattlesCandleDto Right,
    string Winner, string RuleVersion, decimal LeftStrength, decimal RightStrength);

public sealed record CandleBattlesFeedDto(
    int MatchId, string LeftSymbol, string RightSymbol, int ScoreLeft, int ScoreRight,
    bool Finished, string Status, CandleBattlesCandleDto? Left, CandleBattlesCandleDto? Right,
    IReadOnlyList<CandleBattlesRoundDto> Rounds, bool HasMore, long? NextCursor,
    long? MatchStartTime = null, long? MatchEndTime = null, int ExpectedRounds = 18, long? ServerTime = null);
