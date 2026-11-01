import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildMoneyFlowAnchors,
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

test('anchor offsets keep the 0.8 baseline and scale with the fighter sprite', () => {
  const base = buildMoneyFlowAnchors({ side: 'left', centreX: 330, groundY: 445, laneLeft: 80, laneRight: 560 });
  assert.equal(base.head.y, 280);
  assert.equal(base.body.y, 355);
  assert.equal(base.hands.y, 353);
  assert.equal(base.hands.x, 358);
  assert.equal(base.feet.y, 441);
  assert.equal(base.ground.y, 449);
  assert.deepEqual(base.collectionBounds, { left: 80, right: 560, top: 20, bottom: 457 });
  const shell = buildMoneyFlowAnchors({ side: 'right', centreX: 950, groundY: 370, fighterScale: 1.55, laneLeft: 720, laneRight: 1200 });
  assert.ok(Math.abs(shell.head.y - (370 - 165 * 1.9375)) < 1e-9);
  assert.ok(Math.abs(shell.hands.y - (370 - 92 * 1.9375)) < 1e-9);
  assert.equal(shell.hands.x, 950 - 28 * 1.9375);
  assert.ok(shell.head.y > 40 && shell.head.y < 60, 'scaled head stays near the top of a tall fighter');
});

test('the money-flow region is fighter-relative and clamped to safe arena bounds', () => {
  const left = buildMoneyFlowAnchors({ side: 'left', centreX: 330, groundY: 445, laneLeft: 80, laneRight: 560 }).region;
  assert.ok(left.left >= 180, 'left side clears the HUD side panels');
  assert.ok(left.right <= 560, 'left side never invades the arena centre');
  assert.ok(left.right - left.left > 300, 'emission region is far wider than the old 72px column');
  assert.equal(left.top, 252, 'spawn ceiling clears the fixed top HUD panel');
  assert.equal(left.floorY, 449);
  assert.equal(left.fighterWidth, 160);
  const right = buildMoneyFlowAnchors({ side: 'right', centreX: 950, groundY: 445, laneLeft: 720, laneRight: 1200 }).region;
  assert.ok(right.left >= 720);
  assert.ok(right.right <= 1100, 'right side clears the HUD side panels');
  assert.ok(right.centerX - right.left > 150 && right.right - right.centerX >= 150);
  const shell = buildMoneyFlowAnchors({ side: 'left', centreX: 330, groundY: 370, fighterScale: 1.55, laneLeft: 80, laneRight: 560 }).region;
  assert.ok(shell.top < 120, 'tall fighters spawn near their head instead of the HUD rule');
  assert.ok(shell.top < shell.floorY);
  const pushed = buildMoneyFlowAnchors({ side: 'left', centreX: 210, groundY: 445, laneLeft: 80, laneRight: 560 }).region;
  assert.ok(pushed.left >= 180 && pushed.right <= 560 && pushed.right > pushed.left, 'clamps stay consistent when the fighter drifts');
});
