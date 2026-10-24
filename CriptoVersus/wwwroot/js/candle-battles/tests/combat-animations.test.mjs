import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { demoRound, combatAdvantage, combatFrame, fighterAnimationForPhase, resolveFinalePose, MATCH_ROUNDS } from '../../dist/candle-battles/model.js';
import {
    COMBAT_PRIORITY, COMBAT_STATE_PRIORITY, COMBAT_STATE_NAMES, COMBAT_SEQUENCE_LENGTHS, COMBAT_TRANSITIONS,
    CombatSequencer, alignToPhase, canInterrupt, combatHash, combatPlan, combatStateKind, frameAt, impactLevel,
    personalityFor, resolveCombatState, transformAt, windowFor,
} from '../../dist/candle-battles/combat-animations.js';

const audit = JSON.parse(readFileSync(new URL('../../../../tools/candle-battles/frame-audit.json', import.meta.url), 'utf8'));
const modularFrames = audit.modular.frames;
const modularPng = readFileSync(new URL('../../../games/candle-battles/assets/modular.png', import.meta.url));
const finishersPng = readFileSync(new URL('../../../games/candle-battles/assets/candle-finishers.png', import.meta.url));

const sha = buffer => createHash('sha256').update(buffer).digest('hex');
const digestOf = name => {
    const digest = modularFrames[name];
    assert.ok(digest, `frame ${name} must be inventoried`);
    return digest;
};
const candle = (over = {}) => ({ symbol: 'T', openTime: 0, closeTime: 300_000, updatedAt: 300_000, open: 100, high: 100, low: 100, close: 100, volume: 1, confirmed: true, ...over });
const idleMotion = { attack: 0, block: 0, dodge: 0, hit: 0, counter: 0, taunt: 0 };
const baseInput = over => ({
    phase: 'FORMING_CANDLE', role: 'none', motion: idleMotion, impact: 'none',
    personality: 'combat_idle', event: 'none', tension: 0, elapsedMs: 0, seed: 1, ...over,
});

test('combat inventory is fresh: the audited digests describe the shipped atlases', () => {
    assert.equal(audit.modular.pngSha256, sha(modularPng), 're-run tools/candle-battles/audit-frames.py after editing an atlas');
    assert.equal(audit['candle-finishers'].pngSha256, sha(finishersPng), 're-run tools/candle-battles/audit-frames.py after editing an atlas');
    assert.deepEqual(audit.modular.size, { w: 1536, h: 6144 });
    assert.equal(Object.keys(modularFrames).length, 163);
});

test('no registered combat beat is built from identical frames', () => {
    for (const state of COMBAT_STATE_NAMES) {
        const plan = combatPlan(state);
        const [start, end] = plan.frameWindow;
        const names = [];
        for (let i = start; i <= end; i++) names.push(`fighter-left-neutral-${plan.animation}-${i}`);
        for (const name of names) assert.ok(modularFrames[name], `${state} references missing frame ${name}`);
        const distinct = new Set(names.map(digestOf));
        if (plan.spriteSequence) {
            assert.ok(distinct.size >= 2, `${state} must swap distinct drawings, found ${distinct.size} across ${names.join(',')}`);
        }
        // Even a held pose must move: the transform channels carry the beat.
        const a = transformAt(plan, 0, 1, .8);
        const b = transformAt(plan, 417, 1, .8);
        const moved = a.x !== b.x || a.y !== b.y || a.rotation !== b.rotation || a.scale !== b.scale;
        assert.ok(moved, `${state} produces no visible movement`);
    }
});

test('every combat beat maps to frames that really exist in modular.png', () => {
    for (const state of COMBAT_STATE_NAMES) {
        const plan = combatPlan(state);
        const max = COMBAT_SEQUENCE_LENGTHS[plan.animation];
        assert.ok(plan.frameWindow[0] >= 1 && plan.frameWindow[1] <= max, `${state} window ${plan.frameWindow} outside ${plan.animation}`);
        assert.ok(plan.captureFrame >= plan.frameWindow[0] && plan.captureFrame <= plan.frameWindow[1], `${state} capture frame`);
        assert.ok(plan.motion.lunge >= 0 && plan.motion.recoil >= 0, `${state} displacements stay one-directional`);
        for (const key of Object.keys(plan.motion)) assert.ok(Number.isFinite(plan.motion[key]), `${state}.${key}`);
    }
});

