namespace BLL.GameRules;

/// <summary>
/// Motor determinístico: aplica suas regras de cancelamento pré-start e KO/WO pós-start.
/// </summary>
public sealed class MatchRuleEngine : IMatchRuleEngine
{
    private readonly int _outConfirmCycles;
    private readonly bool _cancelIfInvalidAtStart;
    private readonly string _rulesetVersion;

    public MatchRuleEngine(
        int? outOfGainersConfirmCycles = null,
        bool? cancelIfInvalidAtStart = null,
        string? rulesetVersion = null)
    {
        _outConfirmCycles = outOfGainersConfirmCycles ?? RuleConstants.DefaultOutOfGainersConfirmCycles;
        if (_outConfirmCycles < 1) _outConfirmCycles = 1;

        _cancelIfInvalidAtStart = cancelIfInvalidAtStart ?? RuleConstants.DefaultCancelIfInvalidAtStart;
        _rulesetVersion = string.IsNullOrWhiteSpace(rulesetVersion)
            ? RuleConstants.DefaultRulesetVersion
            : rulesetVersion!;
    }

    public MatchEligibilityResult EvaluateEligibilityForStart(
        string teamASymbol,
        string teamBSymbol,
        IReadOnlyCollection<GainerEntry> topGainersSnapshot,
        DateTime snapshotTimeUtc)
    {
        if (string.IsNullOrWhiteSpace(teamASymbol) || string.IsNullOrWhiteSpace(teamBSymbol))
        {
            return MatchEligibilityResult.NotEligible(
                EligibilityReasonCode.MissingTeamSymbol,
                $"snapshot={snapshotTimeUtc:O} missing symbol A='{teamASymbol}' B='{teamBSymbol}'",
                aIn: false,
                bIn: false,
                snapshotUtc: snapshotTimeUtc,
                aRank: null,
                bRank: null,
                rulesetVersion: _rulesetVersion
            );
        }

        if (topGainersSnapshot is null || topGainersSnapshot.Count == 0)
        {
            return MatchEligibilityResult.NotEligible(
                EligibilityReasonCode.SnapshotEmpty,
                $"snapshot={snapshotTimeUtc:O} topGainersSnapshot empty",
                aIn: false,
                bIn: false,
                snapshotUtc: snapshotTimeUtc,
                aRank: null,
                bRank: null,
                rulesetVersion: _rulesetVersion
            );
        }

        var a = Find(topGainersSnapshot, teamASymbol);
        var b = Find(topGainersSnapshot, teamBSymbol);

        var aIn = a is not null;
        var bIn = b is not null;

        if (aIn && bIn)
        {
            return MatchEligibilityResult.Eligible(
                snapshotUtc: snapshotTimeUtc,
                aRank: a!.Rank > 0 ? a.Rank : null,
                bRank: b!.Rank > 0 ? b.Rank : null,
                rulesetVersion: _rulesetVersion
            );
        }

        var code =
            (!aIn && !bIn) ? EligibilityReasonCode.Both_NotInTopGainers :
            (!aIn) ? EligibilityReasonCode.TeamA_NotInTopGainers :
                     EligibilityReasonCode.TeamB_NotInTopGainers;

        var detail = $"snapshot={snapshotTimeUtc:O} A={teamASymbol} in={aIn} rank={a?.Rank} | B={teamBSymbol} in={bIn} rank={b?.Rank}";

        return MatchEligibilityResult.NotEligible(
            code,
            detail,
            aIn,
            bIn,
            snapshotTimeUtc,
            aRank: a?.Rank > 0 ? a.Rank : null,
            bRank: b?.Rank > 0 ? b.Rank : null,
            rulesetVersion: _rulesetVersion
        );
    }

    public MatchDecision EvaluatePending(
        string teamASymbol,
        string teamBSymbol,
        IReadOnlyCollection<GainerEntry> topGainersSnapshot,
        DateTime snapshotTimeUtc)
    {
        // Se snapshot está vazio, não cancela por falha externa: apenas NoAction.
        if (topGainersSnapshot is null || topGainersSnapshot.Count == 0)
        {
            return MatchDecision.NoAction(
                reasonDetail: $"snapshot={snapshotTimeUtc:O} {RuleConstants.RC_SNAPSHOT_EMPTY}",
                rulesetVersion: _rulesetVersion
            );
        }

        var eligibility = EvaluateEligibilityForStart(teamASymbol, teamBSymbol, topGainersSnapshot, snapshotTimeUtc);

        if (eligibility.IsEligible)
            return MatchDecision.Start(_rulesetVersion, eligibility.ReasonDetail);

        // Símbolos faltando ou snapshot vazio -> NoAction (o chamador pode decidir cancelar, mas eu não recomendo)
        if (eligibility.ReasonCode is EligibilityReasonCode.MissingTeamSymbol or EligibilityReasonCode.SnapshotEmpty)
        {
            return MatchDecision.NoAction(
                reasonDetail: $"snapshot={snapshotTimeUtc:O} eligibility={eligibility.ReasonCode} detail={eligibility.ReasonDetail}",
                rulesetVersion: _rulesetVersion
            );
        }

        if (!_cancelIfInvalidAtStart)
        {
            return MatchDecision.NoAction(
                reasonDetail: $"snapshot={snapshotTimeUtc:O} invalid lineup but cancelIfInvalidAtStart=false | {eligibility.ReasonDetail}",
                rulesetVersion: _rulesetVersion
            );
        }

        var rc =
            (!eligibility.TeamAInTopGainers && !eligibility.TeamBInTopGainers) ? RuleConstants.RC_LINEUP_INVALID_BOTH_OUT :
            (!eligibility.TeamAInTopGainers) ? RuleConstants.RC_LINEUP_INVALID_A_OUT :
                                               RuleConstants.RC_LINEUP_INVALID_B_OUT;

        return MatchDecision.Cancel(
            rc,
            $"snapshot={snapshotTimeUtc:O} {eligibility.ReasonDetail}",
            _rulesetVersion
        );
    }

