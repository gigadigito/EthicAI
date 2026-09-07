import type {
    FuturebolPlayPhase,
    FuturebolPlayerState,
    FuturebolTeam,
    FuturebolVector3State
} from "./futurebol-types.js";
import type {
    FuturebolShotLateral,
    FuturebolShotProfile
} from "./futurebol-possession-types.js";
import { FUTUREBOL_FIELD } from "./futurebol-match-rules.js";

const GOAL_X = FUTUREBOL_FIELD.goalLineX;
const GOAL_HALF_WIDTH = FUTUREBOL_FIELD.goalHalfWidth;

/**
 * Goalkeeper intent states.
 *
 * Each frame, the GoalkeeperAI produces exactly one intent that the match
 * state and animation system consume.  The intent drives target position,
 * dive direction and animation.
 */
export type GoalkeeperIntent =
    | "HoldCenter"
    | "TrackBall"
    | "SetPosition"
    | "Anticipate"
    | "DiveLeft"
    | "DiveRight"
    | "Save"
    | "Parry"
    | "Recover";

/**
 * Context passed to the GoalkeeperAI every frame.
 *
 * Only the fields the goalkeeper needs to reason about are included.
 * The match state is NOT exposed here.
 */
export interface GoalkeeperContext {
    readonly team: FuturebolTeam;
    readonly goalkeeper: FuturebolPlayerState;

    readonly ballPosition: Readonly<FuturebolVector3State>;
    readonly ballVelocity: Readonly<FuturebolVector3State>;

    readonly attackingTeam: FuturebolTeam | null;
    readonly ballOwnerId: string | null;

    readonly phase: FuturebolPlayPhase;
    readonly phaseElapsed: number;

    readonly shotProfile: FuturebolShotProfile | null;
    readonly shotEndZ: number | null;

    readonly seed: number;
    readonly playIndex: number;
}

/**
 * Output produced by the GoalkeeperAI each frame.
 */
export interface GoalkeeperIntentOutput {
    readonly intent: GoalkeeperIntent;
    readonly targetX: number;
    readonly targetZ: number;
    readonly diveDirection: "left" | "right" | "center";
    readonly reactionDelay: number;
    readonly speedFactor: number;
    readonly diagnostics: GoalkeeperDiagnostics;
}

export interface GoalkeeperDiagnostics {
    readonly intent: GoalkeeperIntent;
    readonly owner: "GoalkeeperAI";
    readonly ballAngle: number;
    readonly targetOffset: number;
    readonly reactionDelay: number;
    readonly shotSide: "left" | "right" | "center";
    readonly expectedDive: "left" | "right" | "center";
    readonly depthRatio: number;
}

function clamp(value: number, minimum: number, maximum: number): number {
    return Math.min(maximum, Math.max(minimum, value));
}

function deterministicUnit(seed: number, salt: number): number {
    let value = (seed ^ Math.imul(salt, 0x9e3779b1)) >>> 0;
    value ^= value >>> 16;
    value = Math.imul(value, 0x7feb352d);
    value ^= value >>> 15;
    value = Math.imul(value, 0x846ca68b);
    value ^= value >>> 16;
    return (value >>> 0) / 4294967295;
}

function planarDistance(
    a: Readonly<FuturebolVector3State>,
    b: Readonly<FuturebolVector3State>
): number {
    return Math.hypot(a.x - b.x, a.z - b.z);
}

function attackDirection(team: FuturebolTeam): number {
    return team === "home" ? 1 : -1;
}

function opponent(team: FuturebolTeam): FuturebolTeam {
    return team === "home" ? "away" : "home";
}

/**
 * Maps a FuturebolShotLateral to a concrete lateral offset within the goal.
 */
function lateralToGoalZ(lateral: FuturebolShotLateral): number {
    switch (lateral) {
        case "NearPost": return -GOAL_HALF_WIDTH * 0.72;
        case "FarPost": return GOAL_HALF_WIDTH * 0.72;
        case "Center": return 0;
    }
}

/**
 * Maps a shot lateral to a dive direction relative to the goalkeeper.
 * The goalkeeper faces the field (toward the attacker), so left/right
 * are inverted relative to the shot lateral.
 */
