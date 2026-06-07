import assert from "node:assert/strict";

import {
    ambientTracks,
    chooseNextBackgroundTrack,
    normalizeBackgroundAudioConfig,
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

function testChoosesSingleBackgroundTrack() {
    const tracks = normalizeBackgroundAudioConfig({
        tracks: ["media/audio/en/tv/stadium-crowd-loop.mp3"]
    }).tracks;

    const result = chooseNextBackgroundTrack(tracks, {
        currentIndex: 0,
        lastTrackSrc: "media/audio/en/tv/stadium-crowd-loop.mp3"
    });

    assert.equal(result?.index, 0);
    assert.equal(result?.track?.rawPath, "media/audio/en/tv/stadium-crowd-loop.mp3");
}

function testChoosesSequentialBackgroundTrack() {
    const tracks = normalizeBackgroundAudioConfig({
        tracks: [
            "media/audio/en/tv/stadium-crowd-loop.mp3",
            "media/audio/en/tv/StadiumCrowd.mp3",
            "media/audio/en/tv/crowareana3.mp3"
        ]
    }).tracks;

    const result = chooseNextBackgroundTrack(tracks, {
        currentIndex: 0,
        lastTrackSrc: "media/audio/en/tv/stadium-crowd-loop.mp3",
        shuffle: false
    });

    assert.equal(result?.index, 1);
    assert.equal(result?.track?.rawPath, "media/audio/en/tv/StadiumCrowd.mp3");
}

function testChoosesShuffleBackgroundTrack() {
    const tracks = normalizeBackgroundAudioConfig({
        tracks: [
            "media/audio/en/tv/stadium-crowd-loop.mp3",
            "media/audio/en/tv/StadiumCrowd.mp3",
            "media/audio/en/tv/crowareana3.mp3"
        ]
    }).tracks;

    const result = chooseNextBackgroundTrack(tracks, {
        currentIndex: 1,
        lastTrackSrc: "media/audio/en/tv/StadiumCrowd.mp3",
        shuffle: true,
        random: () => 0.75
    });

    assert.equal(result?.track?.rawPath, "media/audio/en/tv/crowareana3.mp3");
}

function testAvoidsImmediateRepeatWhenPossible() {
    const tracks = normalizeBackgroundAudioConfig({
        tracks: [
            "media/audio/en/tv/stadium-crowd-loop.mp3",
            "media/audio/en/tv/StadiumCrowd.mp3"
        ]
    }).tracks;

    const result = chooseNextBackgroundTrack(tracks, {
        currentIndex: 0,
        lastTrackSrc: "media/audio/en/tv/StadiumCrowd.mp3",
        shuffle: true,
        avoidImmediateRepeat: true,
        random: () => 0.99
    });

    assert.notEqual(result?.track?.rawPath, "media/audio/en/tv/StadiumCrowd.mp3");
}

function testReturnsNullForEmptyBackgroundTrackList() {
    assert.equal(chooseNextBackgroundTrack([], { shuffle: true }), null);
}

testExportsStableAudioConfig();
testNormalizesAudioError();
testChoosesSingleBackgroundTrack();
testChoosesSequentialBackgroundTrack();
testChoosesShuffleBackgroundTrack();
testAvoidsImmediateRepeatWhenPossible();
testReturnsNullForEmptyBackgroundTrackList();
console.log("tvAudioConfig tests passed");
