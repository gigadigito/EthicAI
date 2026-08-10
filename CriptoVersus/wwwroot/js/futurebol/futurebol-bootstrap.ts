import { acquireBabylon, releaseBabylon } from "./futurebol-babylon-loader.js";
import { FuturebolEngine } from "./futurebol-engine.js";
import type {
    FuturebolDotNetReference,
    FuturebolInitializeOptions,
    FuturebolMarketSnapshot,
    FuturebolOfficialMatchState,
    FuturebolPlayOutcome,
    FuturebolPlayerVisualPreference,
    FuturebolPressureOverride,
    FuturebolQuality,
    FuturebolTeam
} from "./futurebol-types.js";

const instances = new Map<string, FuturebolEngine>();

export async function initialize(
    canvasId: string,
    options: FuturebolInitializeOptions,
    dotNetReference: FuturebolDotNetReference
): Promise<void> {
    await dispose(canvasId);

    let acquired = false;
    try {
        if (options.simulateWebGlFailure || !supportsWebGl())
            throw new Error("WebGL não está disponível ou a inicialização foi bloqueada.");

        const canvas = document.getElementById(canvasId);
        if (!(canvas instanceof HTMLCanvasElement))
            throw new Error("Canvas do Futurebol não foi encontrado.");

        const B = await acquireBabylon();
        acquired = true;
        const engine = new FuturebolEngine(B, canvas, options, dotNetReference);
        await engine.initialize();
        instances.set(canvasId, engine);
    } catch (error) {
        if (acquired)
            releaseBabylon();
        const message = error instanceof Error ? error.message : "Falha desconhecida ao iniciar o Futurebol.";
        console.error("[Futurebol] falha de WebGL/inicialização", error);
        await dotNetReference.invokeMethodAsync("ReportFuturebolError", message);
    }
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
