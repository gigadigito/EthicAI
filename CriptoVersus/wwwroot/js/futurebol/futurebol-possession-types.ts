import type { FuturebolTeam, FuturebolVector3State } from "./futurebol-types.js";

/**
 * Reason for a possession transition.
 */
export type FuturebolPossessionReason =
    | "Pass"
    | "Shot"
    | "Interception"
    | "Parry"
    | "Recovery"
    | "Start"
    | "Reset";

/**
 * Result of an action evaluation. Drives branching in scenario execution.
 */
export type FuturebolActionResult =
    | "Pending"
    | "Completed"
    | "Intercepted"
    | "Parried"
    | "PossessionChanged";

/**
 * Lateral component of a shot profile.
 */
export type FuturebolShotLateral = "NearPost" | "FarPost" | "Center";

/**
 * Height component of a shot profile.
 */
export type FuturebolShotHeight = "Low" | "Medium" | "High";

/**
 * Complete shot profile: lateral placement, height, and power.
 * Power influences parry probability and visual effects.
 */
export interface FuturebolShotProfile {
    readonly lateral: FuturebolShotLateral;
    readonly height: FuturebolShotHeight;
    readonly power: number;
}

/**
 * Interception plan computed ONCE at the start of a pass.
 * Checked during flight by comparing ball progress >= interceptionAlong.
 * This prevents per-frame accumulation and ensures frame-rate independence.
 */
export interface FuturebolInterceptionPlan {
    readonly willIntercept: boolean;
    readonly interceptorId: string | null;
    readonly interceptionAlong: number;
    readonly interceptionPoint: FuturebolVector3State;
    readonly distanceToLine: number;
}

/**
 * Shot resolution plan computed ONCE at launchShot().
 * Contains the shot profile and parry decision.
 * The parry decision is deterministic and frame-rate independent.
 */
export interface FuturebolShotResolutionPlan {
    readonly profile: FuturebolShotProfile;
    readonly willParry: boolean;
}

/**
 * A pending branch that waits for physical LooseBall recovery
 * before injecting continuation actions.
 * This is the ONLY authority for continuation injection.
 */
export interface FuturebolPendingBranch {
    readonly reason: "Interception" | "Parry";
    readonly requiredTeam: FuturebolTeam | null;
}

/**
 * Official goal safety mechanism.
 * When active, the specified team MUST be the one to score.
 * Interceptions and parries can happen visually, but the
 * attacking team always recovers and the final shot is forced to Goal.
 */
export interface FuturebolRequiredOutcome {
    readonly outcome: "Goal" | "Saved";
    readonly team: FuturebolTeam;
    readonly active: boolean;
}

/**
 * Maximum number of branches allowed per scenario.
 * Prevents infinite parry/recovery loops.
 *
 * Example max path:
 *   Pass deflected → recovery → Shot parried → recovery → second shot → done
 */
export const MAX_SCENARIO_BRANCHES = 2;