function shotSideToDive(
    lateral: FuturebolShotLateral,
    attackDir: number,
    goalkeeperZ: number
): "left" | "right" | "center" {
    const shotGoalZ = lateralToGoalZ(lateral) * attackDir;
    const diff = shotGoalZ - goalkeeperZ;
    if (Math.abs(diff) < 0.4) return "center";
    return diff > 0 ? "right" : "left";
}

/**
 * Core angle-based tracking.
 *
 * Computes where the goalkeeper should be on the goal line to reduce
 * the shooting angle.  Closer ball → more precise tracking.  Farther
 * ball → more centralized.
 *
 * The goalkeeper moves along the goal line (z axis) toward the
 * projection of the ball position onto the goal line, weighted by
 * the depth ratio.
 */
function computeAngleTracking(
    ballPosition: Readonly<FuturebolVector3State>,
    goalkeeperBaseX: number,
    goalkeeperBaseZ: number
): { targetZ: number; depthRatio: number } {
    const distToBall = Math.abs(ballPosition.x - goalkeeperBaseX);
    const maxDist = GOAL_X * 2;
    const depthRatio = clamp(1 - distToBall / maxDist, 0.15, 1);

    const lateralWeight = depthRatio * 0.82;
    const targetZ = clamp(
        ballPosition.z * lateralWeight,
        -GOAL_HALF_WIDTH + 0.5,
        GOAL_HALF_WIDTH - 0.5
    );

    return { targetZ, depthRatio };
}

/**
 * Computes the goalkeeper's depth (x-axis) offset from the goal line.
 *
 * When the ball is close, the goalkeeper pushes forward slightly to
 * narrow the angle.  When far, stays near the line.
 */
function computeDepthOffset(
    ballPosition: Readonly<FuturebolVector3State>,
    attackDir: number,
    depthRatio: number
): number {
    const pushForward = depthRatio * 1.6;
    return attackDir * pushForward;
}

/**
 * Deterministic reaction delay based on shot characteristics.
 *
 * Closer shots → faster reaction.  Higher power → slightly faster
 * (adrenaline).  Range: 0.08 – 0.18 seconds.
 */
function computeReactionDelay(
    shotProfile: FuturebolShotProfile,
    distanceToGoal: number,
    seed: number,
    playIndex: number
): number {
    const distFactor = clamp(distanceToGoal / 25, 0, 1);
    const powerFactor = shotProfile.power;

    const baseDelay = 0.08 + distFactor * 0.08 + (1 - powerFactor) * 0.02;

    const jitter = deterministicUnit(seed, playIndex * 97 + 31) * 0.03;

    return clamp(baseDelay + jitter, 0.08, 0.18);
}

/**
 * GoalkeeperAI — produces per-frame intents for the defending goalkeeper.
 *
 * The AI never controls the match outcome.  It only produces visual
 * positioning and animation intentions that the match state consumes.
 *
 * Ownership model:
 * - During Neutral / Cooldown → "HoldCenter" (TeamBehavior fallback)
 * - During BuildUp / Passing / Attacking → "TrackBall" / "Anticipate"
 * - During PreparingShot → "SetPosition"
 * - During Shooting → "DiveLeft" / "DiveRight" / "Save" / "Parry"
 * - After shot resolution → "Recover"
 */
export class GoalkeeperAI {
    private lastIntent: GoalkeeperIntent = "HoldCenter";
    private diveDirection: "left" | "right" | "center" = "center";
    private reactionDelay = 0;
    private shotElapsed = 0;
    private diveStarted = false;
    private recoveryElapsed = 0;
    private inRecovery = false;

