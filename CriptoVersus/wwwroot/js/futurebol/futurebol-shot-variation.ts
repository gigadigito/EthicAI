import type { FuturebolVector3State } from "./futurebol-types.js";
import type {
    FuturebolShotHeight,
    FuturebolShotLateral,
    FuturebolShotProfile
} from "./futurebol-possession-types.js";

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

function deterministicSigned(seed: number, salt: number): number {
    return deterministicUnit(seed, salt) * 2 - 1;
}

/**
 * Selects a shot profile based on attacker position, attack direction,
 * attacking advantage, and deterministic seed.
 *
 * Lateral: influenced by attacker Z position relative to attack direction.
 * Height: independent deterministic roll.
 * Power: influenced by attacking advantage + deterministic component.
 */
export function selectShotProfile(
    attackerZ: number,
    attackDir: number,
    advantage: number,
    seed: number,
    salt: number
): FuturebolShotProfile {
    const lateral = selectLateral(attackerZ, attackDir, seed, salt);
    const height = selectHeight(seed, salt + 1);
    const power = selectPower(advantage, seed, salt + 2);

    return { lateral, height, power };
}

function selectLateral(
    attackerZ: number,
    attackDir: number,
    seed: number,
    salt: number
): FuturebolShotLateral {
    const relativeZ = attackerZ * attackDir;
    const roll = deterministicUnit(seed, salt);

    if (relativeZ > 1.5) {
        if (roll < 0.40) return "NearPost";
        if (roll < 0.70) return "Center";
        return "FarPost";
    }

    if (relativeZ < -1.5) {
        if (roll < 0.40) return "FarPost";
        if (roll < 0.70) return "Center";
        return "NearPost";
    }

    if (roll < 0.33) return "NearPost";
    if (roll < 0.66) return "Center";
    return "FarPost";
}

function selectHeight(seed: number, salt: number): FuturebolShotHeight {
    const roll = deterministicUnit(seed, salt);
    if (roll < 0.55) return "Low";
    if (roll < 0.82) return "Medium";
    return "High";
}

function selectPower(advantage: number, seed: number, salt: number): number {
    const deterministic = deterministicUnit(seed, salt);
    return clamp(0.5 + advantage * 0.3 + deterministic * 0.2, 0.3, 1.0);
}

/**
 * Maps a FuturebolShotProfile to concrete ball target coordinates.
 *
 * @param profile - shot lateral/height/power
 * @param attackDir - +1 for home, -1 for away
 * @param shotPlacement - base z placement from playPlan
 * @returns target position { x, y, z } for the shot
 */
export function computeShotTarget(
    profile: FuturebolShotProfile,
    attackDir: number,
    shotPlacement: number
): { x: number; y: number; z: number } {
    const GOAL_LINE_X = 25;
    const GOAL_HALF_WIDTH = 3.5;

    const lateralZ = computeLateralZ(profile.lateral, shotPlacement, GOAL_HALF_WIDTH);
    const heightY = computeHeightY(profile.height);
    const powerOffset = computePowerOffset(profile.power);

    return {
        x: attackDir * (GOAL_LINE_X + powerOffset),
        y: heightY,
        z: lateralZ
    };
}

function computeLateralZ(
    lateral: FuturebolShotLateral,
    shotPlacement: number,
    goalHalfWidth: number
): number {
    switch (lateral) {
        case "NearPost":
            return clamp(shotPlacement * 0.3, -goalHalfWidth + 0.5, goalHalfWidth - 0.5);
        case "FarPost":
            return clamp(
                Math.sign(shotPlacement) * goalHalfWidth * 0.85 + shotPlacement * 0.15,
                -goalHalfWidth + 0.5,
                goalHalfWidth - 0.5
            );
        case "Center":
            return clamp(shotPlacement * 0.1, -goalHalfWidth + 1.0, goalHalfWidth - 1.0);
    }
}

function computeHeightY(height: FuturebolShotHeight): number {
    switch (height) {
        case "Low": return 0.35;
        case "Medium": return 0.65;
        case "High": return 1.35;
    }
}

function computePowerOffset(power: number): number {
    return power * 1.35;
}

/**
 * Computes goalkeeper dive target based on the actual shot destination.
 *
 * The goalkeeper moves toward the shot but not all the way (realistic
 * — goalkeepers don't teleport). The dive direction is determined by
 * the lateral relationship between shot and goalkeeper.
 */
export function computeGoalkeeperDiveTarget(
    shotEndZ: number,
    goalkeeperZ: number,
    _attackDir: number
): { targetZ: number; diveDirection: "left" | "right" | "center" } {
    const lateralDiff = shotEndZ - goalkeeperZ;
    const targetZ = goalkeeperZ + lateralDiff * 0.75;

    const diveDirection =
        lateralDiff > 0.3 ? "right" :
        lateralDiff < -0.3 ? "left" :
        "center";

    return { targetZ, diveDirection };
}
