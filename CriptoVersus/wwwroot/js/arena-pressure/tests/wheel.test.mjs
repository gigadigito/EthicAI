import test from 'node:test';
import assert from 'node:assert/strict';
import {
    buildFullRingCoverage,
    crownColorForPressure,
    hubAngleForPressure,
    hubColorForPressure,
    stepWheelMechanicalTension,
    wheelWobbleAngleDegrees
} from '../../dist/arena-pressure/wheel.js';

test('full ring coverage assigns every sector to one of the two colors', () => {
    for (const [left, right] of [[0, 100], [37, 63], [50, 50], [65, 35], [100, 0]]) {
        const coverage = buildFullRingCoverage(left, right);
        assert.equal(coverage.length, 18);
        assert.ok(coverage.every(segment => segment.orangePortion + segment.cyanPortion > 0.999999));
        assert.ok(coverage.every(segment => segment.orangePortion + segment.cyanPortion <= 1.000001));
        assert.ok(Math.abs(coverage.reduce((sum, segment) => sum + segment.orangePortion, 0) - left / 100 * 18) < 1e-9);
        assert.ok(Math.abs(coverage.reduce((sum, segment) => sum + segment.cyanPortion, 0) - right / 100 * 18) < 1e-9);
    }
});

test('full ring clips a fractional boundary without leaving a dark sector', () => {
    const coverage = buildFullRingCoverage(37, 63);
    const partial = coverage.filter(segment => segment.orangePortion > 0 && segment.orangePortion < 1);
    assert.equal(partial.length, 1);
    assert.ok(Math.abs(partial[0].orangePortion - 0.66) < 1e-9);
    assert.ok(Math.abs(partial[0].cyanPortion - 0.34) < 1e-9);
});

test('hub angle and color follow the real pressure difference', () => {
    assert.equal(hubAngleForPressure(50), 0);
    assert.equal(hubAngleForPressure(65), -9);
    assert.equal(hubAngleForPressure(35), 9);
    assert.equal(hubAngleForPressure(0), 30);
    assert.equal(hubAngleForPressure(100), -30);
    assert.equal(hubColorForPressure(65), 'orange');
    assert.equal(hubColorForPressure(35), 'cyan');
    assert.equal(hubColorForPressure(50), 'neutral');
    assert.equal(crownColorForPressure(65), 0xff9100);
    assert.equal(crownColorForPressure(35), 0x18d8d2);
    assert.equal(crownColorForPressure(50), 0xfdc62e);
});

test('wheel wobble stays independent and bounded by the sprite atlas', () => {
    const samples = Array.from({ length: 180 }, (_, index) =>
        wheelWobbleAngleDegrees(index / 30, 80));
    assert.ok(samples.some(value => value < 0), 'dominant right pressure may still answer left');
    assert.ok(samples.some(value => value > 0), 'the wheel must oscillate in both directions');
    assert.ok(samples.every(value => Math.abs(value) <= 6));
    assert.ok(Math.abs(wheelWobbleAngleDegrees(3, 80, true)) < Math.abs(wheelWobbleAngleDegrees(3, 80)));
});

test('mechanical tension freezes while replay is paused', () => {
    let state = { clock: 0, offsetX: 0, offsetY: 0, angle: 0 };
    for (let i = 0; i < 120; i++) {
        state = stepWheelMechanicalTension(state, 65, 16.6);
    }
    assert.ok(state.offsetX < 0);
    assert.ok(Math.abs(state.offsetY) < 0.5);
    assert.ok(Math.abs(state.angle) < 0.04);
    assert.deepEqual(stepWheelMechanicalTension(state, 35, 64, false), state);
});
