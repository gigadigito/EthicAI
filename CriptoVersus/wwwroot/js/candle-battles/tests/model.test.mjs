import test from 'node:test';
import assert from 'node:assert/strict';
import { demoRound, project, interpolate, sharedRange, MarketHeartbeat, BattleClock, TerritoryManager, BattleStateMachine, validCandle, candleDirection, candleChangePercent, combatAdvantage, combatFrame, fighterAnimationForPhase } from '../../dist/candle-battles/model.js';
const candle = (overrides={}) => ({...demoRound(0).left,open:100,high:106,low:94,close:103,...overrides});
test('OHLC maps exact price distances, including small body, large body, doji and extreme wicks',()=>{
    for(const close of [100,100.01,103,110,90]) {
        const c=candle({close,high:Math.max(100,close)+20,low:Math.min(100,close)-20});
        const g=project(c,40,200);
        assert.ok(Math.abs(g.height-Math.abs(close-100)*2.5)<1e-9);
        assert.ok(Math.abs(g.highY-(100-(c.high-100)*2.5))<1e-9);assert.ok(Math.abs(g.lowY-(100-(c.low-100)*2.5))<1e-9);
        assert.ok(g.highY<=g.top && g.lowY>=g.bottom);
    }
});
test('direction reversal interpolates through a real doji without negative bodies or changed source data',()=>{
    const up=candle({close:104}),down=candle({close:96}); const saved=JSON.stringify([up,down]);
    const a=project(up,10,200),b=project(down,10,200);
    assert.equal(interpolate(a,b,.5).height,0);assert.deepEqual(interpolate(a,b,1),b);
    for(let i=0;i<=100;i++){const g=interpolate(a,b,i/100);assert.ok(g.highY<=g.top&&g.lowY>=g.bottom);}
    assert.equal(JSON.stringify([up,down]),saved);
});
test('heartbeat rejects invalid, duplicate, stale and post-confirmation ticks without resolving battles',()=>{
    const h=new MarketHeartbeat(),clock=new BattleClock(); const a=candle({confirmed:false});
    assert.ok(h.accept('left',a));assert.equal(h.accept('left',a),false);
    assert.equal(h.accept('left',{...a,updatedAt:a.updatedAt-1}),false);
    assert.equal(h.accept('left',{...a,high:99,updatedAt:a.updatedAt+1}),false);
    assert.ok(h.accept('left',{...a,confirmed:true,updatedAt:a.updatedAt+2}));
    assert.equal(h.accept('left',{...a,updatedAt:a.updatedAt+3}),false);assert.equal(clock.count,0);
});
test('battle clock validates both confirmed UTC intervals and deduplicates by match + interval',()=>{
    const b=new BattleClock(),r=demoRound(0);
    assert.equal(b.enqueue({...r,right:{...r.right,confirmed:false}}),false);
    assert.equal(b.enqueue({...r,right:demoRound(1).right}),false);
    assert.ok(b.enqueue(demoRound(1)));assert.ok(b.enqueue(r));assert.equal(b.enqueue({...r,id:'another-id'}),false);
    assert.equal(b.next().id,r.id);assert.equal(b.next().id,demoRound(1).id);
});
test('queued snapshots are immutable while next-candle heartbeat continues',()=>{
    const b=new BattleClock(),r=demoRound(0),h=new MarketHeartbeat();b.enqueue(r);
    r.left.close=1;h.accept('left',demoRound(1).left);
    assert.notEqual(b.next().left.close,1);assert.equal(h.get('left').openTime,demoRound(1).left.openTime);
});
test('one win means one point/tile; draws none; complete rows retain colors and page overflow archives history',()=>{
    const t=new TerritoryManager();
    for(let i=0;i<241;i++){const r={...demoRound(i),winner:i%2?'right':'left'};t.apply(r);t.apply(r);}
    assert.equal(t.history.length,241);assert.equal(t.score.left,121);assert.equal(t.score.right,120);
    assert.equal(t.lines,12);assert.equal(t.page,2);assert.equal(t.history[120].page,1);
    assert.equal(t.history[19].row,5);assert.equal(t.history[20].row,4);
    t.apply({...demoRound(242),winner:'draw'});assert.equal(t.history.length,241);
});
test('replay outcomes, tile order and line counts are invariant at 1x, 2x, 5x and 10x',()=>{
    const rounds=Array.from({length:30},(_,i)=>demoRound(i));const snapshots=[];
    for(const speed of [1,2,5,10]){
        const t=new TerritoryManager(),machine=new BattleStateMachine();
        for(const r of rounds){machine.start();for(let i=0;i<10000&&machine.phase!=='FORMING_CANDLE';i++)machine.advance(16*speed,p=>{if(p==='BLOCK_LOCKING')t.apply(r);});}
        snapshots.push(JSON.stringify({score:t.score,tiles:t.history,lines:t.lines}));
    }
    assert.equal(new Set(snapshots).size,1);
});
test('reconnection reconstruction equals original history and duplicates cannot add tiles',()=>{
    const t=new TerritoryManager(),restored=new TerritoryManager();const rounds=Array.from({length:53},(_,i)=>demoRound(i));
    for(const r of rounds)t.apply(r);for(const r of rounds)restored.apply(r);for(const r of rounds)restored.apply(r);
    assert.deepEqual(restored.history,t.history);assert.deepEqual(restored.score,t.score);
});
test('normalization compares percentage movement rather than nominal coin prices',()=>{
    const a=candle(),b={...a,open:10000,high:10600,low:9400,close:10300};
    assert.deepEqual(project(a,sharedRange([a,b]),200),project(b,sharedRange([a,b]),200));
    assert.equal(validCandle({...a,open:NaN}),false);assert.throws(()=>project(a,0,200));
});

