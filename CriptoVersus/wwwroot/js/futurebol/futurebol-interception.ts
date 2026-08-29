import type {
    FuturebolPlayerState,
    FuturebolTeam,
    FuturebolVector3State
} from "./futurebol-types.js";
import type {
    FuturebolInterceptionPlan,
    FuturebolShotProfile
} from "./futurebol-possession-types.js";

const INTERCEPTION_RANGE = 2.0;
const INTERCEPTION_AUTO_RANGE = 1.2;
const INTERCEPTION_MIN_ALONG = 0.15;
const INTERCEPTION_MAX_ALONG = 0.88;

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
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

function planarDistance(a: FuturebolVector3State, b: FuturebolVector3State): number {
    return Math.hypot(a.x - b.x, a.z - b.z);
}

/**
 * Computes the perpendicular distance and parametric position of a point
 * relative to a line segment from `start` to `end`.
 *
 * This is the same geometry used by `FuturebolPlayerAI.laneRisk()`.
 */
export function distanceToPassLine(
    playerPos: FuturebolVector3State,
    passStart: FuturebolVector3State,
    passEnd: FuturebolVector3State
): { distance: number; along: number } {
    const dx = passEnd.x - passStart.x;
    const dz = passEnd.z - passStart.z;
    const lengthSquared = dx * dx + dz * dz;

    const along = lengthSquared <= 0.0001
        ? 0
        : clamp(
            ((playerPos.x - passStart.x) * dx + (playerPos.z - passStart.z) * dz) /
            lengthSquared,
            0,
            1
        );

    const nearestX = passStart.x + dx * along;
    const nearestZ = passStart.z + dz * along;

    return {
        distance: Math.hypot(playerPos.x - nearestX, playerPos.z - nearestZ),
        along
    };
}

/**
 * Builds an interception plan ONCE at the start of a pass.
 *
 * This is frame-rate independent: the plan is resolved once using the seed,
 * and during flight, the match state simply checks:
 *   ballProgress >= plan.interceptionAlong
 *
 * The deterministic roll uses `seed` and `salt` (derived from playIndex),
 * NOT `phaseElapsed` or frame count.
 */
export function buildInterceptionPlan(
    players: readonly FuturebolPlayerState[],
    passStart: FuturebolVector3State,
    passEnd: FuturebolVector3State,
    intendedReceiverId: string,
    attackingTeam: FuturebolTeam,
    seed: number,
    salt: number
): FuturebolInterceptionPlan {
    let bestCandidate: FuturebolPlayerState | null = null;
    let bestDistance = INTERCEPTION_RANGE;

    for (const player of players) {
        if (player.id === intendedReceiverId) continue;
        if (player.team === attackingTeam) continue;
        if (player.role === "goalkeeper") continue;

        const projection = distanceToPassLine(player.position, passStart, passEnd);

        if (projection.along <= INTERCEPTION_MIN_ALONG || projection.along >= INTERCEPTION_MAX_ALONG) {
            continue;
        }

        if (projection.distance < bestDistance) {
            bestDistance = projection.distance;
            bestCandidate = player;
        }
    }

    if (!bestCandidate) {
        return {
            willIntercept: false,
            interceptorId: null,
            interceptionAlong: 1,
            interceptionPoint: { x: passEnd.x, y: 0, z: passEnd.z },
            distanceToLine: INTERCEPTION_RANGE
        };
    }

    const projection = distanceToPassLine(bestCandidate.position, passStart, passEnd);

    let willIntercept: boolean;
    if (projection.distance < INTERCEPTION_AUTO_RANGE) {
        willIntercept = true;
    } else {
        const interceptionChance = clamp(
            (INTERCEPTION_RANGE - projection.distance) / (INTERCEPTION_RANGE - INTERCEPTION_AUTO_RANGE) * 0.7,
            0,
            0.7
        );
        const roll = deterministicUnit(seed, salt);
        willIntercept = roll < interceptionChance;
    }

    const ix = passStart.x + (passEnd.x - passStart.x) * projection.along;
    const iz = passStart.z + (passEnd.z - passStart.z) * projection.along;

    return {
        willIntercept,
        interceptorId: willIntercept ? bestCandidate.id : null,
        interceptionAlong: projection.along,
        interceptionPoint: { x: ix, y: 0, z: iz },
        distanceToLine: projection.distance
    };
}

/**
 * Evaluates whether a shot should result in a parry.
 *
 * Called ONCE at launchShot() time, NOT per-frame.
 * Uses deterministic seed + salt for frame-rate independence.
 *
 * @param shotProfile - the shot's lateral/height/power characteristics
 * @param shotEndZ - actual shot target Z position
 * @param goalkeeperZ - goalkeeper's current Z position
 * @param seed - deterministic seed
 * @param salt - unique salt for this evaluation
 */
export function evaluateParry(
    shotProfile: FuturebolShotProfile,
    shotEndZ: number,
    goalkeeperZ: number,
    seed: number,
    salt: number
): boolean {
    const shotOffCenter = Math.abs(shotEndZ) / 3.0;
    const gkPositioning = Math.abs(shotEndZ - goalkeeperZ) / 3.5;
    const shotPower = shotProfile.power;

    const parryChance = clamp(
        shotPower * 0.3 +
        shotOffCenter * 0.25 +
        gkPositioning * 0.2,
        0.12,
        0.52
    );

    const roll = deterministicUnit(seed, salt);
    return roll < parryChance;
}
