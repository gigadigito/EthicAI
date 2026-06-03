import assert from "node:assert/strict";

import {
    ensureTvAudioManager,
    resolveTvAudioChannel,
    resolveTvAudioUrl,
    resolveTvCueVolume
} from "./tvAudioRuntime.mjs";

function testAudioRuntimeResolvesStableValues() {
    const manager = ensureTvAudioManager();
    assert.equal(resolveTvAudioChannel("goal"), "fx");
    assert.equal(resolveTvAudioUrl("goal"), "/audio/tv/goal-sting.mp3");

    const volume = resolveTvCueVolume("goal", "fx", 0.2, manager);
    assert.ok(volume >= 0.88);
    assert.ok(volume <= 1);
}

function testAudioManagerIsSingleton() {
    const first = ensureTvAudioManager();
    const second = ensureTvAudioManager();
    assert.equal(first, second);
}

testAudioRuntimeResolvesStableValues();
testAudioManagerIsSingleton();
console.log("tvAudioRuntime tests passed");
