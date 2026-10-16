import { test, expect } from '@playwright/test';
const url='/js/candle-battles/tests/visual.html';
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


test('LIVE holds at the missing candle close without awarding a point',async({page})=>{
 await page.goto(url+'?kind=live');await page.waitForFunction(()=>window.engine);
 const state=await page.evaluate(()=>{
  const now=Date.now(),start=Math.floor(now/300000)*300000-300000+1000;
  const feed={matchId:92,leftSymbol:'BTC',rightSymbol:'ETH',left:null,right:null,rounds:[],status:'waiting-confirmation',finished:false,
   matchStartTime:start,expectedRounds:18,serverTime:now};
  window.engine.receive(feed,true);window.engine.receive(feed,false);
  return {mode:window.engine.mode,score:window.engine.snapshot().score,next:window.engine.hud.get('nextBattle').text};
 });
 expect(state.mode).toBe('live');expect(state.score).toEqual({left:0,right:0});expect(state.next).toContain('00:00');
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
