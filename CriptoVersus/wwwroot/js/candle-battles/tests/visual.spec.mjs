import { test, expect } from '@playwright/test';
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
 await page.goto(url+'?kind=live');await page.waitForFunction(()=>window.engine);
 const final=await page.evaluate(async()=>{
  const {demoRound,PERIOD}=await import('/js/dist/candle-battles/model.js');
  const rounds=Array.from({length:17},(_,i)=>({...demoRound(i),matchId:93,id:`93:5m:${demoRound(i).left.openTime}`}));
  window.engine.receive({matchId:93,leftSymbol:'AVAXUSDT',rightSymbol:'OPUSDT',left:null,right:null,rounds,status:'finished',finished:true,
   matchStartTime:rounds[0].left.openTime,matchEndTime:rounds[0].left.openTime+18*PERIOD,expectedRounds:18},true);
  window.engine.command('speed',10);
  for(let i=0;i<500&&!window.engine.terminal;i++) window.engine.update(100);
  return {terminal:window.engine.terminal,result:window.engine.hud.get('result').text,status:window.engine.hud.get('status').text,
   round:window.engine.hud.get('round').text,score:window.engine.snapshot().score,leftName:window.engine.hud.get('leftName').text,
   rightName:window.engine.hud.get('rightName').text,leftFinal:window.engine.left.finalVisualState,rightFinal:window.engine.right.finalVisualState,
   bubbleVisible:!window.engine.bubble.hidden,finalLine:window.engine.currentLine};
 });
 expect(final.terminal).toBe(true);expect(final.result).toContain('FINAL SCORE');expect(final.result).not.toContain('INCOMPLETE');
 expect(final.round).toContain('17 / 17');expect(final.score).toEqual({left:9,right:7});
 expect(final.status).toContain('AVAX WINS');expect(final.status).not.toContain('USDT');
 expect(final.leftName).toBe('AVAX');expect(final.rightName).toBe('OP');
 expect(final.leftFinal).toBe('winner');expect(final.rightFinal).toBe('loser');
 expect(final.bubbleVisible).toBe(true);expect(final.finalLine.text.length).toBeGreaterThan(0);
 const dialogue=await page.evaluate(()=>{const e=window.engine;e.command('pause');const line=e.currentLine;e.update(1000);const held=e.currentLine===line;
  e.command('pause');for(let i=0;i<3;i++)e.update(100);return {held,reply:e.currentLine};});
 expect(dialogue.held).toBe(true);expect(dialogue.reply.side).not.toBe(final.finalLine.side);
 const replay=await page.evaluate(()=>{const e=window.engine;e.command('replay');
  const fighter=(side)=>{const f=e[side],sprite=f.root.list[2];return {state:f.finalVisualState,animation:sprite.anims.currentAnim?.key,alpha:sprite.alpha,rotation:sprite.rotation,x:f.root.x};};
  return {left:fighter('left'),right:fighter('right')};});
 expect(replay.left).toEqual({state:'none',animation:'candle-left-neutral-idle',alpha:1,rotation:0,x:330});
 expect(replay.right).toEqual({state:'none',animation:'candle-right-neutral-idle',alpha:1,rotation:0,x:950});
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
