import assert from 'node:assert/strict';
import test from 'node:test';
import {
    addCreatureCounts,
    creaturePoints,
    creatureTradeCount,
    emptyCreatureCounts,
    normalizeCreatureCounts,
    normalizeScoreboard,
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

test('normalizes the API snapshot and live counts from either JSON casing', () => {
    const snapshot = normalizeScoreboard({
        MatchId: 42,
        WindowStartUtc: '2026-11-13T12:00:00Z',
        WindowEndUtc: '2026-11-13T12:00:30Z',
        IsFinalized: false,
        TeamA: {
            Symbol: 'BARDUSDT',
            MatchTotal: { Buy: { Small: 4 }, Sell: { Whale: 1 } },
            Last30Seconds: { Buy: { Medium: 2 } },
            LastSequences: [{ SourceId: 'worker-a', Symbol: 'BARDUSDT', Sequence: 7 }]
        },
        TeamB: { Symbol: 'BMTUSDT', MatchTotal: {}, Last30Seconds: {} }
    });

    assert.equal(snapshot.matchId, 42);
    assert.equal(snapshot.teamA.symbol, 'BARDUSDT');
    assert.equal(snapshot.teamA.matchTotal.buy.small, 4);
    assert.equal(snapshot.teamA.matchTotal.sell.whale, 1);
    assert.equal(snapshot.teamA.lastSequences[0].sequence, 7);
    assert.equal(creaturePoints(snapshot.teamA.matchTotal), 64);

    const counts = normalizeCreatureCounts({ Buy: { Small: '3' }, Sell: { Shark: 2 } });
    assert.equal(creatureTradeCount(counts), 5);
    assert.equal(creaturePoints(counts), 43);
});
