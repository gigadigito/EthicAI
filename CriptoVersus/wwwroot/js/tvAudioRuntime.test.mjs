import assert from "node:assert/strict";

import {
    ensureTvAudioManager,
    getTvMediaCulture,
    resolveTvAudioChannel,
    resolveTvAudioUrl,
    setTvMediaCulture,
    resolveTvCueVolume
} from "./tvAudioRuntime.mjs";

async function testAudioRuntimeResolvesStableValues() {
    global.fetch = async (url) => ({
        ok: String(url).includes("/media/audio/pt/tv/goal-sting.mp3")
    });

    const manager = ensureTvAudioManager();
    assert.equal(resolveTvAudioChannel("goal"), "fx");
    assert.equal(setTvMediaCulture("pt-BR"), "pt");
    assert.equal(getTvMediaCulture(), "pt");
    assert.equal(await resolveTvAudioUrl("goal"), "/media/audio/pt/tv/goal-sting.mp3");

    const volume = resolveTvCueVolume("goal", "fx", 0.2, manager);
    assert.ok(volume >= 0.88);
    assert.ok(volume <= 1);
}

function testAudioManagerIsSingleton() {
    const first = ensureTvAudioManager();
    const second = ensureTvAudioManager();
    assert.equal(first, second);
}

await testAudioRuntimeResolvesStableValues();
testAudioManagerIsSingleton();
console.log("tvAudioRuntime tests passed");
