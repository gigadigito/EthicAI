import assert from 'node:assert/strict';
import test from 'node:test';
import {
  collectorLimit,
  normalizeCollectorQuality,
  shouldStartCollector,
} from '../../dist/candle-battles/money-flow-collectors.js';

const bag = (id, availableAge = 0) => ({
  id,
  active: true,
  side: 'left',
  positive: true,
  state: 'AVAILABLE',
  age: availableAge,
  availableAge,
  x: 100,
  y: 100,
});

test('collector quality is normalized and concurrency remains bounded', () => {
  assert.equal(normalizeCollectorQuality('LOW'), 'low');
  assert.equal(normalizeCollectorQuality('High'), 'high');
  assert.equal(normalizeCollectorQuality('unknown'), 'medium');
  assert.equal(normalizeCollectorQuality(), 'medium');
  assert.equal(collectorLimit('low', false), 1);
  assert.equal(collectorLimit('medium', false), 1);
  assert.equal(collectorLimit('high', false), 2);
  assert.equal(collectorLimit('high', true), 1);
});

test('collector scheduling reacts to queue pressure or age without waiting for a batch boundary', () => {
  assert.equal(shouldStartCollector([], 0), false);
  assert.equal(shouldStartCollector([bag(1, 1199)], 1), false);
  assert.equal(shouldStartCollector([bag(1, 1200)], 1), true);
  assert.equal(shouldStartCollector([bag(1, 500), bag(2, 100)], 2), true);
  assert.equal(shouldStartCollector([bag(1), bag(2), bag(3)], 3), true);
  assert.equal(shouldStartCollector([bag(1)], 5), true);
});
