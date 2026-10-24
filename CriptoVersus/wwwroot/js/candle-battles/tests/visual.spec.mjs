import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
const url='/js/candle-battles/tests/visual.html';

test('arena logos follow the match, share cached textures and keep a symbol fallback',async({page})=>{
 const requested=[];
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+9N9sAAAAASUVORK5CYII=','base64');
 await page.route('**/futurebol/team-logo/*',route=>{
  const symbol=decodeURIComponent(new URL(route.request().url()).pathname.split('/').pop());
  requested.push(symbol);
  return route.fulfill(symbol==='MISS'?{status:404}:{contentType:'image/png',body:png});
 });
 await page.goto('/js/candle-battles/tests/shell.html');
 await page.addStyleTag({path:'Components/Shared/CandleBattlesHost.razor.css'});
 await page.waitForFunction(()=>window.ready);
 const feed=(matchId,leftSymbol,rightSymbol)=>({matchId,leftSymbol,rightSymbol,left:null,right:null,rounds:[],status:'live',finished:false,expectedRounds:18});
 await page.evaluate(feed=>window.engine.receive(feed,true),feed(1,'ALTUSDT','GTCUSDT'));
 await expect.poll(()=>page.evaluate(()=>window.engine.logos.size)).toBe(2);
 const first=await page.evaluate(()=>{
  const e=window.engine,left=e.logos.get('left'),right=e.logos.get('right');
  return {left:{x:left.x,y:left.y,width:left.displayWidth,height:left.displayHeight,depth:left.depth,key:left.texture.key},right:{x:right.x,y:right.y,width:right.displayWidth,height:right.displayHeight,depth:right.depth,key:right.texture.key},fighterDepth:e.left.root.depth};
 });
 expect(first.left).toMatchObject({x:97,y:237,depth:.6,key:'coin-ALTUSDT'});
 expect(first.right).toMatchObject({x:1183,y:237,depth:.6,key:'coin-GTCUSDT'});
 expect(first.left.width).toBe(first.right.width);
 expect(first.left.height).toBe(first.right.height);
 expect(first.fighterDepth).toBeGreaterThan(first.left.depth);
 await page.waitForLoadState('networkidle');
 const count=requested.length;
 await page.evaluate(feed=>window.engine.receive(feed,false),feed(1,'ALTUSDT','GTCUSDT'));
 expect(requested).toHaveLength(count);
 await page.evaluate(feed=>window.engine.receive(feed,true),feed(2,'ALTUSDT','ALTUSDT'));
 await expect.poll(()=>page.evaluate(()=>window.engine.logos.get('right')?.texture.key)).toBe('coin-ALTUSDT');
 expect(await page.evaluate(()=>window.engine.scene.textures.exists('coin-GTCUSDT'))).toBe(false);
 await page.evaluate(feed=>window.engine.receive(feed,true),feed(3,'MISS','ALTUSDT'));
 await expect.poll(()=>page.evaluate(()=>window.engine.loadingLogos.size)).toBe(0);
 expect(await page.evaluate(()=>({fallback:window.engine.logoFallbacks.get('left')?.text,leftLogo:window.engine.logos.has('left')}))).toEqual({fallback:'MISS',leftLogo:false});
 await page.setViewportSize({width:390,height:844});
 expect(await page.locator('#arena canvas').evaluate(canvas=>canvas.getBoundingClientRect().width)).toBeLessThanOrEqual(390);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
test('dashboard shows server-aligned countdown, confirmed history and mobile layout',async({page},testInfo)=>{
 await page.goto('/js/candle-battles/tests/shell.html');
 await page.addStyleTag({path:'Components/Shared/CandleBattlesHost.razor.css'});
 await page.waitForFunction(()=>window.engine&&window.ready);
 const initial=await page.evaluate(async()=>{
  const {demoRound,PERIOD}=await import('/js/dist/candle-battles/model.js');
  const aligned=Math.floor(Date.now()/PERIOD)*PERIOD;
  const source=demoRound(0);
  const forming=(c)=>({...c,openTime:aligned,closeTime:aligned+PERIOD,updatedAt:aligned+145000,confirmed:false});
  window.fixtureRound={...source,id:`44:5m:${aligned}`,matchId:44,left:{...source.left,openTime:aligned,closeTime:aligned+PERIOD,updatedAt:aligned+PERIOD},right:{...source.right,openTime:aligned,closeTime:aligned+PERIOD,updatedAt:aligned+PERIOD}};
  window.fixtureFeed={matchId:44,leftSymbol:'BTC',rightSymbol:'ETH',left:forming(source.left),right:forming(source.right),rounds:[],status:'live',finished:false,matchStartTime:aligned+60000,expectedRounds:18,serverTime:aligned+145000};
  window.engine.receive(window.fixtureFeed,true);
  return {countdown:document.querySelector('[data-cb="countdown"]').textContent,progress:document.querySelector('[data-cb="progress"]').getAttribute('aria-valuenow'),match:document.querySelector('[data-cb="matchTime"]').textContent};
 });
 expect(initial.countdown).toMatch(/^02:3[45]$/);expect(Number(initial.progress)).toBe(48);expect(initial.match).toContain('01:25');
 await page.screenshot({path:testInfo.outputPath('candle-battles-desktop.png'),fullPage:true});
 const confirmed=await page.evaluate(()=>{
  window.fixtureFeed.serverTime=window.fixtureRound.left.closeTime+1000;
  window.engine.receive(window.fixtureFeed,false);
  const waiting=document.querySelector('[data-cb="countdown"]').textContent;
  window.fixtureFeed.rounds=[window.fixtureRound];window.engine.receive(window.fixtureFeed,false);window.engine.receive(window.fixtureFeed,false);
  window.engine.update(100);
  return {waiting,active:!!window.engine.active,rounds:window.engine.history.length};
 });
 expect(confirmed.waiting).toMatch(/^04:5[89]$/);expect(confirmed.active).toBe(true);expect(confirmed.rounds).toBe(1);
 await page.evaluate(()=>{window.engine.command('replay');window.engine.command('pause');});
 const held=await page.evaluate(()=>{const before=window.engine.replayElapsed;window.engine.update(1000);return window.engine.replayElapsed===before;});
 expect(held).toBe(true);
 await page.setViewportSize({width:390,height:844});
 await page.screenshot({path:testInfo.outputPath('candle-battles-mobile.png'),fullPage:true});
 const overflow=await page.evaluate(()=>({width:window.innerWidth,scroll:document.documentElement.scrollWidth,items:[...document.querySelectorAll('*')].filter(e=>e.getBoundingClientRect().right>window.innerWidth+1).slice(0,8).map(e=>({tag:e.tagName,cls:e.className,right:e.getBoundingClientRect().right}))}));
 expect(overflow.scroll,JSON.stringify(overflow)).toBeLessThanOrEqual(overflow.width);
});
test('comic bubbles follow fighters, pause with playback and clear for combat and restart',async({page})=>{
 await page.goto(url+'?kind=game');await page.waitForFunction(()=>window.engine&&window.ready);
 const first=await page.evaluate(()=>{const e=window.engine;e.command('restart');e.update(100);e.update(100);e.update(100);e.update(100);return {text:e.bubble.textContent,visible:!e.bubble.hidden,left:parseFloat(e.bubble.style.left)};});
 expect(first.visible).toBe(true);expect(first.text.length).toBeGreaterThan(0);
 const clearance=await page.evaluate(()=>{const e=window.engine,canvas=e.game.canvas.getBoundingClientRect(),speaker=e.currentLine.side==='left'?e.left:e.right;
  const bubble=e.bubble.getBoundingClientRect(),foot=canvas.top+(speaker.root.y+speaker.root.list[2].y)*canvas.height/480;
  return foot-bubble.bottom;});
 expect(clearance).toBeGreaterThan(100);
 const held=await page.evaluate(firstText=>{const e=window.engine;e.command('pause');e.update(5000);return e.bubble.textContent===firstText&& !e.bubble.hidden;},first.text);
 expect(held).toBe(true);
 await page.evaluate(()=>{const e=window.engine;e.left.root.x+=45;e.right.root.x+=45;e.positionBubble();});
 expect(await page.evaluate(()=>parseFloat(window.engine.bubble.style.left))).toBeGreaterThan(first.left);
 await page.evaluate(()=>window.engine.command('pause'));
 await page.evaluate(async()=>{const e=window.engine;const {demoRound}=await import('/js/dist/candle-battles/model.js');e.begin(demoRound(0));});
 expect(await page.evaluate(()=>window.engine.bubble.hidden)).toBe(true);
 await page.evaluate(()=>window.engine.command('restart'));
 expect(await page.evaluate(()=>window.engine.bubble.hidden)).toBe(true);
 await page.setViewportSize({width:390,height:844});
 await page.waitForTimeout(100);
 const mobile=await page.evaluate(()=>{const e=window.engine;e.update(100);e.update(100);e.update(100);e.update(100);const b=e.bubble.getBoundingClientRect(),h=e.host.getBoundingClientRect();return {visible:!e.bubble.hidden,left:b.left,right:b.right,hostLeft:h.left,hostRight:h.right};});
 expect(mobile.visible).toBe(true);expect(mobile.left).toBeGreaterThanOrEqual(mobile.hostLeft);expect(mobile.right).toBeLessThanOrEqual(mobile.hostRight);
});
test('small, medium, large, doji and extreme wicks preserve accessory sizes for both teams',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(url);await page.waitForFunction(()=>window.ready);
 const before=await page.evaluate(()=>window.fighters.map(x=>({face:x.fighter.faceSize,g:x.fighter.geometry,color:x.fighter.outlineColor})));
 expect(new Set(before.map(x=>JSON.stringify(x.face))).size).toBe(1);
 expect(before[3].g.height).toBe(0);expect(before[8].g.height).toBe(0);
 expect(before[0].color).toBe(0x54ff72);expect(before[5].color).toBe(0xff354f);
 await expect(page).toHaveScreenshot('modular-candles.png');
 await page.evaluate(()=>window.reverse());
 const after=await page.evaluate(()=>window.fighters.map(x=>({face:x.fighter.faceSize,color:x.fighter.outlineColor})));
 expect(after.map(x=>x.face)).toEqual(before.map(x=>x.face));expect(after[0].color).toBe(0xff354f);expect(after[5].color).toBe(0x54ff72);
 await expect(page).toHaveScreenshot('direction-reversal.png');expect(errors).toEqual([]);
});
test('arcade plays rounds, replays, resizes, pauses and releases the canvas',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(url+'?kind=game');await page.waitForFunction(()=>window.engine&&document.querySelector('#arena').dataset.ready==='true');
 await page.evaluate(()=>{window.engine.command('restart');window.engine.command('pause');window.engine.showDemoForming(0);window.engine.updateClocks();});
 await expect(page).toHaveScreenshot('arcade-arena.png');
 await page.evaluate(()=>window.engine.command('start'));
 await expect.poll(()=>page.evaluate(()=>window.engine.snapshot().tiles.length),{timeout:12000}).toBeGreaterThan(0);
 await page.evaluate(()=>window.engine.command('pause'));const snapshot=await page.evaluate(()=>window.engine.snapshot());
 await page.setViewportSize({width:390,height:844});await expect(page.locator('canvas')).toBeVisible();
 expect(await page.locator('canvas').evaluate(c=>c.getBoundingClientRect().width)).toBeLessThanOrEqual(390);
 await page.evaluate(()=>{window.engine.command('replay');window.engine.command('speed',10);window.engine.replayElapsed=300000-200;});
 await expect.poll(()=>page.evaluate(()=>window.engine.snapshot().tiles.length),{timeout:7000}).toBeGreaterThanOrEqual(snapshot.tiles.length);
 await page.evaluate(()=>window.engine.dispose());await expect(page.locator('canvas')).toHaveCount(0);expect(errors).toEqual([]);
});

