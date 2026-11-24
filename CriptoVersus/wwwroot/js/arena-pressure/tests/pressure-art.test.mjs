import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { PressureArt } from '../../dist/arena-pressure/pressure-art.js';
import { PressureVisualStateMachine } from '../../dist/arena-pressure/pressure-visual.js';

function harness(available = true) {
    const images = [];
    const killed = [];
    const tweens = [];
    const frames = [];
    let visible = true;
    const scene = {
        textures: { exists: () => available, get(key) { return { add(frame, source, x, y, width, height) { frames.push({ key, frame, x, y, width, height }); } }; } },
        add: { image(x, y, key, frame) {
            const image = { x, y, key, frame, texture: { key }, destroyed: false,
                setOrigin() { return this; }, setDisplaySize(width, height) { this.displayWidth = width; this.displayHeight = height; return this; },
                setFlipX(value) { this.flipX = value; return this; },
                setDepth() { return this; }, setAlpha() { return this; },
                destroy() { this.destroyed = true; } };
            images.push(image);
            return image;
        } },
        tweens: { add(config) { tweens.push(config); }, killTweensOf(image) { killed.push(image); } }
    };
    const candles = { setCharactersVisible(value) { visible = value; } };
    return { scene, candles, images, frames, killed, tweens, get visible() { return visible; } };
}

test('group art replaces animated characters and transitions without blank frames', () => {
    const h = harness();
    const art = new PressureArt(h.scene, h.candles, false, 50);
    assert.equal(h.visible, false);
    assert.equal(h.images.length, 6);
    assert.ok(h.images.every(image => image.flipX && image.displayWidth > 100 && image.displayHeight > 205));
    assert.equal(h.frames.length, 42);
    for (const key of new Set(h.frames.map(frame => frame.key))) {
        const sections = h.frames.filter(frame => frame.key === key);
        assert.equal(sections.length, 3);
        assert.equal(sections[0].x, 0);
        assert.equal(sections[0].width + sections[1].width + sections[2].width, 1200);
        assert.equal(sections[2].x + sections[2].width, 1200);
    }
    assert.deepEqual(art.getRopeGripPoints('buy').map(point => Math.round(point.x)), [106, 155, 204]);
    assert.deepEqual(art.getRopeGripPoints('sell').map(point => Math.round(point.x)), [854, 805, 756]);
    assert.equal(Math.round(art.getRopeGripPoints('buy')[0].y), 350);
    art.update(400, 80, 20);
    assert.equal(h.images.length, 12);
    assert.equal(h.images[6].key, 'buy_state_3_dominant');
    assert.equal(h.images[9].key, 'sell_state_3_struggling');
    assert.ok(h.images.every(image => image.flipX));
    assert.equal(h.images[0].destroyed, false);
    art.update(800, 95, 5);
    assert.equal(h.images[12].key, 'buy_state_4_extreme');
    assert.equal(h.images[15].key, 'sell_state_4_collapsed');
    art.destroy();
    assert.ok(h.images.every(image => image.destroyed));
    assert.ok(h.killed.length >= 18);
});

test('missing optional texture retains original animated characters', () => {
    const h = harness(false);
    const art = new PressureArt(h.scene, h.candles, false, 50);
    art.update(400, 95, 5);
    assert.equal(h.visible, true);
    assert.equal(h.images.length, 0);
    art.destroy();
});

test('all fourteen pressure states face their opponent at the enlarged size', () => {
    const seen = new Set();
    for (const left of [50, 65, 80, 95, 35, 20, 5]) {
        const h = harness();
        const art = new PressureArt(h.scene, h.candles, true, left);
        assert.equal(art.getRopeGripPoints('sell').length, left === 5 ? 0 : 3);
        for (const image of h.images) {
            seen.add(image.key);
            assert.equal(image.flipX, true, image.key);
            if (image.key === 'buy_state_2_pressed') {
                assert.equal(image.frame, '__BASE');
                assert.equal(image.displayWidth, 335);
                assert.deepEqual(art.getRopeGripPoints('buy').map(point => point.x), [79, 165, 249]);
            } else if (image.key.endsWith('_collapsed')) {
                assert.match(image.frame, /^member-[0-2]$/);
                assert.equal(image.displayHeight, 181.25);
            } else {
                assert.match(image.frame, /^member-[0-2]$/);
                assert.ok(image.displayHeight > 205);
            }
        }
        art.destroy();
    }
    assert.equal(seen.size, 14);
});

test('versioned runtime includes both pressure modules', () => {
    for (const module of ['pressure-art', 'pressure-visual']) {
        assert.ok(existsSync(new URL(`../../dist/arena-pressure/${module}.20261124a.js`, import.meta.url)));
    }
});

test('PressureVisualStateMachine.reset and PressureArt.snapToPressure seek instantly without dwell or tweening', () => {
    const machine = new PressureVisualStateMachine(50, 50, 0, 300, 2);
    // Normal update inside dwell window stays balanced
    const held = machine.update(80, 20, 100);
    assert.equal(held.buy, 'buy_state_1_balanced');
    // Reset bypasses dwell and hysteresis immediately
    const snapped = machine.reset(80, 20, 10000);
    assert.equal(snapped.buy, 'buy_state_3_dominant');
    assert.equal(snapped.sell, 'sell_state_3_struggling');

    const h = harness();
    const art = new PressureArt(h.scene, h.candles, false, 50);
    const tweensBeforeSnap = h.tweens.length;
    art.snapToPressure(92, 8, 20000);
    assert.equal(art.state.buy, 'buy_state_4_extreme');
    assert.equal(art.state.sell, 'sell_state_4_collapsed');
    assert.equal(h.tweens.length, tweensBeforeSnap, 'snapToPressure must swap sprites without crossfade tweens');
    assert.ok(h.images.slice(0, 6).every(img => img.destroyed), 'previous balanced sprites must be destroyed immediately');
    art.destroy();
});
