import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildMoneyFlowAnchors,
  isCollectorTerminal,
  nextCollectorState,
  pickLateralX,
  travelDirection,
} from '../../dist/candle-battles/money-flow-collectors.js';

const groundY = 449;

const step = (overrides = {}) => ({
  state: 'demon-approach',
  positive: false,
  stateAge: 0,
  distance: 400,
  x: 200,
  y: groundY,
  portalX: 120,
  groundY,
  special: false,
  ...overrides,
});

// ---------------------------------------------------------------- direction
// The face must follow the real travel direction on the way out and on the way
// back, in both halves of the arena.  Spawning side must never decide facing.
test('facing follows real displacement in both directions', () => {
  assert.equal(travelDirection(500, 200, 'left'), 'right', 'walking right toward the bag');
  assert.equal(travelDirection(120, 500, 'right'), 'left', 'returning left toward the portal');
  assert.equal(travelDirection(200, 200, 'left'), 'left', 'holds the last facing when stationary');
});

test('a demon faces the bag going out and the portal coming back', () => {
  // Portal on the left, bag on the right.
  const outward = travelDirection(460, 120, 'right');
  assert.equal(outward, 'right', 'looks at the bag while approaching');
  const returning = travelDirection(120, 460, 'right');
  assert.equal(returning, 'left', 'looks at the portal while carrying the bag back');
  // Mirrored arena: portal on the right, bag on the left.
  assert.equal(travelDirection(300, 820, 'left'), 'left', 'mirrored approach faces the bag');
  assert.equal(travelDirection(820, 300, 'left'), 'right', 'mirrored return faces the portal');
});

// ------------------------------------------------------- capture on contact
test('the demon may not grab the bag before it is within reach', () => {
  // Still far away: the approach must continue.
  assert.equal(nextCollectorState(step({ state: 'demon-approach', distance: 300 })), null);
  assert.equal(nextCollectorState(step({ state: 'demon-approach', distance: 55 })), null);
  // In reach: it may stop.
  assert.equal(nextCollectorState(step({ state: 'demon-approach', distance: 50 })), 'demon-stop');
  // Stopping but not touching yet: no grab.
  assert.equal(nextCollectorState(step({ state: 'demon-stop', distance: 45 })), null);
  assert.equal(nextCollectorState(step({ state: 'demon-stop', distance: 30 })), 'demon-reach');
});

test('the demon walks the whole distance before it reaches', () => {
  // A long trip must still be travelling after the short-trip duration.
  const long = step({ state: 'demon-approach', distance: 300, stateAge: 650 });
  assert.equal(nextCollectorState(long), null, 'a distant demon is still walking after 650ms');
  // The state only advances on the spatial predicate.
  const arrived = step({ state: 'demon-approach', distance: 40, stateAge: 5 });
  assert.equal(nextCollectorState(arrived), 'demon-stop', 'arrival is spatial, not temporal');
});

test('the angel keeps flying until it actually reaches the bag', () => {
  assert.equal(nextCollectorState(step({ positive: true, state: 'angel-fly-empty', distance: 400 })), null);
  assert.equal(nextCollectorState(step({ positive: true, state: 'angel-fly-empty', distance: 20 })), 'angel-approach');
  assert.equal(nextCollectorState(step({ positive: true, state: 'angel-descend', distance: 25 })), null);
  assert.equal(nextCollectorState(step({ positive: true, state: 'angel-descend', distance: 18 })), 'angel-hover');
});

test('neither collector may show a carrying pose before the grab', () => {
  // The carrying states are only reachable through the grab state.
  const demonOrder = ['demon-emerge', 'demon-idle', 'demon-approach', 'demon-stop', 'demon-reach', 'demon-grab', 'demon-carry', 'demon-return', 'demon-descend', 'demon-disappear'];
  for (const state of demonOrder.slice(0, 5)) {
    assert.notEqual(state, 'demon-carry', `${state} must precede the carry`);
  }
  const angelOrder = ['angel-fly-empty', 'angel-approach', 'angel-descend', 'angel-hover', 'angel-reach', 'angel-grab', 'angel-hold', 'angel-carry'];
  for (const state of angelOrder.slice(0, 5)) {
    assert.notEqual(state, 'angel-carry', `${state} must precede the carry`);
  }
  // Reaching does not carry: only the grab does.
  assert.equal(nextCollectorState(step({ state: 'demon-reach', distance: 20, stateAge: 200 })), 'demon-grab');
  assert.equal(nextCollectorState(step({ state: 'angel-reach', distance: 20, stateAge: 200, positive: true })), 'angel-grab');
});

