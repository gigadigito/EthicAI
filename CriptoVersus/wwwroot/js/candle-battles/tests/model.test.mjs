import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { demoRound, project, interpolate, sharedRange, MarketHeartbeat, BattleClock, TerritoryManager, BattleStateMachine, FinaleStateMachine, validCandle, candleDirection, candleChangePercent, combatAdvantage, combatFrame, fighterAnimationForPhase, resolveFinalePose, resolveRoundResultPose, matchWindow, roundInMatch, clockParts, nextCandleCountdown, MATCH_DURATION, PERIOD, FINALE_PHASES, FINALE_DURATIONS, FINALE_TOTAL_MS } from '../../dist/candle-battles/model.js';
import { registerFighterAnimations, registerFinisherAnimations, finisherFrameName, finisherAnimationKey, FINISHER_FRAME_COUNTS, FINISHER_CAPTURE_FRAMES, OVERLAY_FRAMES, OVERLAY_ANCHORS, OVERLAY_SCALES, OVERLAY_KINDS } from '../../dist/candle-battles/renderer.js';
import { DialogueClock, dialogueLines, finalLines } from '../../dist/candle-battles/dialogue.js';

test('five-minute clock joins an existing candle and resets without a confirmed round', () => {
    const start = Date.UTC(2026, 0, 1, 0, 1);
    assert.equal(nextCandleCountdown(start + 85_000, start), 155_000);
    assert.equal(nextCandleCountdown(start + 240_000, start), 300_000);
    assert.equal(nextCandleCountdown(start + 241_000, start), 299_000);
    assert.equal(nextCandleCountdown(start + MATCH_DURATION - 1, start), 240_001);
    assert.equal(nextCandleCountdown(start + MATCH_DURATION, start), 0);
});

test('comic dialogue keeps localization, sides and a repeatable sequence', () => {
    const round=demoRound(2);
    const context={matchId:73,round:3,score:{left:10,right:7},left:{...round.left,strength:29.5},right:{...round.right,strength:19.7}};
    const first=Array.from({length:12},(_,slot)=>dialogueLines(context,'pt-BR',slot));
    assert.deepEqual(first,Array.from({length:12},(_,slot)=>dialogueLines(context,'pt-BR',slot)));
    assert.ok(first.every(lines=>lines[0].side!==lines[1].side));
    assert.ok(first.every(lines=>lines.every(line=>line.text.length>0&&!line.text.includes('{'))));
    assert.notEqual(dialogueLines(context,'en-US',0)[0].text,first[0][0].text);
    const unavailable=dialogueLines({...context,left:undefined,right:undefined},'pt-BR',3);
    assert.ok(unavailable.every(line=>!line.text.includes('{')&&!line.text.includes('%')));
    const closing=finalLines(73,context.score,'pt-BR');
    assert.equal(closing.length,2);
    assert.notEqual(closing[0].side,closing[1].side);
    assert.ok(closing.every(line=>line.text.length>0&&!line.text.includes('{')));
    assert.ok(finalLines(73,{left:2,right:2},'pt-BR').every(line=>line.text.length>0));
});

test('dialogue clock provides one exchange then cooldown and restarts identically', () => {
    const run=(speed)=>{const clock=new DialogueClock(),events=[];for(let elapsed=0;elapsed<32000;elapsed+=100*speed){const event=clock.advance(100*speed,73,3);if(event)events.push(event);}return events;};
    for(const speed of [1,2,5]) assert.deepEqual(run(speed).slice(0,2),[{slot:0,line:0},{slot:0,line:1}]);
    const clock=new DialogueClock();clock.advance(500,73,3);clock.reset();
    assert.deepEqual(clock.advance(500,73,3),{slot:0,line:0});
});

