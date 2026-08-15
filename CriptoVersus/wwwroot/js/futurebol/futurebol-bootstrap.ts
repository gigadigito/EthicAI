import { acquireBabylon, preloadBabylonRuntime, releaseBabylon } from "./futurebol-babylon-loader.js";
import { FuturebolEngine } from "./futurebol-engine.js";
import { FUTUREBOL_PLAYER_ASSET } from "./player/futurebol-animation-map.js";
import type {
    FuturebolDotNetReference,
    FuturebolInitializeOptions,
    FuturebolMatchPresentationState,
    FuturebolMarketSnapshot,
    FuturebolOfficialMatchState,
    FuturebolPlayOutcome,
    FuturebolPlayerVisualPreference,
    FuturebolPressureOverride,
    FuturebolQuality,
    FuturebolRuntimeOptions,
    FuturebolTeam
} from "./futurebol-types.js";

const instances = new Map<string, FuturebolEngine>();
const playerAssetUrl = `${FUTUREBOL_PLAYER_ASSET.rootUrl}${FUTUREBOL_PLAYER_ASSET.fileName}`;
let preloadPromise: Promise<void> | null = null;
console.info("[FUTUREBOL] bootstrap started");

export function reportBootstrapImport(durationMs: number): void {
    console.info("[FUTUREBOL-TV][LOAD] bootstrap import", {
        durationMs: Math.round(durationMs)
    });
}

export function preload(): Promise<void> {
    preloadPromise ??= (async () => {
        const started = performance.now();
        await Promise.all([
            preloadBabylonRuntime(),
            preloadPlayerAsset()
        ]);
        console.info("[FUTUREBOL-TV][LOAD] preload ready", {
            durationMs: Math.round(performance.now() - started)
        });
    })();
    return preloadPromise;
}

export async function initialize(
    canvasId: string,
    options: FuturebolInitializeOptions,
    dotNetReference: FuturebolDotNetReference
): Promise<boolean> {
    const initializeStarted = performance.now();
    let acquired = false;
    let engine: FuturebolEngine | null = null;
    let stage = "dispose-previous";
    try {
        await dispose(canvasId);
        console.info("[FUTUREBOL] bootstrap initialize started", {
            canvasId,
            matchId: options.matchId ?? null
        });

        stage = "validate-webgl";
        if (options.simulateWebGlFailure || !supportsWebGl())
            throw new Error("WebGL não está disponível ou a inicialização foi bloqueada.");

        stage = "find-canvas";
        const canvas = document.getElementById(canvasId);
        if (!(canvas instanceof HTMLCanvasElement))
            throw new Error("Canvas do Futurebol não foi encontrado.");

        console.info("[FUTUREBOL-TV] canvas found", {
            canvasId,
            rect: readCanvasRect(canvas)
        });

        stage = "load-babylon";
        const babylonStarted = performance.now();
        const B = await acquireBabylon();
        console.info(
            `[FUTUREBOL] Babylon ready: ${Math.round(performance.now() - initializeStarted)} ms `
            + `(runtime ${Math.round(performance.now() - babylonStarted)} ms)`
        );
        acquired = true;
        const runtimeOptions: FuturebolRuntimeOptions = {
            ...options,
            quality: resolveInitialQuality(canvas, options.quality)
        };
        stage = "create-engine";
        const sceneStarted = performance.now();
        engine = new FuturebolEngine(B, canvas, runtimeOptions, dotNetReference);
        console.info(
            `[FUTUREBOL] scene ready: ${Math.round(performance.now() - initializeStarted)} ms `
            + `(creation ${Math.round(performance.now() - sceneStarted)} ms)`
        );
        await engine.initialize(currentStage => {
            stage = currentStage;
            console.info(`[FUTUREBOL] stage=${stage}`);
        });
        instances.set(canvasId, engine);
        const totalMs = Math.round(performance.now() - initializeStarted);
        console.info("[FUTUREBOL-TV][LOAD] initialize total", {
            durationMs: Math.round(performance.now() - initializeStarted)
        });
        console.info("[FUTUREBOL-TV][READY] initialize success", {
            canvasId,
            matchId: options.matchId ?? null,
            size: engine.getSizeDiagnostics()
        });
        console.info(`[FUTUREBOL] READY total: ${totalMs} ms`);
        return true;
    } catch (error) {
        const message = error instanceof Error ? error.message : "Falha desconhecida ao iniciar o Futurebol.";
        console.error("[FUTUREBOL][FATAL]", {
            stage,
            error,
            message,
            stack: error instanceof Error ? error.stack : undefined
        });
        try {
            await engine?.dispose();
        } catch (cleanupError) {
            console.warn("[FUTUREBOL][WARN] cleanup failed", cleanupError);
        }
        if (acquired)
            releaseBabylon();
        try {
            await dotNetReference.invokeMethodAsync("ReportFuturebolError", message);
        } catch (reportError) {
            console.warn("[FUTUREBOL][WARN] fatal error report failed", reportError);
        }
        return false;
    }
}