    /**
     * Main entry point.  Called once per frame for each goalkeeper.
     */
    public computeIntent(ctx: GoalkeeperContext): GoalkeeperIntentOutput {
        const gk = ctx.goalkeeper;
        const attackingDir = attackDirection(opponent(gk.team));
        const baseX = gk.basePosition.x;
        const baseZ = gk.basePosition.z;

        const { targetZ: angleTargetZ, depthRatio } = computeAngleTracking(
            ctx.ballPosition,
            baseX,
            baseZ
        );

        const depthOffset = computeDepthOffset(
            ctx.ballPosition,
            attackingDir,
            depthRatio
        );

        const ballAngle = Math.atan2(
            ctx.ballPosition.z - gk.position.z,
            ctx.ballPosition.x - gk.position.x
        );

        let intent: GoalkeeperIntent;
        let targetX = baseX;
        let targetZ = baseZ;
        let speedFactor = 0.6;
        let diveDir: "left" | "right" | "center" = "center";
        let reactionDelayMs = 0;

        switch (ctx.phase) {
            case "Neutral":
            case "Cooldown":
            case "Resetting":
                intent = "HoldCenter";
                targetX = baseX;
                targetZ = baseZ;
                speedFactor = 0.4;
                this.resetState();
                break;

            case "BuildUp":
            case "Passing":
                intent = "TrackBall";
                targetX = baseX + depthOffset;
                targetZ = angleTargetZ;
                speedFactor = 0.55;
                break;

            case "Attacking":
                intent = this.computeAnticipation(ctx, baseX, baseZ, angleTargetZ, depthOffset, depthRatio);
                if (intent === "Anticipate") {
                    targetX = baseX + depthOffset * 1.4;
                    targetZ = angleTargetZ;
                    speedFactor = 0.65;
                } else {
                    targetX = baseX + depthOffset;
                    targetZ = angleTargetZ;
                    speedFactor = 0.55;
                }
                break;

            case "PreparingShot":
                intent = "SetPosition";
                targetX = baseX + depthOffset * 1.8;
                targetZ = angleTargetZ;
                speedFactor = 0.7;
                this.shotElapsed = 0;
                this.diveStarted = false;
                break;

            case "Shooting":
                ({
                    intent,
                    targetX,
                    targetZ,
                    diveDir,
                    reactionDelayMs,
                    speedFactor
                } = this.computeShooting(ctx, baseX, baseZ, angleTargetZ, attackingDir));
                break;

            case "Outcome":
                ({
                    intent,
                    targetX,
                    targetZ,
                    speedFactor
                } = this.computeOutcomeRecovery(ctx, baseX, baseZ));
                break;

            default:
                intent = "HoldCenter";
                targetX = baseX;
                targetZ = baseZ;
                speedFactor = 0.4;
        }

        this.lastIntent = intent;
        if (diveDir !== undefined) {
            this.diveDirection = diveDir;
        }
        this.reactionDelay = reactionDelayMs ?? this.reactionDelay;

        const shotSide = ctx.shotProfile
            ? shotSideToDive(ctx.shotProfile.lateral, attackingDir, gk.position.z)
            : "center";

        return {
            intent,
            targetX: clamp(targetX, baseX - 0.55, baseX + 0.55),
            targetZ: clamp(targetZ, -GOAL_HALF_WIDTH - 0.2, GOAL_HALF_WIDTH + 0.2),
            diveDirection: this.diveDirection,
            reactionDelay: this.reactionDelay,
            speedFactor,
            diagnostics: {
                intent,
                owner: "GoalkeeperAI",
                ballAngle: Math.round(ballAngle * 1000) / 1000,
                targetOffset: Math.round((angleTargetZ - baseZ) * 100) / 100,
                reactionDelay: Math.round(this.reactionDelay * 1000),
                shotSide,
                expectedDive: shotSide,
                depthRatio: Math.round(depthRatio * 100) / 100
            }
        };
    }

    /**
     * Reset all internal state.  Called when a new play starts.
     */
    public reset(): void {
        this.resetState();
    }

    /**
     * Returns true if the GoalkeeperAI is currently controlling this
     * goalkeeper (i.e., not in Neutral/Cooldown).
     */
    public isActiveFor(phase: FuturebolPlayPhase): boolean {
        return phase !== "Neutral" &&
            phase !== "Cooldown" &&
            phase !== "Resetting";
    }

    private resetState(): void {
        this.lastIntent = "HoldCenter";
        this.diveDirection = "center";
        this.reactionDelay = 0;
        this.shotElapsed = 0;
        this.diveStarted = false;
        this.recoveryElapsed = 0;
        this.inRecovery = false;
    }

    /**
     * During Attacking phase, decide whether to start anticipating.
     *
     * The goalkeeper begins adjusting position when the attacker
     * enters shooting range.  This is a visual pre-read, not an
     * outcome-determining action.
     */
    private computeAnticipation(
        ctx: GoalkeeperContext,
        _baseX: number,
        _baseZ: number,
        _angleTargetZ: number,
        _depthOffset: number,
        depthRatio: number
    ): GoalkeeperIntent {
        if (!ctx.ballOwnerId) return "TrackBall";

        const distToBall = planarDistance(ctx.ballPosition, ctx.goalkeeper.position);

        if (distToBall < 14 && depthRatio > 0.55) {
            return "Anticipate";
        }

        return "TrackBall";
    }

