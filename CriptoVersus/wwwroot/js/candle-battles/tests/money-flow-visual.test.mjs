import assert from 'node:assert/strict';
import test from 'node:test';
import { decideMoneyFlow, MoneyFlowVisualState, ReusablePool, planBagSpawn } from '../../dist/candle-battles/money-flow-visual.js';
import { bagFrameForPhase, accentFrameFor } from '../../dist/candle-battles/money-flow-effects-renderer.js';
import { buildMoneyFlowAnchors } from '../../dist/candle-battles/money-flow-collectors.js';

const batch = (overrides = {}) => ({
  matchId: 12, symbol: 'BTCUSDT', sequence: 1, windowStartUtc: '2026-01-01T00:00:00Z', windowEndUtc: '2026-01-01T00:00:01Z',
  eventTimeUtc: '2026-01-01T00:00:01Z', receivedAtUtc: '2026-01-01T00:00:01Z', publishedAtUtc: '2026-01-01T00:00:01Z',
  tradeCount: 30, totalBaseQuantity: '3', takerBuyBaseQuantity: '2', takerSellBaseQuantity: '1', takerBuyQuote: '220',
  takerSellQuote: '100', netQuote: '120', firstPrice: '100', lastPrice: '100.2', highPrice: '100.3', lowPrice: '99.9', isPartial: false,
  ...overrides
});

test('price movement decides visual direction independently of net quote', () => {
  assert.equal(decideMoneyFlow(batch({ lastPrice: '100.4', netQuote: '-500' })).direction, 'positive');
  assert.equal(decideMoneyFlow(batch({ lastPrice: '99.6', netQuote: '500' })).direction, 'negative');
  assert.deepEqual(decideMoneyFlow(batch({ lastPrice: '100' })), { direction: 'neutral', intensity: 0 });
});

test('sub-precision jitter keeps the flow neutral instead of flickering', () => {
  assert.deepEqual(decideMoneyFlow(batch({ lastPrice: '100.00000000000001' }), 100), { direction: 'neutral', intensity: 0 });
  assert.equal(decideMoneyFlow(batch({ lastPrice: '100.001' }), 100).direction, 'positive');
});

test('tiny real moves stay weaker than large ones', () => {
  const tiny = decideMoneyFlow(batch({ lastPrice: '100.002' }), 100).intensity;
  const large = decideMoneyFlow(batch({ lastPrice: '104' }), 100).intensity;
  assert.ok(tiny > 0);
  assert.ok(tiny < large);
});

test('invalid prices never produce a direction', () => {
  assert.deepEqual(decideMoneyFlow(batch({ firstPrice: '0', lastPrice: '100' })), { direction: 'neutral', intensity: 0 });
  assert.deepEqual(decideMoneyFlow(batch({ firstPrice: '100', lastPrice: 'NaN' })), { direction: 'neutral', intensity: 0 });
});

test('partial batches are intentionally conservative', () => {
  const full = decideMoneyFlow(batch()).intensity;
  const partial = decideMoneyFlow(batch({ isPartial: true })).intensity;
  assert.ok(partial > 0);
  assert.ok(partial < full);
});

test('single-price batches use the preceding valid price without inventing an initial move', () => {
  const state = new MoneyFlowVisualState();
  assert.deepEqual(state.ingest(batch({ firstPrice: '100', lastPrice: '100' })), { direction: 'neutral', intensity: 0 });
  assert.equal(state.referencePrice, 100);
  assert.equal(state.ingest(batch({ sequence: 2, firstPrice: '100.3', lastPrice: '100.3' })).direction, 'positive');
  assert.equal(state.ingest(batch({ sequence: 3, firstPrice: '99.8', lastPrice: '99.8' })).direction, 'negative');
  assert.equal(state.ingest(batch({ sequence: 4, firstPrice: '99.8', lastPrice: '99.8' })).direction, 'neutral');
});

test('visual accumulator is bounded, smoothed, and responds in both directions', () => {
  const state = new MoneyFlowVisualState();
  for (let index = 0; index < 10; index++) state.ingest(batch({ sequence: index + 1 }));
  state.advance(160);
  const raised = state.snapshot();
  assert.ok(raised.accumulator <= 1 && raised.accumulator > 0);
  assert.ok(raised.displayedCandle > .5 && raised.displayedCandle <= .84);
  for (let index = 0; index < 12; index++) state.ingest(batch({ sequence: index + 20, lastPrice: '99.2' }));
  state.advance(320);
  const lowered = state.snapshot();
  assert.ok(lowered.accumulator >= -1 && lowered.accumulator < 0);
  assert.ok(lowered.displayedCandle >= .16 && lowered.displayedCandle < raised.displayedCandle);
});