test('decorative bounce and pulse cannot resize OHLC or fixed-size accessories; reversal passes through doji',async({page})=>{
 await page.goto(url);await page.waitForFunction(()=>window.ready);
 const result=await page.evaluate(()=>{
 const item=window.fighters[1],f=item.fighter,before=f.geometry,size=f.faceSize;
 f.setReducedMotion(false);f.update(13000,0);const decorated=f.geometry;
 const reversed={...item.c,close:200-item.c.close,low:95,updatedAt:item.c.updatedAt+100};
 f.setCandle(reversed,item.range);f.update(0,120);const halfway=f.geometry;f.update(0,120);
 return {before,decorated,size,afterSize:f.faceSize,halfway,after:f.geometry,scaleY:f.root.scaleY,close:f.financialSnapshot.close};
 });
 expect(result.decorated).toEqual(result.before);expect(result.size).toEqual(result.afterSize);expect(result.scaleY).toBe(1);
 expect(result.halfway.height).toBe(0);expect(result.close).toBe(97);expect(result.after.height).toBeCloseTo(result.before.height,8);
});

test('fighters stay below candles and action frames contain one team character',async({page})=>{
 await page.goto(url);await page.waitForFunction(()=>window.ready);
 const positions=await page.evaluate(()=>{
  const actions=['run','punch','break'];
  return [0,1,2,5,6,7].map((index)=>{
   const fighter=window.fighters[index].fighter;
   const sprite=fighter.root.list[2],action=actions[index%5];
   fighter.setPose(action==='run'?'APPROACHING':action==='punch'?'ATTACKING':'DESTROYING',false);
   sprite.setFrame(`fighter-${fighter.side}-neutral-${action}-${action==='break'?1:action==='punch'?3:2}`);
   fighter.update(0,0);
   return {candleBottom:fighter.geometry.lowY,spriteFoot:sprite.y,frame:sprite.frame.name};
  });
 });
 expect(positions.every(x=>x.candleBottom<x.spriteFoot-40)).toBe(true);
 expect(positions.every(x=>x.frame.includes('-neutral-'))).toBe(true);
 await expect(page).toHaveScreenshot('isolated-fighters.png');
});
test('LIVE reconciles immutable history and heartbeat never creates points',async({page})=>{
 await page.goto(url+'?kind=live');await page.waitForFunction(()=>window.engine);
 await page.evaluate(async()=>{
 const {demoRound}=await import('/js/dist/candle-battles/model.js');
 window.fixtureRound=i=>{const r=demoRound(i);return {...r,matchId:77,id:'77:5m:'+r.left.openTime,winner:i%2?'right':'left'};};
 window.feed={matchId:77,leftSymbol:'BTC',rightSymbol:'ETH',left:{...window.fixtureRound(3).left,confirmed:false},right:{...window.fixtureRound(3).right,confirmed:false},rounds:[0,1,2].map(window.fixtureRound),status:'live',finished:false,
  matchStartTime:window.fixtureRound(0).left.openTime,expectedRounds:18,serverTime:window.fixtureRound(3).left.closeTime};
 window.engine.receive(window.feed,true);window.engine.receive(window.feed,false);
 });
 expect(await page.evaluate(()=>({mode:window.engine.mode,catchUp:window.engine.catchUpReplay,speed:window.engine.speed})))
  .toEqual({mode:'replay',catchUp:true,speed:5});
 await page.evaluate(()=>{for(let i=0;i<200&&window.engine.mode!=='live';i++)window.engine.update(100);});
 expect(await page.evaluate(()=>window.engine.mode)).toBe('live');
 expect((await page.evaluate(()=>window.engine.snapshot())).score).toEqual({left:2,right:1});
 await page.evaluate(()=>{window.feed.left={...window.feed.left,updatedAt:window.feed.left.updatedAt+1};window.engine.receive(window.feed,false);});
 expect((await page.evaluate(()=>window.engine.snapshot())).tiles).toHaveLength(3);
 await page.evaluate(()=>{window.feed.rounds.push(window.fixtureRound(3));window.engine.receive(window.feed,false);window.engine.receive(window.feed,true);});
 expect((await page.evaluate(()=>window.engine.snapshot())).score).toEqual({left:2,right:2});
 expect((await page.evaluate(()=>window.engine.snapshot())).tiles).toHaveLength(4);
 await page.evaluate(()=>{window.engine.command('replay');window.engine.command('speed',10);window.engine.replayElapsed=4*300000-200;window.feed.rounds.push(window.fixtureRound(4));window.engine.receive(window.feed,false);});
 await expect.poll(()=>page.evaluate(()=>window.engine.snapshot().tiles.length),{timeout:8000}).toBe(4);
 await page.evaluate(()=>window.engine.command('live'));
 expect((await page.evaluate(()=>window.engine.snapshot())).tiles).toHaveLength(5);
 expect(await page.evaluate(()=>window.engine.tileImages.every(t=>t.displayWidth===30&&t.displayHeight===30))).toBe(true);
 await page.evaluate(()=>{window.engine.command('pause');window.engine.left.root.setPosition(330,260);window.engine.right.root.setPosition(950,260);window.engine.updateClocks();});
 await expect(page).toHaveScreenshot('persisted-history-arena.png');
});

test('ongoing partial history autoplays a tied score without a final celebration',async({page})=>{
 await page.goto(url+'?kind=live');await page.waitForFunction(()=>window.engine);
 const partial=await page.evaluate(async()=>{
  const {demoRound}=await import('/js/dist/candle-battles/model.js');
  const rounds=Array.from({length:14},(_,i)=>{const source=demoRound(i);const winner=i%2===0?'left':'right';return {...source,matchId:90,id:`90:5m:${source.left.openTime}`,winner};});
  window.engine.receive({matchId:90,leftSymbol:'AVAUSDT',rightSymbol:'PUMPUSDT',left:null,right:null,rounds,status:'live',finished:false,
   matchStartTime:rounds[0].left.openTime,expectedRounds:18,serverTime:rounds.at(-1).left.closeTime+1000},true);
  for(let i=0;i<500&&window.engine.mode!=='live';i++)window.engine.update(100);
  return {mode:window.engine.mode,terminal:window.engine.terminal,score:window.engine.snapshot().score,
   finished:document.querySelector('#arena').dataset.finished,leftFinal:window.engine.left.finalVisualState,
   rightFinal:window.engine.right.finalVisualState,canvas:document.querySelectorAll('#arena canvas').length};
 });
 expect(partial).toEqual({mode:'live',terminal:false,score:{left:7,right:7},finished:undefined,leftFinal:'none',rightFinal:'none',canvas:1});
});

