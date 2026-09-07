import type {
    FuturebolPlayPhase,
    FuturebolPlayOutcome,
    FuturebolPlayerState,
    FuturebolQuality,
    FuturebolTeam,
    FuturebolVector3State
} from "./futurebol-types.js";

/**
 * Camera modes for the broadcast-like presentation.
 */
export type CameraMode =
    | "Broadcast"
    | "BuildUp"
    | "Attack"
    | "ShotPreparation"
    | "ShotTracking"
    | "GoalCelebration"
    | "GoalkeeperSave"
    | "Parry"
    | "Recovery";

/**
 * Camera focus target.
 */
export type CameraFocus =
    | "ball"
    | "shooter"
    | "goalkeeper"
    | "midfield"
    | "goal";

/**
 * Input to the Camera Director each frame.
 *
 * Only the fields the director needs to reason about are included.
 * The match state is NOT exposed directly.
 */
export interface CameraDirectorInput {
    readonly phase: FuturebolPlayPhase;
    readonly outcome: FuturebolPlayOutcome | null;
    readonly activeTeam: FuturebolTeam | null;
    readonly ballPosition: Readonly<FuturebolVector3State>;
    readonly ballVelocity: Readonly<FuturebolVector3State>;
    readonly ballOwnerId: string | null;
    readonly lastShooterId: string | null;
    readonly players: readonly FuturebolPlayerState[];
    readonly pressure: number;
    readonly quality: FuturebolQuality;
    readonly reducedMotion: boolean;
    readonly phaseElapsed: number;
    readonly goalHoldDuration: number;
    readonly saveHoldDuration: number;
    readonly goalkeeperIntent: string | null;
    readonly goalkeeperDiveDirection: "left" | "right" | "center" | null;
    readonly shotPower: number | null;
    readonly shotOrdinal: number;
}

/**
 * Output produced by the Camera Director each frame.
 *
 * This is consumed by FuturebolCamera for interpolation and blending.
 */
export interface CameraModeOutput {
    readonly mode: CameraMode;
    readonly positionX: number;
    readonly positionY: number;
    readonly positionZ: number;
    readonly targetX: number;
    readonly targetY: number;
    readonly targetZ: number;
    readonly fov: number;
    readonly shake: CameraShake | null;
    readonly focus: CameraFocus;
    readonly holdRemaining: number;
    readonly transitionProgress: number;
    readonly diagnostics: CameraDirectorDiagnostics;
}

export interface CameraShake {
    readonly intensity: number;
    readonly frequency: number;
}

export interface CameraDirectorDiagnostics {
    readonly mode: CameraMode;
    readonly focus: CameraFocus;
    readonly fov: number;
    readonly holdRemaining: number;
    readonly transitionProgress: number;
    readonly shakeIntensity: number;
    readonly frameCount: number;
    readonly lastModeChangeFrame: number;
}

/**
 * Minimum duration a camera mode must remain active before switching.
 * Prevents flicker during rapid phase changes.
 */
const MINIMUM_MODE_DURATION_SECONDS = 0.35;

/**
 * Hold duration for goal celebration camera.
 */
const GOAL_CELEBRATION_HOLD_SECONDS = 2.0;

/**
 * Hold duration for goalkeeper save camera.
 */
const GK_SAVE_HOLD_SECONDS = 1.2;

/**
 * Hold duration for parry camera.
 */
const PARRY_HOLD_SECONDS = 0.9;

/**
 * Hold duration for recovery camera after goal/save.
 */
const RECOVERY_HOLD_SECONDS = 1.0;

/**
 * Transition duration between camera modes.
 */
const TRANSITION_DURATION_SECONDS = 0.45;

/**
 * Micro-shake intensity for high-power shots.
 */
const MICRO_SHAKE_INTENSITY_SHOT = 0.012;

/**
 * Micro-shake intensity for goals.
 */
const MICRO_SHAKE_INTENSITY_GOAL = 0.018;

/**
 * Micro-shake frequency.
 */
const MICRO_SHAKE_FREQUENCY = 18;

/**
 * Attack direction multiplier for attack camera.
 */
const ATTACK_LEAD_FACTOR = 2.8;

/**
 * Default broadcast camera parameters.
 */
const BROADCAST_DEFAULTS = {
    positionY: 21.4,
    positionZ: -32.4,
    targetY: 0.82,
    targetZ: 0,
    fov: 0.765,
    responsiveness: 0.9
};

