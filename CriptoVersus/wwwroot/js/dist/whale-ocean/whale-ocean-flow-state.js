export function flowStatusForConnection(connected, hasFlowData) {
    return connected && hasFlowData ? "LIVE" : "BOOTSTRAP_PENDING";
}
/**
 * MatchStatus is authoritative. This policy keeps renderer callbacks from
 * replacing FINALIZED with a transport/bootstrap state after the match ends.
 */
export function guardWhaleOceanFlowStatus(matchFinished, current, requested) {
    if (matchFinished && requested !== "FINALIZED")
        return { accepted: false, status: current };
    return { accepted: true, status: requested };
}