test('idle holds one upright fighter frame without cycling through stun poses', () => {
    const animations = new Map();
    registerFighterAnimations({ anims: {
        exists: key => animations.has(key),
        create: config => animations.set(config.key, config),
    } });
    for (const side of ['left', 'right']) for (const direction of ['neutral', 'up', 'down']) {
        const idle = animations.get(`candle-${side}-${direction}-idle`);
        assert.equal(idle.frames.length, 1);
        assert.equal(idle.frames[0].frame, `fighter-${side}-${direction}-idle-1`);
        assert.equal(idle.repeat, -1);
    }
});
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
test('a non-aligned 90-minute match admits exactly 18 confirmed market intervals',()=>{
    const first=demoRound(0).left.openTime;
    const start=first+42_000;
    const window=matchWindow(start);
    assert.equal(window.firstOpen,first);
    assert.equal(window.lastClose,first+MATCH_DURATION);
    assert.equal(window.durationEnd,start+MATCH_DURATION);
    for(let i=0;i<18;i++)assert.equal(roundInMatch(demoRound(i),start),true);
    assert.equal(roundInMatch(demoRound(18),start),false);
    assert.equal(roundInMatch(demoRound(1),start,first+PERIOD),false);
    assert.equal(roundInMatch({...demoRound(0),right:{...demoRound(0).right,confirmed:false}},start),false);
    assert.equal(clockParts(0),'00:00');
    assert.equal(clockParts(5*PERIOD),'25:00');
    assert.equal(clockParts(MATCH_DURATION),'90:00');
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

// ---------------------------------------------------------------------------
// Closing cinematic: FinaleStateMachine, sprite fallback and overlays.
// ---------------------------------------------------------------------------

/** Frames that really exist in modular.png, per the packing convention. */
const ATLAS_COUNTS = { idle: 1, run: 8, punch: 6, break: 8, recover: 3 };
const modularFrame = (side, action, frame) => `fighter-${side}-neutral-${action}-${frame}`;
const modularFrames = new Set(['left', 'right'].flatMap(side =>
    Object.entries(ATLAS_COUNTS).flatMap(([action, count]) =>
        Array.from({ length: count }, (_, i) => modularFrame(side, action, i + 1)))));

test('finale timeline runs six ordered phases in about eight seconds and holds the final pose', () => {
    assert.deepEqual([...FINALE_PHASES], ['MATCH_FINISHED', 'FINISHER_CHARGE', 'FINISHER_ATTACK', 'KNOCKOUT', 'VICTORY_CELEBRATION', 'SOCIAL_FINAL_POSE']);
    assert.equal(FINALE_DURATIONS.length, FINALE_PHASES.length - 1);
    assert.equal(FINALE_TOTAL_MS, 8000);

    const machine = new FinaleStateMachine();
    const seen = [];
    machine.start(phase => seen.push(phase));
    assert.deepEqual(seen, ['MATCH_FINISHED']);
    assert.equal(machine.running, true);
    assert.equal(machine.settled, false);

    let elapsed = 0;
    while (!machine.settled && elapsed < 20000) {
        machine.advance(100, phase => seen.push(phase));
        elapsed += 100;
    }
    assert.deepEqual(seen, [...FINALE_PHASES]);
    assert.equal(machine.phase, 'SOCIAL_FINAL_POSE');
    assert.equal(machine.settled, true);
    assert.ok(Math.abs(elapsed - FINALE_TOTAL_MS) <= 100, `elapsed ${elapsed}`);

    // SOCIAL_FINAL_POSE holds and keeps animating instead of advancing further.
    for (let i = 0; i < 50; i++) machine.advance(100, phase => seen.push(phase));
    assert.equal(machine.phase, 'SOCIAL_FINAL_POSE');
    assert.deepEqual(seen, [...FINALE_PHASES]);
});

test('finale settle is deterministic and skips the wall clock for social capture', () => {
    const walk = () => {
        const machine = new FinaleStateMachine();
        const seen = [];
        machine.start(phase => seen.push(phase));
        machine.settle(phase => seen.push(phase));
        return { seen, phase: machine.phase, settled: machine.settled };
    };
    assert.deepEqual(walk(), walk());
    assert.deepEqual(walk().seen, [...FINALE_PHASES]);
    assert.equal(walk().settled, true);
    // Settling twice cannot leave SOCIAL_FINAL_POSE.
    const machine = new FinaleStateMachine();
    const seen = [];
    machine.start(phase => seen.push(phase));
    machine.settle(phase => seen.push(phase));
    machine.settle(phase => seen.push(phase));
    assert.deepEqual(seen, [...FINALE_PHASES]);
    // A machine that never started is a no-op.
    const idle = new FinaleStateMachine();
    let called = 0;
    idle.settle(() => called++);
    assert.equal(called, 0);
    assert.equal(idle.running, false);
});

test('finale replay speeds stay identical and reset clears the timeline', () => {
    const run = speed => {
        const machine = new FinaleStateMachine();
        const seen = [];
        machine.start(phase => seen.push(phase));
        for (let i = 0; i < 2000 && !machine.settled; i++) machine.advance(16 * speed, phase => seen.push(phase));
        return seen;
    };
    for (const speed of [1, 2, 5, 10]) assert.deepEqual(run(speed), [...FINALE_PHASES]);
    const machine = new FinaleStateMachine();
    machine.start();
    machine.advance(5000, () => {});
    machine.reset();
    assert.equal(machine.running, false);
    assert.equal(machine.phase, 'MATCH_FINISHED');
    assert.equal(machine.elapsed, 0);
});

test('finale fallback uses only frames that already exist in modular.png', () => {
    for (const phase of FINALE_PHASES) for (const role of ['winner', 'loser', 'draw']) {
        const without = resolveFinalePose(phase, role, false);
        assert.equal(without.finisher, null, `${phase}/${role} must not require candle-finishers`);
        assert.ok(Object.hasOwn(ATLAS_COUNTS, without.animation), `${phase}/${role} unknown action ${without.animation}`);
        if (without.holdFrame != null) {
            assert.ok(Number.isInteger(without.holdFrame) && without.holdFrame >= 1, `${phase}/${role} bad holdFrame`);
            assert.ok(without.holdFrame <= ATLAS_COUNTS[without.animation], `${phase}/${role} holdFrame outside modular.png`);
            assert.ok(modularFrames.has(modularFrame('left', without.animation, without.holdFrame)));
            assert.ok(modularFrames.has(modularFrame('right', without.animation, without.holdFrame)));
        }
        assert.ok(without.celebration >= 0 && without.celebration <= 1);
        assert.ok(without.defeat >= 0 && without.defeat <= 1);
        assert.equal(without.role, role);
    }
});

test('closing poses keep the winner celebrating and the loser in an animated defeat', () => {
    const winner = resolveFinalePose('SOCIAL_FINAL_POSE', 'winner', false);
    const loser = resolveFinalePose('SOCIAL_FINAL_POSE', 'loser', false);
    assert.equal(winner.celebration, 1);
    assert.equal(winner.defeat, 0);
    assert.equal(winner.holdFrame, 2);
    assert.equal(winner.animation, 'recover');
    assert.equal(loser.defeat, 1);
    assert.equal(loser.celebration, 0);
    assert.equal(loser.animation, 'break');
    // The held winner frame is the illustrated victory pose already in modular.png.
    assert.ok(modularFrames.has(modularFrame('left', 'recover', 2)));
    const charge = resolveFinalePose('FINISHER_CHARGE', 'winner', false);
    assert.equal(charge.loop, true);
    assert.equal(charge.animation, 'run');
    const draw = resolveFinalePose('SOCIAL_FINAL_POSE', 'draw', false);
    assert.equal(draw.celebration, draw.defeat);
});

test('finisher sequences are requested only when the optional atlas is available', () => {
    const expected = {
        MATCH_FINISHED: [null, null, null],
        FINISHER_CHARGE: ['charge', 'hurt-stagger', 'charge'],
        FINISHER_ATTACK: ['attack', 'hurt-stagger', 'attack'],
        KNOCKOUT: ['attack', 'knockout', 'knockout'],
        VICTORY_CELEBRATION: ['victory-loop', 'defeated-idle', 'dizzy'],
        SOCIAL_FINAL_POSE: ['victory-loop', 'defeated-idle', 'dizzy']
    };
    for (const phase of FINALE_PHASES) {
        ['winner', 'loser', 'draw'].forEach((role, index) => {
            assert.equal(resolveFinalePose(phase, role, true).finisher, expected[phase][index], `${phase}/${role}`);
            assert.equal(resolveFinalePose(phase, role, false).finisher, null, `${phase}/${role} fallback`);
        });
    }
    for (const [action, count] of Object.entries(FINISHER_FRAME_COUNTS)) {
        assert.ok(count >= 1);
        assert.equal(finisherFrameName('left', action, 1), `finisher-left-${action}-1`);
        assert.equal(finisherAnimationKey('right', action), `finisher-right-${action}`);
    }
});

test('round result beats celebrate the winner and stun the loser with the finisher atlas', () => {
    const expected = {
        DESTROYING: [null, 'hurt-stagger', 'hurt-stagger'],
        VICTORY: ['victory-loop', 'dizzy', 'dizzy'],
        BLOCK_FALLING: [null, 'dizzy', 'dizzy'],
        BLOCK_LOCKING: [null, 'dizzy', 'dizzy'],
        ROUND_COMPLETE: ['victory-loop', 'dizzy', 'dizzy'],
        FORMING_CANDLE: ['victory-loop', 'dizzy', 'dizzy']
    };
    for (const [phase, actions] of Object.entries(expected)) {
        ['winner', 'loser', 'draw'].forEach((role, index) => {
            assert.equal(resolveRoundResultPose(phase, role, true)?.finisher ?? null, actions[index], `${phase}/${role}`);
            assert.equal(resolveRoundResultPose(phase, role, false)?.finisher ?? null, null, `${phase}/${role} fallback`);
        });
    }
    for (const phase of ['SPAWNING', 'APPROACHING', 'ATTACKING', 'COLLISION', 'WAITING_MARKET']) {
        for (const role of ['winner', 'loser', 'draw']) assert.equal(resolveRoundResultPose(phase, role, true), null, `${phase}/${role}`);
    }
    const winner = resolveRoundResultPose('VICTORY', 'winner', false);
    const loser = resolveRoundResultPose('VICTORY', 'loser', false);
    assert.equal(winner.celebration, .85);
    assert.equal(winner.defeat, 0);
    assert.equal(loser.celebration, 0);
    assert.ok(loser.defeat > 0);
    const draw = resolveRoundResultPose('VICTORY', 'draw', false);
    assert.equal(draw.celebration, draw.defeat);
});

test('round result fallback uses only frames that already exist in modular.png', () => {
    for (const phase of ['DESTROYING', 'VICTORY', 'BLOCK_FALLING', 'BLOCK_LOCKING', 'ROUND_COMPLETE', 'FORMING_CANDLE']) {
        for (const role of ['winner', 'loser', 'draw']) {
            const pose = resolveRoundResultPose(phase, role, false);
            if (!pose) continue;
            assert.equal(pose.finisher, null, `${phase}/${role} must not require candle-finishers`);
            assert.ok(Object.hasOwn(ATLAS_COUNTS, pose.animation), `${phase}/${role} unknown action ${pose.animation}`);
            if (pose.holdFrame != null) {
                assert.ok(Number.isInteger(pose.holdFrame) && pose.holdFrame >= 1, `${phase}/${role} bad holdFrame`);
                assert.ok(pose.holdFrame <= ATLAS_COUNTS[pose.animation], `${phase}/${role} holdFrame outside modular.png`);
                assert.ok(modularFrames.has(modularFrame('left', pose.animation, pose.holdFrame)));
                assert.ok(modularFrames.has(modularFrame('right', pose.animation, pose.holdFrame)));
            }
            assert.ok(pose.celebration >= 0 && pose.celebration <= 1);
            assert.ok(pose.defeat >= 0 && pose.defeat <= 1);
            assert.equal(pose.role, role);
        }
    }
});

test('optional finisher atlas is a no-op when absent and registers real frames when present', () => {
    const created = new Map();
    const bare = {
        textures: { exists: () => false, get: () => undefined },
        anims: { exists: key => created.has(key), create: config => created.set(config.key, config) }
    };
    registerFinisherAnimations(bare, 'left');
    assert.equal(created.size, 0);

    const frames = new Set();
    for (const side of ['left', 'right']) for (const [action, count] of Object.entries(FINISHER_FRAME_COUNTS))
        for (let i = 1; i <= count; i++) frames.add(finisherFrameName(side, action, i));
    const loaded = {
        textures: {
            exists: key => key === 'candle-finishers',
            get: () => ({ has: name => frames.has(name) })
        },
        anims: { exists: key => created.has(key), create: config => created.set(config.key, config) }
    };
    registerFinisherAnimations(loaded, 'left');
    assert.equal(created.size, Object.keys(FINISHER_FRAME_COUNTS).length);
    const charge = created.get('finisher-left-charge');
    assert.equal(charge.frameRate, 8);
    assert.equal(charge.repeat, -1);
    assert.deepEqual(charge.frames.map(entry => entry.frame), ['finisher-left-charge-1', 'finisher-left-charge-2', 'finisher-left-charge-3']);
    const attack = created.get('finisher-left-attack');
    assert.equal(attack.frameRate, 14);
    assert.equal(attack.repeat, 0);
    assert.equal(created.has('finisher-right-charge'), false);
    // Registering twice cannot duplicate a key.
    registerFinisherAnimations(loaded, 'left');
    assert.equal(created.size, Object.keys(FINISHER_FRAME_COUNTS).length);
});

test('shipped finisher atlas matches the 55-frame Phaser contract', () => {
    const manifestUrl = new URL('../../../games/candle-battles/assets/candle-finishers.json', import.meta.url);
    const imageUrl = new URL('../../../games/candle-battles/assets/candle-finishers.png', import.meta.url);
    const manifest = JSON.parse(readFileSync(manifestUrl, 'utf8'));
    const image = readFileSync(imageUrl);
    assert.equal(image.toString('ascii', 1, 4), 'PNG');
    assert.equal(image.readUInt32BE(16), 1536);
    assert.equal(image.readUInt32BE(20), 2048);
    assert.equal(manifest.meta.format, 'RGBA8888');
    assert.deepEqual(manifest.meta.size, { w: 1536, h: 2048 });

    const expected = [
        ...Object.values(OVERLAY_FRAMES).flat(),
        'overlay-spark', 'overlay-dust', 'overlay-ring', 'overlay-trail',
    ];
    for (const side of ['left', 'right']) for (const [action, count] of Object.entries(FINISHER_FRAME_COUNTS)) {
        assert.ok(FINISHER_CAPTURE_FRAMES[action] >= 1 && FINISHER_CAPTURE_FRAMES[action] <= count, `${action} capture frame`);
        for (let frame = 1; frame <= count; frame++) expected.push(finisherFrameName(side, action, frame));
    }
    assert.equal(expected.length, 55);
    assert.deepEqual(Object.keys(manifest.frames), expected);
    const rectangles = new Set();
    for (const name of expected) {
        const entry = manifest.frames[name];
        assert.ok(entry, name);
        assert.deepEqual({ w: entry.frame.w, h: entry.frame.h }, { w: 200, h: 200 });
        assert.ok(entry.frame.x >= 0 && entry.frame.y >= 0);
        assert.ok(entry.frame.x + entry.frame.w <= 1536 && entry.frame.y + entry.frame.h <= 2048);
        const rectangle = `${entry.frame.x},${entry.frame.y},${entry.frame.w},${entry.frame.h}`;
        assert.equal(rectangles.has(rectangle), false, `${name} overlaps another manifest cell`);
        rectangles.add(rectangle);
    }
});

test('damage overlays keep the measured body anchors and never invent frames', () => {
    assert.deepEqual([...OVERLAY_KINDS], ['bandage', 'bruise', 'star']);
    for (const kind of OVERLAY_KINDS) {
        assert.ok(OVERLAY_FRAMES[kind].length >= 1);
        assert.ok(OVERLAY_FRAMES[kind].every(name => name.startsWith('overlay-')));
        const anchor = OVERLAY_ANCHORS[kind];
        assert.ok(Number.isFinite(anchor.x) && Number.isFinite(anchor.y));
        // Anchors stay inside the 200x200 cell measured from modular.png:
        // feet at y=197, head top in [82,115], speech anchor at y=32.
        assert.ok(anchor.y < 0 && anchor.y >= -165, `${kind} anchor y ${anchor.y}`);
        assert.ok(Math.abs(anchor.x) < 30, `${kind} anchor x ${anchor.x}`);
        assert.ok(OVERLAY_SCALES[kind] > 0 && OVERLAY_SCALES[kind] < 1, `${kind} scale ${OVERLAY_SCALES[kind]}`);
    }
    assert.ok(OVERLAY_ANCHORS.star.y < OVERLAY_ANCHORS.bandage.y);
    assert.ok(OVERLAY_ANCHORS.bandage.y < OVERLAY_ANCHORS.bruise.y);
});
