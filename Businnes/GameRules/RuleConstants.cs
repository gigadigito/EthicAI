namespace BLL.GameRules;

/// <summary>
/// Constantes e códigos estáveis para auditoria.
/// Não coloque textos "bonitos" aqui — só identificadores estáveis.
/// </summary>
public static class RuleConstants
{
    public const string DefaultRulesetVersion = "v1.0.0";

    // ==========
    // Reason Codes (auditáveis)
    // ==========

    // Pending
    public const string RC_NO_ACTION = "NO_ACTION";
    public const string RC_LINEUP_OK = "LINEUP_OK";
    public const string RC_SNAPSHOT_EMPTY = "SNAPSHOT_EMPTY";
    public const string RC_MISSING_SYMBOL = "MISSING_SYMBOL";
    public const string RC_LINEUP_INVALID_A_OUT = "LINEUP_INVALID_A_OUT";
    public const string RC_LINEUP_INVALID_B_OUT = "LINEUP_INVALID_B_OUT";
    public const string RC_LINEUP_INVALID_BOTH_OUT = "LINEUP_INVALID_BOTH_OUT";

    // Ongoing (KO/Finish)
    public const string RC_KO_A_OUT_OF_GAINERS = "KO_A_OUT_OF_GAINERS";
    public const string RC_KO_B_OUT_OF_GAINERS = "KO_B_OUT_OF_GAINERS";
    public const string RC_BOTH_OUT_SCORE_DECISION = "BOTH_OUT_SCORE_DECISION";
    public const string RC_BOTH_OUT_DRAW_WO = "BOTH_OUT_DRAW_WO";

    // ==========
    // Defaults
    // ==========
    public const int DefaultOutOfGainersConfirmCycles = 2;
    public const bool DefaultCancelIfInvalidAtStart = true;
}

/// <summary>
/// Snapshot mínimo de um item do Top Gainers.
/// Se você já tem DTO próprio, pode mapear para isso no serviço que chama o engine.
/// </summary>
public sealed class GainerEntry
{
    public string Symbol { get; init; } = string.Empty;

    /// <summary>Rank (1..N) dentro do snapshot. Opcional.</summary>
    public int Rank { get; init; }

    /// <summary>Percentual de variação. Opcional.</summary>
    public decimal? PercentageChange { get; init; }
}