    /**
     * During Shooting phase, compute the dive and reaction.
     *
     * The goalkeeper reads the shot profile and ball trajectory to
     * determine dive direction and timing.  The actual dive happens
     * after a deterministic reaction delay.
     */
    private computeShooting(
        ctx: GoalkeeperContext,
        baseX: number,
        baseZ: number,
        angleTargetZ: number,
        attackingDir: number
    ): {
        intent: GoalkeeperIntent;
        targetX: number;
        targetZ: number;
        diveDir: "left" | "right" | "center";
        reactionDelayMs: number;
        speedFactor: number;
    } {
        this.shotElapsed += 0.1;

        const shotProfile = ctx.shotProfile;
        const gk = ctx.goalkeeper;

        if (!shotProfile) {
            return {
                intent: "SetPosition",
                targetX: baseX,
                targetZ: angleTargetZ,
                diveDir: "center",
                reactionDelayMs: 0,
                speedFactor: 0.6
            };
        }

        const distToGoal = Math.abs(ctx.ballPosition.x - baseX);

        if (!this.diveStarted) {
            this.reactionDelay = computeReactionDelay(
                shotProfile,
                distToGoal,
                ctx.seed,
                ctx.playIndex
            );
        }

        if (this.shotElapsed < this.reactionDelay && !this.diveStarted) {
            return {
                intent: "SetPosition",
                targetX: baseX + computeDepthOffset(ctx.ballPosition, attackingDir, 0.8),
                targetZ: angleTargetZ,
                diveDir: this.diveDirection,
                reactionDelayMs: this.reactionDelay,
                speedFactor: 0.65
            };
        }

        this.diveStarted = true;

        const shotGoalZ = lateralToGoalZ(shotProfile.lateral) * attackingDir;
        const lateralDiff = shotGoalZ - gk.position.z;

        let diveDir: "left" | "right" | "center";
        if (Math.abs(lateralDiff) < 0.4) {
            diveDir = "center";
        } else if (lateralDiff > 0) {
            diveDir = "right";
        } else {
            diveDir = "left";
        }

        this.diveDirection = diveDir;

        const diveTargetZ = gk.position.z + lateralDiff * 0.72;

        const intent: GoalkeeperIntent = diveDir === "left"
            ? "DiveLeft"
            : diveDir === "right"
                ? "DiveRight"
                : "Save";

        return {
            intent,
            targetX: baseX + computeDepthOffset(ctx.ballPosition, attackingDir, 0.4),
            targetZ: clamp(diveTargetZ, -GOAL_HALF_WIDTH - 0.2, GOAL_HALF_WIDTH + 0.2),
            diveDir,
            reactionDelayMs: this.reactionDelay,
            speedFactor: 0.85
        };
    }

    /**
     * After shot resolution, recover gradually to center.
     */
    private computeOutcomeRecovery(
        ctx: GoalkeeperContext,
        baseX: number,
        baseZ: number
    ): {
        intent: GoalkeeperIntent;
        targetX: number;
        targetZ: number;
        speedFactor: number;
    } {
        if (!this.inRecovery) {
            this.inRecovery = true;
            this.recoveryElapsed = 0;
        }

        this.recoveryElapsed += 0.1;

        const recoveryProgress = clamp(this.recoveryElapsed / 1.2, 0, 1);
        const eased = recoveryProgress * recoveryProgress * (3 - 2 * recoveryProgress);

        const targetX = baseX;
        const targetZ = baseZ + (this.lastIntent === "DiveLeft" || this.lastIntent === "DiveRight" || this.lastIntent === "Save" || this.lastIntent === "Parry"
            ? (0 - baseZ) * eased
            : 0);

        if (recoveryProgress >= 1) {
            return {
                intent: "HoldCenter",
                targetX: baseX,
                targetZ: baseZ,
                speedFactor: 0.4
            };
        }

        return {
            intent: "Recover",
            targetX,
            targetZ: clamp(targetZ, -GOAL_HALF_WIDTH, GOAL_HALF_WIDTH),
            speedFactor: 0.5
        };
    }
}
