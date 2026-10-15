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
 await expect(page).toHaveScreenshot('arcade-arena.png');
 await page.evaluate(()=>window.engine.command('start'));
 await expect.poll(()=>page.evaluate(()=>window.engine.snapshot().tiles.length),{timeout:12000}).toBeGreaterThan(0);
 await page.evaluate(()=>window.engine.command('pause'));const snapshot=await page.evaluate(()=>window.engine.snapshot());
 await page.setViewportSize({width:390,height:844});await expect(page.locator('canvas')).toBeVisible();
 expect(await page.locator('canvas').evaluate(c=>c.getBoundingClientRect().width)).toBeLessThanOrEqual(390);
 await page.evaluate(()=>{window.engine.command('replay');window.engine.command('speed',10);});
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
test('LIVE reconciles immutable history and heartbeat never creates points',async({page})=>{
 await page.goto(url+'?kind=live');await page.waitForFunction(()=>window.engine);
 await page.evaluate(async()=>{
 const {demoRound}=await import('/js/dist/candle-battles/model.js');
 window.fixtureRound=i=>{const r=demoRound(i);return {...r,matchId:77,id:'77:5m:'+r.left.openTime,winner:i%2?'right':'left'};};
 window.feed={matchId:77,leftSymbol:'BTC',rightSymbol:'ETH',left:{...window.fixtureRound(3).left,confirmed:false},right:{...window.fixtureRound(3).right,confirmed:false},rounds:[0,1,2].map(window.fixtureRound),status:'live',finished:false};
 window.engine.receive(window.feed,true);window.engine.receive(window.feed,false);
 });
 expect((await page.evaluate(()=>window.engine.snapshot())).score).toEqual({left:2,right:1});
 await page.evaluate(()=>{window.feed.left={...window.feed.left,updatedAt:window.feed.left.updatedAt+1};window.engine.receive(window.feed,false);});
 expect((await page.evaluate(()=>window.engine.snapshot())).tiles).toHaveLength(3);
 await page.evaluate(()=>{window.feed.rounds.push(window.fixtureRound(3));window.engine.receive(window.feed,false);window.engine.receive(window.feed,true);});
 expect((await page.evaluate(()=>window.engine.snapshot())).score).toEqual({left:2,right:2});
 expect((await page.evaluate(()=>window.engine.snapshot())).tiles).toHaveLength(4);
 await page.evaluate(()=>{window.engine.command('replay');window.engine.command('speed',10);window.feed.rounds.push(window.fixtureRound(4));window.engine.receive(window.feed,false);});
 await expect.poll(()=>page.evaluate(()=>window.engine.snapshot().tiles.length),{timeout:8000}).toBe(4);
 await page.evaluate(()=>window.engine.command('live'));
 expect((await page.evaluate(()=>window.engine.snapshot())).tiles).toHaveLength(5);
 expect(await page.evaluate(()=>window.engine.tileImages.every(t=>t.displayWidth===30&&t.displayHeight===30))).toBe(true);
 await expect(page).toHaveScreenshot('persisted-history-arena.png');
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
