import test from 'node:test';
import assert from 'node:assert/strict';
import { MonotonicCaptureClock } from '../../dist/candle-battles/capture-clock.js';

const schedules={
  '60 FPS':Array(600).fill(1000/60),'30 FPS':Array(300).fill(1000/30),'15 FPS':Array(150).fill(1000/15),'6 FPS':Array(60).fill(1000/6),
  variable:[16,17,33,80,140,8,250,456,1000,2000,6000]
};
for(const [name,deltas] of Object.entries(schedules))test(`monotonic capture follows real time at ${name}`,()=>{
  let now=0;const clock=new MonotonicCaptureClock(()=>now);clock.prepare(20_000,30_000);clock.start();
  for(const delta of deltas)now+=delta;
  assert.equal(clock.position(),Math.min(30_000,20_000+now));
});
test('pause, resume, segment limit and reset are deterministic',()=>{
  let now=100;const clock=new MonotonicCaptureClock(()=>now);clock.prepare(10_000,20_000);clock.start();now+=1250;assert.equal(clock.pause(),11250);
  now+=5000;assert.equal(clock.position(),11250);clock.start();now+=20_000;assert.equal(clock.position(),20_000);clock.reset();assert.equal(clock.position(),0);
});
