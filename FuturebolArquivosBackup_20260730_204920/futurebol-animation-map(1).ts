import type {
    FuturebolPlayerState,
    FuturebolQuality,
    FuturebolVisualAnimationState,
    FuturebolVisualUpdateContext
} from "../futurebol-types.js";
export { FUTUREBOL_ACTION_TIMING, hasReachedContact } from "../futurebol-action-timing.js";

export interface FuturebolAnimationDefinition {
    candidates: readonly string[];
    loop: boolean;
    nominalDurationSeconds?: number;
}

export const FUTUREBOL_ANIMATION_MAP: Readonly<Record<FuturebolVisualAnimationState, FuturebolAnimationDefinition>> = {
    Idle: { candidates: ["Idle", "Standing"], loop: true },
    Walk: { candidates: ["Walking", "Running"], loop: true },
    Run: { candidates: ["Running", "Walking"], loop: true },
    Dribble: { candidates: ["Running", "Walking"], loop: true },
    Pass: { candidates: ["Punch", "Walking"], loop: false, nominalDurationSeconds: 0.78 },
    Shoot: { candidates: ["WalkJump", "Jump", "Punch"], loop: false, nominalDurationSeconds: 0.72 },
    GoalkeeperReady: { candidates: ["Standing", "Idle"], loop: true },
    GoalkeeperDiveLeft: { candidates: ["Death", "Jump"], loop: false, nominalDurationSeconds: 0.96 },
    GoalkeeperDiveRight: { candidates: ["Death", "Jump"], loop: false, nominalDurationSeconds: 0.96 },
    Celebrate: { candidates: ["ThumbsUp", "Yes", "Dance"], loop: false, nominalDurationSeconds: 1.58 },
    Disappointed: { candidates: ["No", "Death"], loop: false, nominalDurationSeconds: 1.66 }
};

export const FUTUREBOL_PLAYER_ASSET = Object.freeze({
    rootUrl: "/assets/futurebol/players/",
    fileName: "futurebol-humanoid.glb",
    timeoutMs: 8000,
    heightMeters: 3.25,
    scale: 0.98,
    yawOffsetRadians: Math.PI / 2,
    // Cabeça-moeda dimensionada em unidades do modelo GLB.
    // Os valores anteriores eram de poucos milímetros e deixavam o logo invisível.
    coinDiameter: 0.72,
    coinThickness: 0.14,
    coinLocalOffsetY: 0.12,
    coinSymbolSize: 0.53,
    coinSymbolSurfaceOffset: 0.012,
    headBoneCandidates: ["Head", "head", "mixamorig:Head", "mixamorigHead", "Bip001 Head"] as readonly string[],
    headMeshCandidates: ["Head", "head", "Wolf3D_Head"] as readonly string[],
    rootMotionCandidates: ["Bone", "Root", "root", "mixamorig:Hips", "Hips"] as readonly string[]
});

export function selectFuturebolAnimation(
    player: FuturebolPlayerState,
    context: FuturebolVisualUpdateContext
): FuturebolVisualAnimationState {
    if (context.phase === "Outcome" && context.outcome) {
        const won = context.outcome === "Goal" && player.team === context.activeTeam;
        const lost = context.outcome === "Goal" && player.team !== context.activeTeam;
        if (won && player.role === "attacker") return "Celebrate";
        if (lost && player.role === "goalkeeper") return "Disappointed";
    }

    if (player.animation === "goalkeeper-dive")
        return player.targetPosition.z >= player.position.z ? "GoalkeeperDiveRight" : "GoalkeeperDiveLeft";
    if (player.animation === "kick")
        return context.phase === "BuildUp" || context.phase === "Passing" ? "Pass" : "Shoot";
    if (player.role === "goalkeeper")
        return "GoalkeeperReady";
    if (context.ballOwnerId === player.id && player.currentSpeed > 0.18)
        return "Dribble";
    if (player.currentSpeed >= 2.4 || player.animation === "run")
        return "Run";
    if (player.currentSpeed >= 0.18 || player.animation === "walk")
        return "Walk";
    return "Idle";
}

export function resolvePlayerVisualKind(preference: "Auto" | "Primitives" | "Skeletal", quality: FuturebolQuality): "Primitives" | "Skeletal" {
    if (quality === "Low") return "Primitives";
    if (preference === "Primitives") return "Primitives";
    return "Skeletal";
}

export function normalizeAnimationName(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function resolveAnimationName(names: readonly string[], candidates: readonly string[]): string | null {
    const normalized = new Map(names.map(name => [normalizeAnimationName(name), name]));
    for (const candidate of candidates) {
        const exact = normalized.get(normalizeAnimationName(candidate));
        if (exact) return exact;
    }
    return null;
}

export function resolveCandidateName(names: readonly string[], candidates: readonly string[]): string | null {
    const exact = resolveAnimationName(names, candidates);
    if (exact) return exact;
    for (const name of names) {
        const normalizedName = normalizeAnimationName(name);
        if (candidates.some(candidate => normalizedName.endsWith(normalizeAnimationName(candidate))))
            return name;
    }
    return null;
}
