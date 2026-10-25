import { fighterAnimationForPhase } from './model.20261024f.js';
/**
 * Priority tiers from the delivery spec. A state may only be interrupted by an
 * equal or higher tier; lower tiers can never cut a critical beat short.
 */
export const COMBAT_PRIORITY = {
    finisher: 100,
    heavyHit: 80,
    attack: 60,
    guard: 50,
    recover: 40,
    personality: 20,
    idle: 10,
};
export const COMBAT_STATE_PRIORITY = {
    combat_hit_heavy: COMBAT_PRIORITY.heavyHit,
    combat_pushback: COMBAT_PRIORITY.heavyHit,
    combat_jab: COMBAT_PRIORITY.attack,
    combat_heavy_punch: COMBAT_PRIORITY.attack,
    combat_combo: COMBAT_PRIORITY.attack,
    combat_counter: COMBAT_PRIORITY.attack,
    combat_block: COMBAT_PRIORITY.guard,
    combat_guard: COMBAT_PRIORITY.guard,
    combat_dodge: COMBAT_PRIORITY.guard,
    combat_recover: COMBAT_PRIORITY.recover,
    combat_hit_light: COMBAT_PRIORITY.recover,
    taunt: COMBAT_PRIORITY.personality,
    surprised: COMBAT_PRIORITY.personality,
    comeback: COMBAT_PRIORITY.personality,
    combat_idle: COMBAT_PRIORITY.idle,
    confident_idle: COMBAT_PRIORITY.idle,
    nervous_idle: COMBAT_PRIORITY.idle,
    exhausted_idle: COMBAT_PRIORITY.idle,
    ready_stance: COMBAT_PRIORITY.idle,
};
/**
 * Explicit transition table. `holds` is the tier that cannot be interrupted at
 * all from below; `replacedBy` lists states that may cut the beat short even
 * inside its own hold window.
 */