/**
 * FuturebolCameraDirector — produces per-frame camera mode, focus, and target
 * information for the broadcast-like presentation.
 *
 * The director never modifies gameplay, score, or match state.
 * It only produces camera intentions that FuturebolCamera consumes for
 * interpolation and movement.
 *
 * Ownership model:
 * - During Neutral/Cooldown → "Broadcast"
 * - During BuildUp → "BuildUp"
 * - During Passing/Attacking → "Attack"
 * - During PreparingShot → "ShotPreparation"
 * - During Shooting → "ShotTracking"
 * - During Outcome (Goal) → "GoalCelebration"
 * - During Outcome (Saved) → "GoalkeeperSave" or "Parry"
 * - After outcome hold → "Recovery" → "Broadcast"
 */
export class FuturebolCameraDirector {
    private currentMode: CameraMode = "Broadcast";
    private previousMode: CameraMode = "Broadcast";
    private modeElapsed = 0;
    private holdRemaining = 0;
    private transitionElapsed = 0;
    private frameCount = 0;
    private lastModeChangeFrame = 0;
    private currentFocus: CameraFocus = "ball";
    private currentFov = BROADCAST_DEFAULTS.fov;
    private currentShake: CameraShake | null = null;
    private shakeElapsed = 0;
    private goalScoredThisPhase = false;
    private lastGoalTeam: FuturebolTeam | null = null;
    private lastGoalShooterId: string | null = null;

    /**
     * Main entry point.  Called once per frame.
     */
    public compute(ctx: CameraDirectorInput): CameraModeOutput {
        this.frameCount += 1;
        this.modeElapsed += 0.016; // Approximate frame time; actual delta handled by caller
        this.transitionElapsed += 0.016;

        const previousMode = this.currentMode;

        // Detect phase transitions and decide new mode
        const newMode = this.resolveMode(ctx);
        const newFocus = this.resolveFocus(ctx, newMode);

        if (newMode !== this.currentMode) {
            this.previousMode = this.currentMode;
            this.currentMode = newMode;
            this.modeElapsed = 0;
            this.transitionElapsed = 0;
            this.lastModeChangeFrame = this.frameCount;
        }

        this.currentFocus = newFocus;

        // Compute camera targets based on mode
        const targets = this.computeTargets(ctx, newMode, newFocus);

        // Compute shake
        this.updateShake(ctx, newMode);

        // Compute hold remaining
        this.updateHoldRemaining(ctx, newMode);

        // Compute transition progress
        const transitionProgress = this.computeTransitionProgress();

        return {
            mode: this.currentMode,
            positionX: targets.positionX,
            positionY: targets.positionY,
            positionZ: targets.positionZ,
            targetX: targets.targetX,
            targetY: targets.targetY,
            targetZ: targets.targetZ,
            fov: targets.fov,
            shake: this.currentShake,
            focus: this.currentFocus,
            holdRemaining: this.holdRemaining,
            transitionProgress,
            diagnostics: {
                mode: this.currentMode,
                focus: this.currentFocus,
                fov: Math.round(this.currentFov * 1000) / 1000,
                holdRemaining: Math.round(this.holdRemaining * 100) / 100,
                transitionProgress: Math.round(transitionProgress * 100) / 100,
                shakeIntensity: this.currentShake?.intensity ?? 0,
                frameCount: this.frameCount,
                lastModeChangeFrame: this.lastModeChangeFrame
            }
        };
    }

    /**
     * Reset all internal state.  Called when a new match starts.
     */
    public reset(): void {
        this.currentMode = "Broadcast";
        this.previousMode = "Broadcast";
        this.modeElapsed = 0;
        this.holdRemaining = 0;
        this.transitionElapsed = 0;
        this.frameCount = 0;
        this.lastModeChangeFrame = 0;
        this.currentFocus = "ball";
        this.currentFov = BROADCAST_DEFAULTS.fov;
        this.currentShake = null;
        this.shakeElapsed = 0;
        this.goalScoredThisPhase = false;
        this.lastGoalTeam = null;
        this.lastGoalShooterId = null;
    }

    /**
     * Update with actual delta seconds for accurate timing.
     */
    public updateDelta(deltaSeconds: number): void {
        const safeDelta = clamp(deltaSeconds, 0, 0.1);
        this.modeElapsed += safeDelta;
        this.transitionElapsed += safeDelta;
        this.shakeElapsed += safeDelta;
    }

