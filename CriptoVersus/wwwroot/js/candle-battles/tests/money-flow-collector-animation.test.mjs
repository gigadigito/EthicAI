import assert from 'node:assert/strict';
import test from 'node:test';
import {
  collectorAnimationChanged,
  collectorAnimationForState,
  collectorAnimationFrames,
} from '../../dist/candle-battles/money-flow-collector-renderer.js';

test('collector states select authored poses rather than a synthetic demon walk', () => {
  assert.equal(collectorAnimationForState('demon-approach'), 'demon-idle');
  assert.equal(collectorAnimationForState('demon-stop'), 'demon-idle');
  assert.equal(collectorAnimationForState('demon-reach'), 'demon-approach');
  assert.equal(collectorAnimationForState('angel-hover'), 'angel-hover');
  assert.deepEqual(collectorAnimationFrames('angel-hover', 'left'), ['angel-approach-left-2']);
  assert.deepEqual(collectorAnimationFrames('demon-carry', 'right'), ['demon-carry-right-1', 'demon-carry-right-2']);
});

test('completed one-shot collector animations remain held until state or facing changes', () => {
  assert.equal(collectorAnimationChanged('demon-grab', 'left', 'demon-grab', 'left'), false);
  assert.equal(collectorAnimationChanged('angel-hold', 'right', 'angel-hold', 'right'), false);
  assert.equal(collectorAnimationChanged('demon-grab', 'left', 'demon-carry', 'left'), true);
  assert.equal(collectorAnimationChanged('demon-grab', 'left', 'demon-grab', 'right'), true);
});
