namespace BLL.GameRules;

public enum MatchDecisionType
{
    NoAction = 0,
    StartMatch = 1,
    CancelMatch = 2,
    FinishWithWinner = 3,
    FinishWithWO = 4
}

/// <summary>
/// Resultado determinístico do motor de regras.
/// O Worker/Service aplica e persiste isso (status, winner, audit log, etc).
/// </summary>
public sealed class MatchDecision
{
    public MatchDecisionType Decision { get; init; }

    /// <summary>
    /// Se você usa "lado" (A/B) em vez de TeamId, pode ignorar e usar WinnerSide.
    /// </summary>
    public int? WinnerTeamId { get; init; }

    /// <summary>
    /// Alternativa ao WinnerTeamId quando você não tem id no engine.
    /// </summary>
    public MatchWinnerSide WinnerSide { get; init; } = MatchWinnerSide.None;

    /// <summary>ReasonCode estável para auditoria.</summary>
    public string ReasonCode { get; init; } = RuleConstants.RC_NO_ACTION;

    /// <summary>Detalhe humano para log/auditoria (não usar como regra).</summary>
    public string ReasonDetail { get; init; } = string.Empty;

    /// <summary>Versão do conjunto de regras que gerou a decisão.</summary>
    public string RulesetVersion { get; init; } = RuleConstants.DefaultRulesetVersion;

    /// <summary>
    /// Para janela de estabilidade: o engine pode devolver os contadores atualizados.
    /// O chamador deve persistir no Match.
    /// </summary>
    public int? UpdatedTeamAOutCycles { get; init; }
    public int? UpdatedTeamBOutCycles { get; init; }

    // ==========
    // Factories
    // ==========

    public static MatchDecision NoAction(
        string reasonDetail = "",
        string rulesetVersion = RuleConstants.DefaultRulesetVersion,
        int? updatedAOutCycles = null,
        int? updatedBOutCycles = null)
        => new()
        {
            Decision = MatchDecisionType.NoAction,
            ReasonCode = RuleConstants.RC_NO_ACTION,
            ReasonDetail = reasonDetail,
            RulesetVersion = rulesetVersion,
            UpdatedTeamAOutCycles = updatedAOutCycles,
            UpdatedTeamBOutCycles = updatedBOutCycles
        };

    public static MatchDecision Start(string rulesetVersion = RuleConstants.DefaultRulesetVersion, string detail = "")
        => new()
        {
            Decision = MatchDecisionType.StartMatch,
            ReasonCode = RuleConstants.RC_LINEUP_OK,
            ReasonDetail = detail,
            RulesetVersion = rulesetVersion
        };

    public static MatchDecision Cancel(string code, string detail, string rulesetVersion = RuleConstants.DefaultRulesetVersion)
        => new()
        {
            Decision = MatchDecisionType.CancelMatch,
            ReasonCode = code,
            ReasonDetail = detail,
            RulesetVersion = rulesetVersion
        };

    public static MatchDecision WinnerByTeamId(
        int winnerTeamId,
        string code,
        string detail,
        string rulesetVersion = RuleConstants.DefaultRulesetVersion,
        int? updatedAOutCycles = null,
        int? updatedBOutCycles = null)
        => new()
        {
            Decision = MatchDecisionType.FinishWithWinner,
            WinnerTeamId = winnerTeamId,
            WinnerSide = MatchWinnerSide.None,
            ReasonCode = code,
            ReasonDetail = detail,
            RulesetVersion = rulesetVersion,
            UpdatedTeamAOutCycles = updatedAOutCycles,
            UpdatedTeamBOutCycles = updatedBOutCycles
        };

    public static MatchDecision WinnerBySide(
        MatchWinnerSide side,
        string code,
        string detail,
        string rulesetVersion = RuleConstants.DefaultRulesetVersion,
        int? updatedAOutCycles = null,
        int? updatedBOutCycles = null)
        => new()
        {
            Decision = MatchDecisionType.FinishWithWinner,
            WinnerSide = side,
            WinnerTeamId = null,
            ReasonCode = code,
            ReasonDetail = detail,
            RulesetVersion = rulesetVersion,
            UpdatedTeamAOutCycles = updatedAOutCycles,
            UpdatedTeamBOutCycles = updatedBOutCycles
        };

    public static MatchDecision WO(
        string code,
        string detail,
        string rulesetVersion = RuleConstants.DefaultRulesetVersion,
        int? updatedAOutCycles = null,
        int? updatedBOutCycles = null)
        => new()
        {
            Decision = MatchDecisionType.FinishWithWO,
            ReasonCode = code,
            ReasonDetail = detail,
            RulesetVersion = rulesetVersion,
            UpdatedTeamAOutCycles = updatedAOutCycles,
            UpdatedTeamBOutCycles = updatedBOutCycles
        };
}

public enum MatchWinnerSide
{
    None = 0,
    A = 1,
    B = 2
}
