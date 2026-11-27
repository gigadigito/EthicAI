#!/usr/bin/env node
import { createWriteStream } from 'node:fs';
import { mkdir, open, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { runFullMatchCapture } from '../arena-pressure/capture-full-match.mjs';
import { redactSecret } from '../arena-pressure/capture-media.mjs';
import { candleBattleBrowserlessFunction, candleBattleMetadataFunction } from './browserless-video-function.mjs';

const HTTP_TIMEOUT_MS=55_000, MAX_WEBM_BYTES=100*1024*1024;
const cultures=new Set(['en','pt','zh','es','fr','de','it','ja','hi']);
const toolRoot=dirname(fileURLToPath(import.meta.url));
const defaultOutput=resolve(toolRoot,'..','..','..','.codex-artifacts-local','candle-battle');
const sharedBrowserlessLock=resolve(toolRoot,'..','..','..','.codex-artifacts-local','arena-pressure','browserless-preview.lock');

export function strictFrameCount(value, expected) {
  if(!Number.isSafeInteger(value)||value<1)throw new Error(`Invalid MP4 frame count: ${String(value)}`);
  if(value!==expected)throw new Error(`Expected ${expected} frames, got ${value}`);
  return value;
}

function argsOf(argv){const out={};for(let i=0;i<argv.length;i++){const key=argv[i];if(!key.startsWith('--'))continue;const next=argv[i+1];out[key.slice(2)]=next&&!next.startsWith('--')?(i++,next):true;}return out;}
function safeUrl(raw,name){if(!raw)throw new Error(`${name} is required`);const url=new URL(raw);if(!['http:','https:'].includes(url.protocol))throw new Error(`${name} must use HTTP or HTTPS`);url.username='';url.password='';return url;}
function navigation(base,culture,matchId){const url=new URL(`/${culture}/tv/candle-battle/${matchId}/match?mode=videoCapture`,base.origin);if(url.protocol!=='https:')throw new Error('Capture base URL must use HTTPS');return {targetUrl:url.href,authorizedNavigation:{href:url.href,protocol:url.protocol,hostname:url.hostname,port:url.port,pathname:url.pathname,search:url.search}};}
async function browserlessJson({endpoint,code,context,secrets}){
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),HTTP_TIMEOUT_MS);
  try{const response=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code,context}),signal:controller.signal});const text=await response.text();if(!response.ok)throw new Error(`Browserless HTTP ${response.status}: ${redactSecret(text,secrets).slice(0,300)}`);const parsed=JSON.parse(text);return parsed?.data??parsed;}finally{clearTimeout(timer);}
}
async function streamSegment({endpoint,context,path,secrets}){
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),HTTP_TIMEOUT_MS);
  try{
    const response=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code:candleBattleBrowserlessFunction,context}),signal:controller.signal});
    if(!response.ok||!response.body){const body=await response.text().catch(()=> '');throw new Error(`Browserless HTTP ${response.status}: ${redactSecret(body,secrets).slice(0,300)}`);}
    let bytes=0;const limit=new Transform({transform(chunk,_encoding,callback){bytes+=chunk.length;callback(bytes<=MAX_WEBM_BYTES?null:new Error('WebM size limit exceeded'),chunk);}});
    // The abort timer remains armed until the response body has been fully consumed.
    await pipeline(Readable.fromWeb(response.body),limit,createWriteStream(path,{flags:'wx'}));
  }finally{clearTimeout(timer);}
}

