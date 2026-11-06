import test from 'node:test';
import assert from 'node:assert/strict';
import { CandleCharacterBehaviorController } from '../../dist/candle-battles/character-behavior-controller.js';

const input = (over = {}) => ({
  nowMs: 0, deltaMs: 16, pressure: .5, opponentX: 950, baseX: 330,
  minX: 170, maxX: 1110, minSeparation: 300, active: false,
  reducedMotion: false, ...over
});

const run = (controller, values, overrides = {}) => values.map(nowMs => controller.update(input({ nowMs, deltaMs: 100, ...overrides })));

test('movement is deterministic and pressure changes are hysteretic', () => {
  const first = new CandleCharacterBehaviorController('left');
  const second = new CandleCharacterBehaviorController('left');
  const times = Array.from({ length: 80 }, (_, index) => index * 100);
  const a = run(first, times, { pressure: .74 });
  const b = run(second, times, { pressure: .74 });
  assert.deepEqual(a, b);
  const reversals = a.filter(item => item.locomotion === 'walk-backward').length;
  assert.equal(reversals, 0, 'stable favorable pressure must not reverse direction');
});

test('both sides approach and retreat without crossing or leaving the arena', () => {
  const left = new CandleCharacterBehaviorController('left');
  const right = new CandleCharacterBehaviorController('right');
  left.reset(44, 330); right.reset(44, 950);
  for (let nowMs = 0; nowMs <= 30_000; nowMs += 100) {
    const l = left.update(input({ nowMs, pressure: .78, opponentX: right.position, baseX: 330 }));
    const r = right.update(input({ nowMs, pressure: .22, opponentX: l.x, baseX: 950 }));
    assert.ok(l.x >= 170 && l.x <= 1110);
    assert.ok(r.x >= 170 && r.x <= 1110);
    assert.ok(r.x - l.x >= 300 - .01);
  }
});

test('neutral oscillation returns to base instead of continuously sliding', () => {
  const controller = new CandleCharacterBehaviorController('right');
  controller.reset(8, 950);
  const samples = run(controller, Array.from({ length: 120 }, (_, index) => index * 100), { pressure: .5, opponentX: 330, baseX: 950 });
  assert.ok(samples.some(item => item.locomotion === 'idle'));
  assert.ok(Math.abs(samples.at(-1).x - 950) < 1);
});

test('blink schedules are independent, short, and deterministic', () => {
  const left = new CandleCharacterBehaviorController('left');
  const right = new CandleCharacterBehaviorController('right');
  left.reset(99, 330); right.reset(99, 950);
  const leftBlinks = [], rightBlinks = [];
  for (let nowMs = 0; nowMs <= 40_000; nowMs += 20) {
    if (left.update(input({ nowMs, pressure: .5 })).blink) leftBlinks.push(nowMs);
    if (right.update(input({ nowMs, pressure: .5, opponentX: 330, baseX: 950 })).blink) rightBlinks.push(nowMs);
  }
  assert.ok(leftBlinks.length > 0 && rightBlinks.length > 0);
  assert.notDeepEqual(leftBlinks, rightBlinks);
  const burst = values => values.some((value, index) => index === 0 || value - values[index - 1] <= 220);
  assert.ok(burst(leftBlinks) && burst(rightBlinks), 'each blink stays a short burst');
});

test('reduced motion and combat disable decorative movement and blinking', () => {
  const controller = new CandleCharacterBehaviorController('left');
  controller.reset(7, 330);
  for (let nowMs = 0; nowMs <= 10_000; nowMs += 100) {
    const result = controller.update(input({ nowMs, pressure: .9, reducedMotion: true }));
    assert.equal(result.x, 330);
    assert.equal(result.locomotion, 'idle');
    assert.equal(result.blink, false);
  }
  const active = controller.update(input({ nowMs: 10_100, pressure: .9, active: true }));
  assert.equal(active.locomotion, 'idle');
  assert.equal(active.blink, false);
});
