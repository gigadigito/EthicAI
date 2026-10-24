using System.Text.Json.Serialization;
using DTOs;

namespace CriptoVersus.Web.Services;

/// <summary>Root of a mock scenario fixture file (camelCase JSON under mock-data/candle-battles/scenarios).</summary>
public sealed class CandleBattleScenarioFile
{
    [JsonPropertyName("scenario")] public string Scenario { get; set; } = "";
    [JsonPropertyName("description")] public string Description { get; set; } = "";
    [JsonPropertyName("match")] public CandleBattleScenarioMatch Match { get; set; } = new();
    [JsonPropertyName("logos")] public Dictionary<string, string> Logos { get; set; } = new();
    [JsonPropertyName("series")] public CandleBattleScenarioSeries Series { get; set; } = new();
    [JsonPropertyName("social")] public CandleBattleScenarioSocial Social { get; set; } = new();
}

public sealed class CandleBattleScenarioMatch
{
    [JsonPropertyName("matchId")] public int MatchId { get; set; }
    [JsonPropertyName("leftSymbol")] public string LeftSymbol { get; set; } = "";
    [JsonPropertyName("rightSymbol")] public string RightSymbol { get; set; } = "";
    [JsonPropertyName("startTimeMs")] public long StartTimeMs { get; set; }
    /// <summary>waiting | live | finished (fictional match state).</summary>
    [JsonPropertyName("status")] public string Status { get; set; } = "finished";
    /// <summary>How many confrontations are revealed; null means every stored round.</summary>
    [JsonPropertyName("revealRounds")] public int? RevealRounds { get; set; }
}

public sealed class CandleBattleScenarioSeries
{
    [JsonPropertyName("left")] public List<CandleBattleScenarioCandle> Left { get; set; } = [];
    [JsonPropertyName("right")] public List<CandleBattleScenarioCandle> Right { get; set; } = [];
}

public sealed class CandleBattleScenarioCandle
{
    [JsonPropertyName("openTimeMs")] public long OpenTimeMs { get; set; }
    [JsonPropertyName("open")] public decimal Open { get; set; }
    [JsonPropertyName("high")] public decimal High { get; set; }
    [JsonPropertyName("low")] public decimal Low { get; set; }
    [JsonPropertyName("close")] public decimal Close { get; set; }
    [JsonPropertyName("volume")] public decimal Volume { get; set; }
}

public sealed class CandleBattleScenarioSocial
{
    [JsonPropertyName("interestScore")] public int InterestScore { get; set; }
    [JsonPropertyName("selectionReasons")] public List<string> SelectionReasons { get; set; } = [];
}

/// <summary>
/// Immutable compiled scenario: fixture in, real DTOs out. Rounds, strengths and
/// winners are produced by <see cref="BLL.NFTFutebol.CandleBattlesResolver"/> so
/// fictional battles always follow the production combat rules.
/// </summary>
public sealed class CandleBattleScenario
{
    public required string Key { get; init; }
    public required string Description { get; init; }
    public required int MatchId { get; init; }
    public required string LeftSymbol { get; init; }
    public required string RightSymbol { get; init; }
    public required long MatchStartMs { get; init; }
    public required long MatchEndMs { get; init; }
    public required string Status { get; init; }
    public required bool Finished { get; init; }
    public required IReadOnlyList<CandleBattlesRoundDto> Rounds { get; init; }
    public required CandleBattlesFeedDto Feed { get; init; }
    public required CandleBattleSocialResponse Social { get; init; }
    public required IReadOnlyDictionary<string, string> Logos { get; init; }

    public bool Contains(int matchId) => matchId == MatchId;
}