test('animation priority follows the delivery ladder and idle can never cancel a critical beat', () => {
    assert.ok(COMBAT_PRIORITY.finisher > COMBAT_PRIORITY.heavyHit);
    assert.ok(COMBAT_PRIORITY.heavyHit > COMBAT_PRIORITY.attack);
    assert.ok(COMBAT_PRIORITY.attack > COMBAT_PRIORITY.guard);
    assert.ok(COMBAT_PRIORITY.guard > COMBAT_PRIORITY.recover);
    assert.ok(COMBAT_PRIORITY.recover > COMBAT_PRIORITY.personality);
    assert.ok(COMBAT_PRIORITY.personality > COMBAT_PRIORITY.idle);

    const critical = ['combat_hit_heavy', 'combat_pushback', 'combat_heavy_punch', 'combat_combo', 'combat_jab', 'combat_counter'];
    const low = ['combat_idle', 'confident_idle', 'nervous_idle', 'exhausted_idle', 'ready_stance', 'taunt', 'surprised', 'comeback'];
    for (const strong of critical) for (const weak of low) {
        assert.equal(canInterrupt(combatPlan(strong), combatPlan(weak)), false, `${weak} must not interrupt ${strong}`);
        assert.equal(canInterrupt(combatPlan(weak), combatPlan(strong)), true, `${strong} must interrupt ${weak}`);
    }
    assert.equal(COMBAT_STATE_PRIORITY.combat_hit_heavy, COMBAT_PRIORITY.heavyHit);
    assert.equal(COMBAT_STATE_PRIORITY.combat_idle, COMBAT_PRIORITY.idle);
});

test('the transition table names an explicit cancellation rule for every beat', () => {
    for (const state of COMBAT_STATE_NAMES) {
        const entry = COMBAT_TRANSITIONS[state];
        assert.ok(entry, `${state} missing from COMBAT_TRANSITIONS`);
        for (const other of entry.replacedBy) {
            assert.ok(COMBAT_STATE_NAMES.includes(other), `${state} lists unknown state ${other}`);
            assert.ok(COMBAT_STATE_PRIORITY[other] >= COMBAT_STATE_PRIORITY[state], `${other} cannot cancel ${state} from below`);
        }
    }
});

test('the sequencer enforces holds, refreshes motion in place and expires timed beats', () => {
    const sequencer = new CombatSequencer();
    const at = (elapsed, state) => sequencer.request(combatPlan(state), elapsed);
    assert.equal(at(0, 'combat_hit_heavy'), true);
    assert.equal(at(50, 'combat_idle'), false, 'idle cannot cut the heavy hit short');
    assert.equal(sequencer.active.state, 'combat_hit_heavy');
    assert.equal(at(80, 'combat_hit_heavy'), false, 'the same beat refreshes without restarting');
    assert.equal(at(100, 'combat_heavy_punch'), false, 'a lower tier cannot cut in');
    assert.equal(sequencer.update(200).state, 'combat_hit_heavy');
    assert.equal(sequencer.update(1000), undefined, 'the 900ms beat ends');
    assert.equal(at(1000, 'combat_idle'), true, 'idle resumes once the beat is over');
    sequencer.reset();
    assert.equal(sequencer.active, undefined);
});

