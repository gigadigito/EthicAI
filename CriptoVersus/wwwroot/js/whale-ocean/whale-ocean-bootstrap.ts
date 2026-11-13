import { WhaleOceanRuntime, type WhaleOceanGeometryDiagnostic, type WhaleOceanRuntimeOptions, type WhaleOceanVisualDiagnosticRow } from "./whale-ocean-runtime.js";
import type { WhaleOceanBatch } from "./whale-ocean-model.js";

const instances = new Map<number, WhaleOceanRuntime>();
const initializationTasks = new Map<number, Promise<void>>();

export async function initialize(options: WhaleOceanRuntimeOptions): Promise<void> {
    const previous = initializationTasks.get(options.matchId);
    if (previous) {
        try { await previous; } catch { /* the next initialization owns recovery */ }
    }

    const task = initializeRuntime(options);
    initializationTasks.set(options.matchId, task);
    try {
        await task;
    } finally {
        if (initializationTasks.get(options.matchId) === task)
            initializationTasks.delete(options.matchId);
    }
}

async function initializeRuntime(options: WhaleOceanRuntimeOptions): Promise<void> {
    await dispose(options.matchId);
    const mobile = typeof window !== "undefined" && window.matchMedia("(max-width: 700px)").matches;
    const runtime = new WhaleOceanRuntime({
        ...options,
        visualBudget: {
            maxVisibleAnimals: mobile ? 12 : 24,
            maxSchoolAnimalsPerGroup: mobile ? 3 : 6,
            maxOccupancyPerTerritory: mobile ? 7 : 14,
            ...options.visualBudget
        }
    });
    // Keep the instance discoverable for an explicit dispose while async
    // Babylon/texture initialization is still in flight. The runtime itself
    // checks `disposed` before touching the scene after every await.
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

export function getVisualDiagnostics(matchId: number): WhaleOceanVisualDiagnosticRow[] {
    return instances.get(matchId)?.visualDiagnostics() ?? [];
}

export function getGeometryDiagnostics(matchId: number): WhaleOceanGeometryDiagnostic | null {
    return instances.get(matchId)?.geometryDiagnostics() ?? null;
}

export function setPaused(matchId: number, paused: boolean): void {
    instances.get(matchId)?.setPaused(paused);
}

export function setConnectionState(matchId: number, connected: boolean): void {
    instances.get(matchId)?.setConnectionState(connected);
}

export function setMatchFinished(matchId: number, finished: boolean): void {
    instances.get(matchId)?.setMatchFinished(finished);
}

export function setOfficialMatchState(
    matchId: number,
    finished: boolean,
    rawStatus: string | null,
    startTimeUtc: string | null,
    endTimeUtc: string | null
): void {
    instances.get(matchId)?.setOfficialMatchState(finished, rawStatus, startTimeUtc, endTimeUtc);
}

export function completeReplay(matchId: number): void {
    instances.get(matchId)?.completeReplay();
}

export async function setQuality(matchId: number, quality: "Low" | "Medium" | "High"): Promise<void> {
    await instances.get(matchId)?.setQuality(quality);
}

export function setLabels(matchId: number, labels: Record<string, string>): void {
    instances.get(matchId)?.setLabels(labels);
}

export async function dispose(matchId: number): Promise<void> {
    const runtime = instances.get(matchId);
    if (!runtime) return;
    instances.delete(matchId);
    await runtime.dispose();
}
