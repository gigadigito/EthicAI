namespace BLL.GameRules;

/// <summary>
/// Contrato do motor de regras. Não acessa banco, não loga.
/// Só decide com base em inputs.
/// </summary>
public interface IMatchRuleEngine
{
    /// <summary>
    /// Avalia se um confronto (A/B) pode iniciar baseado no snapshot atual.
    /// </summary>
    MatchEligibilityResult EvaluateEligibilityForStart(
        string teamASymbol,
        string teamBSymbol,
        IReadOnlyCollection<GainerEntry> topGainersSnapshot,
        DateTime snapshotTimeUtc);

    /// <summary>
    /// Decide o que fazer com uma partida PENDING (geralmente: Start ou Cancel ou NoAction).
    /// </summary>
    MatchDecision EvaluatePending(
        string teamASymbol,
        string teamBSymbol,
        IReadOnlyCollection<GainerEntry> topGainersSnapshot,
        DateTime snapshotTimeUtc);

    /// <summary>
    /// Decide o que fazer com uma partida ONGOING.
    ///
    /// - "out cycles" são contadores persistidos no match para estabilidade (anti-flap).
    /// - o engine devolve os contadores atualizados em MatchDecision (UpdatedTeamAOutCycles/UpdatedTeamBOutCycles).
    /// </summary>
    MatchDecision EvaluateOngoing(
        int teamAId,
        int teamBId,
        string teamASymbol,
        string teamBSymbol,
        int scoreA,
        int scoreB,
        int teamAOutCycles,
        int teamBOutCycles,
        IReadOnlyCollection<GainerEntry> topGainersSnapshot,
        DateTime snapshotTimeUtc);
}