    private resolveMode(ctx: CameraDirectorInput): CameraMode {
        // Check hold timer — if we're still holding, keep current mode
        if (this.holdRemaining > 0 && this.modeElapsed < MINIMUM_MODE_DURATION_SECONDS) {
            return this.currentMode;
        }

        switch (ctx.phase) {
            case "Neutral":
            case "Cooldown":
            case "Resetting":
                return "Broadcast";

            case "BuildUp":
                return "BuildUp";

            case "Passing":
            case "Attacking":
                return "Attack";

            case "PreparingShot":
                return "ShotPreparation";

            case "Shooting":
                return "ShotTracking";

            case "Outcome":
                return this.resolveOutcomeMode(ctx);

            default:
                return "Broadcast";
        }
    }

    private resolveOutcomeMode(ctx: CameraDirectorInput): CameraMode {
        if (ctx.outcome === "Goal") {
            // Track goal scored in this phase
            if (!this.goalScoredThisPhase) {
                this.goalScoredThisPhase = true;
                this.lastGoalTeam = ctx.activeTeam;
                this.lastGoalShooterId = ctx.lastShooterId;
            }

            // Check if we're still in goal hold period
            if (ctx.phaseElapsed < ctx.goalHoldDuration) {
                return "GoalCelebration";
            }

            // After goal hold, transition to recovery
            return "Recovery";
        }

        // Saved outcome
        if (ctx.outcome === "Saved") {
            // Check if goalkeeper is diving (parry vs save)
            if (ctx.goalkeeperIntent === "DiveLeft" || ctx.goalkeeperIntent === "DiveRight" || ctx.goalkeeperIntent === "Parry") {
                if (ctx.phaseElapsed < ctx.saveHoldDuration) {
                    return "Parry";
                }
            }

            if (ctx.phaseElapsed < ctx.saveHoldDuration) {
                return "GoalkeeperSave";
            }

            return "Recovery";
        }

        return "Broadcast";
    }

    private resolveFocus(
        ctx: CameraDirectorInput,
        mode: CameraMode
    ): CameraFocus {
        switch (mode) {
            case "GoalCelebration":
                return "shooter";

            case "GoalkeeperSave":
            case "Parry":
                return "goalkeeper";

            case "ShotTracking":
                return "ball";

            case "ShotPreparation":
                return "shooter";

            case "Recovery":
                return "midfield";

            case "BuildUp":
            case "Attack":
                return ctx.ballOwnerId ? "ball" : "midfield";

            case "Broadcast":
                return "midfield";

            default:
                return "ball";
        }
    }

    private computeTargets(
        ctx: CameraDirectorInput,
        mode: CameraMode,
        focus: CameraFocus
    ): {
        positionX: number;
        positionY: number;
        positionZ: number;
        targetX: number;
        targetY: number;
        targetZ: number;
        fov: number;
    } {
        const direction = ctx.activeTeam === "home"
            ? 1
            : ctx.activeTeam === "away"
                ? -1
                : Math.sign(ctx.pressure);

        const velocityLead = clamp(ctx.ballVelocity.x * 0.36, -2.2, 2.2);
        const lateralLead = clamp(ctx.ballVelocity.z * 0.2, -0.9, 0.9);

        switch (mode) {
            case "Broadcast":
                return this.broadcastTargets(ctx, direction);

            case "BuildUp":
                return this.buildUpTargets(ctx, direction, velocityLead, lateralLead);

            case "Attack":
                return this.attackTargets(ctx, direction, velocityLead, lateralLead);

            case "ShotPreparation":
                return this.shotPrepTargets(ctx, direction, velocityLead, lateralLead);

            case "ShotTracking":
                return this.shotTrackingTargets(ctx, direction, velocityLead, lateralLead);

            case "GoalCelebration":
                return this.goalCelebrationTargets(ctx, direction);

            case "GoalkeeperSave":
            case "Parry":
                return this.gkSaveTargets(ctx, direction);

            case "Recovery":
                return this.recoveryTargets(ctx, direction);

            default:
                return this.broadcastTargets(ctx, direction);
        }
    }

    private broadcastTargets(
        ctx: CameraDirectorInput,
        direction: number
    ): {
        positionX: number;
        positionY: number;
        positionZ: number;
        targetX: number;
        targetY: number;
        targetZ: number;
        fov: number;
    } {
        const reducedMotion = ctx.reducedMotion;

        return {
            positionX: clamp(ctx.pressure * 1.2, -1.6, 1.6),
            positionY: BROADCAST_DEFAULTS.positionY,
            positionZ: BROADCAST_DEFAULTS.positionZ,
            targetX: clamp(ctx.pressure * 1.6, -2.1, 2.1),
            targetY: BROADCAST_DEFAULTS.targetY,
            targetZ: BROADCAST_DEFAULTS.targetZ,
            fov: reducedMotion ? 0.78 : BROADCAST_DEFAULTS.fov
        };
    }

