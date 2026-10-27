namespace DTOs;

public static class CandleBattleBroadcastModes
{
    public const string Live = "live";
    public const string Replay = "replay";
    public const string None = "none";
}

public static class CandleBattleBroadcastSkipReasons
{
    public const string Disabled = "disabled";
    public const string NoContent = "no_content";
    public const string SourceUnavailable = "source_unavailable";
}

/// <summary>
/// Conteudo escolhido pelo diretor automatico de transmissao da Candle Battle TV.
/// <see cref="Mode"/> descreve o tipo de conteudo exibido; uma partida LIVE encerrada
/// permanece <c>live</c> com <see cref="IsFinished"/> true somente durante a janela
/// de exibicao do resultado final. Uma selecao nova nunca devolve partida encerrada como LIVE.
/// </summary>
public sealed record CandleBattleBroadcastSelectionDto
{
    public bool Available { get; init; }
    public string Mode { get; init; } = CandleBattleBroadcastModes.None;
    public int? MatchId { get; init; }
    public string? BattleId { get; init; }
    public string? AssetA { get; init; }
    public string? AssetB { get; init; }
    public int ScoreA { get; init; }
    public int ScoreB { get; init; }
    public int InterestScore { get; init; }
    public IReadOnlyList<string> SelectionReasons { get; init; } = [];
    public string? MatchStatus { get; init; }
    public string? BattleStatus { get; init; }
    public bool IsFinished { get; init; }
    public bool ReplayAvailable { get; init; }
    public string? WinnerSymbol { get; init; }
    public DateTime? StartTimeUtc { get; init; }
    public DateTime? EndTimeUtc { get; init; }
    public int? RemainingSeconds { get; init; }
    public string? PlaybackUrl { get; init; }
    public int FinalResultDisplaySeconds { get; init; }
    public int StatusPollingSeconds { get; init; }
    public string? SkipReason { get; init; }
    public DateTime GeneratedAtUtc { get; init; }
}

/// <summary>
/// Estado de transmissao de uma Candle Battle para o transmissor decidir troca de partida.
/// <see cref="IsFinished"/> e o encerramento real da partida (nao a conclusao de um candle de
/// cinco minutos). Em <c>replay</c> a partida sempre esta encerrada; a permanencia do replay
/// e comandada por <see cref="ShouldSwitch"/>.
/// </summary>
public sealed record CandleBattleBroadcastStatusDto
{
    public int MatchId { get; init; }
    public string Mode { get; init; } = CandleBattleBroadcastModes.None;
    public string? MatchStatus { get; init; }
    public string? BattleStatus { get; init; }
    public bool IsFinished { get; init; }
    public bool ReplayAvailable { get; init; }
    public string? WinnerSymbol { get; init; }
    public DateTime? StartTimeUtc { get; init; }
    public DateTime? EndTimeUtc { get; init; }
    public int? RemainingSeconds { get; init; }
    public bool ShouldSwitch { get; init; }
    public string? SwitchReason { get; init; }
    public DateTime GeneratedAtUtc { get; init; }
}

public static class CandleBattleBroadcastSwitchReasons
{
    public const string FinalResultDisplayed = "final_result_displayed";
    public const string ReplayBudgetElapsed = "replay_budget_elapsed";
    public const string LiveAvailable = "live_available";
    public const string ReplayServingUnknown = "replay_serving_unknown";
    public const string MatchEnded = "match_ended";
    public const string NoContent = "no_content";
}
