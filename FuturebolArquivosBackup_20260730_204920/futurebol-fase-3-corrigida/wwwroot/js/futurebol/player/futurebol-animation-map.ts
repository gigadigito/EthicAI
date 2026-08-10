import type {
    FuturebolPlayerState,
    FuturebolQuality,
    FuturebolVisualAnimationState,
    FuturebolVisualUpdateContext
} from "../futurebol-types.js";

export {
    FUTUREBOL_ACTION_TIMING,
    hasReachedContact
} from "../futurebol-action-timing.js";

export interface FuturebolAnimationDefinition {
    candidates: readonly string[];
    loop: boolean;
    nominalDurationSeconds?: number;
}

export const FUTUREBOL_ANIMATION_MAP: Readonly<
    Record<
        FuturebolVisualAnimationState,
        FuturebolAnimationDefinition
    >
> = {
    Idle: {
        // Standing é preferido para evitar que um clip Idle muito expressivo
        // pareça uma dança antes da jogada.
        candidates: [
            "Standing",
            "Idle"
        ],
        loop: true
    },

    Walk: {
        candidates: [
            "Walking",
            "Running"
        ],
        loop: true
    },

    Run: {
        candidates: [
            "Running",
            "Walking"
        ],
        loop: true
    },

    Dribble: {
        candidates: [
            "Running",
            "Walking"
        ],
        loop: true
    },

    Pass: {
        candidates: [
            "Punch",
            "Walking"
        ],
        loop: false,
        nominalDurationSeconds: 0.78
    },

    Shoot: {
        candidates: [
            "WalkJump",
            "Jump",
            "Punch"
        ],
        loop: false,
        nominalDurationSeconds: 0.72
    },

    GoalkeeperReady: {
        candidates: [
            "Standing",
            "Idle"
        ],
        loop: true
    },

    /*
     * O mergulho usa uma animação que mantém o skeleton íntegro.
     *
     * O movimento lateral e a inclinação do corpo são complementados
     * pelo FuturebolSkeletalPlayerVisual.
     */
    GoalkeeperDiveLeft: {
        candidates: [
            "Jump",
            "WalkJump",
            "Running"
        ],
        loop: false,
        nominalDurationSeconds: 0.72
    },

    GoalkeeperDiveRight: {
        candidates: [
            "Jump",
            "WalkJump",
            "Running"
        ],
        loop: false,
        nominalDurationSeconds: 0.72
    },

    Celebrate: {
        candidates: [
            "ThumbsUp",
            "Yes",
            "Dance"
        ],
        loop: false,
        nominalDurationSeconds: 1.58
    },

    /*
     * Não usar Death para frustração.
     *
     * Caso No não exista no GLB, o goleiro permanece em pé.
     */
    Disappointed: {
        candidates: [
            "No",
            "Standing",
            "Idle"
        ],
        loop: false,
        nominalDurationSeconds: 1.1
    }
};

export const FUTUREBOL_PLAYER_ASSET = Object.freeze({
    rootUrl: "/assets/futurebol/players/",
    fileName: "futurebol-humanoid.glb",
    timeoutMs: 8000,

    heightMeters: 3.25,
    scale: 0.98,
    yawOffsetRadians: Math.PI / 2,

    /*
     * Valores locais do skeleton/GLB.
     *
     * Mantidos conforme a configuração visual atual.
     */
    coinDiameter: 0.035,
    coinThickness: 0.0085,
    coinLocalOffsetY: 0.001,

    /*
     * Logo aplicado nas duas faces da cabeça-moeda.
     */
    coinSymbolSize: 0.0318,
    coinSymbolSurfaceOffset: 0.0009,

    headBoneCandidates: [
        "Head",
        "head",
        "mixamorig:Head",
        "mixamorigHead",
        "Bip001 Head"
    ] as readonly string[],

    headMeshCandidates: [
        "Head",
        "head",
        "Wolf3D_Head"
    ] as readonly string[],

    rootMotionCandidates: [
        "Bone",
        "Root",
        "root",
        "mixamorig:Hips",
        "Hips"
    ] as readonly string[]
});