    private buildUpTargets(
        ctx: CameraDirectorInput,
        direction: number,
        velocityLead: number,
        lateralLead: number
    ): {
        positionX: number;
        positionY: number;
        positionZ: number;
        targetX: number;
        targetY: number;
        targetZ: number;
        fov: number;
    } {
        return {
            positionX: clamp(ctx.ballPosition.x * 0.4 + direction * 1.5, -11.5, 11.5),
            positionY: 20.6,
            positionZ: -30.8,
            targetX: clamp(ctx.ballPosition.x * 0.58 + direction * 2.1, -15, 15),
            targetY: 0.92,
            targetZ: clamp(ctx.ballPosition.z * 0.28, -3.3, 3.3),
            fov: ctx.reducedMotion ? 0.76 : 0.745
        };
    }

    private attackTargets(
        ctx: CameraDirectorInput,
        direction: number,
        velocityLead: number,
        lateralLead: number
    ): {
        positionX: number;
        positionY: number;
        positionZ: number;
        targetX: number;
        targetY: number;
        targetZ: number;
        fov: number;
    } {
        return {
            positionX: clamp(
                ctx.ballPosition.x * 0.58 + direction * ATTACK_LEAD_FACTOR + velocityLead,
                -14.2, 14.2
            ),
            positionY: 19.1,
            positionZ: -28.1,
            targetX: clamp(ctx.ballPosition.x * 0.76 + direction * 2.5, -17.8, 17.8),
            targetY: 1,
            targetZ: clamp(ctx.ballPosition.z * 0.4 + lateralLead, -4.5, 4.5),
            fov: ctx.reducedMotion ? 0.73 : 0.715
        };
    }

    private shotPrepTargets(
        ctx: CameraDirectorInput,
        direction: number,
        velocityLead: number,
        lateralLead: number
    ): {
        positionX: number;
        positionY: number;
        positionZ: number;
        targetX: number;
        targetY: number;
        targetZ: number;
        fov: number;
    } {
        // Tighter framing for shot preparation — show attacker + GK
        const shooter = ctx.lastShooterId
            ? ctx.players.find(p => p.id === ctx.lastShooterId) ?? null
            : null;

        const targetX = shooter
            ? clamp(shooter.position.x + direction * 2, -19, 19)
            : clamp(ctx.ballPosition.x * 0.84 + direction * 2.9, -19, 19);

        return {
            positionX: clamp(
                ctx.ballPosition.x * 0.7 + direction * 3.4 + velocityLead,
                -15.2, 15.2
            ),
            positionY: ctx.reducedMotion ? 18.6 : 17.6,
            positionZ: ctx.reducedMotion ? -27.4 : -25.9,
            targetX,
            targetY: 1.15,
            targetZ: clamp(ctx.ballPosition.z * 0.52 + lateralLead, -5.1, 5.1),
            fov: ctx.reducedMotion ? 0.705 : 0.675
        };
    }

    private shotTrackingTargets(
        ctx: CameraDirectorInput,
        direction: number,
        velocityLead: number,
        lateralLead: number
    ): {
        positionX: number;
        positionY: number;
        positionZ: number;
        targetX: number;
        targetY: number;
        targetZ: number;
        fov: number;
    } {
        // Follow ball trajectory during shot
        // Ball must remain visible — it's the narrative
        const ballLead = clamp(ctx.ballVelocity.x * 0.45, -3.5, 3.5);

        return {
            positionX: clamp(
                ctx.ballPosition.x * 0.65 + direction * 2.8 + ballLead,
                -16, 16
            ),
            positionY: ctx.reducedMotion ? 18.2 : 16.8,
            positionZ: ctx.reducedMotion ? -27.0 : -24.5,
            targetX: clamp(ctx.ballPosition.x + direction * 1.5, -20, 20),
            targetY: 1.2,
            targetZ: clamp(ctx.ballPosition.z + lateralLead, -5.5, 5.5),
            fov: ctx.reducedMotion ? 0.69 : 0.65
        };
    }

    private goalCelebrationTargets(
        ctx: CameraDirectorInput,
        direction: number
    ): {
        positionX: number;
        positionY: number;
        positionZ: number;
        targetX: number;
        targetY: number;
        targetZ: number;
        fov: number;
    } {
        // Focus on the scorer/attacker
        const scorer = this.lastGoalShooterId
            ? ctx.players.find(p => p.id === this.lastGoalShooterId) ?? null
            : null;

        const focusX = scorer
            ? scorer.position.x
            : ctx.ballPosition.x;

        const focusZ = scorer
            ? scorer.position.z
            : 0;

        return {
            positionX: clamp(focusX + direction * 3, -20, 20),
            positionY: 16.5,
            positionZ: -23.5,
            targetX: clamp(focusX, -20, 20),
            targetY: 1.8,
            targetZ: clamp(focusZ, -6, 6),
            fov: ctx.reducedMotion ? 0.68 : 0.62
        };
    }

