import type { AssetContainer, InstantiatedEntries, Scene } from "babylonjs";
import { acquireBabylonGltfLoader, releaseBabylonGltfLoader } from "../futurebol-babylon-loader.js";
import { FUTUREBOL_ANIMATION_MAP, FUTUREBOL_PLAYER_ASSET, resolveCandidateName } from "./futurebol-animation-map.js";

type BabylonApi = typeof import("babylonjs");
export type FuturebolAssetProgress = "Carregando modelo" | "Preparando skeleton" | "Criando jogadores" | "Pronto";

export class FuturebolPlayerAssetLoader {
    public loadTimeMs = 0;
    public isLoaded = false;
    private container: AssetContainer | null = null;
    private loadPromise: Promise<AssetContainer> | null = null;
    private loaderAcquired = false;
    private generation = 0;
    private disposed = false;

    public constructor(
        private readonly B: BabylonApi,
        private readonly scene: Scene,
        private readonly simulateFailure: boolean,
        private readonly onProgress: (stage: FuturebolAssetProgress) => void
    ) {
        if (!onProgress)
            throw new Error("Callback de progresso do asset Futurebol é obrigatório.");
    }

    public async load(): Promise<void> {
        if (this.disposed) throw new Error("Loader de personagem já foi descartado.");
        if (this.container) return;
        if (this.simulateFailure) throw new Error("Falha simulada no asset esquelético.");
        const generation = this.generation;
        const started = performance.now();
        this.onProgress("Carregando modelo");
        await acquireBabylonGltfLoader();
        this.loaderAcquired = true;

        this.loadPromise ??= this.B.SceneLoader.LoadAssetContainerAsync(
            FUTUREBOL_PLAYER_ASSET.rootUrl,
            FUTUREBOL_PLAYER_ASSET.fileName,
            this.scene,
            undefined,
            ".glb"
        );
        const pending = this.loadPromise;
        let timeoutId = 0;
        const timeout = new Promise<never>((_, reject) => {
            timeoutId = window.setTimeout(() => reject(new Error(`Timeout de ${FUTUREBOL_PLAYER_ASSET.timeoutMs}ms ao carregar o personagem GLB.`)), FUTUREBOL_PLAYER_ASSET.timeoutMs);
        });

        try {
            const container = await Promise.race([pending, timeout]);
            if (this.disposed || generation !== this.generation) {
                container.dispose();
                throw new Error("Carregamento de personagem cancelado.");
            }
            this.onProgress("Preparando skeleton");
            this.validate(container);
            this.container = container;
            this.isLoaded = true;
            this.loadTimeMs = performance.now() - started;
        } catch (error) {
            void pending.then(container => {
                if (container !== this.container) container.dispose();
            }).catch(() => undefined);
            this.loadPromise = null;
            throw error;
        } finally {
            window.clearTimeout(timeoutId);
        }
    }

    public instantiate(playerId: string): InstantiatedEntries {
        if (!this.container) throw new Error("O asset esquelético não foi preparado.");
        this.onProgress("Criando jogadores");
        return this.container.instantiateModelsToScene(
            name => `${playerId}:${name}`,
            true,
            { doNotInstantiate: true }
        );
    }

    public markReady(): void { if (!this.disposed) this.onProgress("Pronto"); }

    public dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.generation += 1;
        this.container?.dispose();
        this.container = null;
        this.loadPromise = null;
        this.isLoaded = false;
        if (this.loaderAcquired) {
            releaseBabylonGltfLoader();
            this.loaderAcquired = false;
        }
    }

    private validate(container: AssetContainer): void {
        if (!container.skeletons.length || Math.max(...container.skeletons.map(skeleton => skeleton.bones.length)) < 20)
            throw new Error("O GLB não contém um skeleton humanoide válido.");
        const boneNames = container.skeletons.flatMap(skeleton => skeleton.bones.map(bone => bone.name));
        if (!resolveCandidateName(boneNames, FUTUREBOL_PLAYER_ASSET.headBoneCandidates))
            throw new Error("O GLB não contém um bone de cabeça compatível.");
        const animationNames = container.animationGroups.map(group => group.name);
        for (const required of ["Idle", "Run", "Pass", "Shoot", "GoalkeeperDiveLeft"] as const) {
            if (!resolveCandidateName(animationNames, FUTUREBOL_ANIMATION_MAP[required].candidates))
                throw new Error(`O GLB não contém fallback suficiente para a animação ${required}.`);
        }
    }
}
