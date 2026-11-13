import assert from 'node:assert/strict';
import test from 'node:test';
import {
    addCreatureCounts,
    creaturePoints,
    creatureTradeCount,
    emptyCreatureCounts,
    oceanControl,
} from '../../dist/whale-ocean/whale-ocean-scoreboard.js';

test('scoreboard counts trades independently of the visible entity budget', () => {
    const counts = emptyCreatureCounts();
    counts.buy.small = 600;
    counts.buy.medium = 250;
    counts.buy.large = 100;
    counts.buy.shark = 40;
    counts.buy.whale = 10;
    addCreatureCounts(counts, {
        buy: { small: 0, medium: 0, large: 0, shark: 0, whale: 0 },
        sell: { small: 0, medium: 0, large: 0, shark: 0, whale: 0 }
    });

    assert.equal(creatureTradeCount(counts), 1_000);
    assert.equal(creaturePoints(counts), 600 + 250 * 3 + 100 * 8 + 40 * 20 + 10 * 60);
});

test('buy and sell remain separate and ocean control is neutral at zero', () => {
    const counts = emptyCreatureCounts();
    counts.buy.medium = 2;
    counts.sell.whale = 1;
    assert.equal(counts.buy.medium, 2);
    assert.equal(counts.sell.whale, 1);
    assert.deepEqual(oceanControl(0, 0), { left: null, right: null });
    assert.deepEqual(oceanControl(25, 75), { left: 25, right: 75 });
});
