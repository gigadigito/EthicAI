import assert from "node:assert/strict";

import { createTvAudioFacade } from "./tvAudioFacade.mjs";

function testDelegatesAudioInteropCalls() {
    const calls = [];
    const facade = createTvAudioFacade({
        initBroadcastAudio(...args) {
            calls.push(["initBroadcastAudio", ...args]);
            return { ok: true };
        },
        setBroadcastAudioMuted(...args) {
            calls.push(["setBroadcastAudioMuted", ...args]);
        },
        playAudioCue(...args) {
            calls.push(["playAudioCue", ...args]);
            return true;
        },
        initTvAudioManager(...args) {
            calls.push(["initTvAudioManager", ...args]);
            return { unlocked: false };
        },
        playTvAudioCue(...args) {
            calls.push(["playTvAudioCue", ...args]);
            return true;
        },
        stopTvAudioCue(...args) {
            calls.push(["stopTvAudioCue", ...args]);
        },
        destroyBroadcastAudio(...args) {
            calls.push(["destroyBroadcastAudio", ...args]);
        },
        getTvAudioState() {
            calls.push(["getTvAudioState"]);
            return { muted: false };
        },
        tvAudioMap: { goal: "/audio/tv/goal-sting.mp3" }
    });

    assert.deepEqual(facade.initBroadcastAudio("el", 0.5, false), { ok: true });
    facade.setBroadcastAudioMuted("el", true, 0.4);
    assert.equal(facade.playAudioCue("goal"), true);
    assert.deepEqual(facade.initTvAudioManager(0.3, true), { unlocked: false });
    assert.equal(facade.playTvAudioCue("goal", { volume: 0.8 }), true);
    facade.stopTvAudioCue("goal");
    facade.destroyBroadcastAudio("el");
    assert.deepEqual(facade.getTvAudioState(), { muted: false });
    assert.deepEqual(facade.tvAudioMap, { goal: "/audio/tv/goal-sting.mp3" });

    assert.deepEqual(calls, [
        ["initBroadcastAudio", "el", 0.5, false],
        ["setBroadcastAudioMuted", "el", true, 0.4],
        ["playAudioCue", "goal"],
        ["initTvAudioManager", 0.3, true],
        ["playTvAudioCue", "goal", { volume: 0.8 }],
        ["stopTvAudioCue", "goal"],
        ["destroyBroadcastAudio", "el"],
        ["getTvAudioState"]
    ]);
}

testDelegatesAudioInteropCalls();
console.log("tvAudioFacade tests passed");
