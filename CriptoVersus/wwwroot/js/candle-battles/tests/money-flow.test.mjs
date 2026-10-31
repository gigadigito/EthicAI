import assert from 'node:assert/strict';
import test from 'node:test';
import { getMoneyFlowBuffer, inspectMoneyFlowBuffer, receiveMoneyFlowBatch, resetMoneyFlowBuffer } from '../../dist/candle-battles/money-flow.js';

globalThis.performance ??= { now: () => 0 };
globalThis.document ??= { dispatchEvent() {} };
globalThis.CustomEvent ??= class CustomEvent { constructor(type, init) { this.type = type; this.detail = init?.detail; } };

const batch = (sequence, matchId = 12, symbol = 'BTCUSDT') => ({
  matchId, symbol, sequence, windowStartUtc: '2026-01-01T00:00:00Z', windowEndUtc: '2026-01-01T00:00:00.250Z',
  eventTimeUtc: '2026-01-01T00:00:00.100Z', receivedAtUtc: '2026-01-01T00:00:00.100Z', publishedAtUtc: '2026-01-01T00:00:00.100Z',
  tradeCount: 1, totalBaseQuantity: '1', takerBuyBaseQuantity: '1', takerSellBaseQuantity: '0', takerBuyQuote: '100',
  takerSellQuote: '0', netQuote: '100', firstPrice: '100', lastPrice: '100', highPrice: '100', lowPrice: '100', isPartial: false
});

test('money flow sequences are isolated per symbol in the same match', () => {
  resetMoneyFlowBuffer();
  assert.equal(receiveMoneyFlowBatch(batch(1, 12, 'BTCUSDT')), true);
  assert.equal(receiveMoneyFlowBatch(batch(1, 12, 'ETHUSDT')), true);
  assert.equal(receiveMoneyFlowBatch(batch(1, 12, 'BTCUSDT')), false);
  assert.deepEqual(getMoneyFlowBuffer(12).map(item => item.symbol), ['BTCUSDT', 'ETHUSDT']);
  const state = inspectMoneyFlowBuffer(12);
  assert.equal(state.symbolCount, 2);
  assert.equal(state.duplicates, 1);
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

test('stale out-of-order events never replace newer ones', () => {
  resetMoneyFlowBuffer();
  assert.equal(receiveMoneyFlowBatch(batch(5, 12, 'BTCUSDT')), true);
  assert.equal(receiveMoneyFlowBatch(batch(4, 12, 'BTCUSDT')), false);
  assert.equal(receiveMoneyFlowBatch(batch(2, 12, 'BTCUSDT')), false);
  assert.equal(receiveMoneyFlowBatch(batch(6, 12, 'BTCUSDT')), true);
  const buffered = getMoneyFlowBuffer(12);
  assert.deepEqual(buffered.map(item => item.sequence), [5, 6]);
  assert.equal(inspectMoneyFlowBuffer(12).duplicates, 2);
});

test('reconnect replays do not duplicate the visual stream', () => {
  resetMoneyFlowBuffer();
  for (let sequence = 1; sequence <= 3; sequence++) assert.equal(receiveMoneyFlowBatch(batch(sequence, 12, 'BTCUSDT')), true);
  for (let sequence = 1; sequence <= 3; sequence++) assert.equal(receiveMoneyFlowBatch(batch(sequence, 12, 'BTCUSDT')), false);
  assert.equal(getMoneyFlowBuffer(12).length, 3);
  assert.equal(inspectMoneyFlowBuffer(12).duplicates, 3);
});

test('gaps are tracked per symbol and do not cross-contaminate', () => {
  resetMoneyFlowBuffer();
  assert.equal(receiveMoneyFlowBatch(batch(1, 12, 'BTCUSDT')), true);
  assert.equal(receiveMoneyFlowBatch(batch(1, 12, 'ETHUSDT')), true);
  assert.equal(receiveMoneyFlowBatch(batch(4, 12, 'BTCUSDT')), true);
  assert.equal(receiveMoneyFlowBatch(batch(2, 12, 'ETHUSDT')), true);
  const buffered = getMoneyFlowBuffer(12);
  assert.equal(buffered.find(item => item.symbol === 'BTCUSDT' && item.sequence === 4).isPartial, true);
  assert.equal(buffered.find(item => item.symbol === 'ETHUSDT' && item.sequence === 2).isPartial, false);
  assert.equal(inspectMoneyFlowBuffer(12).gaps, 1);
});

test('switching matches clears the previous state', () => {
  resetMoneyFlowBuffer();
  assert.equal(receiveMoneyFlowBatch(batch(7, 31, 'BTCUSDT')), true);
  resetMoneyFlowBuffer(31);
  assert.equal(getMoneyFlowBuffer(31).length, 0);
  assert.equal(inspectMoneyFlowBuffer(31).latestSequence, 0);
  assert.equal(receiveMoneyFlowBatch(batch(7, 31, 'BTCUSDT')), true);
  assert.equal(receiveMoneyFlowBatch(batch(1, 32, 'ETHUSDT')), true);
  assert.equal(getMoneyFlowBuffer(32).length, 1);
  assert.equal(getMoneyFlowBuffer(31).length, 1);
});

test('buffer capacity is hard-bounded and drops oldest first', () => {
  resetMoneyFlowBuffer();
  for (let sequence = 1; sequence <= 6; sequence++) receiveMoneyFlowBatch(batch(sequence, 12, 'BTCUSDT'), 3);
  const buffered = getMoneyFlowBuffer(12);
  assert.equal(buffered.length, 3);
  assert.deepEqual(buffered.map(item => item.sequence), [4, 5, 6]);
  assert.equal(inspectMoneyFlowBuffer(12).dropped, 3);
});
