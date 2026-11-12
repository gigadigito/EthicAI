import test from 'node:test';
import assert from 'node:assert/strict';
import {
    cssPixelToRenderPixel,
    getTeamHorizontalBounds,
    getTransitPath
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
    assert.deepEqual(leftBuy, { fromX: -23, toX: -2 });
    assert.deepEqual(leftSell, { fromX: 3, toX: -18 });
    assert.deepEqual(rightBuy, { fromX: -3, toX: 18 });
    assert.deepEqual(rightSell, { fromX: 23, toX: 2 });
});

test('CSS and Babylon render coordinates use the same viewport reference', () => {
    assert.equal(cssPixelToRenderPixel(0, 1920, 1536), 0);
    assert.equal(cssPixelToRenderPixel(960, 1920, 1536), 768);
    assert.equal(cssPixelToRenderPixel(1920, 1920, 1536), 1536);
    assert.equal(cssPixelToRenderPixel(1720, 3440, 3440), 1720);
});
