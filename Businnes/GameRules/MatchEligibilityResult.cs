namespace BLL.GameRules;

public enum EligibilityReasonCode
{
    Ok = 0,

    MissingTeamSymbol,
    SnapshotEmpty,

    TeamA_NotInTopGainers,
    TeamB_NotInTopGainers,
    Both_NotInTopGainers
}

/// <summary>
/// Resultado explicável sobre elegibilidade de lineup (principalmente antes do start).
/// </summary>
public sealed class MatchEligibilityResult
{
    public bool IsEligible { get; init; }
    public EligibilityReasonCode ReasonCode { get; init; } = EligibilityReasonCode.Ok;
    public string ReasonDetail { get; init; } = string.Empty;

    public bool TeamAInTopGainers { get; init; }
    public bool TeamBInTopGainers { get; init; }

    public int? TeamARank { get; init; }
    public int? TeamBRank { get; init; }

    public DateTime SnapshotTimeUtc { get; init; }
    public string RulesetVersion { get; init; } = RuleConstants.DefaultRulesetVersion;

    public static MatchEligibilityResult Eligible(
        DateTime snapshotUtc,
        int? aRank,
        int? bRank,
        string rulesetVersion)
        => new()
        {
            IsEligible = true,
            ReasonCode = EligibilityReasonCode.Ok,
            TeamAInTopGainers = true,
            TeamBInTopGainers = true,
            TeamARank = aRank,
            TeamBRank = bRank,
            SnapshotTimeUtc = snapshotUtc,
            RulesetVersion = rulesetVersion
        };

    public static MatchEligibilityResult NotEligible(
        EligibilityReasonCode code,
        string detail,
        bool aIn,
        bool bIn,
        DateTime snapshotUtc,
        int? aRank,
        int? bRank,
        string rulesetVersion)
        => new()
        {
            IsEligible = false,
            ReasonCode = code,
            ReasonDetail = detail,
            TeamAInTopGainers = aIn,
            TeamBInTopGainers = bIn,
            TeamARank = aRank,
            TeamBRank = bRank,
            SnapshotTimeUtc = snapshotUtc,
            RulesetVersion = rulesetVersion
        };
}
