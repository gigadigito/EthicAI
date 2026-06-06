import assert from "node:assert/strict";

import { isProceduralPlaybackDuplicate } from "./tvProceduralAudioUtils.mjs";

function testProceduralPlaybackDedupesRecentSignature() {
    const signature = "audio://goal|pressure|BTC";
    const now = 50_000;

    assert.equal(isProceduralPlaybackDuplicate(signature, signature, now - 200, now, 1200), true);
    assert.equal(isProceduralPlaybackDuplicate(signature, signature, now - 1600, now, 1200), false);
}

function testProceduralPlaybackAllowsDistinctSignatures() {
    const signature = "audio://goal|pressure|BTC";
    const now = 90_000;

    assert.equal(isProceduralPlaybackDuplicate(`${signature}|1`, `${signature}|2`, now - 100, now, 1200), false);
    assert.equal(isProceduralPlaybackDuplicate("", signature, now - 100, now, 1200), false);
}

testProceduralPlaybackDedupesRecentSignature();
testProceduralPlaybackAllowsDistinctSignatures();
console.log("tvProceduralAudio tests passed");