test('historical match autoplays, observes pause and 2x, then freezes after eighteen rounds',async({page})=>{
 test.setTimeout(30000);
 await page.goto(url+'?kind=live');await page.waitForFunction(()=>window.engine);
 const initial=await page.evaluate(async()=>{
  const {demoRound,PERIOD,MATCH_DURATION}=await import('/js/dist/candle-battles/model.js');
  const rounds=Array.from({length:18},(_,i)=>({...demoRound(i),matchId:91,id:`91:5m:${demoRound(i).left.openTime}`}));
  window.expectedScore={left:rounds.filter(r=>r.winner==='left').length,right:rounds.filter(r=>r.winner==='right').length};
  window.engine.receive({matchId:91,leftSymbol:'BTC',rightSymbol:'ETH',left:null,right:null,rounds,status:'finished',finished:true,
   matchStartTime:rounds[0].left.openTime,matchEndTime:rounds[0].left.openTime+MATCH_DURATION,expectedRounds:18},true);
  window.engine.command('pause');const paused=window.engine.replayElapsed;window.engine.update(1000);
  const held=window.engine.replayElapsed===paused;
  window.engine.command('pause');window.engine.update(100);
  const firstStarted=!!window.engine.active,firstTime=window.engine.replayElapsed===PERIOD;
  window.engine.command('speed',10);
  return {mode:window.engine.mode,catchUp:window.engine.catchUpReplay,held,firstStarted,firstTime};
 });
 expect(initial).toEqual({mode:'replay',catchUp:true,held:true,firstStarted:true,firstTime:true});
 await expect.poll(()=>page.evaluate(()=>window.engine.terminal),{timeout:15000}).toBe(true);
 const final=await page.evaluate(()=>({score:window.engine.snapshot().score,elapsed:window.engine.replayElapsed,status:window.engine.hud.get('status').text}));
 expect(final.score).toEqual(await page.evaluate(()=>window.expectedScore));
 expect(final.elapsed).toBe(90*60*1000);expect(final.status).toContain('MATCH FINISHED');
 const manual=await page.evaluate(()=>{
  window.engine.command('replay');window.engine.command('speed',2);window.engine.update(100);
  const beforeClose=!!window.engine.active;
  window.engine.replayElapsed=5*60*1000-300;window.engine.update(100);const almostClosed=!!window.engine.active;
  window.engine.update(100);const atClose=!!window.engine.active;
  return {terminal:window.engine.terminal,beforeClose,almostClosed,atClose,score:window.engine.snapshot().score};
 });
 expect(manual).toEqual({terminal:false,beforeClose:false,almostClosed:false,atClose:true,score:{left:0,right:0}});
});


test('LIVE restarts the five-minute clock without awarding a point while confirmation is missing',async({page})=>{
 await page.goto(url+'?kind=live');await page.waitForFunction(()=>window.engine);
 const state=await page.evaluate(()=>{
  const now=Math.floor(Date.now()/300000)*300000+1000,start=now-300000;
  const feed={matchId:92,leftSymbol:'BTC',rightSymbol:'ETH',left:null,right:null,rounds:[],status:'waiting-confirmation',finished:false,
   matchStartTime:start,expectedRounds:18,serverTime:now};
  window.engine.receive(feed,true);window.engine.receive(feed,false);
  return {mode:window.engine.mode,score:window.engine.snapshot().score,next:window.engine.hud.get('nextBattle').text};
 });
 expect(state.mode).toBe('live');expect(state.score).toEqual({left:0,right:0});expect(state.next).toMatch(/04:5[89]/);
});

test('a server-finished partial market window displays its confirmed final score and resets the finale for replay',async({page})=>{
  await page.goto('/js/candle-battles/tests/shell.html');await page.waitForFunction(()=>window.engine&&window.ready);
 const final=await page.evaluate(async()=>{
  const {demoRound,PERIOD}=await import('/js/dist/candle-battles/model.js');
  const {watchReadiness}=await import('/js/candleBattleSocial.mjs');
  await watchReadiness('candle-battle-social-card',true,true);
  const rounds=Array.from({length:17},(_,i)=>({...demoRound(i),matchId:93,id:`93:5m:${demoRound(i).left.openTime}`}));
  window.engine.receive({matchId:93,leftSymbol:'AVAXUSDT',rightSymbol:'OPUSDT',left:null,right:null,rounds,status:'finished',finished:true,
   matchStartTime:rounds[0].left.openTime,matchEndTime:rounds[0].left.openTime+18*PERIOD,expectedRounds:18},true);
  window.engine.command('speed',10);
  for(let i=0;i<500&&!window.engine.terminal;i++) window.engine.update(100);
  return {terminal:window.engine.terminal,result:window.engine.hud.get('result').text,status:window.engine.hud.get('status').text,
   round:window.engine.hud.get('round').text,score:window.engine.snapshot().score,leftName:window.engine.hud.get('leftName').text,
   rightName:window.engine.hud.get('rightName').text,leftFinal:window.engine.left.finalVisualState,rightFinal:window.engine.right.finalVisualState,
   bubbleVisible:!window.engine.bubble.hidden,finalLine:window.engine.currentLine,
   canvas:document.querySelectorAll('#arena canvas').length,fighters:[window.engine.left.root.visible,window.engine.right.root.visible]};
 });
 expect(final.terminal).toBe(true);expect(final.result).toContain('FINAL SCORE');expect(final.result).not.toContain('INCOMPLETE');
 expect(final.round).toContain('17 / 17');expect(final.score).toEqual({left:9,right:7});
 expect(final.status).toContain('AVAX WINS');expect(final.status).not.toContain('USDT');
 expect(final.leftName).toBe('AVAX');expect(final.rightName).toBe('OP');
 expect(final.leftFinal).toBe('winner');expect(final.rightFinal).toBe('loser');
 expect(final.bubbleVisible).toBe(true);expect(final.finalLine.text.length).toBeGreaterThan(0);
 expect(final.canvas).toBe(1);expect(final.fighters).toEqual([true,true]);
 await expect.poll(()=>page.evaluate(()=>document.querySelector('#candle-battle-social-card').dataset.socialReady)).toBe('true');
 expect(await page.evaluate(()=>document.querySelector('#candle-battle-social-card').dataset.replayReady)).toBe('true');
 const dialogue=await page.evaluate(()=>{const e=window.engine;e.command('pause');const line=e.currentLine;e.update(1000);const held=e.currentLine===line;
  e.command('pause');for(let i=0;i<3;i++)e.update(100);return {held,reply:e.currentLine};});
 expect(dialogue.held).toBe(true);expect(dialogue.reply.side).not.toBe(final.finalLine.side);
 const replay=await page.evaluate(()=>{const e=window.engine;e.command('replay');
  const fighter=(side)=>{const f=e[side],sprite=f.root.list[2];return {state:f.finalVisualState,animation:sprite.anims.currentAnim?.key,alpha:sprite.alpha,rotation:sprite.rotation,x:f.root.x};};
  return {left:fighter('left'),right:fighter('right')};});
 expect(replay.left).toEqual({state:'none',animation:'candle-left-neutral-idle',alpha:1,rotation:0,x:330});
 expect(replay.right).toEqual({state:'none',animation:'candle-right-neutral-idle',alpha:1,rotation:0,x:950});
});

test('renderer initialization reports the exact sprite asset that failed',async({page})=>{
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/games/candle-battles/assets/modular.png*',route=>route.abort());
 await page.goto('/js/candle-battles/tests/shell.html');
 await expect.poll(()=>errors.find(message=>message.includes('Candle Battles asset failed to load'))??'',{timeout:8000})
  .toContain('modular');
 expect(errors.join('\n')).toContain('/games/candle-battles/assets/modular.png');
 expect(await page.locator('#arena canvas').count()).toBe(0);
});

test('native controls unlock supplied audio, change volume and enter fullscreen',async({page})=>{
 const failures=[];page.on('pageerror',e=>failures.push(e.message));
 await page.goto(url+'?kind=game');await page.waitForFunction(()=>window.engine);
 await page.evaluate(()=>{
   const controls=document.createElement('div');controls.style.cssText='position:fixed;top:0;left:0;z-index:10';
   controls.innerHTML='<button data-cb-action="mute">Sound</button><button data-cb-action="fullscreen">Fullscreen</button><input aria-label="Volume" data-cb-action="volume" type="range" min="0" max="1" step="0.1">';
   document.querySelector('#arena').append(controls);
 });
 await page.getByRole('button',{name:'Sound',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>window.engine.audio.music?.readyState??0)).toBeGreaterThanOrEqual(2);
 expect(await page.evaluate(()=>window.engine.audio.muted)).toBe(false);
 await page.getByRole('slider',{name:'Volume'}).fill('0.3');
 expect(await page.evaluate(()=>window.engine.audio.master)).toBe(0.3);
 await page.getByRole('button',{name:'Fullscreen',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>!!document.fullscreenElement)).toBe(true);
 await page.getByRole('button',{name:'Fullscreen',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>!!document.fullscreenElement)).toBe(false);
  await page.evaluate(()=>window.engine.dispose());expect(failures).toEqual([]);
});

const captureCard = '#candle-battle-social-capture';
const pngSize = buffer => ({ width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) });

async function openCapture(page) {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+9N9sAAAAASUVORK5CYII=','base64');
  await page.route('**/futurebol/team-logo/*', route => route.fulfill({ contentType: 'image/png', body: png }));
  await page.goto('/js/candle-battles/tests/capture-social.html');
  await page.addStyleTag({ path: 'Components/Shared/CandleBattlesHost.razor.css' });
  await page.waitForFunction(() => window.ready);
  await page.setViewportSize({ width: 1280, height: 900 });
}

async function renderFinishedCapture(page, { matchId, left, right, leftSymbol = 'BTCUSDT', rightSymbol = 'ETHUSDT' }) {
  await openCapture(page);
  await page.evaluate(async scenario => {
    const { demoRound, MATCH_DURATION } = await import('/js/dist/candle-battles/model.js');
    const winners = [
      ...Array(scenario.left).fill('left'),
      ...Array(scenario.right).fill('right'),
      ...Array(Math.max(0, 18 - scenario.left - scenario.right)).fill('draw')
    ];
    const rounds = winners.map((winner, i) => {
      const source = demoRound(i);
      return { ...source, matchId: scenario.matchId, id: `${scenario.matchId}:5m:${source.left.openTime}`, winner };
    });
    window.setCapture({ matchId: scenario.matchId, leftSymbol: scenario.leftSymbol, rightSymbol: scenario.rightSymbol,
      scoreA: scenario.left, scoreB: scenario.right, confrontations: 18, expected: 18, finished: true, winners });
    window.engine.receive({ matchId: scenario.matchId, leftSymbol: scenario.leftSymbol, rightSymbol: scenario.rightSymbol,
      left: null, right: null, rounds, scoreLeft: scenario.left, scoreRight: scenario.right, status: 'finished', finished: true,
      matchStartTime: rounds[0].left.openTime, matchEndTime: rounds[0].left.openTime + MATCH_DURATION, expectedRounds: 18 }, true);
    await window.watchCapture();
  }, { matchId, left, right, leftSymbol, rightSymbol });
  await expect.poll(() => page.evaluate(card => document.querySelector(card).dataset.socialReady, captureCard), { timeout: 30000 }).toBe('true');
}

