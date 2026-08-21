import type { Scene } from 'babylonjs';
import type {
    FuturebolLogoTextureDiagnosticMap,
    FuturebolPlayerState,
    FuturebolPlayerVisualKind,
    FuturebolTeamVisualConfigurationMap
} from '../futurebol-types.js';
import { FuturebolPlayerAssetLoader, type FuturebolAssetProgress } from "./futurebol-player-asset-loader.js";
import { FuturebolPrimitivePlayerVisual } from "./futurebol-primitive-player-visual.js";
import { FuturebolSkeletalPlayerVisual } from "./futurebol-skeletal-player-visual.js";
import { FuturebolTeamLogoTextureProvider } from './futurebol-team-logo-texture.js';
import type { FuturebolPlayerVisual } from "./futurebol-player-visual.js";

type BabylonApi = typeof import("babylonjs");

export interface FuturebolVisualFactoryResult {
    visuals: Map<string, FuturebolPlayerVisual>;
    activeKind: FuturebolPlayerVisualKind;
    fallbackActive: boolean;
    warning: string | null;
    assetLoaded: boolean;
    loadTimeMs: number;
}

export class FuturebolPlayerVisualFactory {
    private loader: FuturebolPlayerAssetLoader | null = null;
    private readonly logoTextures: FuturebolTeamLogoTextureProvider;
    private disposed = false;

    public constructor(
        private readonly B: BabylonApi,
        private readonly scene: Scene,
        private readonly teams: FuturebolTeamVisualConfigurationMap,
        private readonly development: boolean,
        private readonly simulateAssetFailure: boolean,
        private readonly onProgress: (stage: FuturebolAssetProgress) => void
    ) {
        this.logoTextures = new FuturebolTeamLogoTextureProvider(B, scene, teams);
        if (!onProgress)
            throw new Error("Callback de progresso da factory Futurebol é obrigatório.");
    }

    public async create(players: FuturebolPlayerState[], kind: FuturebolPlayerVisualKind): Promise<FuturebolVisualFactoryResult> {
        if (this.disposed) throw new Error("Factory visual já descartada.");
        if (kind === "Primitives")
            return this.createPrimitives(players, false, null);
        const visuals = new Map<string, FuturebolPlayerVisual>();
        try {
            this.loader ??= new FuturebolPlayerAssetLoader(this.B, this.scene, this.simulateAssetFailure, this.onProgress);
            await this.loader.load();
            console.info(
                `[FUTUREBOL] player GLB ready: ${Math.round(this.loader.loadTimeMs)} ms`
            );
            const playerCreationStarted = performance.now();
            for (const player of players) {
                const entries = this.loader.instantiate(player.id);
                try {
                    visuals.set(
                        player.id,
                        new FuturebolSkeletalPlayerVisual(
                            this.B,
                            this.scene,
                            player,
                            entries,
                            this.teams[player.team],
                            this.logoTextures.material(player.team)
                        )
                    );
                } catch (error) {
                    for (const group of entries.animationGroups) group.dispose();
                    for (const skeleton of entries.skeletons) skeleton.dispose();
                    for (const node of entries.rootNodes) node.dispose(false, false);
                    throw error;
                }
            }
            console.info("[FUTUREBOL-TV][LOAD] player creation", {
                durationMs: Math.round(performance.now() - playerCreationStarted),
                players: players.length
            });
            this.loader.markReady();
            return { visuals, activeKind: "Skeletal", fallbackActive: false, warning: null, assetLoaded: true, loadTimeMs: this.loader.loadTimeMs };
        } catch (error) {
            for (const visual of visuals.values()) visual.dispose();
            const message = error instanceof Error ? error.message : "Falha desconhecida no GLB.";
            const reason = "asset-load-failed";
            console.warn(
                `[Futurebol][PlayerVisual] kind=Primitives reason=${reason}`,
                { message }
            );
            if (this.development)
                console.error("[Futurebol] GLB esquelético indisponível; usando primitivas.", error);
            this.loader?.dispose();
            this.loader = null;
            return this.createPrimitives(
                players,
                true,
                `Fallback emergencial: reason=${reason}. ${message}`
            );
        }
    }

    public dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.loader?.dispose();
        this.loader = null;
        this.logoTextures.dispose();
    }

    public logoDiagnostics(): FuturebolLogoTextureDiagnosticMap {
        return this.logoTextures.diagnostics();
    }

    public reconfigureTeams(teams: FuturebolTeamVisualConfigurationMap): void {
        this.logoTextures.reconfigure(teams);
    }

    private createPrimitives(players: FuturebolPlayerState[], fallback: boolean, warning: string | null): FuturebolVisualFactoryResult {
        const visuals = new Map<string, FuturebolPlayerVisual>();
        for (const player of players) {
            visuals.set(
                player.id,
                new FuturebolPrimitivePlayerVisual(
                    this.B,
                    this.scene,
                    player,
                    this.teams[player.team],
                    this.logoTextures.material(player.team)
                )
            );
        }
        this.onProgress("Pronto");
        return { visuals, activeKind: "Primitives", fallbackActive: fallback, warning, assetLoaded: false, loadTimeMs: 0 };
    }
}
