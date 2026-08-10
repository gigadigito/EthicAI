import { acquireBabylonGltfLoader, releaseBabylonGltfLoader } from "../futurebol-babylon-loader.js";
import { FUTUREBOL_ANIMATION_MAP, FUTUREBOL_PLAYER_ASSET, resolveCandidateName } from "./futurebol-animation-map.js";
export class FuturebolPlayerAssetLoader {
    constructor(B, scene, simulateFailure, onProgress) {
        this.B = B;
        this.scene = scene;
        this.simulateFailure = simulateFailure;
        this.onProgress = onProgress;
        this.loadTimeMs = 0;
        this.isLoaded = false;
        this.container = null;
        this.loadPromise = null;
        this.loaderAcquired = false;
        this.generation = 0;
        this.disposed = false;
        if (!onProgress)
            throw new Error("Callback de progresso do asset Futurebol é obrigatório.");
    }
    async load() {
        if (this.disposed)
            throw new Error("Loader de personagem já foi descartado.");
        if (this.container)
            return;
        if (this.simulateFailure)
            throw new Error("Falha simulada no asset esquelético.");
        const generation = this.generation;
        const started = performance.now();
        this.onProgress("Carregando modelo");
        await acquireBabylonGltfLoader();
        this.loaderAcquired = true;
        this.loadPromise ?? (this.loadPromise = this.B.SceneLoader.LoadAssetContainerAsync(FUTUREBOL_PLAYER_ASSET.rootUrl, FUTUREBOL_PLAYER_ASSET.fileName, this.scene, undefined, ".glb"));
        const pending = this.loadPromise;
        let timeoutId = 0;
        const timeout = new Promise((_, reject) => {
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
        }
        catch (error) {
            void pending.then(container => {
                if (container !== this.container)
                    container.dispose();
            }).catch(() => undefined);
            this.loadPromise = null;
            throw error;
        }
        finally {
            window.clearTimeout(timeoutId);
        }
    }
    instantiate(playerId) {
        if (!this.container)
            throw new Error("O asset esquelético não foi preparado.");
        this.onProgress("Criando jogadores");
        return this.container.instantiateModelsToScene(name => `${playerId}:${name}`, true, { doNotInstantiate: true });
    }
    markReady() { if (!this.disposed)
        this.onProgress("Pronto"); }
    dispose() {
        if (this.disposed)
            return;
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
    validate(container) {
        if (!container.skeletons.length || Math.max(...container.skeletons.map(skeleton => skeleton.bones.length)) < 20)
            throw new Error("O GLB não contém um skeleton humanoide válido.");
        const boneNames = container.skeletons.flatMap(skeleton => skeleton.bones.map(bone => bone.name));
        if (!resolveCandidateName(boneNames, FUTUREBOL_PLAYER_ASSET.headBoneCandidates))
            throw new Error("O GLB não contém um bone de cabeça compatível.");
        const animationNames = container.animationGroups.map(group => group.name);
        for (const required of ["Idle", "Run", "Pass", "Shoot", "GoalkeeperDiveLeft"]) {
            if (!resolveCandidateName(animationNames, FUTUREBOL_ANIMATION_MAP[required].candidates))
                throw new Error(`O GLB não contém fallback suficiente para a animação ${required}.`);
        }
    }
}