test('fixed pools reuse released particles and never exceed their capacity', () => {
  let creations = 0;
  const pool = new ReusablePool(2, () => ({ active: false, id: ++creations }));
  const first = pool.acquire();
  const second = pool.acquire();
  assert.equal(pool.acquire(), undefined);
  pool.release(first);
  const reused = pool.acquire();
  assert.equal(reused, first);
  assert.equal(creations, 2);
  assert.equal(pool.activeCount, 2);
  assert.equal(second.id, 2);
});

test('bag frames follow the real atlas order for every visual phase', () => {
  assert.equal(bagFrameForPhase('falling', 0), 'bag-fall-1');
  assert.equal(bagFrameForPhase('falling', .5), 'bag-fall-7');
  assert.equal(bagFrameForPhase('falling', 1), 'bag-fall-12');
  assert.equal(bagFrameForPhase('landing', 0), 'bag-squash-1');
  assert.equal(bagFrameForPhase('landing', .6), 'bag-squash-3');
  assert.equal(bagFrameForPhase('landing', 1), 'bag-squash-4');
  assert.equal(bagFrameForPhase('resting'), 'bag-burn-1');
  assert.equal(bagFrameForPhase('carried'), 'bag-burn-1');
  assert.equal(bagFrameForPhase('burning', 0), 'bag-burn-1');
  assert.equal(bagFrameForPhase('burning', 1), 'bag-burn-12');
});

test('accent frames expose the coin and arrow sequences from the atlas', () => {
  assert.equal(accentFrameFor(true, 0), 'positive-coins-1');
  assert.equal(accentFrameFor(true, 1), 'positive-coins-8');
  assert.equal(accentFrameFor(false, 0), 'negative-arrows-1');
  assert.equal(accentFrameFor(false, 1), 'negative-arrows-8');
});

const anchors = () => buildMoneyFlowAnchors({ side: 'left', centreX: 330, groundY: 445, laneLeft: 80, laneRight: 560 });

test('positive spawn plans fall from the upper region onto varied hand targets', () => {
  const base = anchors();
  const plan = planBagSpawn(true, base, [.5, .5, 0, .5, .5]);
  assert.ok(plan.y >= base.region.top, 'spawn clears the fixed HUD panel');
  assert.ok(plan.y < base.body.y, 'spawn stays in the upper region of the fighter');
  assert.equal(plan.targetY, base.hands.y + 34);
  assert.ok(Math.abs(plan.targetX - base.hands.x) <= base.region.fighterWidth * .63);
  assert.ok(plan.x >= base.region.left && plan.x <= base.region.right);
  assert.ok(plan.fallDuration >= 850 && plan.fallDuration <= 1450);
  const lateral = planBagSpawn(true, base, [.02, .02, .5, .5, .5]);
  const lateralRight = planBagSpawn(true, base, [.98, .98, .5, .5, .5]);
  assert.ok(lateral.x < plan.x && lateralRight.x > plan.x, 'triangular sampling spreads across the region');
  assert.ok(lateralRight.x - lateral.x > 150, 'horizontal spread far exceeds the old 72px column');
});

test('negative spawn plans leave the body and land on varied floor points', () => {
  const base = anchors();
  const plan = planBagSpawn(false, base, [.5, .5, .5, .5, .5]);
  assert.ok(plan.y > base.head.y && plan.y < base.body.y + 30, 'negative bags start close to the body');
  assert.equal(plan.targetY, base.region.floorY);
  assert.ok(plan.targetX >= base.region.left && plan.targetX <= base.region.right);
  const left = planBagSpawn(false, base, [0, 0, .5, 0, .5]);
  const right = planBagSpawn(false, base, [1, 1, .5, 1, .5]);
  assert.ok(left.x < plan.x && right.x > plan.x);
  assert.ok(right.targetX - left.targetX > 100, 'landing points vary across the floor');
});

test('spawn plans stay inside the safe region for both sides, scales and polarities', () => {
  for (const [side, centreX, laneLeft, laneRight] of [['left', 330, 80, 560], ['right', 950, 720, 1200]]) {
    for (const scale of [.8, 1.55]) {
      const built = buildMoneyFlowAnchors({
        side, centreX, groundY: scale > 1 ? 370 : 445, fighterScale: scale, laneLeft, laneRight,
      });
      for (const positive of [true, false]) {
        for (let run = 0; run < 40; run++) {
          const plan = planBagSpawn(positive, built, [run / 40, (run * 7 % 40) / 40, (run * 13 % 40) / 40, (run * 3 % 40) / 40, .5]);
          assert.ok(plan.x >= built.region.left - 1e-9 && plan.x <= built.region.right + 1e-9, `${side}/${scale} spawn x in region`);
          assert.ok(plan.targetX >= built.region.left - 1e-9 && plan.targetX <= built.region.right + 1e-9, `${side}/${scale} target x in region`);
          assert.ok(plan.y >= built.region.top - 1e-9, `${side}/${scale} spawn clears the HUD`);
          assert.ok(plan.targetY <= built.region.floorY + 1e-9, `${side}/${scale} lands on the floor line`);
        }
      }
    }
  }
});
