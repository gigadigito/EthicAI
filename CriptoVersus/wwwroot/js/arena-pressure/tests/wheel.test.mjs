import test from 'node:test';
import assert from 'node:assert/strict';
import {
    buildWheelRingSegments,
    stepWheelMotion
} from '../../dist/arena-pressure/wheel.js';

function sum(values) {
    return values.reduce((total, value) => total + value, 0);
}

test('wheel ring maps the pressure pair to one continuous 360-degree indicator', () => {
    for (const leftPressure of [0, 25, 35, 50, 65, 75, 100]) {
        const segments = buildWheelRingSegments(leftPressure);
        assert.equal(segments.length, 64);
        assert.ok(segments.every((segment) => segment.startAngle < segment.endAngle));
        assert.ok(Math.abs(sum(segments.map((segment) => segment.orangePortion)) - (64 * leftPressure / 100)) < 1e-9);
        assert.ok(Math.abs(sum(segments.map((segment) => segment.cyanPortion)) - (64 * (100 - leftPressure) / 100)) < 1e-9);
    }
});

test('wheel ring preserves the fixed lower-centre start and angular direction', () => {
    const segments = buildWheelRingSegments(65);
    const visibleSweep = sum(segments.map((segment) => segment.endAngle - segment.startAngle));
    assert.ok(Math.abs(segments[0].startAngle - (Math.PI * 0.5 + 0.009)) < 1e-9);
    assert.ok(Math.abs(visibleSweep - (Math.PI * 2 - 64 * 0.018)) < 1e-9);
    assert.ok(segments.findIndex((segment) => segment.orangePortion < 1) >= 0);
    assert.ok(segments.findIndex((segment) => segment.cyanPortion < 1) >= 0);
});

test('wheel motion only receives impulses from pressure changes', () => {
    let state = { rotation: 0, angularVelocity: 0, targetAngularVelocity: 0 };
    for (let i = 0; i < 120; i++) {
        state = stepWheelMotion(state, 0, 16.6);
    }
    assert.ok(Math.abs(state.angularVelocity) < 0.001);

    const leftAdvance = stepWheelMotion({ rotation: 0, angularVelocity: 0, targetAngularVelocity: 0 }, 20, 16.6);
    assert.ok(leftAdvance.angularVelocity < 0, 'left advance must rotate counter-clockwise');
    assert.ok(leftAdvance.rotation < 0);

    const rightAdvance = stepWheelMotion({ rotation: 0, angularVelocity: 0, targetAngularVelocity: 0 }, -30, 16.6);
    assert.ok(rightAdvance.angularVelocity > 0, 'right advance must rotate clockwise');
    assert.ok(rightAdvance.rotation > 0);
});

test('wheel motion brakes before reversing and freezes while paused', () => {
    let state = { rotation: 0, angularVelocity: 0, targetAngularVelocity: 0 };
    state = stepWheelMotion(state, 25, 16.6);
    const beforeReverse = state;
    state = stepWheelMotion(state, -25, 16.6);
    assert.ok(state.angularVelocity <= 0, 'direction must not invert instantly');

    for (let i = 0; i < 120; i++) {
        state = stepWheelMotion(state, 0, 16.6);
    }
    assert.ok(state.angularVelocity > beforeReverse.angularVelocity);
    assert.ok(state.angularVelocity > 0, 'the braked mechanism must eventually reverse');

    const paused = stepWheelMotion(state, 100, 64, false);
    assert.deepEqual(paused, state);
});
