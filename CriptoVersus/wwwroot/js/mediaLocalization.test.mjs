import assert from "node:assert/strict";

import {
    buildLocalizedMediaCandidates,
    getCultureFallbackChain,
    resolveLocalizedAudioPath,
    setMediaCulture
} from "./mediaLocalization.mjs";

async function testResolvesCurrentCultureFirst() {
    global.fetch = async (url) => ({
        ok: String(url).includes("/media/audio/pt/tv/goal-sting.mp3")
    });

    assert.equal(setMediaCulture("pt-BR"), "pt");
    const resolved = await resolveLocalizedAudioPath("goal-sting.mp3", "pt", "tv", {
        legacyPath: "/audio/tv/goal-sting.mp3",
        version: "pt-first"
    });

    assert.equal(resolved, "/media/audio/pt/tv/goal-sting.mp3?v=pt-first");
}

async function testFallsBackToEnglishThenPortuguese() {
    global.fetch = async (url) => ({
        ok: String(url).includes("/media/audio/en/tv/goal-sting.mp3")
    });

    const resolved = await resolveLocalizedAudioPath("goal-sting.mp3", "fr", "tv", {
        legacyPath: "/audio/tv/goal-sting.mp3",
        version: "en-fallback"
    });

    assert.equal(resolved, "/media/audio/en/tv/goal-sting.mp3?v=en-fallback");
}

async function testFallsBackToLegacyPath() {
    global.fetch = async (url) => ({
        ok: String(url).includes("/audio/tv/goal-sting.mp3")
    });

    const resolved = await resolveLocalizedAudioPath("goal-sting.mp3", "en", "tv", {
        legacyPath: "/audio/tv/goal-sting.mp3",
        version: "legacy-fallback"
    });

    assert.equal(resolved, "/audio/tv/goal-sting.mp3?v=legacy-fallback");
}

function testBuildsStableFallbackCandidates() {
    assert.deepEqual(getCultureFallbackChain("pt"), ["pt", "en"]);
    assert.deepEqual(
        buildLocalizedMediaCandidates({
            mediaType: "audio",
            fileName: "goal-sting.mp3",
            culture: "pt",
            context: "tv",
            legacyPath: "/audio/tv/goal-sting.mp3"
        }),
        [
            "/media/audio/pt/tv/goal-sting.mp3",
            "/media/audio/en/tv/goal-sting.mp3",
            "/audio/tv/goal-sting.mp3"
        ]);
}

await testResolvesCurrentCultureFirst();
await testFallsBackToEnglishThenPortuguese();
await testFallsBackToLegacyPath();
testBuildsStableFallbackCandidates();
console.log("mediaLocalization tests passed");
