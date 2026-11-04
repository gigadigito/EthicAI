import test from 'node:test';
import assert from 'node:assert/strict';
import {
    normalizePressure,
    determineDominance,
    determineCandleState,
    formatDisplaySymbol,
    sampleHistory,
    resolveHistoryDuration,
    clampPercent
} from '../../dist/arena-pressure/model.js';

test('normalizePressure handles balanced defaults when empty or null', () => {
    assert.deepEqual(normalizePressure(null, null), { left: 50, right: 50 });
    assert.deepEqual(normalizePressure(undefined, undefined), { left: 50, right: 50 });
    assert.deepEqual(normalizePressure(NaN, NaN), { left: 50, right: 50 });
});

test('normalizePressure normalizes arbitrary pairs to sum to exactly 100%', () => {
    assert.deepEqual(normalizePressure(58, 42), { left: 58, right: 42 });
    assert.deepEqual(normalizePressure(70, 30), { left: 70, right: 30 });
    assert.deepEqual(normalizePressure(100, 0), { left: 100, right: 0 });
    assert.deepEqual(normalizePressure(0, 100), { left: 0, right: 100 });
});

test('normalizePressure computes counterpart when only one side is given', () => {
    assert.deepEqual(normalizePressure(65, null), { left: 65, right: 35 });
    assert.deepEqual(normalizePressure(null, 40), { left: 60, right: 40 });
});

test('determineDominance applies deadband correctly', () => {
    assert.equal(determineDominance(50, 50), 'balanced');
    assert.equal(determineDominance(52, 48), 'balanced'); // diff is 4 -> balanced
    assert.equal(determineDominance(48, 52), 'balanced');
    assert.equal(determineDominance(53, 47), 'left');     // diff is 6 -> left
    assert.equal(determineDominance(45, 55), 'right');    // diff is 10 -> right
    assert.equal(determineDominance(80, 20), 'left');
});

test('determineCandleState assigns appropriate pull and resistance states', () => {
    // Live: Balanced
    assert.equal(determineCandleState(50, false, false, false), 'idle');
    assert.equal(determineCandleState(50, true, false, false), 'pull-light');

    // Live: Moderate dominance
    assert.equal(determineCandleState(60, true, false, false), 'pull-medium');
    assert.equal(determineCandleState(40, false, false, false), 'resist');

    // Live: Heavy dominance
    assert.equal(determineCandleState(75, true, false, false), 'pull-heavy');
    assert.equal(determineCandleState(25, false, false, false), 'exhausted');

    // Live: Quick recovery from disadvantage
    assert.equal(determineCandleState(55, true, false, false, 45), 'recover');

    // Finished match
    assert.equal(determineCandleState(65, true, true, true), 'victory');
    assert.equal(determineCandleState(35, false, true, false), 'defeat');
    assert.equal(determineCandleState(50, false, true, false), 'idle');
});

test('formatDisplaySymbol formats and strips USDT suffix', () => {
    assert.equal(formatDisplaySymbol('LSK/USDT'), 'LSK');
    assert.equal(formatDisplaySymbol('BMTUSDT'), 'BMT');
    assert.equal(formatDisplaySymbol('SOL'), 'SOL');
    assert.equal(formatDisplaySymbol(''), '--');
    assert.equal(formatDisplaySymbol(null), '--');
});

const history = [
    { t: 0, l: 50 },
    { t: 10, l: 58 },
    { t: 20, l: 42 },
    { t: 30, l: 55 }
];

test('sampleHistory is stateless and interpolates between real samples', () => {
    assert.equal(sampleHistory(history, 0), 50);
    assert.equal(sampleHistory(history, 10), 58);
    assert.equal(sampleHistory(history, 5), 54);
    assert.equal(sampleHistory(history, 15), 50);

    // Repeated and out of order reads must be identical: seeking cannot duplicate events.
    assert.equal(sampleHistory(history, 15), sampleHistory(history, 15));
    assert.equal(sampleHistory(history, 20), 42);
    assert.equal(sampleHistory(history, 15), 50);
});

test('sampleHistory clamps outside the timeline and tolerates empty input', () => {
    assert.equal(sampleHistory(history, -5), 50);
    assert.equal(sampleHistory(history, 999), 55);
    assert.equal(sampleHistory(undefined, 5), null);
    assert.equal(sampleHistory([], 5), null);
    assert.equal(sampleHistory([{ t: 4, l: 61 }], 99), 61);
});

test('sampleHistory keeps every reconstructed sample inside 0..100', () => {
    for (const point of history) {
        const value = sampleHistory(history, point.t);
        assert.ok(value >= 0 && value <= 100);
    }
});

test('resolveHistoryDuration prefers the explicit duration and never returns zero', () => {
    assert.equal(resolveHistoryDuration(history, 45), 45);
    assert.equal(resolveHistoryDuration(history, undefined), 30);
    assert.equal(resolveHistoryDuration([], undefined), 1);
    assert.equal(resolveHistoryDuration(history, 0), 30);
});

test('clampPercent rejects non finite input and bounds the range', () => {
    assert.equal(clampPercent(Number.NaN), 50);
    assert.equal(clampPercent(-20), 0);
    assert.equal(clampPercent(140), 100);
    assert.equal(clampPercent(57.4), 57.4);
});
