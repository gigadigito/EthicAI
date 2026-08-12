import { acquireBabylon, releaseBabylon } from "./futurebol-babylon-loader.js";
import { FuturebolEngine } from "./futurebol-engine.js";
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

export async function initialize(
    canvasId: string,
    options: FuturebolInitializeOptions,
    dotNetReference: FuturebolDotNetReference
): Promise<boolean> {
    await dispose(canvasId);

    let acquired = false;
    let engine: FuturebolEngine | null = null;
    try {
        if (options.simulateWebGlFailure || !supportsWebGl())
            throw new Error("WebGL não está disponível ou a inicialização foi bloqueada.");

        const canvas = document.getElementById(canvasId);
        if (!(canvas instanceof HTMLCanvasElement))
            throw new Error("Canvas do Futurebol não foi encontrado.");

        const B = await acquireBabylon();
        acquired = true;
        const runtimeOptions: FuturebolRuntimeOptions = {
            ...options,
            quality: resolveInitialQuality(canvas, options.quality)
        };
        engine = new FuturebolEngine(B, canvas, runtimeOptions, dotNetReference);
        await engine.initialize();
        instances.set(canvasId, engine);
        return true;
    } catch (error) {
        await engine?.dispose();
        if (acquired)
            releaseBabylon();
        const message = error instanceof Error ? error.message : "Falha desconhecida ao iniciar o Futurebol.";
        if (options.development)
            console.error("[Futurebol] falha de WebGL/inicialização", error);
        await dotNetReference.invokeMethodAsync("ReportFuturebolError", message);
        return false;
    }
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

    instances.delete(canvasId);
    await instance.dispose();
    releaseBabylon();
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
