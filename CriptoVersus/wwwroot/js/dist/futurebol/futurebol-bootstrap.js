import { acquireBabylon, releaseBabylon } from "./futurebol-babylon-loader.js";
import { FuturebolEngine } from "./futurebol-engine.js";
const instances = new Map();
export async function initialize(canvasId, options, dotNetReference) {
    await dispose(canvasId);
    let acquired = false;
    let engine = null;
    try {
        if (options.simulateWebGlFailure || !supportsWebGl())
            throw new Error("WebGL não está disponível ou a inicialização foi bloqueada.");
        const canvas = document.getElementById(canvasId);
        if (!(canvas instanceof HTMLCanvasElement))
            throw new Error("Canvas do Futurebol não foi encontrado.");
        const B = await acquireBabylon();
        acquired = true;
        const runtimeOptions = {
            ...options,
            quality: resolveInitialQuality(canvas, options.quality)
        };
        engine = new FuturebolEngine(B, canvas, runtimeOptions, dotNetReference);
        await engine.initialize();
        instances.set(canvasId, engine);
        return true;
    }
    catch (error) {
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
export async function updatePresentation(canvasId, state) {
    await instances.get(canvasId)?.applyPresentationState(state);
}
export function pause(canvasId) {
    instances.get(canvasId)?.pause();
}
export function resume(canvasId) {
    instances.get(canvasId)?.resume();
}
export function reset(canvasId) {
    instances.get(canvasId)?.reset();
}
export function setPressure(canvasId, pressure) {
    instances.get(canvasId)?.setPressure(pressure);
}
export function setFixedCamera(canvasId, fixed) {
    instances.get(canvasId)?.setFixedCamera(fixed);
}
export async function setQuality(canvasId, quality) {
    await instances.get(canvasId)?.setQuality(quality);
}
export async function setPlayerVisual(canvasId, preference) {
    await instances.get(canvasId)?.setPlayerVisual(preference);
}
export function forcePass(canvasId, team) {
    instances.get(canvasId)?.forcePass(team);
}
export function forceShot(canvasId, team) {
    instances.get(canvasId)?.forceShot(team);
}
export function forceOutcome(canvasId, outcome) {
    instances.get(canvasId)?.forceOutcome(outcome);
}
export function resetPlay(canvasId) {
    instances.get(canvasId)?.resetPlay();
}
export function updateMarket(canvasId, snapshot) {
    instances.get(canvasId)?.pushMarketSnapshot(snapshot);
}
export function updateOfficialState(canvasId, state) {
    instances.get(canvasId)?.pushOfficialMatchState(state);
}
export function reportMarketError(canvasId, message) {
    instances.get(canvasId)?.reportMarketError(message);
}
export async function dispose(canvasId) {
    const instance = instances.get(canvasId);
    if (!instance)
        return;
    instances.delete(canvasId);
    await instance.dispose();
    releaseBabylon();
}
function supportsWebGl() {
    try {
        const probe = document.createElement("canvas");
        return Boolean(probe.getContext("webgl2") || probe.getContext("webgl"));
    }
    catch {
        return false;
    }
}
function resolveInitialQuality(canvas, preference) {
    if (preference !== "Auto")
        return preference;
    const logicalWidth = Math.max(canvas.clientWidth, window.innerWidth);
    const logicalHeight = Math.max(canvas.clientHeight, window.innerHeight);
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 3);
    const pixelLoad = logicalWidth * logicalHeight * pixelRatio * pixelRatio;
    const cores = navigator.hardwareConcurrency || 4;
    const memory = navigator.deviceMemory ?? 4;
    const webGl2 = Boolean(document.createElement("canvas").getContext("webgl2"));
    if (logicalWidth <= 760 || cores <= 4 || memory <= 4 || pixelLoad > 6000000)
        return "Low";
    if (webGl2 && logicalWidth >= 1200 && cores >= 8 && memory >= 8 && pixelRatio <= 2)
        return "High";
    return "Medium";
}
