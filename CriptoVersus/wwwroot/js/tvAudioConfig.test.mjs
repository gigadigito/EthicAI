import assert from "node:assert/strict";

import {
    ambientTracks,
    normalizeAudioError,
    tvAudioMap,
    tvAudioChannelMap,
    tvAudioCooldownDefaults,
    tvAudioMixProfiles,
    tvAudioPriority
} from "./tvAudioConfig.mjs";

function testExportsStableAudioConfig() {
    assert.equal(tvAudioMap.goal.fileName, "goal-sting.mp3");
    assert.equal(tvAudioMap.goal.context, "tv");
    assert.equal(tvAudioMap.goal.legacyPath, "/audio/tv/goal-sting.mp3");
    assert.equal(tvAudioChannelMap.goal, "fx");
    assert.equal(tvAudioPriority.goal, 100);
    assert.equal(tvAudioCooldownDefaults.goal, 6500);
    assert.equal(tvAudioMixProfiles.goal.boost, 1.2);
    assert.equal(Array.isArray(ambientTracks), true);
    assert.equal(ambientTracks[0].mood, "standard");
    assert.equal(ambientTracks[0].fileName, "stadium-crowd-loop.mp3");
}

function testNormalizesAudioError() {
    assert.deepEqual(normalizeAudioError(null), { message: "unknown error" });
    assert.deepEqual(normalizeAudioError({ name: "Oops", message: "Broken" }), {
        name: "Oops",
        message: "Broken"
    });
}

testExportsStableAudioConfig();
testNormalizesAudioError();
console.log("tvAudioConfig tests passed");
