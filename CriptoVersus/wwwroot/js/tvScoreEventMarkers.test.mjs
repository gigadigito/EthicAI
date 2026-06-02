import assert from "node:assert/strict";

import { buildScoreEventMarkersModel } from "./tvScoreEventMarkers.mjs";

function buildPoints(values) {
    return values.map(([time, value]) => ({ time, value }));
}

function unix(isoDate) {
    return Math.floor(Date.parse(isoDate) / 1000);
}

function testBuildsEveryOfficialScoreEvent() {
    const markers = buildScoreEventMarkersModel({
        leftPoints: buildPoints([
            [unix("2026-06-02T15:31:00Z"), 1.0],
            [unix("2026-06-02T15:32:00Z"), 1.4],
            [unix("2026-06-02T15:33:00Z"), 1.8],
            [unix("2026-06-02T15:37:00Z"), 2.2]
        ]),
        rightPoints: buildPoints([
            [unix("2026-06-02T15:31:00Z"), 0.8],
            [unix("2026-06-02T15:32:00Z"), 1.1],
            [unix("2026-06-02T15:33:00Z"), 1.0],
            [unix("2026-06-02T15:37:00Z"), 0.9]
        ]),
        scoreEvents: [
            { matchScoreEventId: 1, teamId: 10, teamSymbol: "XAUTUSDT", points: 1, eventTimeUtc: "2026-06-02T15:31:05Z", description: "Threshold %." },
            { matchScoreEventId: 2, teamId: 20, teamSymbol: "CHZUSDT", points: 1, eventTimeUtc: "2026-06-02T15:32:01Z", description: "Crossover." },
            { matchScoreEventId: 3, teamId: 10, teamSymbol: "XAUTUSDT", points: 1, eventTimeUtc: "2026-06-02T15:32:35Z", description: "Threshold %." },
            { matchScoreEventId: 4, teamId: 10, teamSymbol: "XAUTUSDT", points: 1, eventTimeUtc: "2026-06-02T15:37:00Z", description: "Threshold %." }
        ],
        leftMeta: { symbol: "XAUTUSDT", logoUrl: "/xaut.png", accentColor: "#ffd76e" },
        rightMeta: { symbol: "CHZUSDT", logoUrl: "/chz.png", accentColor: "#86c9ff" },
        leftTeamId: 10,
        rightTeamId: 20,
        matchStartTimeUtc: "2026-06-02T15:16:00Z"
    });

    assert.equal(markers.length, 4);
    assert.deepEqual(markers.map((marker) => marker.key), ["score:1", "score:2", "score:3", "score:4"]);
}

function testKeepsSameMinuteEventsByStacking() {
    const markers = buildScoreEventMarkersModel({
        leftPoints: buildPoints([
            [unix("2026-06-02T15:31:00Z"), 1.0],
            [unix("2026-06-02T15:32:00Z"), 1.5],
            [unix("2026-06-02T15:33:00Z"), 1.9]
        ]),
        rightPoints: buildPoints([
            [unix("2026-06-02T15:31:00Z"), 0.8],
            [unix("2026-06-02T15:32:00Z"), 1.0],
            [unix("2026-06-02T15:33:00Z"), 1.1]
        ]),
        scoreEvents: [
            { matchScoreEventId: 11, teamId: 10, teamSymbol: "XAUTUSDT", points: 1, eventTimeUtc: "2026-06-02T15:32:01Z", description: "A." },
            { matchScoreEventId: 12, teamId: 10, teamSymbol: "XAUTUSDT", points: 1, eventTimeUtc: "2026-06-02T15:32:40Z", description: "B." }
        ],
        leftMeta: { symbol: "XAUTUSDT", logoUrl: "/xaut.png", accentColor: "#ffd76e" },
        rightMeta: { symbol: "CHZUSDT", logoUrl: "/chz.png", accentColor: "#86c9ff" },
        leftTeamId: 10,
        rightTeamId: 20,
        matchStartTimeUtc: "2026-06-02T15:16:00Z"
    });

    assert.equal(markers.length, 2);
    assert.equal(markers[0].stackIndex, 0);
    assert.equal(markers[1].stackIndex, 1);
    assert.notEqual(markers[0].stackOffsetPx, markers[1].stackOffsetPx);
}

testBuildsEveryOfficialScoreEvent();
testKeepsSameMinuteEventsByStacking();
console.log("tvScoreEventMarkers tests passed");