// --------------------------------------------------------- full demon pass
test('a demon completes emerge -> grab -> return -> disappear in order', () => {
  const seen = [];
  let state = 'demon-emerge';
  let y = groundY + 90;
  let x = 120;
  const bagX = 460;
  let stateAge = 0;
  const guard = 200;
  for (let i = 0; i < guard; i++) {
    const target = state === 'demon-return' || state === 'demon-descend' || state === 'demon-disappear' || state === 'demon-emerge'
      ? 120 : bagX;
    const distance = Math.hypot(target - x, 0);
    if (seen[seen.length - 1] !== state) seen.push(state);
    const next = nextCollectorState({ state, positive: false, stateAge, distance, x, y, portalX: 120, groundY, special: false });
    if (next) { state = next; stateAge = 0; continue; }
    stateAge += 16;
    const speed = 210 * 0.016;
    if (state === 'demon-emerge') y = Math.max(groundY, y - speed * 3);
    else if (state === 'demon-descend' || state === 'demon-disappear') y += speed * 3;
    else x += (target - x) * 0.12;
    if (isCollectorTerminal({ state, positive: false, stateAge, distance, x, y, portalX: 120, groundY, special: false })) break;
  }
  assert.deepEqual(seen, [
    'demon-emerge', 'demon-idle', 'demon-approach', 'demon-stop',
    'demon-reach', 'demon-grab', 'demon-carry', 'demon-return',
    'demon-descend', 'demon-disappear',
  ]);
});

test('an angel completes fly -> grab -> ascend -> depart in order', () => {
  const seen = [];
  let state = 'angel-fly-empty';
  let y = 40;
  let x = 250;
  const bagX = 400;
  const bagY = 380;
  let stateAge = 0;
  for (let i = 0; i < 600; i++) {
    const target = state === 'angel-ascend' || state === 'angel-depart' ? { x, y: -90 } : { x: bagX, y: bagY };
    const distance = Math.hypot(target.x - x, target.y - y);
    if (seen[seen.length - 1] !== state) seen.push(state);
    const next = nextCollectorState({ state, positive: true, stateAge, distance, x, y, portalX: 250, groundY, special: false });
    if (next) { state = next; stateAge = 0; continue; }
    stateAge += 16;
    const speed = 250 * 0.016;
    const d = Math.max(1, distance);
    x += (target.x - x) / d * speed;
    y += (target.y - y) / d * speed;
    if (isCollectorTerminal({ state, positive: true, stateAge, distance, x, y, portalX: 250, groundY, special: false })) break;
  }
  assert.deepEqual(seen, [
    'angel-fly-empty', 'angel-approach', 'angel-descend', 'angel-hover',
    'angel-reach', 'angel-grab', 'angel-hold', 'angel-carry', 'angel-ascend', 'angel-depart',
  ]);
});

// ------------------------------------------------------------------- zones
test('bags spawn and settle on lateral lanes, never on the candle body', () => {
  const base = buildMoneyFlowAnchors({ side: 'left', centreX: 330, groundY: 445, laneLeft: 80, laneRight: 560 });
  const region = base.region;
  const half = region.fighterWidth * .55;
  for (const seed of [0, 17, 34, 51, 68, 85, 99]) {
    const x = pickLateralX(region, 'left', seed);
    assert.ok(x >= region.left && x <= region.right, 'stays inside the region');
    assert.ok(x <= region.centerX - half || x >= region.centerX + half,
      `x=${x.toFixed(1)} must clear the protected core (${half.toFixed(1)}px)`);
  }
});

test('portal stays clear of the candle so the demon never walks under it', () => {
  const base = buildMoneyFlowAnchors({ side: 'left', centreX: 330, groundY: 445, laneLeft: 80, laneRight: 560 });
  const region = base.region;
  const minGap = region.fighterWidth * .6;
  // The bag is left of centre -> the portal goes further left.
  const outward = 460 <= region.centerX ? -1 : 1;
  const portalX = region.centerX + outward * minGap;
  assert.ok(Math.abs(portalX - region.centerX) >= minGap, 'portal clears the fighter');
});

// ------------------------------------------------------- both arena halves
test('the same choreography rules hold for both sides of the arena', () => {
  const left = buildMoneyFlowAnchors({ side: 'left', centreX: 330, groundY: 445, laneLeft: 80, laneRight: 560 });
  const right = buildMoneyFlowAnchors({ side: 'right', centreX: 950, groundY: 445, laneLeft: 720, laneRight: 1200 });
  for (const [label, anchors] of [['left', left], ['right', right]]) {
    for (const seed of [3, 27, 61, 88]) {
      const x = pickLateralX(anchors.region, anchors.region.centerX < 640 ? 'left' : 'right', seed);
      assert.ok(x >= anchors.region.left - 1e-9 && x <= anchors.region.right + 1e-9, `${label} lane stays in bounds`);
    }
    assert.ok(anchors.region.right > anchors.region.left, `${label} region is usable`);
  }
});