async function captureState(page) {
  return page.evaluate(card => {
    const root = document.querySelector(card);
    const box = element => {
      const r = element.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
    };
    const rootRect = box(root);
    const arenaRect = box(document.querySelector('.cbs-capture__arena'));
    const scoreRect = box(document.querySelector('.cbs-capture__score'));
    const canvasRect = box(document.querySelector('#arena'));
    const engine = window.engine;
    const view = engine.scene.cameras.main.worldView;
    const toScreen = (x, y) => ({
      x: canvasRect.left + (x - view.x) / view.width * canvasRect.width,
      y: canvasRect.top + (y - view.y) / view.height * canvasRect.height });
    const fighter = side => {
      const f = engine[side];
      const sprite = f.root.list[2];
      const geom = f.geometry;
      const feetY = f.root.y + sprite.y;
      const faceY = f.root.y + sprite.y - 165;
      const candleTopY = geom ? f.root.y - 60 + geom.highY : faceY;
      const topY = Math.min(candleTopY, faceY - 30);
      const halfWidth = 80;
      const toScreenY = y => canvasRect.top + (y - view.y) / view.height * canvasRect.height;
      const toScreenX = x => canvasRect.left + (x - view.x) / view.width * canvasRect.width;
      return {
        worldInside: topY >= view.top && feetY <= view.bottom
          && f.root.x - halfWidth >= view.left && f.root.x + halfWidth <= view.right,
        heightRatio: (feetY - topY) / view.height,
        screen: { left: toScreenX(f.root.x - halfWidth), top: toScreenY(topY), right: toScreenX(f.root.x + halfWidth), bottom: toScreenY(feetY) }
      };
    };
    const bubble = side => {
      const element = document.querySelector(`[data-cb-capture-bubble="${side}"]`);
      return { text: element.textContent.trim(), rect: box(element) };
    };
    const overlap = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    const leftBubble = bubble('left'), rightBubble = bubble('right');
    const leftFighter = fighter('left'), rightFighter = fighter('right');
    const logos = { count: engine.logos.size, textures: [...engine.logos.values()].map(image => image.texture.key) };
    const tiles = [...document.querySelectorAll('[data-cb-capture-rounds] i')].map(element => element.className);
    const replay = { catchUp: engine.catchUpReplay, elapsed: engine.replayElapsed, index: engine.replayIndex };
    const overflow = [...root.querySelectorAll('*')]
      .map(element => ({ element, rect: element.getBoundingClientRect() }))
      .filter(({ element, rect }) => rect.width > 0 && !element.hidden && (rect.left < rootRect.left - 1 || rect.right > rootRect.right + 1 || rect.top < rootRect.top - 1 || rect.bottom > rootRect.bottom + 1))
      .slice(0, 6).map(({ element }) => element.className || element.tagName);
    return {
      socialReady: root.dataset.socialReady, captureFrame: root.dataset.captureFrame,
      replayReady: root.dataset.replayReady, matchStatus: root.dataset.matchStatus,
      arenaFrame: document.querySelector('#arena').dataset.captureFrame,
      poster: { width: rootRect.width, height: rootRect.height },
      regions: { header: box(document.querySelector('.cbs-capture__header')).height, stage: box(document.querySelector('.cbs-capture__stage')).height, footer: box(document.querySelector('.cbs-capture__footer')).height },
      canvasInsideArena: canvasRect.left >= arenaRect.left - 1 && canvasRect.right <= arenaRect.right + 1
        && canvasRect.top >= arenaRect.top - 1 && canvasRect.bottom <= arenaRect.bottom + 1,
      operationalDom: document.querySelectorAll('.candle-battles__toolbar, .candle-battles__audio, .candle-battles__dashboard, .candle-battles__bottom, .candle-battles__final, .candle-battles__footer, .candle-battles__arena-status, .candle-battles__force').length,
      visibleControls: [...document.querySelectorAll('button, select, input')].filter(element => !element.hidden && element.offsetParent !== null).length,
      scoreText: document.querySelector('.cbs-capture__points').textContent.replace(/\s+/g, ' ').trim(),
      stateLine: document.querySelector('.cbs-capture__state-line').textContent.trim(),
      fighters: { left: leftFighter, right: rightFighter },
      bubbles: {
        left: leftBubble, right: rightBubble,
        separate: !overlap(leftBubble.rect, rightBubble.rect),
        clearScore: leftBubble.rect.bottom <= scoreRect.top + 1 && rightBubble.rect.bottom <= scoreRect.top + 1,
        clearFighters: !overlap(leftBubble.rect, leftFighter.screen) && !overlap(rightBubble.rect, rightFighter.screen)
          && !overlap(leftBubble.rect, rightFighter.screen) && !overlap(rightBubble.rect, leftFighter.screen)
      },
      logos,
      tiles: {
        total: tiles.length,
        left: tiles.filter(name => name === 'is-left').length,
        right: tiles.filter(name => name === 'is-right').length,
        draw: tiles.filter(name => name === 'is-draw').length,
        pending: tiles.filter(name => name === 'is-pending').length
      },
      replay,
      overflow
    };
  }, captureCard);
}

function assertPoster(state, tiles) {
  expect(state.poster).toEqual({ width: 1200, height: 675 });
  expect(state.regions.header).toBeCloseTo(80, 0);
  expect(state.regions.stage).toBeCloseTo(515, 0);
  expect(state.regions.footer).toBeCloseTo(80, 0);
  expect(state.operationalDom).toBe(0);
  expect(state.visibleControls).toBe(0);
  expect(state.canvasInsideArena).toBe(true);
  expect(state.fighters.left.worldInside).toBe(true);
  expect(state.fighters.right.worldInside).toBe(true);
  expect(state.fighters.left.heightRatio).toBeGreaterThan(0.28);
  expect(state.fighters.right.heightRatio).toBeGreaterThan(0.28);
  for (const bubble of [state.bubbles.left, state.bubbles.right]) {
    expect(bubble.text.length).toBeGreaterThan(0);
    expect(bubble.rect.width).toBeGreaterThan(0);
    expect(bubble.rect.height).toBeGreaterThan(0);
  }
  expect(state.bubbles.separate).toBe(true);
  expect(state.bubbles.clearScore).toBe(true);
  expect(state.bubbles.clearFighters).toBe(true);
  expect(state.logos.count).toBe(2);
  expect(state.logos.textures.every(key => key.startsWith('coin-'))).toBe(true);
  expect(state.tiles).toMatchObject(tiles);
  expect(state.replay).toEqual({ catchUp: false, elapsed: 0, index: 0 });
  expect(state.overflow).toEqual([]);
  expect(state.captureFrame).toBe('frozen');
  expect(state.arenaFrame).toBe('frozen');
}

test('compact social capture is a fixed 1200x675 poster without any game controls', async ({ page }, testInfo) => {
  test.setTimeout(60000);
  await openCapture(page);
  await page.evaluate(async () => {
    const { demoRound, PERIOD } = await import('/js/dist/candle-battles/model.js');
    const rounds = Array.from({ length: 14 }, (_, i) => {
      const source = demoRound(i);
      return { ...source, matchId: 90, id: `90:5m:${source.left.openTime}`, winner: i % 2 === 0 ? 'left' : 'right' };
    });
    const forming = candle => ({ ...candle, openTime: rounds.at(-1).left.openTime + PERIOD, closeTime: rounds.at(-1).left.openTime + 2 * PERIOD, updatedAt: rounds.at(-1).left.closeTime + 1000, confirmed: false });
    window.setCapture({ matchId: 90, leftSymbol: 'AVAUSDT', rightSymbol: 'PUMPUSDT', scoreA: 7, scoreB: 7, confrontations: 14, expected: 18, finished: false, winners: rounds.map(round => round.winner) });
    window.engine.receive({ matchId: 90, leftSymbol: 'AVAUSDT', rightSymbol: 'PUMPUSDT', left: forming(rounds.at(-1).left), right: forming(rounds.at(-1).right),
      rounds, status: 'live', finished: false, matchStartTime: rounds[0].left.openTime, expectedRounds: 18, serverTime: rounds.at(-1).left.closeTime + 1000 }, true);
    await window.watchCapture();
  });
  await expect.poll(() => page.evaluate(card => document.querySelector(card).dataset.socialReady, captureCard), { timeout: 30000 }).toBe('true');
  const state = await captureState(page);
  assertPoster(state, { total: 18, left: 7, right: 7, draw: 0, pending: 4 });
  expect(state.matchStatus).toBe('in_progress');
  expect(state.replayReady).toBe('true');
  expect(state.scoreText).toContain('7');
  expect(state.stateLine).toMatch(/Round 14 of 18/i);
  expect(await page.evaluate(() => ({ left: window.engine.left.finalVisualState, right: window.engine.right.finalVisualState, score: window.engine.snapshot().score })))
    .toEqual({ left: 'none', right: 'none', score: { left: 7, right: 7 } });
  const shot = await page.locator(captureCard).screenshot({ path: testInfo.outputPath('candle-battle-social-capture-ongoing.png') });
  expect(pngSize(shot)).toEqual({ width: 1200, height: 675 });
});

