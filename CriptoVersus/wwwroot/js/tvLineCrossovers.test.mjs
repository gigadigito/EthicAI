import assert from "node:assert/strict";

import {
    findLineCrossovers,
    interpolateLineCrossover,
    normalizeSeriesForCrossovers
} from "./tvLineCrossovers.mjs";

function approx(actual, expected, epsilon = 0.0001) {
    assert.ok(Math.abs(actual - expected) <= epsilon, `expected ${actual} ~= ${expected}`);
}

function testExactTimestampCrossover() {
    const crossovers = findLineCrossovers(
        [{ time: 100, value: 1 }, { time: 160, value: 3 }],
        [{ time: 100, value: 4 }, { time: 160, value: 3 }]
    );

    assert.equal(crossovers.length, 1);
    assert.equal(crossovers[0].time, 160);
    assert.equal(crossovers[0].value, 3);
}

function testInterpolatedCrossoverBetweenPoints() {
    const crossover = interpolateLineCrossover(
        { time: 100, value: 4 },
        { time: 160, value: 2 },
        { time: 100, value: 1 },
        { time: 160, value: 5 }
    );

    approx(crossover.time, 130);
    approx(crossover.value, 3);
}

function testCrossesAbove() {
    const [crossover] = findLineCrossovers(
        [{ time: 100, value: 1 }, { time: 160, value: 4 }],
        [{ time: 100, value: 3 }, { time: 160, value: 2 }]
    );

    assert.equal(crossover.direction, "a-crosses-above");
}

function testCrossesBelow() {
    const [crossover] = findLineCrossovers(
        [{ time: 100, value: 4 }, { time: 160, value: 1 }],
        [{ time: 100, value: 2 }, { time: 160, value: 3 }]
    );

    assert.equal(crossover.direction, "a-crosses-below");
}

function testMillisecondsBecomeSeconds() {
    const normalized = normalizeSeriesForCrossovers([{ time: 1780414265000, value: 1 }]);
    assert.equal(normalized[0].time, 1780414265);
}

function testIsoStringBecomesSeconds() {
    const normalized = normalizeSeriesForCrossovers([{ time: "2026-06-02T15:31:05Z", value: 1 }]);
    assert.equal(normalized[0].time, Math.floor(Date.parse("2026-06-02T15:31:05Z") / 1000));
}

function testOutOfOrderSeriesAreSorted() {
    const normalized = normalizeSeriesForCrossovers([
        { time: 160, value: 2 },
        { time: 100, value: 1 }
    ]);

    assert.deepEqual(normalized.map((point) => point.time), [100, 160]);
}

function testDifferentTimestampsStillCrossCorrectly() {
    const crossovers = findLineCrossovers(
        [{ time: 100, value: 4 }, { time: 200, value: 0 }],
        [{ time: 120, value: 1 }, { time: 220, value: 5 }]
    );

    assert.equal(crossovers.length, 1);
    approx(crossovers[0].time, 147.5);
    approx(crossovers[0].value, 2.1);
}

function testInvalidPointsAreIgnored() {
    const discarded = [];
    const normalized = normalizeSeriesForCrossovers([
        { time: null, value: 1 },
        { time: 100, value: "x" },
        { time: 120, value: 2 }
    ], {
        diagnostics: {
            recordDiscardedEvent(reason) {
                discarded.push(reason);
            }
        }
    });

    assert.equal(normalized.length, 1);
    assert.equal(discarded.length, 2);
}

function testNoCrossingReturnsEmptyArray() {
    const crossovers = findLineCrossovers(
        [{ time: 100, value: 1 }, { time: 160, value: 2 }],
        [{ time: 100, value: 3 }, { time: 160, value: 4 }]
    );

    assert.deepEqual(crossovers, []);
}

function testMultipleCrossingsReturnAll() {
    const crossovers = findLineCrossovers(
        [{ time: 100, value: 1 }, { time: 160, value: 4 }, { time: 220, value: 1 }],
        [{ time: 100, value: 4 }, { time: 160, value: 1 }, { time: 220, value: 4 }]
    );

    assert.equal(crossovers.length, 2);
    assert.equal(crossovers[0].direction, "a-crosses-above");
    assert.equal(crossovers[1].direction, "a-crosses-below");
}

testExactTimestampCrossover();
testInterpolatedCrossoverBetweenPoints();
testCrossesAbove();
testCrossesBelow();
testMillisecondsBecomeSeconds();
testIsoStringBecomesSeconds();
testOutOfOrderSeriesAreSorted();
testDifferentTimestampsStillCrossCorrectly();
testInvalidPointsAreIgnored();
testNoCrossingReturnsEmptyArray();
testMultipleCrossingsReturnAll();
console.log("tvLineCrossovers tests passed");
