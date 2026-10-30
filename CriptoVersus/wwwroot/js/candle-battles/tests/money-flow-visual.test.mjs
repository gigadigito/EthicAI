import assert from 'node:assert/strict';
import test from 'node:test';
import { decideMoneyFlow, MoneyFlowVisualState, ReusablePool } from '../../dist/candle-battles/money-flow-visual.js';

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

test('partial batches are intentionally conservative', () => {
  const full = decideMoneyFlow(batch()).intensity;
  const partial = decideMoneyFlow(batch({ isPartial: true })).intensity;
  assert.ok(partial > 0);
  assert.ok(partial < full);
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
