import test from 'node:test';
import assert from 'node:assert/strict';
import {
    WheelMechanism,
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

test('WheelMechanism.syncToPressure preloads target hub frame and continues mechanical clock cleanly', async () => {
    const prevDocument = globalThis.document;
    const prevImage = globalThis.Image;
    const prevFetch = globalThis.fetch;

    const requestedImages = [];
    let refreshed = 0;
    const mockCtx = {
        imageSmoothingEnabled: false,
        setTransform() {},
        clearRect() {},
        save() {},
        restore() {},
        translate() {},
        rotate() {},
        beginPath() {},
        moveTo() {},
        arc() {},
        closePath() {},
        clip() {},
        drawImage() {}
    };
    globalThis.document = {
        createElement() {
            return { width: 0, height: 0, getContext: () => mockCtx };
        }
    };
    globalThis.Image = class FakeImage {
        constructor() { this.onload = null; this.onerror = null; }
        set src(value) {
            requestedImages.push(value);
            queueMicrotask(() => this.onload?.());
        }
    };
    const segments = Array.from({ length: 18 }, (_, index) => ({
        index,
        orange: `lights/segments/left/s${index}.png`,
        cyan: `lights/segments/right/s${index}.png`
    }));
    const spriteEntries = {
        'base/suporte_fixo.png': { x: 0, y: 0, width: 100, height: 100 },
        'base/cordas_extremidades.png': { x: 0, y: 0, width: 100, height: 100 },
        'lights/special/left_raios_internos.png': { x: 0, y: 0, width: 100, height: 100 },
        'lights/special/right_raios_internos.png': { x: 0, y: 0, width: 100, height: 100 },
        'lights/special/left_suporte.png': { x: 0, y: 0, width: 100, height: 100 },
        'lights/special/right_suporte.png': { x: 0, y: 0, width: 100, height: 100 },
        'hub/frames/neutral/angulo_+00.png': { x: 0, y: 0, width: 100, height: 100 },
        'hub/frames/orange/angulo_-15.png': { x: 0, y: 0, width: 100, height: 100 },
        'hub/frames/cyan/angulo_+12.png': { x: 0, y: 0, width: 100, height: 100 }
    };
    for (let angle = -6; angle <= 6; angle++) {
        const name = `${angle >= 0 ? '+' : '-'}${String(Math.abs(angle)).padStart(2, '0')}`;
        spriteEntries[`wheel/wobble/inclinacao_${name}.png`] = { x: 0, y: 0, width: 100, height: 100 };
    }
    for (const seg of segments) {
        spriteEntries[seg.orange] = { x: 0, y: 0, width: 100, height: 100 };
        spriteEntries[seg.cyan] = { x: 0, y: 0, width: 100, height: 100 };
    }
    globalThis.fetch = async () => ({
        ok: true,
        async json() {
            return {
                source_size: [1254, 1254],
                center_pivot_px: [626, 599],
                sprites: spriteEntries,
                full_ring_v2: { mode: 'full', wheel_pivot: [626, 599], segments }
            };
        }
    });

    const scene = {
        sys: {
            textures: {
                addCanvas() { return { refresh() { refreshed += 1; } }; },
                remove() {}
            }
        },
        add: {
            image() {
                return { setDisplaySize() { return this; }, setDepth() { return this; }, destroy() {} };
            }
        }
    };

    try {
        const wheel = new WheelMechanism(scene);
        await wheel.ready;

        await wheel.syncToPressure(75, 20);
        assert.ok(requestedImages.some(url => url.endsWith('hub/frames/orange/angulo_-15.png')));
        assert.equal(wheel.mechanicalState.clock, 20);
        assert.equal(wheel.currentHubAngle, -15);
        assert.equal(wheel.hubColor, 'orange');
        assert.ok(Math.abs(wheel.currentRingOrangeShare - 0.75) < 1e-9);
        assert.ok(refreshed >= 2);

        await wheel.syncToPressure(30, 50);
        assert.ok(requestedImages.some(url => url.endsWith('hub/frames/cyan/angulo_+12.png')));
        assert.equal(wheel.mechanicalState.clock, 50);
        assert.equal(wheel.currentHubAngle, 12);
        assert.equal(wheel.hubColor, 'cyan');
        assert.ok(Math.abs(wheel.currentRingOrangeShare - 0.30) < 1e-9);
        wheel.destroy();
    } finally {
        globalThis.document = prevDocument;
        globalThis.Image = prevImage;
        globalThis.fetch = prevFetch;
    }
});
