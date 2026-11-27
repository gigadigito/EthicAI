import test from 'node:test';
import assert from 'node:assert/strict';
import { strictFrameCount } from './capture-full-candle-battle.mjs';
import { readFile } from 'node:fs/promises';
import { buildFullMatchPlan } from '../arena-pressure/capture-planner.mjs';

test('accepts only the exact integral MP4 frame count',()=>{
  assert.equal(strictFrameCount(3600,3600),3600);
  for(const value of [undefined,null,NaN,Infinity,3599.5,0])assert.throws(()=>strictFrameCount(value,3600),/Invalid MP4 frame count/);
  assert.throws(()=>strictFrameCount(3599,3600),/Expected 3600 frames/);
});

test('plans the Candle Battle movie as twelve exact 300-frame segments',()=>{
  const plan=buildFullMatchPlan({matchId:46908,historicalDurationSeconds:5400,historyPoints:18,targetVideoDurationSeconds:120,segmentDurationSeconds:10,width:1280,height:720,fps:30,culture:'pt',tailPadSeconds:.5});
  assert.equal(plan.totalSegments,12);assert.equal(plan.totalTargetFrames,3600);
  assert.deepEqual(plan.segments.map(segment=>segment.targetFrames),Array(12).fill(300));
  assert.ok(plan.segments.every(segment=>segment.recordingDurationSeconds===10.5));
});

test('Browserless endpoints preserve authentication query parameters',async()=>{
  const source=await readFile(new URL('./capture-full-candle-battle.mjs',import.meta.url),'utf8');
  assert.match(source,/new URL\(browserlessBaseUrl\.href\)/);
  assert.doesNotMatch(source,/new URL\('\/(?:function|screencast)'\s*,\s*browserlessBaseUrl\)/);
});