test('compact social capture freezes the victory frame of a finished match', async ({ page }, testInfo) => {
  test.setTimeout(60000);
  await openCapture(page);
  await page.evaluate(async () => {
    const { demoRound, MATCH_DURATION } = await import('/js/dist/candle-battles/model.js');
    const rounds = Array.from({ length: 18 }, (_, i) => ({ ...demoRound(i), matchId: 91, id: `91:5m:${demoRound(i).left.openTime}` }));
    window.expectedTiles = {
      left: rounds.filter(round => round.winner === 'left').length,
      right: rounds.filter(round => round.winner === 'right').length,
      draw: rounds.filter(round => round.winner === 'draw').length
    };
    window.setCapture({ matchId: 91, leftSymbol: 'RUNEUSDT', rightSymbol: 'STRKUSDT',
      scoreA: rounds.filter(r => r.winner === 'left').length, scoreB: rounds.filter(r => r.winner === 'right').length,
      confrontations: 18, expected: 18, finished: true, winners: rounds.map(round => round.winner) });
    window.engine.receive({ matchId: 91, leftSymbol: 'RUNEUSDT', rightSymbol: 'STRKUSDT', left: null, right: null, rounds, status: 'finished', finished: true,
      matchStartTime: rounds[0].left.openTime, matchEndTime: rounds[0].left.openTime + MATCH_DURATION, expectedRounds: 18 }, true);
    await window.watchCapture();
  });
  await expect.poll(() => page.evaluate(card => document.querySelector(card).dataset.socialReady, captureCard), { timeout: 30000 }).toBe('true');
  const state = await captureState(page);
  const expectedTiles = await page.evaluate(() => window.expectedTiles);
  assertPoster(state, { total: 18, ...expectedTiles, pending: 0 });
  expect(state.matchStatus).toBe('finished');
  expect(state.replayReady).toBe('true');
  expect(state.stateLine).toMatch(/Final result/i);
  const finale = await page.evaluate(() => ({ left: window.engine.left.finalVisualState, right: window.engine.right.finalVisualState,
    leftBubble: document.querySelector('[data-cb-capture-bubble="left"]').className,
    rightBubble: document.querySelector('[data-cb-capture-bubble="right"]').className,
    winnerTag: document.querySelector('[data-cb-capture="tagA"]').hidden === false || document.querySelector('[data-cb-capture="tagB"]').hidden === false }));
  expect(finale.left === 'winner' || finale.right === 'winner').toBe(true);
  expect(finale.left === 'loser' || finale.right === 'loser').toBe(true);
  expect(finale.winnerTag).toBe(true);
  expect(`${finale.leftBubble} ${finale.rightBubble}`).toContain('candle-battles__bubble--shout');
  expect(`${finale.leftBubble} ${finale.rightBubble}`).toContain('candle-battles__bubble--thought');
  const shot = await page.locator(captureCard).screenshot({ path: testInfo.outputPath('candle-battle-social-capture-finished.png') });
  expect(pngSize(shot)).toEqual({ width: 1200, height: 675 });
});

