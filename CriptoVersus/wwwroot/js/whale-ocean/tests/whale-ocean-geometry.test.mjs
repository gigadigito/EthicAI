import test from 'node:test';
import assert from 'node:assert/strict';
import {
    cssPixelToRenderPixel,
    getTeamHorizontalBounds,
    getTransitPath,
    getDirectionalTransitPath,
    positionOnTransitPath,
    preserveTransitProgress,
    getUsefulOceanVerticalViewport,
    getWhaleOceanVerticalBands
} from '../../dist/whale-ocean/whale-ocean-geometry.js';

const visible = { left: -20, center: 0, right: 20 };

test('territories share the frustum center and keep the visible body inside', () => {
    const left = getTeamHorizontalBounds(visible, 'left', 2);
    const right = getTeamHorizontalBounds(visible, 'right', 2);
    assert.deepEqual(left, { ...visible, minX: -18, maxX: -2 });
    assert.deepEqual(right, { ...visible, minX: 2, maxX: 18 });
    assert.equal(left.maxX + 2, visible.center);
    assert.equal(right.minX - 2, visible.center);
});

test('BUY and SELL paths enter from the correct edge and end at the territory edge', () => {
    const leftBuy = getTransitPath(visible, 'left', 'buy', 3, 2);
    const leftSell = getTransitPath(visible, 'left', 'sell', 3, 2);
    const rightBuy = getTransitPath(visible, 'right', 'buy', 3, 2);
    const rightSell = getTransitPath(visible, 'right', 'sell', 3, 2);
    assert.deepEqual(leftBuy, { fromX: -18, toX: -2 });
    assert.deepEqual(leftSell, { fromX: -2, toX: -23 });
    assert.deepEqual(rightBuy, { fromX: 2, toX: 23 });
    assert.deepEqual(rightSell, { fromX: 18, toX: 2 });
});

test('CSS and Babylon render coordinates use the same viewport reference', () => {
    assert.equal(cssPixelToRenderPixel(0, 1920, 1536), 0);
    assert.equal(cssPixelToRenderPixel(960, 1920, 1536), 768);
    assert.equal(cssPixelToRenderPixel(1920, 1920, 1536), 1536);
    assert.equal(cssPixelToRenderPixel(1720, 3440, 3440), 1720);
});

test('all four directional paths stay in their own territory with asymmetric sprite bodies', () => {
    const narrow = { left: -7, center: 0, right: 7 };
    const body = { left: 0.2, right: 0.3 };
    assert.deepEqual(getDirectionalTransitPath(narrow, 'left', 'buy', 0.6, body), { fromX: -6.8, toX: -0.3 });
    assert.deepEqual(getDirectionalTransitPath(narrow, 'left', 'sell', 0.6, body), { fromX: -0.3, toX: -7.6 });
    assert.deepEqual(getDirectionalTransitPath(narrow, 'right', 'buy', 0.6, body), { fromX: 0.2, toX: 7.6 });
    assert.deepEqual(getDirectionalTransitPath(narrow, 'right', 'sell', 0.6, body), { fromX: 6.7, toX: 0.2 });
});

test('every entry keeps the visible body on-screen at progress zero', () => {
    const body = { left: 0.2, right: 0.3 };
    const paths = [
        getDirectionalTransitPath(visible, 'left', 'buy', 0.6, body),
        getDirectionalTransitPath(visible, 'left', 'sell', 0.6, body),
        getDirectionalTransitPath(visible, 'right', 'buy', 0.6, body),
        getDirectionalTransitPath(visible, 'right', 'sell', 0.6, body)
    ];
    assert.deepEqual(paths.map(path => positionOnTransitPath(path, 0)), [-19.8, -0.3, 0.2, 19.7]);
});

test('resize preserves normalized progress instead of jumping or restarting a transit', () => {
    const before = getTransitPath({ left: -20, center: 0, right: 20 }, 'left', 'buy', 3, 2);
    const after = getTransitPath({ left: -30, center: 0, right: 30 }, 'left', 'buy', 3, 2);
    const currentX = positionOnTransitPath(before, 0.4);
    const progress = preserveTransitProgress(before, currentX, after);
    assert.equal(progress, 0.4);
    assert.equal(positionOnTransitPath(after, progress), -17.6);
});

test('divides only the canvas viewport into five proportional invisible depth bands', () => {
    const viewport = getUsefulOceanVerticalViewport(844);
    const bands = getWhaleOceanVerticalBands(844);
    assert.equal(bands.length, 5);
    assert.equal(bands[0].top, viewport.top);
    assert.equal(bands.at(-1).bottom, viewport.bottom);
    for (let index = 0; index < bands.length; index++) {
        assert.equal(bands[index].index, index);
        assert.ok(bands[index].bottom > bands[index].top);
        assert.equal(bands[index].center, (bands[index].top + bands[index].bottom) / 2);
        if (index > 0) assert.equal(bands[index - 1].bottom, bands[index].top);
    }
});

test('reserves the mobile HUD footprint before placing the bottom band', () => {
    const desktop = getUsefulOceanVerticalViewport(844, 1400);
    const mobile = getUsefulOceanVerticalViewport(844, 390);
    assert.ok(mobile.bottom < desktop.bottom);
    assert.ok(mobile.bottom - mobile.top > 0);
});