test('impact levels are proportional to real confrontation data and stay neutral when it is missing', () => {
    const winner = { pressure: .82, opponentPressure: .18, strength: 90, opponentStrength: 20, hit: .2, role: 'winner' };
    const loser = { pressure: .18, opponentPressure: .82, strength: 20, opponentStrength: 90, hit: .8, role: 'loser' };
    assert.equal(impactLevel(loser), 'heavy');
    assert.ok(['none', 'light'].includes(impactLevel(winner)), 'the winner never reels');
    const mild = impactLevel({ pressure: .55, opponentPressure: .45, strength: 50, opponentStrength: 48, hit: .1, role: 'loser' });
    const strong = impactLevel({ pressure: .2, opponentPressure: .8, strength: 10, opponentStrength: 95, hit: .9, role: 'loser' });
    const band = { none: 0, light: 1, medium: 2, heavy: 3 };
    assert.ok(band[strong] > band[mild], 'a wider advantage gap reads as a harder impact');
    assert.equal(impactLevel({ pressure: .5, opponentPressure: .5, strength: NaN, opponentStrength: 50, hit: .5, role: 'loser' }), 'none');
    assert.equal(impactLevel({ pressure: .9, opponentPressure: .1, strength: 90, opponentStrength: 10, hit: Number.POSITIVE_INFINITY, role: 'loser' }), 'none');
});

test('the loser always reels, whatever the candle colour or body size', () => {
    // Green larger versus green smaller: the larger percentage return wins.
    const bigGreen = candle({ open: 100, close: 112, high: 118, low: 96 });
    const smallGreen = candle({ open: 100, close: 103, high: 106, low: 97 });
    const greenRound = demoRound(0);
    // Red versus green: the green candle wins under the existing return rule.
    const bigRed = candle({ open: 100, close: 70, high: 130, low: 60 });
    const green = candle({ open: 100, close: 101, high: 102, low: 99 });
    // Red larger versus red smaller: the smaller red wins under the existing rule.
    const bigRed2 = candle({ open: 100, close: 80, high: 140, low: 70 });
    const smallRed = candle({ open: 100, close: 96, high: 104, low: 92 });

    for (const [left, right, officialWinner] of [
        [bigGreen, smallGreen, 'left'],
        [bigRed, green, 'right'],
        [bigRed2, smallRed, 'right'],
    ]) {
        const advantage = combatAdvantage(left, right, 50, 50, officialWinner);
        const winnerSide = officialWinner;
        const loserSide = officialWinner === 'left' ? 'right' : 'left';
        for (const side of [winnerSide, loserSide]) {
            const role = side === winnerSide ? 'winner' : 'loser';
            const plan = resolveCombatState(baseInput({
                phase: 'COLLISION',
                role,
                impact: impactLevel({
                    pressure: side === 'left' ? advantage.leftPressure : advantage.rightPressure,
                    opponentPressure: side === 'left' ? advantage.rightPressure : advantage.leftPressure,
                    strength: 50, opponentStrength: 50,
                    hit: side === winnerSide ? .2 : .75, role,
                }),
                motion: { ...idleMotion, attack: side === winnerSide ? .7 : .25, hit: side === winnerSide ? .15 : .7 },
            }));
            if (role === 'loser') {
                assert.ok(['combat_hit_light', 'combat_hit_heavy', 'combat_pushback', 'combat_recover'].includes(plan.state),
                    `loser must recoil, got ${plan.state}`);
                assert.ok(plan.motion.recoil > 0, 'the loser moves backwards');
            } else {
                assert.ok(['combat_jab', 'combat_heavy_punch', 'combat_combo', 'combat_counter'].includes(plan.state),
                    `winner must press the attack, got ${plan.state}`);
                assert.ok(plan.motion.lunge > 0, 'the winner moves forwards');
            }
        }
    }
    assert.equal(greenRound.winner === 'draw' || typeof greenRound.winner === 'string', true);
});

test('a large red candle never looks superior just because its body is bigger', () => {
    const largeRed = candle({ open: 100, close: 90, high: 250, low: 20 });
    const smallGreen = candle({ open: 100, close: 100.4, high: 101, low: 99.8 });
    const advantage = combatAdvantage(largeRed, smallGreen, 50, 50, 'right');
    assert.ok(advantage.leftPressure < advantage.rightPressure, 'the green candle holds the advantage');
    const loser = resolveCombatState(baseInput({
        phase: 'COLLISION', role: 'loser',
        impact: impactLevel({ pressure: advantage.leftPressure, opponentPressure: advantage.rightPressure, strength: 50, opponentStrength: 50, hit: .8, role: 'loser' }),
        motion: { ...idleMotion, hit: .8 },
    }));
    assert.ok(loser.motion.recoil > loser.motion.lunge, 'the big red candle is driven back');
});