test('compact social capture exports 1200x675 on mobile viewports too', async ({ page }, testInfo) => {
  test.setTimeout(60000);
  await openCapture(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(async () => {
    const { demoRound, PERIOD } = await import('/js/dist/candle-battles/model.js');
    const rounds = Array.from({ length: 6 }, (_, i) => {
      const source = demoRound(i);
      return { ...source, matchId: 92, id: `92:5m:${source.left.openTime}`, winner: i % 2 === 0 ? 'left' : 'right' };
    });
    const forming = candle => ({ ...candle, openTime: rounds.at(-1).left.openTime + PERIOD, closeTime: rounds.at(-1).left.openTime + 2 * PERIOD, updatedAt: rounds.at(-1).left.closeTime + 1000, confirmed: false });
    window.setCapture({ matchId: 92, leftSymbol: 'RUNEUSDT', rightSymbol: 'STRKUSDT', scoreA: 3, scoreB: 3, confrontations: 6, expected: 18, finished: false, winners: rounds.map(round => round.winner) });
    window.engine.receive({ matchId: 92, leftSymbol: 'RUNEUSDT', rightSymbol: 'STRKUSDT', left: forming(rounds.at(-1).left), right: forming(rounds.at(-1).right),
      rounds, status: 'live', finished: false, matchStartTime: rounds[0].left.openTime, expectedRounds: 18, serverTime: rounds.at(-1).left.closeTime + 1000 }, true);
    await window.watchCapture();
  });
  await expect.poll(() => page.evaluate(card => document.querySelector(card).dataset.socialReady, captureCard), { timeout: 30000 }).toBe('true');
  const state = await captureState(page);
  assertPoster(state, { total: 18, left: 3, right: 3, draw: 0, pending: 12 });
  const shot = await page.locator(captureCard).screenshot({ path: testInfo.outputPath('candle-battle-social-capture-mobile.png') });
  expect(pngSize(shot)).toEqual({ width: 1200, height: 675 });
});

const devFeed = async (page, matchId, { finished = true, rounds = 18 } = {}) => page.evaluate(async ({ matchId, finished, rounds }) => {
  const { demoRound, PERIOD, MATCH_DURATION } = await import('/js/dist/candle-battles/model.js');
  const list = Array.from({ length: rounds }, (_, i) => ({ ...demoRound(i), matchId, id: `${matchId}:5m:${demoRound(i).left.openTime}` }));
  const start = list[0].left.openTime;
  window.fixtureRounds = list;
  window.engine.receive({
    matchId, leftSymbol: 'BTC', rightSymbol: 'ETH', left: null, right: null, rounds: list,
    status: finished ? 'finished' : 'live', finished,
    matchStartTime: start, matchEndTime: finished ? start + MATCH_DURATION : null, expectedRounds: 18
  }, true);
  return { start, period: PERIOD, ids: list.map(r => r.id) };
}, { matchId, finished, rounds });

test('dev timeline seek/step/end rebuild state cleanly and finish the match', async ({ page }) => {
  test.setTimeout(60000);
  await page.goto('/js/candle-battles/tests/shell.html?autoplay=0');
  await page.addStyleTag({ path: 'Components/Shared/CandleBattlesHost.razor.css' });
  await page.waitForFunction(() => window.engine && window.ready);
  const info = await devFeed(page, 51);
  const timeline = await page.evaluate(({ period, ids }) => {
    const e = window.engine;
    e.command('seek', 5);
    const sought = e.inspect();
    e.update(100);
    const seeked = { ...sought, battle: e.active?.id ?? null };
    e.command('step', 1);
    e.update(100);
    const next = { battle: e.active?.id ?? null, completed: e.inspect().completedRounds };
    e.command('step', -1);
    e.update(100);
    const back = { battle: e.active?.id ?? null, completed: e.inspect().completedRounds };
    e.command('seek', 0);
    const clean = e.inspect();
    e.command('end');
    const ended = e.inspect();
    return { seeked, next, back, clean, ended, score: e.snapshot().score, expect: { sixth: ids[5], seventh: ids[6], period } };
  }, info);
  expect(timeline.seeked.mode).toBe('replay');
  expect(timeline.seeked.completedRounds).toBe(5);
  expect(timeline.seeked.replayElapsed).toBe(6 * timeline.expect.period);
  expect(timeline.seeked.left.geometry).toBeNull();
  expect(timeline.seeked.battle).toBe(timeline.expect.sixth);
  expect(timeline.next.battle).toBe(timeline.expect.seventh);
  expect(timeline.next.completed).toBe(6);
  expect(timeline.back.battle).toBe(timeline.expect.sixth);
  expect(timeline.back.completed).toBe(5);
  expect(timeline.clean.completedRounds).toBe(0);
  expect(timeline.clean.left.geometry).toBeNull();
  expect(timeline.clean.focusRound).toBe(0);
  expect(timeline.ended.finished).toBe(true);
  expect(timeline.ended.terminal).toBe(true);
  expect(timeline.ended.completedRounds).toBe(18);
  expect(timeline.ended.left.finalState === 'winner' || timeline.ended.left.finalState === 'loser' || timeline.ended.left.finalState === 'draw').toBe(true);
});

test('dev freeze holds sprite frames for inspection and resume continues playback', async ({ page }) => {
  test.setTimeout(60000);
  await page.goto('/js/candle-battles/tests/shell.html?autoplay=0');
  await page.addStyleTag({ path: 'Components/Shared/CandleBattlesHost.razor.css' });
  await page.waitForFunction(() => window.engine && window.ready);
  await devFeed(page, 52);
  const state = await page.evaluate(() => {
    const e = window.engine;
    e.command('replayRound', 3);
    e.update(100);
    const playing = e.inspect();
    e.command('freeze');
    const frozen = e.inspect();
    e.command('resume');
    const resumed = e.inspect();
    return { playing, frozen, resumed };
  });
  expect(state.playing.paused).toBe(false);
  expect(state.playing.activeRoundId).not.toBeNull();
  expect(state.frozen.paused).toBe(true);
  expect(state.frozen.left.frozen).toBe(true);
  expect(state.frozen.right.frozen).toBe(true);
  expect(state.frozen.left.frame).toMatch(/^fighter-left-neutral-/);
  expect(state.frozen.right.frame).toMatch(/^fighter-right-neutral-/);
  expect(state.resumed.paused).toBe(false);
  expect(state.resumed.left.frozen).toBe(false);
});

test('dev replayRound repeats the same confrontation without changing the score', async ({ page }) => {
  test.setTimeout(60000);
  await page.goto('/js/candle-battles/tests/shell.html?autoplay=0');
  await page.addStyleTag({ path: 'Components/Shared/CandleBattlesHost.razor.css' });
  await page.waitForFunction(() => window.engine && window.ready);
  await devFeed(page, 53);
  const runs = await page.evaluate(async () => {
    const e = window.engine;
    const play = () => {
      e.command('replayRound', 3);
      e.update(100);
      const first = { battle: e.active?.id ?? null, winner: e.active?.winner ?? null, score: e.snapshot().score };
      for (let i = 0; i < 50; i++) e.update(100);
      const after = { battle: e.active?.id ?? null, score: e.snapshot().score, completed: e.inspect().completedRounds };
      return { first, after };
    };
    return [play(), play()];
  });
  expect(runs[0].first.battle).toBe(runs[1].first.battle);
  expect(runs[0].first.winner).toBe(runs[1].first.winner);
  expect(runs[0].after.completed).toBe(4);
  expect(runs[1].after.completed).toBe(4);
  expect(runs[0].after.score).toEqual(runs[1].after.score);
});

test('captureTarget pins the compact capture to a chosen round and phase', async ({ page }, testInfo) => {
  test.setTimeout(60000);
  await page.goto('/js/candle-battles/tests/capture-social.html?captureRound=5&capturePhase=COLLISION');
  await page.waitForFunction(() => window.engine && window.ready);
  await page.evaluate(async () => {
    const { demoRound, MATCH_DURATION } = await import('/js/dist/candle-battles/model.js');
    const rounds = Array.from({ length: 18 }, (_, i) => ({ ...demoRound(i), matchId: 93, id: `93:5m:${demoRound(i).left.openTime}` }));
    window.expectedScore = {
      left: rounds.slice(0, 5).filter(r => r.winner === 'left').length,
      right: rounds.slice(0, 5).filter(r => r.winner === 'right').length
    };
    window.setCapture({ matchId: 93, leftSymbol: 'BTCUSDT', rightSymbol: 'ETHUSDT',
      scoreA: window.expectedScore.left, scoreB: window.expectedScore.right,
      confrontations: 5, expected: 18, finished: false, winners: rounds.map(r => r.winner) });
    window.engine.receive({ matchId: 93, leftSymbol: 'BTCUSDT', rightSymbol: 'ETHUSDT', left: null, right: null,
      rounds, status: 'finished', finished: true,
      matchStartTime: rounds[0].left.openTime, matchEndTime: rounds[0].left.openTime + MATCH_DURATION, expectedRounds: 18 }, true);
    await window.watchCapture();
  });
  await expect.poll(() => page.evaluate(() => document.getElementById('candle-battle-social-capture').dataset.captureFrame), { timeout: 30000 }).toBe('frozen');
  const state = await page.evaluate(() => ({
    left: { phase: window.engine.left.posePhase, animation: window.engine.left.poseAction, frame: window.engine.left.frameName, final: window.engine.left.finalVisualState },
    right: { phase: window.engine.right.posePhase, animation: window.engine.right.poseAction },
    score: window.engine.snapshot().score,
    expected: window.expectedScore
  }));
  expect(state.left.phase).toBe('COLLISION');
  expect(state.left.animation).toBe('punch');
  expect(state.left.frame).toMatch(/^fighter-left-neutral-punch-/);
  expect(state.right.phase).toBe('COLLISION');
  expect(state.left.final).toBe('none');
  expect(state.score).toEqual(state.expected);
  const shot = await page.locator('#candle-battle-social-capture').screenshot({ path: testInfo.outputPath('candle-battle-social-capture-collision.png') });
  expect(pngSize(shot)).toEqual({ width: 1200, height: 675 });
});

test('mock local logos load without touching the team-logo route', async ({ page }) => {
  const requested = [];
  await page.route('**/futurebol/team-logo/*', route => { requested.push(route.request().url()); return route.fulfill({ status: 500 }); });
  await page.goto('/js/candle-battles/tests/shell.html?autoplay=0&localLogos=1');
  await page.addStyleTag({ path: 'Components/Shared/CandleBattlesHost.razor.css' });
  await page.waitForFunction(() => window.engine && window.ready);
  await page.evaluate(async () => {
    const { demoRound, PERIOD } = await import('/js/dist/candle-battles/model.js');
    const source = demoRound(0);
    const aligned = source.left.openTime;
    window.engine.receive({
      matchId: 54, leftSymbol: 'BTCUSDT', rightSymbol: 'ETHUSDT', left: null, right: null,
      rounds: [{ ...source, matchId: 54, id: `54:5m:${source.left.openTime}` }],
      status: 'live', finished: false,
      matchStartTime: aligned, expectedRounds: 18
    }, true);
  });
  await expect.poll(() => page.evaluate(() => window.engine.loadingLogos.size)).toBe(0);
  expect(requested).toHaveLength(0);
  expect(await page.evaluate(() => window.engine.logos.get('left')?.texture.key ?? null)).not.toBeNull();
});

test('closing cinematic fallback walks all phases when the optional atlas is unavailable', async ({ page }) => {
  test.setTimeout(60000);
  await page.route('**/candle-finishers.*', route => route.fulfill({ status: 404, body: '' }));
  await page.goto('/js/candle-battles/tests/shell.html?autoplay=0');
  await page.addStyleTag({ path: 'Components/Shared/CandleBattlesHost.razor.css' });
  await page.waitForFunction(() => window.engine && window.ready);
  await devFeed(page, 55);
  const run = await page.evaluate(() => {
    const e = window.engine;
    e.command('end');
    const seen = [e.finaleSequence.phase];
    const score = e.snapshot().score;
    for (let i = 0; i < 120 && !e.finaleSequence.settled; i++) {
      e.update(100);
      if (e.finaleSequence.phase !== seen[seen.length - 1]) seen.push(e.finaleSequence.phase);
    }
    const winnerSide = score.left === score.right ? null : score.left > score.right ? 'left' : 'right';
    const sample = () => {
      const sprite = e[winnerSide ?? 'left'].root.list[2];
      return { y: sprite.y, rotation: sprite.rotation, frame: e[winnerSide ?? 'left'].frameName, drawn: sprite.frame.name };
    };
    e.update(100);
    const first = sample();
    e.update(100);
    const second = sample();
    return {
      seen,
      phase: e.finaleSequence.phase,
      settled: e.finaleSequence.settled,
      running: e.finaleSequence.running,
      dataset: e.host.dataset.finaleState,
      winnerSide,
      leftFinal: e.left.finalVisualState,
      rightFinal: e.right.finalVisualState,
      leftFrame: e.left.frameName,
      rightFrame: e.right.frameName,
      leftDrawn: e.left.root.list[2].frame.name,
      rightDrawn: e.right.root.list[2].frame.name,
      animated: first.y !== second.y || first.rotation !== second.rotation,
      score
    };
  });
  expect(run.seen).toEqual(['MATCH_FINISHED', 'FINISHER_CHARGE', 'FINISHER_ATTACK', 'KNOCKOUT', 'VICTORY_CELEBRATION', 'SOCIAL_FINAL_POSE']);
  expect(run.phase).toBe('SOCIAL_FINAL_POSE');
  expect(run.dataset).toBe('SOCIAL_FINAL_POSE');
  expect(run.settled).toBe(true);
  expect(run.running).toBe(true);
  expect(run.score.left !== run.score.right).toBe(true);
  expect(run.winnerSide === 'left' ? run.leftFinal : run.rightFinal).toBe('winner');
  expect(run.winnerSide === 'left' ? run.rightFinal : run.leftFinal).toBe('loser');
  // Fallback frames come from modular.png only: no candle-finishers asset exists.
  expect(run.winnerSide === 'left' ? run.leftFrame : run.rightFrame).toMatch(/^fighter-(left|right)-neutral-recover-2$/);
  expect(run.winnerSide === 'left' ? run.rightFrame : run.leftFrame).toMatch(/^fighter-(left|right)-neutral-break-1$/);
  expect(run.winnerSide === 'left' ? run.leftDrawn : run.rightDrawn).toBe(run.winnerSide === 'left' ? run.leftFrame : run.rightFrame);
  expect(run.winnerSide === 'left' ? run.rightDrawn : run.leftDrawn).toBe(run.winnerSide === 'left' ? run.rightFrame : run.leftFrame);
  // The winner keeps celebrating and the loser keeps an animated defeat.
  expect(run.animated).toBe(true);
});

test('real finisher atlas drives both sides, damage overlays and deterministic social frames', async ({ page }) => {
  test.setTimeout(60000);
  await renderFinishedCapture(page, { matchId: 95, left: 12, right: 2 });
  const finale = await page.evaluate(() => {
    const e = window.engine;
    const fighter = side => {
      const renderer = e[side];
      const sprite = renderer.root.list[2];
      return {
        state: renderer.finalVisualState,
        frame: renderer.frameName,
        drawn: sprite.frame.name,
        texture: sprite.texture.key,
        overlays: renderer.overlayKinds,
        scale: Math.abs(sprite.scaleX),
        rotation: sprite.rotation
      };
    };
    return {
      left: fighter('left'), right: fighter('right'), score: e.snapshot().score,
      phase: e.host.dataset.finaleState, intensity: Number(e.host.dataset.finaleIntensity),
      capture: e.host.dataset.captureFrame
    };
  });
  expect(finale.score).toEqual({ left: 12, right: 2 });
  expect(finale.phase).toBe('SOCIAL_FINAL_POSE');
  expect(finale.capture).toBe('frozen');
  expect(finale.left).toMatchObject({
    state: 'winner', frame: 'finisher-left-victory-loop-2', drawn: 'finisher-left-victory-loop-2',
    texture: 'candle-finishers', overlays: [], rotation: 0
  });
  expect(finale.right).toMatchObject({
    state: 'loser', frame: 'finisher-right-defeated-idle-2', drawn: 'finisher-right-defeated-idle-2',
    texture: 'candle-finishers', overlays: ['bruise', 'star', 'bandage'], rotation: 0
  });
  expect(finale.left.scale).toBeCloseTo(finale.right.scale, 5);
  expect(finale.intensity).toBeGreaterThan(1.4);
});

test('finale validation captures cover either winner and narrow or wide scores', async ({ page }, testInfo) => {
  test.setTimeout(120000);
  const scenarios = [
    { matchId: 96, left: 12, right: 2, name: 'btc-12-eth-2' },
    { matchId: 97, left: 6, right: 10, name: 'eth-winner-10-6' },
    { matchId: 98, left: 9, right: 8, name: 'narrow-9-8' },
    { matchId: 99, left: 17, right: 1, name: 'wide-17-1' }
  ];
  for (const scenario of scenarios) {
    await renderFinishedCapture(page, scenario);
    const result = await page.evaluate(() => ({
      score: window.engine.snapshot().score,
      left: window.engine.left.finalVisualState,
      right: window.engine.right.finalVisualState,
      leftFrame: window.engine.left.frameName,
      rightFrame: window.engine.right.frameName
    }));
    expect(result.score).toEqual({ left: scenario.left, right: scenario.right });
    expect([result.left, result.right].sort()).toEqual(['loser', 'winner']);
    expect(`${result.leftFrame} ${result.rightFrame}`).toContain('victory-loop-2');
    expect(`${result.leftFrame} ${result.rightFrame}`).toContain('defeated-idle-2');
    const shot = await page.locator(captureCard).screenshot({ path: testInfo.outputPath(`${scenario.name}.png`) });
    expect(pngSize(shot)).toEqual({ width: 1200, height: 675 });
  }
});

test('social capture never announces a frozen frame before the final pose is composed', async ({ page }) => {
  test.setTimeout(60000);
  await openCapture(page);
  await page.evaluate(async () => {
    const { demoRound, MATCH_DURATION } = await import('/js/dist/candle-battles/model.js');
    const rounds = Array.from({ length: 18 }, (_, i) => ({ ...demoRound(i), matchId: 94, id: `94:5m:${demoRound(i).left.openTime}` }));
    window.finaleSamples = [];
    window.sampler = setInterval(() => {
      window.finaleSamples.push({
        capture: document.querySelector('#arena').dataset.captureFrame ?? 'pending',
        finale: window.engine.host.dataset.finaleState ?? 'none'
      });
    }, 10);
    window.setCapture({ matchId: 94, leftSymbol: 'BTCUSDT', rightSymbol: 'ETHUSDT',
      scoreA: rounds.filter(r => r.winner === 'left').length, scoreB: rounds.filter(r => r.winner === 'right').length,
      confrontations: 18, expected: 18, finished: true, winners: rounds.map(round => round.winner) });
    window.engine.receive({ matchId: 94, leftSymbol: 'BTCUSDT', rightSymbol: 'ETHUSDT', left: null, right: null, rounds,
      status: 'finished', finished: true, matchStartTime: rounds[0].left.openTime,
      matchEndTime: rounds[0].left.openTime + MATCH_DURATION, expectedRounds: 18 }, true);
    await window.watchCapture();
  });
  await expect.poll(() => page.evaluate(card => document.querySelector(card).dataset.socialReady, captureCard), { timeout: 30000 }).toBe('true');
  const state = await page.evaluate(() => {
    clearInterval(window.sampler);
    return {
      samples: window.finaleSamples,
      capture: document.querySelector('#arena').dataset.captureFrame,
      finale: window.engine.host.dataset.finaleState,
      settled: window.engine.finaleSequence.settled,
      leftFinal: window.engine.left.finalVisualState,
      rightFinal: window.engine.right.finalVisualState,
      score: window.engine.snapshot().score
    };
  });
  // Every frozen frame was announced with the definitive composition in place.
  const frozen = state.samples.filter(sample => sample.capture === 'frozen');
  expect(frozen.length).toBeGreaterThan(0);
  expect(frozen.every(sample => sample.finale === 'SOCIAL_FINAL_POSE')).toBe(true);
  expect(state.capture).toBe('frozen');
  expect(state.finale).toBe('SOCIAL_FINAL_POSE');
  expect(state.settled).toBe(true);
  expect(state.leftFinal === 'winner' || state.rightFinal === 'winner').toBe(true);
  expect(state.leftFinal === 'loser' || state.rightFinal === 'loser').toBe(true);
  expect(state.score.left + state.score.right).toBeGreaterThan(0);
});
test('host module revision and finisher atlas resolve on the served runtime',async({page,baseURL})=>{
 const host=await readFile(new URL('../../../../Components/Shared/CandleBattlesHost.razor',import.meta.url),'utf8');
 const modulePath=host.match(/import",\s*"(\/js\/dist\/candle-battles\/game\.[^"]+)"/)?.[1];
 expect(modulePath,'CandleBattlesHost must import a versioned game bundle').toBeTruthy();
 const revision=modulePath.match(/game\.([0-9a-z]+)\.js$/)?.[1];
 expect(revision,'versioned bundle name must carry a revision').toBeTruthy();
 const response=await page.request.get(baseURL+modulePath);
 expect(response.ok(),'host bundle must be served').toBe(true);
 const bundle=await response.text();
 expect(bundle).toContain('candle-finishers');
 for(const suffix of ['png','json']) expect(bundle,`atlas ${suffix} must use the module revision`).toContain(`candle-finishers.${suffix}?v=${revision}`);
 const specifiers=[...bundle.matchAll(/from\s+['"](\.\/[^'"]+)['"]/g)].map(match=>match[1]);
 expect(specifiers.length,'bundle must import its runtime siblings').toBeGreaterThan(0);
 for(const specifier of specifiers){
  const resolved=await page.request.get(new URL(specifier,baseURL+modulePath).toString());
  expect(resolved.ok(),`import ${specifier} must resolve`).toBe(true);
 }
 for(const asset of ['candle-finishers.png','candle-finishers.json']){
  const res=await page.request.get(`${baseURL}/games/candle-battles/assets/${asset}`);
  expect(res.ok(),`${asset} must ship in wwwroot`).toBe(true);
 }
  const atlas=await (await page.request.get(`${baseURL}/games/candle-battles/assets/candle-finishers.json`)).json();
  const frames=Array.isArray(atlas.frames)?atlas.frames.map(frame=>frame.filename):Object.keys(atlas.frames??{});
  expect(frames).toContain('finisher-left-charge-1');
  expect(frames).toContain('finisher-right-knockout-1');
});
test('round result beats celebrate and stun with the finisher atlas without claiming the match result',async({page})=>{
 await page.goto('/js/candle-battles/tests/shell.html?autoplay=0');
 await page.addStyleTag({path:'Components/Shared/CandleBattlesHost.razor.css'});
 await page.waitForFunction(()=>window.engine&&window.ready);
 const run=await page.evaluate(()=>{
  const e=window.engine;
  e.left.setPose('VICTORY',true,false); e.right.setPose('VICTORY',false,false);
  const victory={
   left:e.left.finisherAnimation,right:e.right.finisherAnimation,
   leftTexture:e.left.root.list[2].texture.key,rightTexture:e.right.root.list[2].texture.key,
   leftFinal:e.left.finalVisualState,rightFinal:e.right.finalVisualState};
  e.left.setPose('FORMING_CANDLE',true,false); e.right.setPose('FORMING_CANDLE',true,false);
  const held={left:e.left.finisherAnimation,right:e.right.finisherAnimation,
   leftPose:e.left.posePhase,attacking:e.right.posePhase};
  e.left.setPose('DESTROYING',false,true);
  const drawHit=e.left.finisherAnimation;
  e.left.setPose('SPAWNING',true,false);
  return {victory,held,drawHit,cleared:e.left.finisherAnimation,leftAction:e.left.poseAction,
   leftFinalAfter:e.left.finalVisualState};
 });
 expect(run.victory).toEqual({left:'victory-loop',right:'dizzy',leftTexture:'candle-finishers',rightTexture:'candle-finishers',leftFinal:'none',rightFinal:'none'});
 expect(run.held).toEqual({left:'victory-loop',right:'dizzy',leftPose:'FORMING_CANDLE',attacking:'FORMING_CANDLE'});
 expect(run.drawHit).toBe('hurt-stagger');
 expect(run.cleared).toBeUndefined();
 expect(run.leftAction).toBe('idle');
 expect(run.leftFinalAfter).toBe('none');
});
test('round result beats keep modular.png fallback frames when the atlas is unavailable',async({page})=>{
 await page.route('**/candle-finishers.*',route=>route.fulfill({status:404,body:''}));
 await page.goto('/js/candle-battles/tests/shell.html?autoplay=0');
 await page.addStyleTag({path:'Components/Shared/CandleBattlesHost.razor.css'});
 await page.waitForFunction(()=>window.engine&&window.ready);
 const run=await page.evaluate(()=>{
  const e=window.engine;
  e.left.setPose('VICTORY',true,false); e.right.setPose('VICTORY',false,false);
  return {leftFinisher:e.left.finisherAnimation,rightFinisher:e.right.finisherAnimation,
   leftFrame:e.left.frameName,rightFrame:e.right.frameName,
   leftTexture:e.left.root.list[2].texture.key,rightTexture:e.right.root.list[2].texture.key,
   leftFinal:e.left.finalVisualState};
 });
 expect(run.leftFinisher).toBeUndefined();
 expect(run.rightFinisher).toBeUndefined();
 expect(run.leftFrame).toBe('fighter-left-neutral-recover-2');
 expect(run.rightFrame).toBe('fighter-right-neutral-break-1');
 expect(run.leftTexture).toBe('modular');
 expect(run.rightTexture).toBe('modular');
 expect(run.leftFinal).toBe('none');
});

test('each new confrontation restores the fighter baseline after a finisher pose',async({page})=>{
 await page.goto('/js/candle-battles/tests/shell.html?autoplay=0');
 await page.addStyleTag({path:'Components/Shared/CandleBattlesHost.razor.css'});
 await page.waitForFunction(()=>window.engine&&window.ready);
 const runs=await page.evaluate(async()=>{
  const {demoRound,resolveFinalePose}=await import('/js/dist/candle-battles/model.js');
  const e=window.engine,f=e.left,sprite=f.root.list[2],runs=[];
  for(let index=0;index<10;index++){
   f.applyFinalePose(resolveFinalePose('KNOCKOUT','loser',true));
   f.attachOverlay('bruise');
   f.update(1000+index*100,16);
   const round=demoRound(index);
   f.setCandle(round.left,Math.max(round.left.high,round.right.high)-Math.min(round.left.low,round.right.low),true);
   f.setPose('SPAWNING',true,false);
   f.update(2000+index*100,16);
   runs.push({texture:sprite.texture.key,frame:f.frameName,finisher:f.finisherAnimation,
    final:f.finalVisualState,overlays:f.overlayKinds,x:sprite.x,y:sprite.y,
    rotation:sprite.rotation,originX:sprite.originX,originY:sprite.originY,
    scaleX:sprite.scaleX,scaleY:sprite.scaleY,alpha:sprite.alpha});
  }
  return runs;
 });
 expect(runs).toHaveLength(10);
 for(const run of runs){
  expect(run).toMatchObject({texture:'modular',finisher:undefined,final:'none',overlays:[],x:0,y:185,rotation:0,originX:.5,originY:1,alpha:1});
  expect(run.frame).toMatch(/^fighter-left-neutral-idle-1$/);
  expect(run.scaleX).toBeCloseTo(.8,6);
  expect(run.scaleY).toBeCloseTo(.8,6);
 }
});

test('fighters get back on their feet after the round-result reaction',async({page})=>{
 await page.goto('/js/candle-battles/tests/shell.html?autoplay=0');
 await page.addStyleTag({path:'Components/Shared/CandleBattlesHost.razor.css'});
 await page.waitForFunction(()=>window.engine&&window.ready);
 const run=await page.evaluate(async()=>{
  const e=window.engine;
  const {ROUND_RESULT_RETURN_MS,resolveFinalePose}=await import('/js/dist/candle-battles/model.js');
  e.left.setPose('VICTORY',false,false); e.right.setPose('VICTORY',true,false);
  e.left.update(1000,16); e.right.update(1000,16);
  const reaction={left:e.left.finisherAnimation,right:e.right.finisherAnimation};
  e.left.setPose('FORMING_CANDLE',true,false); e.right.setPose('FORMING_CANDLE',true,false);
  e.left.update(1100,16); e.right.update(1100,16);
  const tail={left:e.left.finisherAnimation,right:e.right.finisherAnimation};
  e.left.update(1000+ROUND_RESULT_RETURN_MS+60,16); e.right.update(1000+ROUND_RESULT_RETURN_MS+60,16);
  const stoodUp={left:e.left.finisherAnimation,right:e.right.finisherAnimation,
   leftAction:e.left.poseAction,rightAction:e.right.poseAction,
   leftFinal:e.left.finalVisualState,rightFinal:e.right.finalVisualState};
  e.left.applyFinalePose(resolveFinalePose('SOCIAL_FINAL_POSE','loser',true));
  e.left.update(60000,16);
  const finale={state:e.left.finalVisualState,finisher:e.left.finisherAnimation};
  return {reaction,tail,stoodUp,finale,ms:ROUND_RESULT_RETURN_MS};
 });
 expect(run.ms).toBeGreaterThan(0);
 expect(run.reaction).toEqual({left:'dizzy',right:'victory-loop'});
 expect(run.tail).toEqual({left:'dizzy',right:'victory-loop'});
 expect(run.stoodUp.left).toBeUndefined();
 expect(run.stoodUp.right).toBeUndefined();
 expect(run.stoodUp.leftAction).toBe('idle');
 expect(run.stoodUp.rightAction).toBe('idle');
 expect(run.stoodUp.leftFinal).toBe('none');
 expect(run.finale).toEqual({state:'loser',finisher:'defeated-idle'});
});

test('combat beats drive real sprite frames and verifiable movement',async({page})=>{
 await page.goto(url);await page.waitForFunction(()=>window.ready);
 const result=await page.evaluate(async()=>{
  const {combatPlan}=await import('/js/dist/candle-battles/combat-animations.js');
  const item=window.fighters[0],f=item.fighter,sprite=f.root.list[2];
  f.setReducedMotion(false);
  const sequenced=['combat_jab','combat_heavy_punch','combat_combo','combat_guard','combat_block','combat_counter','combat_recover','ready_stance','nervous_idle','comeback'];
  const held=['combat_idle','combat_dodge','combat_hit_light','combat_hit_heavy','combat_pushback','taunt','surprised','confident_idle','exhausted_idle'];
  const out={sequenced:{},held:{}};
  for(const state of [...sequenced,...held]){
   f.setCombatPlan(combatPlan(state),0);
   const frames=new Set(),xs=new Set(),ys=new Set(),rots=new Set(),scales=new Set();
   for(let t=0;t<40;t++){f.update(t*40,40);frames.add(f.frameName);xs.add(+sprite.x.toFixed(3));ys.add(+sprite.y.toFixed(3));rots.add(+sprite.rotation.toFixed(4));scales.add(+sprite.scaleX.toFixed(4));}
   const moved=xs.size+ys.size+rots.size+scales.size;
   (sequenced.includes(state)?out.sequenced:out.held)[state]={frames:[...frames],moved,state:f.combatState,frame:f.frameName};
  }
  f.setCombatPlan(null,0);
  return out;
 });
 for(const [state,info] of Object.entries(result.sequenced)){
  expect(info.state,`${state} reports itself`).toBe(state);
  expect(info.frames.length,`${state} must swap distinct sprite frames, saw ${info.frames}`).toBeGreaterThan(1);
  expect(info.moved,`${state} must move the sprite`).toBeGreaterThan(0);
  expect(info.frames.every(name=>name.startsWith('fighter-left-neutral-')),`${state} frames stay on one team character`).toBe(true);
 }
 for(const [state,info] of Object.entries(result.held)){
  expect(info.state,`${state} reports itself`).toBe(state);
  expect(info.moved,`${state} must move the sprite`).toBeGreaterThan(0);
 }
});

test('combat beat frames follow the simulation clock at every replay speed',async({page})=>{
 await page.goto(url);await page.waitForFunction(()=>window.ready);
 const result=await page.evaluate(async()=>{
  const {combatPlan}=await import('/js/dist/candle-battles/combat-animations.js');
  const item=window.fighters[2],f=item.fighter;
  f.setReducedMotion(false);f.setCombatPlan(combatPlan('combat_combo'),0);
  const run=(speed,wallStep,count)=>{const seen=[];for(let i=0;i<count;i++){f.update(i*wallStep*speed,wallStep*speed);seen.push(f.frameName);}return seen;};
  const baseline=run(1,40,30);
  const speeds={};for(const [speed,wallStep] of [[2,20],[5,8],[10,4]]) speeds[speed]=run(speed,wallStep,30);
  f.setCombatPlan(null,0);
  return {baseline,speeds};
 });
 for(const [speed,frames] of Object.entries(result.speeds)){
  expect(frames,`frames diverge at ${speed}x`).toEqual(result.baseline);
 }
 expect(new Set(result.baseline).size).toBeGreaterThan(1);
});

test('combat beats stay inside the arena on desktop and mobile',async({page},testInfo)=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(url+'?kind=game');
 await page.waitForFunction(()=>window.engine&&document.querySelector('#arena').dataset.ready==='true');
 await page.evaluate(()=>{window.engine.command('restart');window.engine.command('start');});
 await expect.poll(()=>page.evaluate(()=>window.engine.snapshot().tiles.length),{timeout:12000}).toBeGreaterThan(0);
 const bounds=await page.evaluate(()=>{
  const canvas=document.querySelector('canvas').getBoundingClientRect();
  const host=document.querySelector('#arena');
  const sample=()=>['left','right'].map(side=>{
   const f=side==='left'?window.engine.left:window.engine.right,sprite=f.root.list[2];
   return {side,state:f.combatState,dataset:host.dataset['combat'+(side==='left'?'Left':'Right')],
    x:f.root.x+sprite.x,y:f.root.y+sprite.y,width:sprite.displayWidth};
  });
  return {canvas:{w:canvas.width,h:canvas.height},samples:sample(),event:host.dataset.combatEvent};
 });
 const states=new Set(bounds.samples.map(s=>s.dataset));
 expect([...states].every(s=>typeof s==='string'),'each fighter reports its beat').toBe(true);
 for(const s of bounds.samples){
  expect(s.x-s.width/2,'left edge of the sprite stays in the arena').toBeGreaterThanOrEqual(-4);
  expect(s.x+s.width/2,'right edge of the sprite stays in the arena').toBeLessThanOrEqual(bounds.canvas.w+4);
  expect(s.y).toBeGreaterThan(-40);
 }
 await page.screenshot({path:testInfo.outputPath('candle-battles-combat-desktop.png')});
 await page.setViewportSize({width:390,height:844});
 await expect(page.locator('canvas')).toBeVisible();
 const mobile=await page.evaluate(()=>{
  const host=document.querySelector('#arena');
  return ['left','right'].map(side=>{
   const f=side==='left'?window.engine.left:window.engine.right;
   return {state:f.combatState,frame:f.frameName,dataset:host.dataset['combat'+(side==='left'?'Left':'Right')]};
  });
 });
 // A finished match may already be in the closing cinematic, so both the
 // modular fighters and the optional finisher sequences are valid here.
 for(const s of mobile){
  expect(typeof s.dataset).toBe('string');
  expect(s.frame).toMatch(/^(fighter-(left|right)-neutral-|finisher-(left|right)-)/);
 }
 await page.screenshot({path:testInfo.outputPath('candle-battles-combat-mobile.png')});
 expect(errors).toEqual([]);
});
