export type WhaleOceanFlowStatus =
    | "BOOTSTRAP_PENDING"
    | "LIVE"
    | "REPLAY"
    | "PAUSED"
    | "FINALIZED"
    | "DIAGNOSTIC_SPRITES"
    | "DIAGNOSTIC_SHOWCASE";

export interface WhaleOceanFlowDecision {
    accepted: boolean;
    status: WhaleOceanFlowStatus;
}

export function flowStatusForConnection(connected: boolean, hasFlowData: boolean): WhaleOceanFlowStatus {
    return connected && hasFlowData ? "LIVE" : "BOOTSTRAP_PENDING";
}

/**
 * MatchStatus is authoritative. This policy keeps renderer callbacks from
 * replacing FINALIZED with a transport/bootstrap state after the match ends.
 */
export function guardWhaleOceanFlowStatus(
    matchFinished: boolean,
    current: WhaleOceanFlowStatus,
    requested: WhaleOceanFlowStatus
): WhaleOceanFlowDecision {
    if (matchFinished && requested !== "FINALIZED")
        return { accepted: false, status: current };

    return { accepted: true, status: requested };
}
