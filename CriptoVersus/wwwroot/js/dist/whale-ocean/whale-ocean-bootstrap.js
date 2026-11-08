import { WhaleOceanRuntime } from "./whale-ocean-runtime.js";
const instances = new Map();
export async function initialize(options) {
    await dispose(options.matchId);
    const runtime = new WhaleOceanRuntime(options);
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
