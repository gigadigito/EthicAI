import { WhaleOceanRuntime, type WhaleOceanRuntimeOptions } from "./whale-ocean-runtime.js";
import type { WhaleOceanBatch } from "./whale-ocean-model.js";

const instances = new Map<number, WhaleOceanRuntime>();

export async function initialize(options: WhaleOceanRuntimeOptions): Promise<void> {
    await dispose(options.matchId);
    const runtime = new WhaleOceanRuntime(options);
    instances.set(options.matchId, runtime);
    try {
        await runtime.initialize();
    } catch (error) {
        instances.delete(options.matchId);
        await runtime.dispose();
        throw error;
    }
}

export async function initializeDiagnostic(canvas: HTMLCanvasElement, mode: "sprites" | "showcase"): Promise<void> {
    const matchId = mode === "sprites" ? -10_001 : -10_002;
    await initialize({
        canvas,
        matchId,
        leftSymbol: "LIMA",
        rightSymbol: "CIANO",
        leftPrice: null,
        rightPrice: null,
        leftChange: 0,
        rightChange: 0,
        leftColor: "#789A0C",
        rightColor: "#087F83",
        quality: "High",
        diagnostic: mode
    });
}

export function receive(matchId: number, batch: WhaleOceanBatch): void {
    instances.get(matchId)?.receive(batch);
}

export function setPaused(matchId: number, paused: boolean): void {
    instances.get(matchId)?.setPaused(paused);
}

export function setConnectionState(matchId: number, connected: boolean): void {
    instances.get(matchId)?.setConnectionState(connected);
}

export function completeReplay(matchId: number): void {
    instances.get(matchId)?.completeReplay();
}

export async function setQuality(matchId: number, quality: "Low" | "Medium" | "High"): Promise<void> {
    await instances.get(matchId)?.setQuality(quality);
}

export async function dispose(matchId: number): Promise<void> {
    const runtime = instances.get(matchId);
    if (!runtime) return;
    instances.delete(matchId);
    await runtime.dispose();
}