    private gkSaveTargets(
        ctx: CameraDirectorInput,
        direction: number
    ): {
        positionX: number;
        positionY: number;
        positionZ: number;
        targetX: number;
        targetY: number;
        targetZ: number;
        fov: number;
    } {
        // Focus on the goalkeeper to showcase the save
        const goalkeeper = ctx.players.find(p => p.role === "goalkeeper" && p.team !== ctx.activeTeam) ?? null;

        const gkX = goalkeeper ? goalkeeper.position.x : (ctx.activeTeam === "home" ? -21.2 : 21.2);
        const gkZ = goalkeeper ? goalkeeper.position.z : 0;

        return {
            positionX: clamp(gkX + direction * 4, -20, 20),
            positionY: 17.0,
            positionZ: -24.0,
            targetX: clamp(gkX, -20, 20),
            targetY: 1.4,
            targetZ: clamp(gkZ, -5, 5),
            fov: ctx.reducedMotion ? 0.68 : 0.64
        };
    }

    private recoveryTargets(
        ctx: CameraDirectorInput,
        direction: number
    ): {
        positionX: number;
        positionY: number;
        positionZ: number;
        targetX: number;
        targetY: number;
        targetZ: number;
        fov: number;
    } {
        // Transitioning back to broadcast — wider view
        return {
            positionX: clamp(ctx.ballPosition.x * 0.3, -8, 8),
            positionY: 20.2,
            positionZ: -30.5,
            targetX: clamp(ctx.ballPosition.x * 0.4, -10, 10),
            targetY: 0.88,
            targetZ: clamp(ctx.ballPosition.z * 0.2, -2.5, 2.5),
            fov: 0.74
        };
    }

    private updateShake(ctx: CameraDirectorInput, mode: CameraMode): void {
        if (ctx.reducedMotion || ctx.quality === "Low") {
            this.currentShake = null;
            return;
        }

        // Micro-shake during shooting (high power)
        if (mode === "ShotTracking" && ctx.shotPower && ctx.shotPower > 0.7) {
            const intensity = MICRO_SHAKE_INTENSITY_SHOT * ctx.shotPower;
            this.currentShake = {
                intensity,
                frequency: MICRO_SHAKE_FREQUENCY
            };
            return;
        }

        // Micro-shake during goal celebration
        if (mode === "GoalCelebration" && ctx.phaseElapsed < 0.5) {
            this.currentShake = {
                intensity: MICRO_SHAKE_INTENSITY_GOAL,
                frequency: MICRO_SHAKE_FREQUENCY
            };
            return;
        }

        // Fade out shake
        if (this.currentShake) {
            const fadeout = 1 - Math.min(1, ctx.phaseElapsed / 0.5);
            if (fadeout <= 0) {
                this.currentShake = null;
            } else {
                this.currentShake = {
                    intensity: this.currentShake.intensity * fadeout,
                    frequency: this.currentShake.frequency
                };
            }
        }
    }

    private updateHoldRemaining(ctx: CameraDirectorInput, mode: CameraMode): void {
        switch (mode) {
            case "GoalCelebration":
                this.holdRemaining = Math.max(0, ctx.goalHoldDuration - ctx.phaseElapsed);
                break;

            case "GoalkeeperSave":
                this.holdRemaining = Math.max(0, ctx.saveHoldDuration - ctx.phaseElapsed);
                break;

            case "Parry":
                this.holdRemaining = Math.max(0, PARRY_HOLD_SECONDS - ctx.phaseElapsed);
                break;

            case "Recovery":
                this.holdRemaining = Math.max(0, RECOVERY_HOLD_SECONDS - ctx.phaseElapsed);
                break;

            default:
                this.holdRemaining = Math.max(0, MINIMUM_MODE_DURATION_SECONDS - this.modeElapsed);
        }
    }

    private computeTransitionProgress(): number {
        if (this.transitionElapsed >= TRANSITION_DURATION_SECONDS) {
            return 1;
        }
        return clamp(this.transitionElapsed / TRANSITION_DURATION_SECONDS, 0, 1);
    }
}

function clamp(value: number, minimum: number, maximum: number): number {
    return Math.min(maximum, Math.max(minimum, value));
}