export const COMBAT_TRANSITIONS = {
    combat_hit_heavy: { replacedBy: [] },
    combat_pushback: { replacedBy: ['combat_hit_heavy'] },
    combat_jab: { replacedBy: ['combat_hit_heavy', 'combat_pushback', 'combat_heavy_punch', 'combat_combo'] },
    combat_heavy_punch: { replacedBy: ['combat_hit_heavy', 'combat_pushback'] },
    combat_combo: { replacedBy: ['combat_hit_heavy', 'combat_pushback'] },
    combat_counter: { replacedBy: ['combat_hit_heavy', 'combat_pushback'] },
    combat_block: { replacedBy: ['combat_hit_heavy', 'combat_pushback', 'combat_heavy_punch', 'combat_combo'] },
    combat_guard: { replacedBy: ['combat_hit_heavy', 'combat_pushback', 'combat_heavy_punch', 'combat_combo', 'combat_jab', 'combat_counter'] },
    combat_dodge: { replacedBy: ['combat_hit_heavy', 'combat_pushback', 'combat_heavy_punch', 'combat_combo'] },
    combat_recover: { replacedBy: ['combat_hit_heavy', 'combat_pushback', 'combat_heavy_punch', 'combat_combo', 'combat_jab', 'combat_counter', 'combat_block', 'combat_dodge'] },
    combat_hit_light: { replacedBy: ['combat_hit_heavy', 'combat_pushback', 'combat_heavy_punch', 'combat_combo'] },
    taunt: { replacedBy: ['combat_hit_heavy', 'combat_pushback', 'combat_heavy_punch', 'combat_combo', 'combat_jab', 'combat_counter', 'combat_block', 'combat_dodge', 'combat_hit_light'] },
    surprised: { replacedBy: ['combat_hit_heavy', 'combat_pushback', 'combat_heavy_punch', 'combat_combo', 'combat_jab', 'combat_counter'] },
    comeback: { replacedBy: ['combat_hit_heavy', 'combat_pushback', 'combat_heavy_punch', 'combat_combo', 'combat_jab', 'combat_counter'] },
    combat_idle: { replacedBy: ['combat_hit_heavy', 'combat_pushback', 'combat_heavy_punch', 'combat_combo', 'combat_jab', 'combat_counter', 'combat_block', 'combat_dodge', 'combat_hit_light', 'combat_recover', 'taunt', 'surprised', 'comeback'] },
    confident_idle: { replacedBy: ['combat_hit_heavy', 'combat_pushback', 'combat_heavy_punch', 'combat_combo', 'combat_jab', 'combat_counter', 'combat_block', 'combat_dodge', 'combat_hit_light', 'combat_recover', 'surprised', 'comeback'] },
    nervous_idle: { replacedBy: ['combat_hit_heavy', 'combat_pushback', 'combat_heavy_punch', 'combat_combo', 'combat_jab', 'combat_counter', 'combat_block', 'combat_dodge', 'combat_hit_light', 'combat_recover', 'taunt', 'surprised', 'comeback'] },
    exhausted_idle: { replacedBy: ['combat_hit_heavy', 'combat_pushback', 'combat_heavy_punch', 'combat_combo', 'combat_jab', 'combat_counter', 'combat_block', 'combat_dodge', 'combat_hit_light', 'combat_recover', 'surprised'] },
    ready_stance: { replacedBy: ['combat_hit_heavy', 'combat_pushback', 'combat_heavy_punch', 'combat_combo', 'combat_jab', 'combat_counter', 'combat_block', 'combat_dodge', 'combat_hit_light', 'combat_recover', 'taunt', 'surprised', 'comeback'] },
};
/** Real frame counts in modular.json, not the renderer's playback subset. */
export const COMBAT_SEQUENCE_LENGTHS = {
    idle: 1, run: 8, punch: 6, break: 8, recover: 3,
};
const clamp01 = (value) => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
const allFinite = (...values) => values.every(Number.isFinite);
/** Deterministic integer hash. Replay and social capture depend on this. */
export function combatHash(value) {
    let h = Math.imul(value | 0, 2246822507);
    h ^= h >>> 15;
    h = Math.imul(h, 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
}
/**
 * Bands the visual intensity of an impact. When any real input is missing or
 * not finite the answer is 'none' so the presentation stays neutral instead of
 * inventing a level.
 */
export function impactLevel(input) {
    const values = [input.pressure, input.opponentPressure, input.strength, input.opponentStrength, input.hit];
    if (!allFinite(...values))
        return 'none';
    const gap = Math.abs(clamp01(input.pressure) - clamp01(input.opponentPressure));
    const strengthGap = Math.min(1, Math.abs(input.strength - input.opponentStrength) / 100);
    const base = clamp01(gap * .5 + strengthGap * .3 + clamp01(input.hit) * .2);
    const scaled = input.role === 'loser' ? base * 1.15
        : input.role === 'winner' ? base * .55
            : input.role === 'draw' ? base * .8
                : base;
    const score = clamp01(scaled);
    if (score >= .62)
        return 'heavy';
    if (score >= .38)
        return 'medium';
    if (score >= .16)
        return 'light';
    return 'none';
}
/**
 * Picks an occasional, reproducible idle mood. The variation comes from the
 * round seed and index so a replay always lands on the same mood.
 */
export function personalityFor(input) {
    const tension = clamp01(input.tension);
    const seed = Number.isFinite(input.seed) ? input.seed : 0;
    const roll = combatHash(Math.round(seed) + input.roundIndex * 7919);
    if (input.event === 'recovery')
        return 'confident_idle';
    if (input.event === 'lead_change')
        return 'nervous_idle';
    if (input.event === 'match_closing' && input.role === 'loser')
        return 'exhausted_idle';
    if (tension > .8)
        return 'ready_stance';
    if (input.streak >= 3 && input.role === 'winner')
        return 'confident_idle';
    if (input.role === 'loser')
        return roll > .55 ? 'exhausted_idle' : 'nervous_idle';
    if (tension > .35)
        return roll > .7 ? 'ready_stance' : 'combat_idle';
    return roll > .82 ? 'confident_idle' : roll > .62 ? 'ready_stance' : 'combat_idle';
}
const IDLE_MOTION = { lunge: 0, recoil: 0, guard: 0, tilt: 0, shake: 0, bob: .12, breath: .004, tremor: 0 };
const STATES = {
    combat_idle: {
        animation: 'idle', frameWindow: [1, 1], frameRate: 0, captureFrame: 1, durationMs: 0, spriteSequence: false,
        motion: { ...IDLE_MOTION, bob: .12, breath: .004 },
        fx: { impact: 'none', overlay: null, flash: 0, particles: 0, cameraShakeMs: 0 },
    },
    combat_guard: {
        animation: 'punch', frameWindow: [1, 2], frameRate: 5, captureFrame: 1, durationMs: 0, spriteSequence: true,
        motion: { lunge: 0, recoil: .3, guard: .55, tilt: -.04, shake: .2, bob: .16, breath: .005, tremor: .004 },
        fx: { impact: 'none', overlay: null, flash: 0, particles: 0, cameraShakeMs: 0 },
    },
    combat_dodge: {
        animation: 'recover', frameWindow: [1, 1], frameRate: 0, captureFrame: 1, durationMs: 420, spriteSequence: false,
        motion: { lunge: 0, recoil: 1.5, guard: .2, tilt: .1, shake: .5, bob: .2, breath: .006, tremor: .01 },
        fx: { impact: 'light', overlay: 'dust', flash: 0, particles: 1, cameraShakeMs: 0 },
    },
    combat_jab: {
        animation: 'punch', frameWindow: [2, 3], frameRate: 20, captureFrame: 3, durationMs: 300, spriteSequence: true,
        motion: { lunge: 1.1, recoil: 0, guard: 0, tilt: -.06, shake: .1, bob: .08, breath: 0, tremor: 0 },
        fx: { impact: 'light', overlay: 'spark', flash: .18, particles: 1, cameraShakeMs: 0 },
    },
    combat_heavy_punch: {
        animation: 'punch', frameWindow: [1, 3], frameRate: 12, captureFrame: 3, durationMs: 560, spriteSequence: true,
        motion: { lunge: 2.3, recoil: 0, guard: 0, tilt: -.11, shake: .35, bob: .1, breath: 0, tremor: .006 },
        fx: { impact: 'heavy', overlay: 'ring', flash: .34, particles: 3, cameraShakeMs: 140 },
    },
    combat_combo: {
        animation: 'punch', frameWindow: [2, 3], frameRate: 24, captureFrame: 3, durationMs: 760, spriteSequence: true,
        motion: { lunge: 1.7, recoil: 0, guard: 0, tilt: -.08, shake: .28, bob: .12, breath: 0, tremor: .005 },
        fx: { impact: 'medium', overlay: 'trail', flash: .26, particles: 2, cameraShakeMs: 90 },
    },
    combat_counter: {
        animation: 'recover', frameWindow: [1, 2], frameRate: 14, captureFrame: 2, durationMs: 520, spriteSequence: true,
        motion: { lunge: 1.4, recoil: .35, guard: .15, tilt: -.07, shake: .3, bob: .1, breath: 0, tremor: .006 },
        fx: { impact: 'medium', overlay: 'spark', flash: .3, particles: 2, cameraShakeMs: 80 },
    },
    combat_block: {
        animation: 'punch', frameWindow: [1, 2], frameRate: 8, captureFrame: 1, durationMs: 420, spriteSequence: true,
        motion: { lunge: 0, recoil: .8, guard: .85, tilt: .05, shake: .4, bob: .14, breath: .004, tremor: .008 },
        fx: { impact: 'light', overlay: 'dust', flash: .12, particles: 1, cameraShakeMs: 0 },
    },
    combat_hit_light: {
        animation: 'recover', frameWindow: [1, 1], frameRate: 0, captureFrame: 1, durationMs: 380, spriteSequence: false,
        motion: { lunge: 0, recoil: .55, guard: 0, tilt: .07, shake: .25, bob: .1, breath: 0, tremor: .006 },
        fx: { impact: 'light', overlay: null, flash: .22, particles: 0, cameraShakeMs: 0 },
    },
    combat_hit_heavy: {
        animation: 'recover', frameWindow: [1, 1], frameRate: 0, captureFrame: 1, durationMs: 900, spriteSequence: false,
        motion: { lunge: 0, recoil: 1.9, guard: 0, tilt: .17, shake: .9, bob: .22, breath: .01, tremor: .022 },
        fx: { impact: 'heavy', overlay: 'ring', flash: .55, particles: 4, cameraShakeMs: 220 },
    },
    combat_recover: {
        animation: 'recover', frameWindow: [1, 3], frameRate: 8, captureFrame: 3, durationMs: 700, spriteSequence: true,
        motion: { lunge: .25, recoil: .3, guard: .1, tilt: -.02, shake: .1, bob: .18, breath: .008, tremor: .002 },
        fx: { impact: 'none', overlay: null, flash: 0, particles: 0, cameraShakeMs: 0 },
    },
    combat_pushback: {
        animation: 'recover', frameWindow: [1, 1], frameRate: 0, captureFrame: 1, durationMs: 620, spriteSequence: false,
        motion: { lunge: 0, recoil: 2.4, guard: .35, tilt: .13, shake: .7, bob: .18, breath: .008, tremor: .016 },
        fx: { impact: 'medium', overlay: 'dust', flash: .3, particles: 2, cameraShakeMs: 120 },
    },
    taunt: {
        animation: 'recover', frameWindow: [2, 2], frameRate: 0, captureFrame: 2, durationMs: 900, spriteSequence: false,
        motion: { lunge: .55, recoil: 0, guard: 0, tilt: -.09, shake: .12, bob: .26, breath: .012, tremor: .003 },
        fx: { impact: 'none', overlay: null, flash: 0, particles: 0, cameraShakeMs: 0 },
    },
    confident_idle: {
        animation: 'idle', frameWindow: [1, 1], frameRate: 0, captureFrame: 1, durationMs: 0, spriteSequence: false,
        motion: { lunge: .2, recoil: 0, guard: .1, tilt: -.035, shake: .05, bob: .1, breath: .006, tremor: 0 },
        fx: { impact: 'none', overlay: null, flash: 0, particles: 0, cameraShakeMs: 0 },
    },
    nervous_idle: {
        animation: 'punch', frameWindow: [1, 2], frameRate: 7, captureFrame: 1, durationMs: 0, spriteSequence: true,
        motion: { lunge: .1, recoil: .35, guard: .35, tilt: .04, shake: .55, bob: .14, breath: .005, tremor: .012 },
        fx: { impact: 'none', overlay: null, flash: 0, particles: 0, cameraShakeMs: 0 },
    },
    exhausted_idle: {
        animation: 'run', frameWindow: [1, 2], frameRate: 2, captureFrame: 1, durationMs: 0, spriteSequence: true,
        motion: { lunge: 0, recoil: .5, guard: .15, tilt: .06, shake: .18, bob: .34, breath: .016, tremor: .004 },
        fx: { impact: 'none', overlay: null, flash: 0, particles: 0, cameraShakeMs: 0 },
    },
    ready_stance: {
        animation: 'punch', frameWindow: [1, 3], frameRate: 4, captureFrame: 1, durationMs: 0, spriteSequence: true,
        motion: { lunge: .45, recoil: .15, guard: .7, tilt: -.05, shake: .16, bob: .2, breath: .007, tremor: .003 },
        fx: { impact: 'none', overlay: null, flash: 0, particles: 0, cameraShakeMs: 0 },
    },
    surprised: {
        animation: 'recover', frameWindow: [1, 1], frameRate: 0, captureFrame: 1, durationMs: 620, spriteSequence: false,
        motion: { lunge: 0, recoil: 1.15, guard: .1, tilt: .11, shake: .6, bob: .2, breath: .012, tremor: .014 },
        fx: { impact: 'medium', overlay: 'ring', flash: .2, particles: 1, cameraShakeMs: 60 },
    },
    comeback: {
        animation: 'recover', frameWindow: [2, 3], frameRate: 6, captureFrame: 2, durationMs: 1100, spriteSequence: true,
        motion: { lunge: 1.25, recoil: 0, guard: .1, tilt: -.1, shake: .2, bob: .3, breath: .014, tremor: .004 },
        fx: { impact: 'medium', overlay: 'spark', flash: .18, particles: 2, cameraShakeMs: 70 },
    },
};
export const COMBAT_STATE_NAMES = Object.keys(STATES);
export function combatPlan(state, overrides = {}) {
    return {
        ...STATES[state],
        ...overrides,
        motion: { ...STATES[state].motion, ...(overrides.motion ?? {}) },
        fx: { ...STATES[state].fx, ...(overrides.fx ?? {}) },
        state,
        priority: COMBAT_STATE_PRIORITY[state],
    };
}
/** Dominant channel wins; ties resolve in the fixed order below. */
function dominant(motion) {
    const entries = [
        ['hit', motion.hit], ['counter', motion.counter], ['attack', motion.attack],
        ['dodge', motion.dodge], ['guard', motion.block], ['taunt', motion.taunt],
    ];
    let best = entries[0];
    for (const entry of entries)
        if (entry[1] > best[1])
            best = entry;
    return best[0];
}
export function combatStateKind(state) {
    switch (state) {
        case 'combat_jab':
        case 'combat_heavy_punch':
        case 'combat_combo':
        case 'combat_counter':
            return 'attack';
        case 'combat_block':
        case 'combat_guard':
        case 'combat_dodge':
        case 'ready_stance':
            return 'guard';
        case 'combat_hit_light':
        case 'combat_hit_heavy':
        case 'combat_pushback':
        case 'combat_recover':
        case 'surprised':
            return 'reaction';
        default:
            return 'idle';
    }
}
/**
 * Window inside a modular sequence that still reads as the beat's meaning.
 * Every window spans at least two distinct drawings whenever the sequence has
 * them, so a registered beat can never be a run of identical frames.
 */
export function windowFor(action, kind) {
    const max = COMBAT_SEQUENCE_LENGTHS[action];
    const pick = (start, end) => [Math.max(1, Math.min(start, max)), Math.max(1, Math.min(end, max))];
    if (action === 'punch')
        return kind === 'attack' ? pick(2, 3) : kind === 'guard' ? pick(1, 2) : pick(1, 1);
    if (action === 'run')
        return kind === 'attack' ? pick(1, 3) : pick(1, 2);
    if (action === 'recover')
        return kind === 'attack' ? pick(1, 2) : pick(1, 1);
    return pick(1, 1);
}
/**
 * Keeps the beat on the sequence the battle phase already owns. The phase to
 * animation mapping is an existing contract used by social capture, so a beat
 * may change intensity, motion and effects but never swap the action the
 * fighter is performing mid-phase. When the phase has no action of its own
 * (`idle`) the beat keeps its own sequence, which is where the between-round
 * movement lives.
 */
export function alignToPhase(plan, phase) {
    const action = fighterAnimationForPhase(phase);
    if (action === 'idle' || action === plan.animation)
        return plan;
    const [start, end] = windowFor(action, combatStateKind(plan.state));
    return {
        ...plan,
        animation: action,
        frameWindow: [start, end],
        captureFrame: start,
        spriteSequence: end > start,
    };
}
/**
 * Resolves the beat this fighter should be showing. The winner is only ever the
 * value the caller read from the authoritative round; nothing here re-decides
 * a result from pressure, sprite size or candle colour.
 */
export function resolveCombatState(input) {
    return alignToPhase(pickCombatState(input), input.phase);
}
function pickCombatState(input) {
    const role = input.role;
    const impact = input.impact;
    const motion = input.motion;
    const heavyImpact = impact === 'heavy';
    const mediumImpact = impact === 'medium';
    if (role === 'loser' && heavyImpact)
        return combatPlan('combat_hit_heavy');
    if (heavyImpact && motion.hit > .45)
        return combatPlan('combat_hit_heavy');
    if (role === 'loser' && mediumImpact && motion.hit > .3)
        return combatPlan('combat_pushback');
    const channel = dominant(motion);
    const fightPhase = input.phase !== 'FORMING_CANDLE' && input.phase !== 'WAITING_MARKET';
    if (fightPhase && channel === 'hit' && motion.hit > .18) {
        return combatPlan(impact === 'light' || impact === 'none' ? 'combat_hit_light' : 'combat_pushback');
    }
    if (fightPhase && channel === 'counter' && motion.counter > .32)
        return combatPlan('combat_counter');
    if (fightPhase && channel === 'attack' && motion.attack > .16) {
        if (motion.attack > .62 && (heavyImpact || mediumImpact))
            return combatPlan('combat_heavy_punch');
        if (motion.attack > .45)
            return combatPlan('combat_combo');
        return combatPlan('combat_jab');
    }
    if (fightPhase && channel === 'dodge' && motion.dodge > .26)
        return combatPlan('combat_dodge');
    if (fightPhase && channel === 'guard' && motion.block > .3)
        return combatPlan('combat_block');
    if (fightPhase && channel === 'guard')
        return combatPlan('combat_guard');
    if (input.event === 'lead_change')
        return combatPlan('surprised');
    if (input.event === 'recovery')
        return combatPlan('comeback');
    if (input.event === 'win_streak' && role === 'winner')
        return combatPlan('taunt');
    if (input.event === 'dominant_win' && role === 'winner')
        return combatPlan('taunt');
    if (input.event === 'match_closing')
        return combatPlan(role === 'loser' ? 'exhausted_idle' : 'confident_idle');
    if (fightPhase && motion.hit > .08)
        return combatPlan('combat_recover');
    switch (input.personality) {
        case 'confident_idle': return combatPlan('confident_idle');
        case 'nervous_idle': return combatPlan('nervous_idle');
        case 'exhausted_idle': return combatPlan('exhausted_idle');
        case 'ready_stance': return combatPlan('ready_stance');
        default: return combatPlan('combat_idle');
    }
}
/** True when `next` is allowed to cut `current` short. */
export function canInterrupt(current, next) {
    if (next.priority > current.priority)
        return true;
    if (next.priority < current.priority)
        return false;
    return next.state !== current.state && COMBAT_TRANSITIONS[current.state].replacedBy.includes(next.state);
}
/**
 * Holds the active beat and enforces the transition rules. Equal-tier states
 * only take over when the transition table allows it, so an idle can never cut
 * a special, an impact or a knockout.
 */
export class CombatSequencer {
    constructor() {
        this.startedAt = 0;
    }
    get active() { return this.plan; }
    get age() { return this.plan ? this.startedAt : 0; }
    request(next, elapsedMs) {
        const now = Number.isFinite(elapsedMs) ? elapsedMs : 0;
        const current = this.plan;
        if (!current) {
            this.plan = { ...next };
            this.startedAt = now;
            return true;
        }
        if (next.state === current.state) {
            this.plan = { ...next };
            return false;
        }
        const expired = current.durationMs > 0 && now - this.startedAt >= current.durationMs;
        if (expired || canInterrupt(current, next)) {
            this.plan = { ...next };
            this.startedAt = now;
            return true;
        }
        return false;
    }
    /** Drops an expired beat so the caller can fall back to idle. */
    update(elapsedMs) {
        const now = Number.isFinite(elapsedMs) ? elapsedMs : 0;
        if (this.plan && this.plan.durationMs > 0 && now - this.startedAt >= this.plan.durationMs)
            this.plan = undefined;
        return this.plan;
    }
    reset() { this.plan = undefined; this.startedAt = 0; }
}
/**
 * Frame index for a plan at a simulation-clock instant. Pure, so live play,
 * replay, accelerated replay, seeking and pause all agree.
 */
export function frameAt(plan, timeMs) {
    const [start, end] = plan.frameWindow;
    const length = Math.max(1, end - start + 1);
    if (length === 1 || !Number.isFinite(timeMs))
        return plan.captureFrame ?? start;
    const stepMs = 1000 / Math.max(1, plan.frameRate);
    const step = Math.floor(Math.max(0, timeMs) / stepMs);
    return start + (step % length);
}
/**
 * Transform for a plan at a simulation-clock instant. The amplitudes are small
 * so the fighters read as alive without disturbing the OHLC candles. `stateAge`
 * drives the brief impact flash so it fades the same way in every playback mode.
 */
export function transformAt(plan, timeMs, facing, baseScale, stateAge = 0) {
    const t = Number.isFinite(timeMs) ? Math.max(0, timeMs) : 0;
    const m = plan.motion;
    const sign = facing >= 0 ? 1 : -1;
    const breathe = Math.sin(t / 620) * m.bob;
    const tremor = m.shake * Math.sin(t / 47) * .6 + m.tremor * 60 * Math.sin(t / 31);
    const age = Math.max(0, Number.isFinite(stateAge) ? stateAge : 0);
    const decay = Math.exp(-age / Math.max(160, plan.durationMs || 420));
    return {
        x: sign * (m.lunge * 4 - m.recoil * 3) + tremor,
        y: breathe + m.guard * -3,
        rotation: sign * (m.tilt + Math.sin(t / 890) * m.tremor * 2),
        scale: baseScale + Math.sin(t / 730) * m.breath,
        flash: plan.fx.flash * decay,
    };
}
