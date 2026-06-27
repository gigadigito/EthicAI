import assert from "node:assert/strict";

import { computeScoreMarkerPlacement } from "./tvChartMarkers.mjs";
import { disposeChartEntry } from "./tvChartResize.mjs";
import { normalizeChartTime } from "./tvChartTime.mjs";
import { buildScoreEventMarkersModel } from "./tvScoreEventMarkers.mjs";

function buildPoints(values) {
    return values.map(([time, value]) => ({ time, value }));
}

function unix(isoDate) {
    return Math.floor(Date.parse(isoDate) / 1000);
}

function testNormalizesIsoStringToSeconds() {
    assert.equal(normalizeChartTime("2026-06-02T15:31:05Z"), unix("2026-06-02T15:31:05Z"));
}

function testNormalizesDateToSeconds() {
    assert.equal(normalizeChartTime(new Date("2026-06-02T15:31:05Z")), unix("2026-06-02T15:31:05Z"));
}

function testNormalizesMillisecondsToSeconds() {
    assert.equal(normalizeChartTime(1780414265000), 1780414265);
}

function testKeepsSecondsAsSeconds() {
    assert.equal(normalizeChartTime(1780414265), 1780414265);
}

function testBuildsEveryOfficialScoreEvent() {
    const markers = buildScoreEventMarkersModel({
        leftPoints: buildPoints([
            [unix("2026-06-02T15:31:00Z"), 1.0],
            [unix("2026-06-02T15:32:00Z"), 0.9],
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
        leftMeta: { symbol: "XAUTUSDT", logoUrl: "/xaut.png", accentColor: "#ff9100" },
        rightMeta: { symbol: "CHZUSDT", logoUrl: "/chz.png", accentColor: "#86c9ff" },
        leftTeamId: 10,
        rightTeamId: 20,
        matchStartTimeUtc: "2026-06-02T15:16:00Z"
    });

    assert.equal(markers.length, 4);
    assert.deepEqual(markers.map((marker) => marker.key), ["score:1", "score:2", "score:3", "score:4"]);
}

function testKeepsMarkerAtSameTimestampAsSeriesPoint() {
    const [marker] = buildScoreEventMarkersModel({
        leftPoints: buildPoints([
            [100, 1.1],
            [160, 1.6]
        ]),
        rightPoints: buildPoints([
            [100, 0.7],
            [160, 0.9]
        ]),
        scoreEvents: [
            { matchScoreEventId: 101, teamId: 10, teamSymbol: "XAUTUSDT", points: 1, eventTime: 160, description: "Threshold %." }
        ],
        leftMeta: { symbol: "XAUTUSDT", logoUrl: "/xaut.png", accentColor: "#ff9100" },
        rightMeta: { symbol: "CHZUSDT", logoUrl: "/chz.png", accentColor: "#86c9ff" },
        leftTeamId: 10,
        rightTeamId: 20,
        matchStartTimeUtc: "2026-06-02T15:16:00Z"
    });

    assert.equal(marker.time, 160);
    assert.equal(marker.value, 1.6);
}

function testInterpolatesMarkerBetweenTwoSeriesPoints() {
    const [marker] = buildScoreEventMarkersModel({
        leftPoints: buildPoints([
            [100, 2.0],
            [160, 4.0]
        ]),
        rightPoints: buildPoints([
            [100, 1.0],
            [160, 1.5]
        ]),
        scoreEvents: [
            { matchScoreEventId: 102, teamId: 10, teamSymbol: "XAUTUSDT", points: 1, eventTime: 130, description: "Threshold %." }
        ],
        leftMeta: { symbol: "XAUTUSDT", logoUrl: "/xaut.png", accentColor: "#ff9100" },
        rightMeta: { symbol: "CHZUSDT", logoUrl: "/chz.png", accentColor: "#86c9ff" },
        leftTeamId: 10,
        rightTeamId: 20,
        matchStartTimeUtc: "2026-06-02T15:16:00Z"
    });

    assert.equal(marker.time, 130);
    assert.ok(Math.abs(marker.value - 3.0) < 0.0001);
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
        leftMeta: { symbol: "XAUTUSDT", logoUrl: "/xaut.png", accentColor: "#ff9100" },
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

function testOutOfRangeEventDoesNotBreakChart() {
    const warnings = [];
    const markers = buildScoreEventMarkersModel({
        leftPoints: buildPoints([
            [100, 1.0],
            [160, 1.5]
        ]),
        rightPoints: buildPoints([
            [100, 1.0],
            [160, 1.2]
        ]),
        scoreEvents: [
            { matchScoreEventId: 103, teamId: 10, teamSymbol: "XAUTUSDT", points: 1, eventTime: 99, description: "Too early." }
        ],
        leftMeta: { symbol: "XAUTUSDT", logoUrl: "/xaut.png", accentColor: "#ff9100" },
        rightMeta: { symbol: "CHZUSDT", logoUrl: "/chz.png", accentColor: "#86c9ff" },
        leftTeamId: 10,
        rightTeamId: 20
    }, {
        diagnostics: {
            recordDiscardedEvent(reason) {
                warnings.push(reason);
            }
        }
    });

    assert.equal(markers.length, 0);
    assert.deepEqual(warnings, ["event-out-of-range"]);
}

function testPositionsCrossoverMarkerAtRealIntersection() {
    const markers = buildScoreEventMarkersModel({
        leftPoints: buildPoints([
            [100, 4],
            [160, 3]
        ]),
        rightPoints: buildPoints([
            [100, 3],
            [160, 5]
        ]),
        scoreEvents: [
            {
                matchScoreEventId: 21,
                teamId: 20,
                teamSymbol: "FETUSDT",
                points: 1,
                eventTimeUtc: new Date(160000).toISOString(),
                ruleType: "PercentageCrossover",
                eventType: "PERCENTAGE_CROSSOVER_UP",
                reasonCode: "PERCENTAGE_CROSSOVER_UP",
                description: "FET marcou 1 ponto por cruzar a linha de valorizacao percentual para cima."
            }
        ],
        leftMeta: { symbol: "CHIPUSDT", logoUrl: "/chip.png", accentColor: "#ff9100" },
        rightMeta: { symbol: "FETUSDT", logoUrl: "/fet.png", accentColor: "#86c9ff" },
        leftTeamId: 10,
        rightTeamId: 20,
        matchStartTimeUtc: "2026-06-02T15:16:00Z"
    });

    assert.equal(markers.length, 1);
    assert.equal(markers[0].side, "right");
    assert.ok(Math.abs(markers[0].time - 120) < 0.0001);
    assert.ok(Math.abs(markers[0].value - 3.6666666667) < 0.0001);
}

function testPrefersDisplayedSymbolOverTeamIdWhenResolvingSeriesSide() {
    const markers = buildScoreEventMarkersModel({
        leftPoints: buildPoints([
            [100, 4.2],
            [160, 4.1]
        ]),
        rightPoints: buildPoints([
            [100, 1.2],
            [160, 1.4]
        ]),
        scoreEvents: [
            {
                matchScoreEventId: 31,
                teamId: 999,
                teamSymbol: "JTOUSDT",
                points: 1,
                eventTimeUtc: new Date(130000).toISOString(),
                description: "Threshold %."
            }
        ],
        leftMeta: { symbol: "JTOUSDT", logoUrl: "/jto.png", accentColor: "#7af5c7" },
        rightMeta: { symbol: "CHZUSDT", logoUrl: "/chz.png", accentColor: "#7dc9ff" },
        leftTeamId: 111,
        rightTeamId: 999,
        matchStartTimeUtc: "2026-06-02T15:16:00Z"
    });

    assert.equal(markers.length, 1);
    assert.equal(markers[0].side, "left");
    assert.ok(markers[0].value > 4);
}

function testResizePlacementDoesNotDuplicateMarkers() {
    const markerEntry = {
        model: { time: 120, value: 2, stackOffsetPx: 0 },
        node: {
            style: {
                left: "",
                setProperty() {
                }
            },
            classList: {
                add() {
                },
                remove() {
                }
            }
        }
    };

    const placementA = computeScoreMarkerPlacement(markerEntry.model, {
        timeToCoordinate: () => 50,
        priceToCoordinate: () => 60
    }, { width: 200, height: 100 });
    const placementB = computeScoreMarkerPlacement(markerEntry.model, {
        timeToCoordinate: () => 50,
        priceToCoordinate: () => 60
    }, { width: 200, height: 100 });

    assert.deepEqual(placementA, placementB);
}

function testDisposeRemovesOldListeners() {
    let clearedTimer = null;
    let disconnected = 0;
    let removed = 0;
    const entry = {
        markerFadeTimer: 77,
        overlayRoot: {
            remove() {
                removed += 1;
            }
        },
        scoreEventMarkerNodes: [
            {
                node: {
                    remove() {
                        removed += 1;
                    }
                }
            }
        ],
        resizeObserver: {
            disconnect() {
                disconnected += 1;
            }
        },
        chart: {
            remove() {
                removed += 1;
            }
        }
    };

    disposeChartEntry(entry, {
        clearTimer(timerId) {
            clearedTimer = timerId;
        }
    });

    assert.equal(clearedTimer, 77);
    assert.equal(disconnected, 1);
    assert.equal(removed, 3);
}

testNormalizesIsoStringToSeconds();
testNormalizesDateToSeconds();
testNormalizesMillisecondsToSeconds();
testKeepsSecondsAsSeconds();
testBuildsEveryOfficialScoreEvent();
testKeepsMarkerAtSameTimestampAsSeriesPoint();
testInterpolatesMarkerBetweenTwoSeriesPoints();
testKeepsSameMinuteEventsByStacking();
testOutOfRangeEventDoesNotBreakChart();
testPositionsCrossoverMarkerAtRealIntersection();
testPrefersDisplayedSymbolOverTeamIdWhenResolvingSeriesSide();
testResizePlacementDoesNotDuplicateMarkers();
testDisposeRemovesOldListeners();
console.log("tvScoreEventMarkers tests passed");