export async function runCandleBattleCapture(options){
  const {matchId,culture='pt',browserlessBaseUrl,captureBaseUrl,captureKey,secrets=[]}=options;
  const nav=navigation(captureBaseUrl,culture,matchId);
  const functionEndpoint=new URL('/function',browserlessBaseUrl),screencastEndpoint=new URL('/screencast',browserlessBaseUrl);
  const fetchMetadata=()=>browserlessJson({endpoint:functionEndpoint,code:candleBattleMetadataFunction,context:{...nav,captureKey,matchId,width:options.width??1280,height:options.height??720,metadataOnly:true,executionBudgetMs:30_000},secrets});
  const captureSegmentWebm=async({segment,totalSegments,recordingDurationSeconds,outputWebmPartialPath,width,height})=>{
    const durationMs=Math.round(recordingDurationSeconds*1000);
    await streamSegment({endpoint:screencastEndpoint,path:outputWebmPartialPath,secrets,context:{...nav,captureKey,matchId,width,height,durationMs,executionBudgetMs:48_000,segment:{index:segment.index,totalSegments,videoStartSeconds:segment.videoStartSeconds,videoEndSeconds:segment.videoEndSeconds,speed:1,roundWindowSeconds:100,finaleWindowSeconds:20,isFinalSegment:segment.isFinalSegment}}});
  };
  await mkdir(dirname(sharedBrowserlessLock),{recursive:true});
  const sharedLock=await open(sharedBrowserlessLock,'wx').catch(()=>{const error=new Error('capture_busy');error.code='CAPTURE_BUSY';throw error;});
  try{
    await sharedLock.writeFile(JSON.stringify({kind:'candle-battle',matchId,pid:process.pid,startedAt:new Date().toISOString()}));
    const report=await runFullMatchCapture({...options,matchId,culture,browserlessBaseUrl:null,allowedCaptureOrigin:null,captureKey:null,secrets,fetchMetadata,captureSegmentWebm,targetDurationSeconds:120,segmentDurationSeconds:10,tailPadSeconds:.5,outputRoot:options.outputRoot??defaultOutput});
    strictFrameCount(report.finalFrames,report.expectedFrames);
    const enriched={...report,kind:'candle-battle',contractVersion:2,timeline:{roundWindowSeconds:100,finaleWindowSeconds:20,totalSeconds:120}};
    const temp=`${report.reportPath}.tmp-${process.pid}`;await writeFile(temp,`${JSON.stringify(enriched,null,2)}\n`,'utf8');await rename(temp,report.reportPath);
    return enriched;
  }finally{await sharedLock.close().catch(()=>{});await rm(sharedBrowserlessLock,{force:true}).catch(()=>{});}
}

async function main(){
  const args=argsOf(process.argv.slice(2));const matchId=Number(args['match-id']);if(!Number.isSafeInteger(matchId)||matchId<1)throw new Error('--match-id must be a positive integer');
  const culture=String(args.culture??'pt');if(!cultures.has(culture))throw new Error('Unsupported culture');
  const rawBrowserless=process.env.ARENA_PRESSURE_BROWSERLESS_URL,captureKey=process.env.ARENA_PRESSURE_CAPTURE_KEY;
  const browserlessBaseUrl=safeUrl(rawBrowserless,'ARENA_PRESSURE_BROWSERLESS_URL'),captureBaseUrl=safeUrl(process.env.ARENA_PRESSURE_CAPTURE_BASE_URL,'ARENA_PRESSURE_CAPTURE_BASE_URL');if(!captureKey?.trim())throw new Error('ARENA_PRESSURE_CAPTURE_KEY is required');
  const secrets=[captureKey,...browserlessBaseUrl.searchParams.values()];
  await mkdir(resolve(String(args.output??defaultOutput)),{recursive:true});
  const report=await runCandleBattleCapture({matchId,culture,browserlessBaseUrl,captureBaseUrl,captureKey,secrets,outputRoot:resolve(String(args.output??defaultOutput)),resume:args.resume===true?null:args.resume??null,keepIntermediates:Boolean(args['keep-intermediates']),maxSegments:args['max-segments']?Number(args['max-segments']):null,maxRetries:args['max-retries']?Number(args['max-retries']):2});
  console.log(`CV_STATUS=captured\nCV_MATCH_ID=${matchId}\nCV_VIDEO_PATH=${report.outputPath}\nCV_WEBM_PATH=segmented\nCV_REPORT_PATH=${report.reportPath}\nCV_FRAMES=${report.finalFrames}\nCV_PUBLISH_READY=1`);
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(error.message);console.log('CV_STATUS=capture_failed\nCV_PUBLISH_READY=0');process.exitCode=1;});
