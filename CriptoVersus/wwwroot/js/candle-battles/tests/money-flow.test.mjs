import assert from 'node:assert/strict';
import test from 'node:test';
import { getMoneyFlowBuffer, inspectMoneyFlowBuffer, receiveMoneyFlowBatch, resetMoneyFlowBuffer } from '../../dist/candle-battles/money-flow.js';

globalThis.performance ??= { now: () => 0 };
globalThis.document ??= { dispatchEvent() {} };
globalThis.CustomEvent ??= class CustomEvent { constructor(type, init) { this.type = type; this.detail = init?.detail; } };

const batch = (sequence, matchId = 12) => ({
  matchId, symbol: 'BTCUSDT', sequence, windowStartUtc: '2026-01-01T00:00:00Z', windowEndUtc: '2026-01-01T00:00:00.250Z',
  eventTimeUtc: '2026-01-01T00:00:00.100Z', receivedAtUtc: '2026-01-01T00:00:00.100Z', publishedAtUtc: '2026-01-01T00:00:00.100Z',
  tradeCount: 1, totalBaseQuantity: '1', takerBuyBaseQuantity: '1', takerSellBaseQuantity: '0', takerBuyQuote: '100',
  takerSellQuote: '0', netQuote: '100', firstPrice: '100', lastPrice: '100', highPrice: '100', lowPrice: '100', isPartial: false
});

test('money flow buffer deduplicates, marks gaps and stays bounded', () => {
  resetMoneyFlowBuffer();
  assert.equal(receiveMoneyFlowBatch(batch(1), 2), true);
  assert.equal(receiveMoneyFlowBatch(batch(1), 2), false);
  assert.equal(receiveMoneyFlowBatch(batch(3), 2), true);
  assert.equal(getMoneyFlowBuffer(12).length, 2);
  const state = inspectMoneyFlowBuffer(12);
  assert.equal(state.duplicates, 1);
  assert.equal(state.gaps, 1);
  assert.equal(getMoneyFlowBuffer(12)[1].isPartial, true);
});
