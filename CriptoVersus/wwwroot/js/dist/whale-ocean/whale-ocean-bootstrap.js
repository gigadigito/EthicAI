import { WhaleOceanRuntime } from "./whale-ocean-runtime.js";
const instances = new Map();
const initializationTasks = new Map();
export async function initialize(options) {
    const previous = initializationTasks.get(options.matchId);
    if (previous) {
        try {
            await previous;
        }
        catch { /* the next initialization owns recovery */ }
    }
    const task = initializeRuntime(options);
    initializationTasks.set(options.matchId, task);
    try {
        await task;
    }
    finally {
        if (initializationTasks.get(options.matchId) === task)
            initializationTasks.delete(options.matchId);
    }
}
async function initializeRuntime(options) {
    await dispose(options.matchId);
    const runtime = new WhaleOceanRuntime({
        ...options,
        visualBudget: options.visualBudget
    });
    // Keep the instance discoverable for an explicit dispose while async
    // Babylon/texture initialization is still in flight. The runtime itself
    // checks `disposed` before touching the scene after every await.
    instances.set(options.matchId, runtime);
    try {
        await runtime.initialize();
    }
    catch (error) {
        instances.delete(options.matchId);
        await runtime.dispose();
        throw error;
    }
}
export async function initializeDiagnostic(canvas, mode) {
    const matchId = mode === "sprites" ? -10001 : -10002;
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
export function receive(matchId, batch) {
    instances.get(matchId)?.receive(batch);
}
export function getVisualDiagnostics(matchId) {
    return instances.get(matchId)?.visualDiagnostics() ?? [];
}
export function getGeometryDiagnostics(matchId) {
    return instances.get(matchId)?.geometryDiagnostics() ?? null;
}
export function setPaused(matchId, paused) {
    instances.get(matchId)?.setPaused(paused);
}
export function setConnectionState(matchId, connected) {
    instances.get(matchId)?.setConnectionState(connected);
}
export function setMatchFinished(matchId, finished) {
    instances.get(matchId)?.setMatchFinished(finished);
}
export function setOfficialMatchState(matchId, finished, rawStatus, startTimeUtc, endTimeUtc) {
    instances.get(matchId)?.setOfficialMatchState(finished, rawStatus, startTimeUtc, endTimeUtc);
}
export function completeReplay(matchId) {
    instances.get(matchId)?.completeReplay();
}
export async function setQuality(matchId, quality) {
    await instances.get(matchId)?.setQuality(quality);
}
export function setLabels(matchId, labels) {
    instances.get(matchId)?.setLabels(labels);
}
export async function dispose(matchId) {
    const runtime = instances.get(matchId);
    if (!runtime)
        return;
    instances.delete(matchId);
    await runtime.dispose();
}
