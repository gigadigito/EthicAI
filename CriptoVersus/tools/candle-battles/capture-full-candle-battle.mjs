#!/usr/bin/env node
import { createWriteStream } from 'node:fs';
import { existsSync } from 'node:fs';
import { mkdir, open, rename, rm, writeFile } from 'node:fs/promises';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { candleBattleBrowserlessFunction } from './browserless-video-function.mjs';
const isolatedMedia = new URL('./capture-media.mjs', import.meta.url);
const repositoryMedia = new URL('../arena-pressure/capture-media.mjs', import.meta.url);
const { processWebmToMp4 } = await import(existsSync(isolatedMedia) ? isolatedMedia : repositoryMedia);

const args = Object.fromEntries(process.argv.slice(2).reduce((a,v,i,x)=>{if(v.startsWith('--'))a.push([v.slice(2),x[i+1]&&!x[i+1].startsWith('--')?x[i+1]:true]);return a;},[]));
const matchId = Number(args['match-id']);
if (!Number.isSafeInteger(matchId) || matchId < 1) throw new Error('--match-id must be a positive integer');
const width=1280,height=720,fps=30,duration=120,maxBytes=500*1024*1024;
const root=resolve(String(args.output??'.codex-artifacts-local/candle-battle'));
const browserlessRaw=process.env.ARENA_PRESSURE_BROWSERLESS_URL;
const baseRaw=process.env.ARENA_PRESSURE_CAPTURE_BASE_URL;
const captureKey=process.env.ARENA_PRESSURE_CAPTURE_KEY;
if(!browserlessRaw||!baseRaw||!captureKey)throw new Error('Browserless URL, capture base URL and capture key are required');
const endpoint=new URL(browserlessRaw);endpoint.pathname='/screencast';
const base=new URL(baseRaw);if(base.protocol!=='https:'&&!['localhost','127.0.0.1'].includes(base.hostname))throw new Error('Capture base URL must use HTTPS');
const culture=String(args.culture??'pt');
if(!/^(en|pt|zh|es|fr|de|it|ja|hi)$/.test(culture))throw new Error('Unsupported culture');
const target=new URL(`/${culture}/tv/candle-battle/${matchId}/match?mode=videoCapture`,base.origin);
const runId=new Date().toISOString().replace(/[-:.]/g,'');
const prefix=`candle-battle-match-${matchId}-${runId}`;
const partial=resolve(root,`${prefix}.partial.webm`), webm=resolve(root,`${prefix}.webm`), mp4=resolve(root,`${prefix}.mp4`), mp4Partial=resolve(root,`${prefix}.partial.mp4`);
const report=resolve(root,`${prefix}.json`), lock=resolve(root,'browserless-preview.lock');
const run=(command,commandArgs)=>new Promise((ok,fail)=>{const p=spawn(command,commandArgs,{stdio:['ignore','pipe','pipe']});let out='',err='';p.stdout.on('data',x=>out+=x);p.stderr.on('data',x=>err+=x);p.on('error',fail);p.on('close',code=>code===0?ok({stdout:out,stderr:err}):fail(new Error(`${command} failed (${code}): ${err.slice(-1000)}`)));});
let lockHandle,timer;
try{
 await mkdir(root,{recursive:true});
 lockHandle=await open(lock,'wx').catch(()=>{const e=new Error('capture_busy');e.code='CAPTURE_BUSY';throw e;});
 await lockHandle.writeFile(JSON.stringify({kind:'candle-battle',matchId,pid:process.pid,startedAt:new Date().toISOString()}));
 const controller=new AbortController();timer=setTimeout(()=>controller.abort(),150000);
 const response=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code:candleBattleBrowserlessFunction,context:{targetUrl:target.href,captureKey,width,height,durationMs:duration*1000,matchId}}),signal:controller.signal});
 clearTimeout(timer);if(!response.ok||!response.body)throw new Error(`Browserless HTTP ${response.status}`);
 let bytes=0;const limit=new Transform({transform(c,e,cb){bytes+=c.length;cb(bytes<=maxBytes?null:new Error('WebM size limit exceeded'),c);}});
 await pipeline(Readable.fromWeb(response.body),limit,createWriteStream(partial,{flags:'wx'}));
 const processed=await processWebmToMp4({inputPath:partial,outputPath:mp4,mp4PartialPath:mp4Partial,width,height,fps,expectedDuration:duration,toleranceSeconds:2,exactFrames:3600,maxPadFrames:30,normalizeTimestamps:true,mp4ExpectedDuration:duration,mp4ToleranceSeconds:.11,ffmpeg:process.env.FFMPEG_PATH??'ffmpeg',ffprobe:process.env.FFPROBE_PATH??'ffprobe',run,log:()=>{},secrets:[captureKey],onWebmValidated:async()=>{await rename(partial,webm);return webm;}});
 const frames=Number(processed.mp4Validation.frameCount);
 if(Math.abs(frames-3600)>1)throw new Error(`Expected 3600 frames, got ${frames}`);
 await writeFile(report,JSON.stringify({schemaVersion:1,status:'validated',kind:'candle-battle',matchId,width,height,fps,frames,durationSeconds:processed.mp4Validation.duration.seconds,videoPath:mp4},null,2));
 console.log(`CV_STATUS=captured\nCV_MATCH_ID=${matchId}\nCV_VIDEO_PATH=${mp4}\nCV_WEBM_PATH=${webm}\nCV_REPORT_PATH=${report}\nCV_FRAMES=${frames}\nCV_PUBLISH_READY=1`);
}catch(error){if(error?.code==='CAPTURE_BUSY'){console.log('CV_STATUS=capture_busy');process.exitCode=3;}else{console.error(error.message);console.log('CV_STATUS=capture_failed');process.exitCode=1;}}
finally{if(timer)clearTimeout(timer);if(lockHandle){await lockHandle.close();await rm(lock,{force:true});}await rm(partial,{force:true});await rm(mp4Partial,{force:true});}