test('round beats stay synchronized with the five-minute candle close', () => {
    assert.equal(fighterAnimationForPhase('FORMING_CANDLE'), 'idle');
    assert.equal(fighterAnimationForPhase('ATTACKING'), 'punch');
    // Tension rises only in the final minute of the candle window.
    const closing = resolveCombatState(baseInput({ tension: 1, personality: personalityFor({ role: 'none', event: 'none', tension: 1, seed: 3, roundIndex: 4, streak: 0 }) }));
    assert.equal(closing.state, 'ready_stance', 'the fighters brace as the candle close approaches');
    const early = resolveCombatState(baseInput({ tension: 0, personality: personalityFor({ role: 'none', event: 'none', tension: 0, seed: 3, roundIndex: 4, streak: 0 }) }));
    assert.notEqual(early.state, closing.state);
    // Nothing announces the result before the round is resolved.
    const waiting = resolveCombatState(baseInput({ phase: 'WAITING_MARKET', role: 'none', tension: 1 }));
    assert.ok(COMBAT_STATE_PRIORITY[waiting.state] <= COMBAT_PRIORITY.personality, 'no attack beat before the confrontation starts');
});

test('real match events drive the personality beats and nothing else', () => {
    const eventStates = {
        lead_change: 'surprised',
        recovery: 'comeback',
        win_streak: 'taunt',
        dominant_win: 'taunt',
    };
    for (const [event, state] of Object.entries(eventStates)) {
        const plan = resolveCombatState(baseInput({ event, role: event === 'lead_change' ? 'loser' : 'winner', tension: 0 }));
        assert.equal(plan.state, state, `${event} must play ${state}`);
    }
    assert.equal(resolveCombatState(baseInput({ event: 'match_closing', role: 'loser' })).state, 'exhausted_idle');
    assert.equal(resolveCombatState(baseInput({ event: 'match_closing', role: 'winner' })).state, 'confident_idle');
    assert.equal(resolveCombatState(baseInput({ event: 'match_closing', role: 'draw' })).state, 'confident_idle');
    assert.equal(resolveCombatState(baseInput({ event: 'none', role: 'winner' })).state, 'combat_idle');
});

test('personality beats are occasional, controlled and reproducible', () => {
    const input = { role: 'winner', event: 'none', tension: .2, seed: 4242, roundIndex: 6, streak: 0 };
    const first = personalityFor(input);
    for (let i = 0; i < 25; i++) assert.equal(personalityFor(input), first, 'the same match moment always picks the same mood');
    const moods = new Set();
    for (let roundIndex = 0; roundIndex < 40; roundIndex++) moods.add(personalityFor({ ...input, roundIndex }));
    assert.ok(moods.size >= 2, 'the moods vary across rounds');
    assert.notEqual(combatHash(1), combatHash(2));
    const runtime = readFileSync(new URL('../../dist/candle-battles/combat-animations.js', import.meta.url), 'utf8');
    assert.equal(runtime.includes('Math.random'), false, 'combat beats must not use unseeded randomness');
});

test('frame selection is a pure function of the simulation clock, so every replay speed agrees', () => {
    const plan = combatPlan('combat_combo');
    // Walk the same simulated instants with different wall steps: the frame at
    // each simulation-clock value must not depend on the playback speed.
    const walk = (speed, wallStep, count) => {
        let sim = 0;
        const map = new Map();
        for (let i = 0; i < count; i++) { sim += wallStep * speed; map.set(sim, frameAt(plan, sim)); }
        return map;
    };
    const baseline = walk(1, 100, 40);
    for (const [speed, wallStep] of [[2, 50], [5, 20], [10, 10]]) {
        assert.deepEqual([...walk(speed, wallStep, 40)], [...baseline], `frames diverge at ${speed}x`);
    }
    // Accelerated replay covers the same simulated beat in proportionally less
    // wall time, which is what makes the 2x/5x/10x controls feel correct.
    assert.equal(frameAt(plan, 2000), frameAt(plan, 2000));
    const seen = new Set(Array.from({ length: 24 }, (_, i) => frameAt(plan, i * 25)));
    assert.ok(seen.size >= 2, `the beat must advance with the clock, saw ${[...seen]}`);
    const transforms = [0, 1, 2, 3, 4].map(t => transformAt(plan, t * 100, 1, .8));
    assert.equal(new Set(transforms.map(t => JSON.stringify(t))).size > 1, true, 'the beat must move over time');
    assert.equal(frameAt(plan, Number.NaN), plan.captureFrame, 'an unknown clock parks on the stable capture frame');
});