    public MatchDecision EvaluateOngoing(
        int teamAId,
        int teamBId,
        string teamASymbol,
        string teamBSymbol,
        int scoreA,
        int scoreB,
        int teamAOutCycles,
        int teamBOutCycles,
        IReadOnlyCollection<GainerEntry> topGainersSnapshot,
        DateTime snapshotTimeUtc)
    {
        if (topGainersSnapshot is null || topGainersSnapshot.Count == 0)
        {
            // Sem snapshot: não finalize jogo por erro externo.
            return MatchDecision.NoAction(
                reasonDetail: $"snapshot={snapshotTimeUtc:O} {RuleConstants.RC_SNAPSHOT_EMPTY}",
                rulesetVersion: _rulesetVersion,
                updatedAOutCycles: teamAOutCycles,
                updatedBOutCycles: teamBOutCycles
            );
        }

        var aInNow = IsIn(topGainersSnapshot, teamASymbol);
        var bInNow = IsIn(topGainersSnapshot, teamBSymbol);

        // Atualiza contadores (anti-flap)
        var newAOut = aInNow ? 0 : teamAOutCycles + 1;
        var newBOut = bInNow ? 0 : teamBOutCycles + 1;

        var aOutConfirmed = newAOut >= _outConfirmCycles;
        var bOutConfirmed = newBOut >= _outConfirmCycles;

        // Se nenhum confirmou saída ainda, segue o jogo
        if (!aOutConfirmed && !bOutConfirmed)
        {
            return MatchDecision.NoAction(
                reasonDetail: $"snapshot={snapshotTimeUtc:O} A_in={aInNow} B_in={bInNow} A_outCycles={newAOut} B_outCycles={newBOut}",
                rulesetVersion: _rulesetVersion,
                updatedAOutCycles: newAOut,
                updatedBOutCycles: newBOut
            );
        }

        // KO: A saiu confirmado, B não
        if (aOutConfirmed && !bOutConfirmed)
        {
            var detail = $"snapshot={snapshotTimeUtc:O} A={teamASymbol} outCycles={newAOut} (confirmed) | B={teamBSymbol} ok";
            return MatchDecision.WinnerByTeamId(
                winnerTeamId: teamBId,
                code: RuleConstants.RC_KO_A_OUT_OF_GAINERS,
                detail: detail,
                rulesetVersion: _rulesetVersion,
                updatedAOutCycles: newAOut,
                updatedBOutCycles: newBOut
            );
        }

        // KO: B saiu confirmado, A não
        if (!aOutConfirmed && bOutConfirmed)
        {
            var detail = $"snapshot={snapshotTimeUtc:O} B={teamBSymbol} outCycles={newBOut} (confirmed) | A={teamASymbol} ok";
            return MatchDecision.WinnerByTeamId(
                winnerTeamId: teamAId,
                code: RuleConstants.RC_KO_B_OUT_OF_GAINERS,
                detail: detail,
                rulesetVersion: _rulesetVersion,
                updatedAOutCycles: newAOut,
                updatedBOutCycles: newBOut
            );
        }

        // Ambos saíram confirmados -> desempate
        if (scoreA != scoreB)
        {
            var winnerId = scoreA > scoreB ? teamAId : teamBId;
            var detail = $"snapshot={snapshotTimeUtc:O} bothOut A_out={newAOut} B_out={newBOut} score={scoreA}x{scoreB}";
            return MatchDecision.WinnerByTeamId(
                winnerTeamId: winnerId,
                code: RuleConstants.RC_BOTH_OUT_SCORE_DECISION,
                detail: detail,
                rulesetVersion: _rulesetVersion,
                updatedAOutCycles: newAOut,
                updatedBOutCycles: newBOut
            );
        }

        // Empate -> WO técnico (ou você troca por regra de reembolso/empate)
        {
            var detail = $"snapshot={snapshotTimeUtc:O} bothOut A_out={newAOut} B_out={newBOut} score={scoreA}x{scoreB}";
            return MatchDecision.WO(
                code: RuleConstants.RC_BOTH_OUT_DRAW_WO,
                detail: detail,
                rulesetVersion: _rulesetVersion,
                updatedAOutCycles: newAOut,
                updatedBOutCycles: newBOut
            );
        }
    }

    // ==========
    // Helpers
    // ==========

    private static bool IsIn(IReadOnlyCollection<GainerEntry> snapshot, string symbol)
    {
        if (string.IsNullOrWhiteSpace(symbol)) return false;
        return snapshot.Any(g => string.Equals(g.Symbol, symbol, StringComparison.OrdinalIgnoreCase));
    }

    private static GainerEntry? Find(IReadOnlyCollection<GainerEntry> snapshot, string symbol)
    {
        if (string.IsNullOrWhiteSpace(symbol)) return null;
        return snapshot.FirstOrDefault(g => string.Equals(g.Symbol, symbol, StringComparison.OrdinalIgnoreCase));
    }
}
