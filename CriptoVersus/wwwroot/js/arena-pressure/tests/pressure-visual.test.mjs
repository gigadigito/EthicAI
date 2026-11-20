import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolvePressureVisualState, PressureVisualStateMachine, PRESSURE_SPRITE_KEYS } from '../../dist/arena-pressure/pressure-visual.js';

test('maps both sides through balanced, dominant and defeated poses', () => {
    assert.deepEqual(resolvePressureVisualState(50, 50), {
        dominant: 'balanced', level: 1, buy: 'buy_state_1_balanced', sell: 'sell_state_1_balanced'
    });
    assert.deepEqual(resolvePressureVisualState(20, 80), {
        dominant: 'sell', level: 3, buy: 'buy_state_3_struggling', sell: 'sell_state_3_dominant'
    });
    assert.deepEqual(resolvePressureVisualState(90, 10), {
        dominant: 'buy', level: 4, buy: 'buy_state_4_extreme', sell: 'sell_state_4_collapsed'
    });
    assert.equal(resolvePressureVisualState(0, 100).buy, 'buy_state_4_collapsed');
    assert.equal(resolvePressureVisualState(100, 0).sell, 'sell_state_4_collapsed');
    assert.equal(resolvePressureVisualState(NaN, Infinity).level, 1);
});

test('hysteresis and dwell resist boundary oscillation but allow extreme reversal', () => {
    const machine = new PressureVisualStateMachine(69, 31, 0, 300, 2);
    assert.equal(machine.update(71, 29, 400).level, 2);
    assert.equal(machine.update(69, 31, 800).level, 2);
    assert.equal(machine.update(73, 27, 900).level, 3);
    assert.equal(machine.update(90, 10, 1000).level, 3);
    assert.equal(machine.update(5, 95, 1001).sell, 'sell_state_4_extreme');
    assert.equal(machine.update(50, 50, 1400).level, 1);
});

test('all 14 runtime textures exist as RGBA PNGs', () => {
    assert.equal(PRESSURE_SPRITE_KEYS.length, 14);
    assert.equal(new Set(PRESSURE_SPRITE_KEYS).size, 14);
    for (const key of PRESSURE_SPRITE_KEYS) {
        const path = new URL(`../../../games/arena-pressure/assets/pressure-states/runtime/${key}.png`, import.meta.url);
        assert.ok(existsSync(path), key);
        const png = readFileSync(path);
        assert.equal(png.toString('ascii', 1, 4), 'PNG', key);
        assert.equal(png.readUInt32BE(16), 1200, key);
        assert.equal(png.readUInt32BE(20), 528, key);
        assert.equal(png[25], 6, key); // RGBA
    }
});