async function preloadPlayerAsset(): Promise<void> {
    const response = await fetch(playerAssetUrl, {
        cache: "force-cache",
        credentials: "same-origin"
    });
    if (!response.ok)
        throw new Error(`Futurebol GLB preload failed with HTTP ${response.status}.`);
    await response.arrayBuffer();
}

export async function updatePresentation(
    canvasId: string,
    state: FuturebolMatchPresentationState
): Promise<void> {
    await instances.get(canvasId)?.applyPresentationState(state);
}

export function pause(canvasId: string): void {
    instances.get(canvasId)?.pause();
}

export function resume(canvasId: string): void {
    instances.get(canvasId)?.resume();
}

export function reset(canvasId: string): void {
    instances.get(canvasId)?.reset();
}

export function setPressure(canvasId: string, pressure: FuturebolPressureOverride): void {
    instances.get(canvasId)?.setPressure(pressure);
}

export function setFixedCamera(canvasId: string, fixed: boolean): void {
    instances.get(canvasId)?.setFixedCamera(fixed);
}

export async function setQuality(canvasId: string, quality: FuturebolQuality): Promise<void> {
    await instances.get(canvasId)?.setQuality(quality);
}

export async function setPlayerVisual(canvasId: string, preference: FuturebolPlayerVisualPreference): Promise<void> {
    await instances.get(canvasId)?.setPlayerVisual(preference);
}

export function forcePass(canvasId: string, team: FuturebolTeam): void {
    instances.get(canvasId)?.forcePass(team);
}

export function forceShot(canvasId: string, team: FuturebolTeam): void {
    instances.get(canvasId)?.forceShot(team);
}

export function forceOutcome(canvasId: string, outcome: FuturebolPlayOutcome): void {
    instances.get(canvasId)?.forceOutcome(outcome);
}

export function resetPlay(canvasId: string): void {
    instances.get(canvasId)?.resetPlay();
}

export function updateMarket(
    canvasId: string,
    snapshot: FuturebolMarketSnapshot
): void {
    instances.get(canvasId)?.pushMarketSnapshot(snapshot);
}

export function updateOfficialState(
    canvasId: string,
    state: FuturebolOfficialMatchState
): void {
    instances.get(canvasId)?.pushOfficialMatchState(state);
}

export function reportMarketError(canvasId: string, message: string): void {
    instances.get(canvasId)?.reportMarketError(message);
}

export async function dispose(canvasId: string): Promise<void> {
    const instance = instances.get(canvasId);
    if (!instance)
        return;

    console.info("[FUTUREBOL-TV] dispose", { canvasId });
    instances.delete(canvasId);
    await instance.dispose();
    releaseBabylon();
}

function readCanvasRect(canvas: HTMLCanvasElement): { width: number; height: number } {
    const rect = canvas.getBoundingClientRect();
    return {
        width: Math.round(rect.width),
        height: Math.round(rect.height)
    };
}

function supportsWebGl(): boolean {
    try {
        const probe = document.createElement("canvas");
        return Boolean(probe.getContext("webgl2") || probe.getContext("webgl"));
    } catch {
        return false;
    }
}

function resolveInitialQuality(
    canvas: HTMLCanvasElement,
    preference: FuturebolInitializeOptions["quality"]
): FuturebolQuality {
    if (preference !== "Auto")
        return preference;

    const logicalWidth = Math.max(canvas.clientWidth, window.innerWidth);
    const logicalHeight = Math.max(canvas.clientHeight, window.innerHeight);
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 3);
    const pixelLoad = logicalWidth * logicalHeight * pixelRatio * pixelRatio;
    const cores = navigator.hardwareConcurrency || 4;
    const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4;
    const webGl2 = Boolean(document.createElement("canvas").getContext("webgl2"));

    if (logicalWidth <= 760 || cores <= 4 || memory <= 4 || pixelLoad > 6_000_000)
        return "Low";
    if (webGl2 && logicalWidth >= 1200 && cores >= 8 && memory >= 8 && pixelRatio <= 2)
        return "High";
    return "Medium";
}
