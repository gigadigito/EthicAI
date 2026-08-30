import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const LogicalWidth = 1000;
const DefaultLogicalHeight = 338;

function computeLogicalHeight(renderedWidth, renderedHeight) {
    if (renderedWidth < 1 || renderedHeight < 1)
        return DefaultLogicalHeight;
    const h = LogicalWidth * renderedHeight / renderedWidth;
    return Math.max(DefaultLogicalHeight, Math.round(h * 10) / 10);
}

describe('TvCandleBattle logicalHeight', () => {
    it('800x650 → 812.5 (uniform scale 0.8)', () => {
        const lh = computeLogicalHeight(800, 650);
        assert.equal(lh, 812.5);
        const scaleX = 800 / LogicalWidth;
        const scaleY = 650 / lh;
        assert.ok(Math.abs(scaleX - scaleY) < 0.001, `scaleX=${scaleX} scaleY=${scaleY}`);
    });

    it('1000x338 → 338 (original behavior preserved)', () => {
        const lh = computeLogicalHeight(1000, 338);
        assert.equal(lh, 338);
        const scaleX = 1000 / LogicalWidth;
        const scaleY = 338 / lh;
        assert.equal(scaleX, 1);
        assert.equal(scaleY, 1);
    });

    it('1920x1080 → 562.5 (TV 16:9)', () => {
        const lh = computeLogicalHeight(1920, 1080);
        assert.equal(lh, 562.5);
        const scaleX = 1920 / LogicalWidth;
        const scaleY = 1080 / lh;
        assert.ok(Math.abs(scaleX - scaleY) < 0.001, `scaleX=${scaleX} scaleY=${scaleY}`);
    });

    it('1366x768 → 562.2 (laptop)', () => {
        const lh = computeLogicalHeight(1366, 768);
        assert.equal(lh, 562.2);
        const scaleX = 1366 / LogicalWidth;
        const scaleY = 768 / lh;
        assert.ok(Math.abs(scaleX - scaleY) < 0.002, `scaleX=${scaleX} scaleY=${scaleY}`);
    });

    it('0x0 → 338 (no measurement yet)', () => {
        assert.equal(computeLogicalHeight(0, 0), 338);
    });

    it('800x200 → 338 (clamped to minimum)', () => {
        const raw = LogicalWidth * 200 / 800;
        assert.ok(raw < DefaultLogicalHeight, `raw=${raw} should be < ${DefaultLogicalHeight}`);
        assert.equal(computeLogicalHeight(800, 200), 338);
    });

    it('scaleX equals scaleY for various aspect ratios', () => {
        const cases = [
            [800, 600],
            [1200, 800],
            [1920, 1080],
            [2560, 1440],
            [640, 480],
        ];
        for (const [w, h] of cases) {
            const lh = computeLogicalHeight(w, h);
            const sx = w / LogicalWidth;
            const sy = h / lh;
            assert.ok(Math.abs(sx - sy) < 0.002, `(${w}x${h}) scaleX=${sx.toFixed(4)} scaleY=${sy.toFixed(4)}`);
        }
    });
});