test('OHLC direction gives a small green candle offensive priority over a large red candle',()=>{
    const green=candle({open:100,close:101,high:151,low:90});
    const red=candle({open:100,close:90,high:150,low:40});
    assert.equal(candleDirection(green),'up');assert.equal(candleDirection(red),'down');
    const advantage=combatAdvantage(green,red,20,95);
    assert.ok(advantage.leftPressure>.5);
    assert.ok(advantage.leftPressure>=.7);
    const frames=Array.from({length:12},(_,i)=>combatFrame(green,red,20,95,i*280,3800,123));
    const avg=(values)=>values.reduce((sum,value)=>sum+value,0)/values.length;
    assert.ok(avg(frames.map(f=>f.left.attack))>avg(frames.map(f=>f.right.attack)));
    assert.ok(avg(frames.map(f=>f.right.hit))>avg(frames.map(f=>f.left.hit)));
});

test('visual pressure follows percentage return, including red versus red and equal-return tie-breaks',()=>{
    const mildRed=candle({open:100,close:98,high:101,low:97});
    const deepRed=candle({open:100,close:92,high:101,low:90});
    assert.equal(candleChangePercent(mildRed),-2);
    assert.equal(candleChangePercent(deepRed),-8);
    assert.ok(combatAdvantage(mildRed,deepRed,10,90).leftPressure>.5);
    const equalLeft=candle({open:100,close:102});
    const equalRight=candle({open:200,close:204});
    assert.equal(candleChangePercent(equalLeft),candleChangePercent(equalRight));
    assert.ok(combatAdvantage(equalLeft,equalRight,10,90,'left').leftPressure>.5);
    assert.ok(combatAdvantage(equalLeft,equalRight,10,90,'right').leftPressure<.5);
    assert.equal(combatAdvantage(equalLeft,equalRight,50,50,'draw').leftPressure,.5);
});

test('same-direction candles use strength as the tie-breaker and combat remains active before the finale',()=>{
    const left=candle({open:100,close:104}),right=candle({open:100,close:102});
    const advantage=combatAdvantage(left,right,85,30);
    assert.ok(advantage.leftPressure>.5);
    const early=combatFrame(left,right,85,30,450,3800,7);
    const middle=combatFrame(left,right,85,30,1900,3800,7);
    assert.ok(early.left.attack>0);assert.ok(early.right.attack>0);
    assert.ok(middle.left.attack>0);assert.ok(middle.right.attack>0);
    assert.notEqual(early.centerOffset,middle.centerOffset);
});

test('battle phases select real action sequences instead of an idle procedural pose',()=>{
    assert.equal(fighterAnimationForPhase('FORMING_CANDLE'),'idle');
    assert.equal(fighterAnimationForPhase('SPAWNING'),'idle');
    assert.equal(fighterAnimationForPhase('APPROACHING'),'run');
    assert.equal(fighterAnimationForPhase('ATTACKING'),'punch');
    assert.equal(fighterAnimationForPhase('COLLISION'),'punch');
    assert.equal(fighterAnimationForPhase('DESTROYING'),'break');
    assert.equal(fighterAnimationForPhase('VICTORY'),'recover');
    assert.equal(fighterAnimationForPhase('ROUND_COMPLETE'),'recover');
});

test('dojis stay balanced while preserving financial geometry',()=>{
    const left=candle({close:100,high:106,low:94}),right=candle({close:100,high:130,low:70});
    const advantage=combatAdvantage(left,right,50,50);
    assert.equal(candleDirection(left),'neutral');assert.equal(candleDirection(right),'neutral');
    assert.equal(advantage.leftPressure,.5);assert.equal(advantage.rightPressure,.5);
    assert.equal(project(left,40,200).height,0);assert.equal(project(right,40,200).height,0);
});

test('territory rejects alternate IDs for the same interval and comeback requires a prior deficit',()=>{
 const t=new TerritoryManager();const round=(i,winner)=>({...demoRound(i),winner});
 t.apply(round(0,'left'));t.apply({...round(0,'left'),id:'duplicate-interval'});assert.equal(t.history.length,1);
 t.apply(round(1,'right'));t.apply(round(2,'left'));assert.notEqual(t.special,'comeback');
 t.apply(round(3,'right'));t.apply(round(4,'right'));assert.equal(t.special,'comeback');
});


test('pausing releases the effect voice limit and dispose clears audio resources', async () => {
    const previousAudio = globalThis.Audio;
    const clips = [];
    class FakeAudio {
        constructor(src) { this.src=src; clips.push(this); }
        load() {}
        play() { return Promise.resolve(); }
        pause() { this.paused=true; }
        removeAttribute() { this.src=''; }
    }
    globalThis.Audio=FakeAudio;
    const { AudioManager } = await import('../../dist/candle-battles/audio.js');
    const audio = new AudioManager();
    try {
        audio.unlock(); audio.configure(1,1,1,false);
        for (const name of ['dash','draw','block_fall','block_lock','combo','punch_impact']) audio.play(name);
        const full=clips.length;
        audio.play('score_point'); assert.equal(clips.length,full);
        audio.pause();
        assert.ok(clips.slice(-6).every(c => c.paused && c.src===''));
        audio.play('score_point'); assert.equal(clips.length,full+1);
        audio.dispose(); assert.ok(clips.every(c => c.src===''));
    } finally { audio.dispose(); globalThis.Audio=previousAudio; }
});