export function selectFuturebolAnimation(
    player: FuturebolPlayerState,
    context: FuturebolVisualUpdateContext
): FuturebolVisualAnimationState {
    /*
     * Resultado da jogada.
     */
    if (
        context.phase === "Outcome" &&
        context.outcome
    ) {
        const scoredGoal =
            context.outcome === "Goal";

        const playerWon =
            scoredGoal &&
            player.team === context.activeTeam;

        const playerLost =
            scoredGoal &&
            player.team !== context.activeTeam;

        if (
            playerWon &&
            player.role === "attacker"
        ) {
            return "Celebrate";
        }

        if (
            playerLost &&
            player.role === "goalkeeper"
        ) {
            return "Disappointed";
        }
    }

    /*
     * Estado neutro.
     *
     * Esta condição deve ficar antes de goalkeeper-dive, kick,
     * velocidade e posse de bola.
     *
     * Assim, animações residuais da jogada anterior não fazem os
     * jogadores correrem, chutarem ou "dançarem" antes do início
     * da próxima jogada.
     */
    if (context.phase === "Neutral") {
        return player.role === "goalkeeper"
            ? "GoalkeeperReady"
            : "Idle";
    }

    /*
     * O goleiro só pode executar o mergulho durante o chute.
     *
     * Quando Shooting termina, a animação deixa imediatamente de
     * ser selecionada, mesmo que o estado lógico ainda mantenha
     * goalkeeper-dive por alguns frames.
     */
    const goalkeeperIsDiving =
        player.role === "goalkeeper" &&
        player.animation === "goalkeeper-dive" &&
        context.phase === "Shooting";

    if (goalkeeperIsDiving) {
        return player.targetPosition.z >=
            player.position.z
            ? "GoalkeeperDiveRight"
            : "GoalkeeperDiveLeft";
    }

    /*
     * Passe ou chute do atacante.
     */
    if (player.animation === "kick") {
        return (
            context.phase === "BuildUp" ||
            context.phase === "Passing"
        )
            ? "Pass"
            : "Shoot";
    }

    /*
     * Fora de uma defesa, o goleiro permanece em pé.
     */
    if (player.role === "goalkeeper") {
        return "GoalkeeperReady";
    }

    /*
     * Jogador conduzindo a bola.
     */
    if (
        context.ballOwnerId === player.id &&
        player.currentSpeed > 0.18
    ) {
        return "Dribble";
    }

    /*
     * Corrida.
     */
    if (
        player.currentSpeed >= 2.4 ||
        player.animation === "run"
    ) {
        return "Run";
    }

    /*
     * Caminhada.
     */
    if (
        player.currentSpeed >= 0.18 ||
        player.animation === "walk"
    ) {
        return "Walk";
    }

    return "Idle";
}

export function resolvePlayerVisualKind(
    preference:
        | "Auto"
        | "Primitives"
        | "Skeletal",
    quality: FuturebolQuality
): "Primitives" | "Skeletal" {
    if (quality === "Low") {
        return "Primitives";
    }

    if (preference === "Primitives") {
        return "Primitives";
    }

    return "Skeletal";
}

export function normalizeAnimationName(
    value: string
): string {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "");
}

export function resolveAnimationName(
    names: readonly string[],
    candidates: readonly string[]
): string | null {
    const normalized = new Map(
        names.map(name => [
            normalizeAnimationName(name),
            name
        ])
    );

    for (const candidate of candidates) {
        const exact = normalized.get(
            normalizeAnimationName(candidate)
        );

        if (exact) {
            return exact;
        }
    }

    return null;
}

export function resolveCandidateName(
    names: readonly string[],
    candidates: readonly string[]
): string | null {
    const exact = resolveAnimationName(
        names,
        candidates
    );

    if (exact) {
        return exact;
    }

    for (const name of names) {
        const normalizedName =
            normalizeAnimationName(name);

        const matchesCandidate =
            candidates.some(candidate =>
                normalizedName.endsWith(
                    normalizeAnimationName(candidate)
                )
            );

        if (matchesCandidate) {
            return name;
        }
    }

    return null;
}