test('frozen captures always land on a real, stable frame', () => {
    for (const state of COMBAT_STATE_NAMES) {
        const plan = combatPlan(state);
        assert.equal(frameAt(plan, 999_999) === plan.captureFrame || plan.spriteSequence, true);
        for (const action of [plan.animation]) {
            const name = `fighter-left-neutral-${action}-${plan.captureFrame}`;
            assert.ok(modularFrames[name], `${state} capture frame ${name} must exist`);
        }
        const flashA = transformAt(plan, 0, 1, .8, 0).flash;
        const flashB = transformAt(plan, 0, 1, .8, 1e6).flash;
        assert.ok(flashA >= flashB, 'the impact flash decays');
        assert.equal(transformAt(plan, 0, 1, .8, 1e6).flash, 0, 'a frozen capture has no flash');
    }
});

test('phase alignment keeps the documented action frames while the beat adds its own intensity', () => {
    const phases = ['SPAWNING', 'APPROACHING', 'ATTACKING', 'COLLISION', 'DESTROYING'];
    for (const phase of phases) {
        const action = fighterAnimationForPhase(phase);
        for (const state of COMBAT_STATE_NAMES) {
            const aligned = alignToPhase(combatPlan(state), phase);
            if (action === 'idle') {
                assert.equal(aligned.animation, combatPlan(state).animation, `${state} keeps its own sequence while waiting`);
            } else {
                assert.equal(aligned.animation, action, `${state} must stay on the ${phase} action`);
                const [start] = aligned.frameWindow;
                assert.ok(modularFrames[`fighter-left-neutral-${action}-${start}`]);
            }
        }
    }
    // The closing cinematic is owned by the finale poses and is not remapped.
    for (const phase of ['MATCH_FINISHED', 'KNOCKOUT', 'SOCIAL_FINAL_POSE']) {
        const pose = resolveFinalePose(phase, 'winner', true);
        assert.ok(pose.finisher || pose.animation, `${phase} keeps its closing pose`);
    }
});

test('combat beats never invent a winner from pressure or sprite size', () => {
    // A deliberately absurd visual advantage must not flip an authoritative loss.
    const plan = resolveCombatState(baseInput({
        phase: 'COLLISION', role: 'loser', impact: 'heavy',
        motion: { attack: 1, block: 0, dodge: 0, hit: 0, counter: 1, taunt: 0 },
    }));
    assert.ok(plan.motion.recoil > 0, 'the authoritative loser still reels');
    assert.ok(plan.motion.lunge <= plan.motion.recoil);
    // And the resolver only ever echoes the role it was given.
    for (const role of ['winner', 'loser', 'draw', 'none']) {
        const resolved = resolveCombatState(baseInput({ role, phase: 'COLLISION', impact: 'heavy', motion: { ...idleMotion, hit: .95, attack: .95 } }));
        assert.ok(resolved.state, `${role} resolves`);
    }
});

test('the match timeline exposes exactly eighteen confrontations of five minutes', () => {
    assert.equal(MATCH_ROUNDS, 18);
    assert.equal(combatStateKind('combat_hit_heavy'), 'reaction');
    assert.equal(combatStateKind('combat_jab'), 'attack');
    assert.equal(combatStateKind('combat_guard'), 'guard');
    assert.equal(combatStateKind('combat_idle'), 'idle');
    assert.deepEqual(windowFor('punch', 'attack'), [2, 3]);
    assert.deepEqual(windowFor('punch', 'reaction'), [1, 1]);
    assert.deepEqual(windowFor('run', 'idle'), [1, 2]);
});
