import { FuturebolPlayerAssetLoader } from "./futurebol-player-asset-loader.js";
import { FuturebolPrimitivePlayerVisual } from "./futurebol-primitive-player-visual.js";
import { FuturebolSkeletalPlayerVisual } from "./futurebol-skeletal-player-visual.js";
import { FuturebolTeamLogoTextureProvider } from './futurebol-team-logo-texture.js';
export class FuturebolPlayerVisualFactory {
    constructor(B, scene, teams, development, simulateAssetFailure, onProgress) {
        this.B = B;
        this.scene = scene;
        this.teams = teams;
        this.development = development;
        this.simulateAssetFailure = simulateAssetFailure;
        this.onProgress = onProgress;
        this.loader = null;
        this.disposed = false;
        this.logoTextures = new FuturebolTeamLogoTextureProvider(B, scene, teams, development);
        if (!onProgress)
            throw new Error("Callback de progresso da factory Futurebol é obrigatório.");
    }
    async create(players, kind) {
        if (this.disposed)
            throw new Error("Factory visual já descartada.");
        if (kind === "Primitives")
            return this.createPrimitives(players, false, null);
        const visuals = new Map();
        try {
            this.loader ?? (this.loader = new FuturebolPlayerAssetLoader(this.B, this.scene, this.simulateAssetFailure, this.onProgress));
            await this.loader.load();
            const playerCreationStarted = performance.now();
            for (const player of players) {
                const entries = this.loader.instantiate(player.id);
                try {
                    visuals.set(player.id, new FuturebolSkeletalPlayerVisual(this.B, this.scene, player, entries, this.teams[player.team], this.logoTextures.material(player.team)));
                }
                catch (error) {
                    for (const group of entries.animationGroups)
                        group.dispose();
                    for (const skeleton of entries.skeletons)
                        skeleton.dispose();
                    for (const node of entries.rootNodes)
                        node.dispose(false, false);
                    throw error;
                }
            }
            console.info("[FUTUREBOL-TV][LOAD] player creation", {
                durationMs: Math.round(performance.now() - playerCreationStarted),
                players: players.length
            });
            this.loader.markReady();
            return { visuals, activeKind: "Skeletal", fallbackActive: false, warning: null, assetLoaded: true, loadTimeMs: this.loader.loadTimeMs };
        }
        catch (error) {
            for (const visual of visuals.values())
                visual.dispose();
            const message = error instanceof Error ? error.message : "Falha desconhecida no GLB.";
            if (this.development)
                console.error("[Futurebol] GLB esquelético indisponível; usando primitivas.", error);
            this.loader?.dispose();
            this.loader = null;
            return this.createPrimitives(players, true, `Visual esquelético indisponível: ${message}`);
        }
    }
    dispose() {
        if (this.disposed)
            return;
        this.disposed = true;
        this.loader?.dispose();
        this.loader = null;
        this.logoTextures.dispose();
    }
    logoDiagnostics() {
        return this.logoTextures.diagnostics();
    }
    reconfigureTeams(teams) {
        this.logoTextures.reconfigure(teams);
    }
    createPrimitives(players, fallback, warning) {
        const visuals = new Map();
        for (const player of players) {
            visuals.set(player.id, new FuturebolPrimitivePlayerVisual(this.B, this.scene, player, this.teams[player.team], this.logoTextures.material(player.team)));
        }
        this.onProgress("Pronto");
        return { visuals, activeKind: "Primitives", fallbackActive: fallback, warning, assetLoaded: false, loadTimeMs: 0 };
    }
}
