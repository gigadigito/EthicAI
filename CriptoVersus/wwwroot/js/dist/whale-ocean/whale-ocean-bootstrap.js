import { WhaleOceanRuntime } from "./whale-ocean-runtime.js";
const instances = new Map();
export async function initialize(options) {
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
export function setPaused(matchId, paused) {
    instances.get(matchId)?.setPaused(paused);
}
export function setConnectionState(matchId, connected) {
    instances.get(matchId)?.setConnectionState(connected);
}
export function completeReplay(matchId) {
    instances.get(matchId)?.completeReplay();
}
export async function setQuality(matchId, quality) {
    await instances.get(matchId)?.setQuality(quality);
}
export async function dispose(matchId) {
    const runtime = instances.get(matchId);
    if (!runtime)
        return;
    instances.delete(matchId);
    await runtime.dispose();
}
