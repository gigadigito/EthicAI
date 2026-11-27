const body = String.raw`async ({ page, context, startScreencast, stopScreencast }) => {
  const startedAt=Date.now(), deadline=startedAt+Number(context.executionBudgetMs??48000);
  const fail=(message,code)=>{const error=new Error(message);error.captureCode=code;return error;};
  const remaining=()=>Math.max(0,deadline-Date.now());
  const withTimeout=async(promise,ms,stage)=>{let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(fail(stage+' timed out',stage.toUpperCase()+'_TIMEOUT')),Math.min(ms,remaining()));})]);}finally{clearTimeout(timer);}};
  const expected=context.authorizedNavigation;
  const origin=expected?expected.protocol+'//'+expected.hostname+(expected.port?':'+expected.port:''):'';
  const href=expected?origin+expected.pathname+expected.search:'';
  if(!expected||expected.protocol!=='https:'||expected.href!==href||context.targetUrl!==href||expected.search!=='?mode=videoCapture'||!/^\/(?:en|pt|zh|es|fr|de|it|ja|hi)\/tv\/candle-battle\/[1-9]\d*\/match$/.test(expected.pathname)||typeof context.captureKey!=='string'||!context.captureKey.trim())
    throw fail('Invalid Candle Battle capture target','TARGET_CONTRACT');
  let initialNavigationHandled=false,securityError=null;
  await page.setRequestInterception(true);
  page.on('request',request=>{
    const headers={...request.headers()};for(const key of Object.keys(headers))if(key.toLowerCase()==='x-arena-capture-key')delete headers[key];
    const main=request.isNavigationRequest()&&request.frame()===page.mainFrame();
    if(!main)return request.continue({headers}).catch(()=>{});
    if(initialNavigationHandled||request.method()!=='GET'||request.url()!==href){securityError=fail('Blocked unauthorized navigation','UNAUTHORIZED_NAVIGATION');return request.abort('blockedbyclient');}
    initialNavigationHandled=true;headers['X-Arena-Capture-Key']=context.captureKey;return request.continue({headers});
  });
  console.log('[CANDLE_CAPTURE:NAV_START]');
  await page.setViewport({width:context.width,height:context.height,deviceScaleFactor:1});
  console.log('[CANDLE_CAPTURE:VIEWPORT_OK] width='+context.width+' height='+context.height);
  const response=await withTimeout(page.goto(href,{waitUntil:'domcontentloaded',timeout:Math.min(15000,remaining())}),15000,'navigation');
  console.log('[CANDLE_CAPTURE:NAV_RESPONSE] status='+(response?.status?.()??'none'));
  if(securityError)throw securityError;if(!response||!response.ok())throw fail('Candle Battle unavailable','MATCH_UNAVAILABLE');
  console.log('[CANDLE_CAPTURE:NAV_OK]');
  console.log('[CANDLE_CAPTURE:PHASER_WAIT]');
  await withTimeout(page.waitForFunction(()=>window.__candleBattleCapture?.getState?.().state==='ready',{polling:100,timeout:Math.min(15000,remaining())}),15000,'phaser');
  console.log('[CANDLE_CAPTURE:PHASER_READY]');
  const initial=await page.evaluate(()=>window.__candleBattleCapture.getState());
  if(initial.matchId!==context.matchId)throw fail('Match id mismatch','MATCH_UNAVAILABLE');
  if(!initial.isFinished)throw fail('Match is not finished','MATCH_NOT_FINISHED');
  if(!Number.isSafeInteger(initial.historyPoints)||initial.historyPoints<1)throw fail('History unavailable','HISTORY_UNAVAILABLE');
  const contract=await page.evaluate(()=>({version:window.__candleBattleCapture.version,capabilities:window.__candleBattleCapture.capabilities,metadata:window.__candleBattleCapture.getMetadata?.()}));
  if(contract.version!==2||!contract.capabilities?.includes('prepareSegment'))throw fail('Capture contract is outdated','CAPTURE_CONTRACT_OUTDATED');
  console.log('[CANDLE_CAPTURE:METADATA_OK] historyPoints='+initial.historyPoints+' historicalSeconds='+initial.durationSeconds);
  if(context.metadataOnly){const metadata={found:true,isFinished:true,historyPoints:initial.historyPoints,historicalDurationSeconds:initial.durationSeconds,durationSeconds:initial.durationSeconds,historySpanSeconds:initial.durationSeconds,supportsSegmentedCapture:contract.capabilities.includes('prepareSegment'),officialResult:'finished',leftSymbol:contract.metadata?.leftSymbol,rightSymbol:contract.metadata?.rightSymbol,officialScore:initial.officialScore,contractVersion:contract.version};return {type:'application/json',data:metadata};}
  const segment=context.segment;
  if(!segment||!Number.isFinite(segment.videoStartSeconds)||!Number.isFinite(segment.videoEndSeconds)||segment.videoEndSeconds<=segment.videoStartSeconds)throw fail('Invalid segment','SEGMENT_CONTRACT');
  console.log('[CANDLE_CAPTURE:PREPARE] segment='+segment.index+' videoStart='+segment.videoStartSeconds);
  const prepared=await withTimeout(page.evaluate(cfg=>window.__candleBattleCapture.prepareSegment(cfg),segment),15000,'segment_seek');
  console.log('[CANDLE_CAPTURE:TIMELINE] prepared='+prepared.timelinePositionSeconds+' expected='+segment.videoStartSeconds);
  if(Math.abs(Number(prepared.timelinePositionSeconds)-segment.videoStartSeconds)>.08)throw fail('Prepared timeline position mismatch','SEGMENT_SEEK_FAILED');
  await withTimeout(page.evaluate(async timeoutMs=>{
    const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
    if(document.fonts?.ready)await Promise.race([Promise.resolve(document.fonts.ready).catch(()=>undefined),wait(timeoutMs)]);
    await Promise.race([new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))),wait(timeoutMs)]);
  },Math.min(3000,remaining())),4000,'visual_preparation');
  let recording=false,final;
  try{
    startScreencast();recording=true;
    await page.evaluate(cfg=>window.__candleBattleCapture.start(cfg),segment);
    await withTimeout(new Promise(resolve=>setTimeout(resolve,context.durationMs)),context.durationMs+1000,'screencast');
    final=await page.evaluate(()=>window.__candleBattleCapture.getState());
  }finally{if(recording)stopScreencast();await page.evaluate(()=>window.__candleBattleCapture?.pause?.()).catch(()=>{});}
  if(Number(final.timelinePositionSeconds)<segment.videoEndSeconds-.2)throw fail('Segment end was not reached','REPLAY_END_NOT_REACHED');
  if(segment.isFinalSegment&&(!final.completed||!final.scoreMatchesOfficial))throw fail('Final result was not reconstructed','REPLAY_END_NOT_REACHED');
  const metrics=await page.evaluate(()=>window.__candleBattleCapture.getPerfMetrics());
  console.log('[CANDLE_CAPTURE:PERF] '+JSON.stringify(metrics));
  console.log('[CANDLE_CAPTURE:COMPLETE] segment='+segment.index+' timeline='+final.timelinePositionSeconds+' rounds='+final.completedRounds);
  return {initial,prepared,final,metrics};
}`;

export const candleBattleBrowserlessFunction=`module.exports = ${body}`;
export const candleBattleMetadataFunction=`module.exports = ${body}`;
