export type Side = "left" | "right";
export type Winner = Side | "draw";
export interface Candle {
    symbol: string;
    openTime: number;
    closeTime: number;
    updatedAt: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number | null;
    confirmed: boolean;
    strength?: number | null;
}
export interface Round {
    id: string;
    matchId: number;
    left: Candle;
    right: Candle;
    winner: Winner;
    ruleVersion: string;
    leftStrength: number;
    rightStrength: number;
}
export const PERIOD = 300_000;
export const MATCH_DURATION = 18 * PERIOD;
export const MATCH_ROUNDS = 18;
export function matchWindow(start: number, end?: number | null): { firstOpen: number; lastClose: number; durationEnd: number } {
    const firstOpen = Math.floor(start / PERIOD) * PERIOD;
    return { firstOpen, lastClose: Math.min(firstOpen + MATCH_DURATION, end ?? Number.POSITIVE_INFINITY), durationEnd: start + MATCH_DURATION };
}
export function roundInMatch(round: Round, start: number, end?: number | null): boolean {
    const window = matchWindow(start, end);
    return validRound(round) && round.left.openTime >= window.firstOpen && round.left.closeTime <= window.lastClose;
}
export function clockParts(elapsedMs: number): string {
    const seconds = Math.floor(Math.max(0, elapsedMs) / 1000);
    return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}
/** Tracks exchange five-minute boundaries; confirmation controls scoring, not the market clock. */
export function nextCandleCountdown(nowMs: number, matchStartMs: number, durationMs = MATCH_DURATION): number {
    if (!Number.isFinite(nowMs) || !Number.isFinite(matchStartMs) || !Number.isFinite(durationMs) || durationMs <= 0 || nowMs >= matchStartMs + durationMs) return 0;
    const nextClose = (Math.floor(nowMs / PERIOD) + 1) * PERIOD;
    return Math.min(PERIOD, Math.max(0, nextClose - nowMs));
}
export const TEAM = { left: 0xc1f20f, right: 0x185957 };
export const OUTLINE = { up: 0x54ff72, down: 0xff354f, neutral: 0xc3cddd };
export function validCandle(c: Candle): boolean {
    return !!c && !!c.symbol && [c.open, c.close, c.high, c.low, c.openTime, c.closeTime, c.updatedAt].every(Number.isFinite)
        && c.open > 0 && c.low > 0 && c.high >= Math.max(c.open, c.close)
        && c.low <= Math.min(c.open, c.close) && c.openTime % PERIOD === 0
        && c.closeTime === c.openTime + PERIOD && c.updatedAt >= c.openTime && (!c.confirmed || c.updatedAt >= c.closeTime)
        && (c.volume === null || (Number.isFinite(c.volume) && c.volume >= 0));
}
export function validRound(r: Round): boolean {
    return !!r && Number.isSafeInteger(r.matchId) && r.matchId >= 0 && !!r.id && !!r.ruleVersion && ["left", "right", "draw"].includes(r.winner)
        && validCandle(r.left) && validCandle(r.right) && r.left.confirmed && r.right.confirmed
        && r.left.openTime === r.right.openTime && r.left.closeTime === r.right.closeTime;
}
export interface Geometry { openY: number; closeY: number; highY: number; lowY: number; top: number; bottom: number; height: number }
export function project(c: Candle, rangePercent: number, height: number): Geometry {
    if (!validCandle(c) || !Number.isFinite(rangePercent) || rangePercent <= 0 || !Number.isFinite(height) || height <= 0)
        throw new Error("Invalid candle geometry");
    const y = (v: number) => height / 2 - ((v - c.open) / c.open * 100) / rangePercent * height / 2;
    const openY = y(c.open), closeY = y(c.close);
    return geometry(openY, closeY, y(c.high), y(c.low));
}
export function geometry(openY: number, closeY: number, highY: number, lowY: number): Geometry {
    return { openY, closeY, highY, lowY, top: Math.min(openY, closeY), bottom: Math.max(openY, closeY), height: Math.abs(closeY - openY) };
}
export function interpolate(a: Geometry, b: Geometry, progress: number): Geometry {
    const p = Math.max(0, Math.min(1, progress));
    const mix = (x: number, y: number) => p === 1 ? y : x + (y - x) * p;
    return geometry(mix(a.openY, b.openY), mix(a.closeY, b.closeY), mix(a.highY, b.highY), mix(a.lowY, b.lowY));
}
export function sharedRange(candles: Candle[]): number {
    return Math.max(0.1, ...candles.filter(validCandle).flatMap(c => [Math.abs((c.high - c.open) / c.open * 100), Math.abs((c.low - c.open) / c.open * 100)])) * 1.18;
}

export type CandleDirection = "up" | "down" | "neutral";

/** Direction is always derived from OHLC, never from a presentation color. */
export function candleDirection(candle: Candle): CandleDirection {
    if (candle.close > candle.open) return "up";
    if (candle.close < candle.open) return "down";
    return "neutral";
}

export function candleChangePercent(candle: Candle): number {
    return (candle.close - candle.open) / candle.open * 100;
}

export interface CombatAdvantage {
    leftPressure: number;
    rightPressure: number;
    leftDirection: CandleDirection;
    rightDirection: CandleDirection;
}

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

/**
 * Converts market direction into visual pressure. Body size never enters this
 * calculation: the OHLC direction owns the green-versus-red advantage, while
 * the existing strength indicators only break ties between comparable candles.
 */
export function combatAdvantage(left: Candle, right: Candle, leftStrength = 50, rightStrength = 50, officialWinner: Winner = "draw"): CombatAdvantage {
    const leftDirection = candleDirection(left);
    const rightDirection = candleDirection(right);
    const leftScore = clamp01(Number.isFinite(leftStrength) ? leftStrength / 100 : 0.5);
    const rightScore = clamp01(Number.isFinite(rightStrength) ? rightStrength / 100 : 0.5);
    const strengthBias = leftScore - rightScore;

    const returnDifference = candleChangePercent(left) - candleChangePercent(right);
    // Match the backend tolerance. For equal percentage returns, use the
    // official resolver's strength tie-breaker instead of inventing a winner.
    let leftPressure = Math.abs(returnDifference) <= .000001
        ? officialWinner === "left" ? .68 : officialWinner === "right" ? .32 : .5 + strengthBias * .28
        : .5 + clamp01(Math.abs(returnDifference) / Math.max(1, Math.abs(candleChangePercent(left)), Math.abs(candleChangePercent(right)))) * .4 * Math.sign(returnDifference);

    leftPressure = clamp01(leftPressure);
    return { leftPressure, rightPressure: 1 - leftPressure, leftDirection, rightDirection };
}

export interface CombatMotion {
    attack: number;
    block: number;
    dodge: number;
    hit: number;
    counter: number;
    taunt: number;
}

export interface CombatFrame {
    centerOffset: number;
    separation: number;
    intensity: number;
    left: CombatMotion;
    right: CombatMotion;
}

const wave = (elapsed: number, period: number, phase: number): number => Math.max(0, Math.sin(elapsed / period + phase));

/**
 * Samples deterministic in-round cinematics. It is presentation-only: it
 * consumes a confirmed candle snapshot and never changes score or territory.
 */
export function combatFrame(
    left: Candle,
    right: Candle,
    leftStrength: number,
    rightStrength: number,
    elapsedMs: number,
    durationMs: number,
    seed = 0,
    officialWinner: Winner = "draw"
): CombatFrame {
    const advantage = combatAdvantage(left, right, leftStrength, rightStrength, officialWinner);
    const progress = clamp01(elapsedMs / Math.max(1, durationMs));
    const intensity = 0.38 + 0.62 * (progress * progress * (3 - 2 * progress));
    const leftPulse = 0.28 + 0.72 * wave(elapsedMs, 310, seed * 0.0007);
    const rightPulse = 0.28 + 0.72 * wave(elapsedMs, 337, seed * 0.0009 + 1.7);
    const leftAttack = clamp01(intensity * (0.18 + advantage.leftPressure * 0.82) * leftPulse);
    const rightAttack = clamp01(intensity * (0.18 + advantage.rightPressure * 0.82) * rightPulse);
    const leftBlock = clamp01(intensity * (0.24 + (1 - advantage.leftPressure) * 0.58) * (0.7 + 0.3 * wave(elapsedMs, 510, seed * 0.001 + 0.4)));
    const rightBlock = clamp01(intensity * (0.24 + (1 - advantage.rightPressure) * 0.58) * (0.7 + 0.3 * wave(elapsedMs, 470, seed * 0.001 + 2.1)));
    const leftDodge = clamp01(intensity * (0.12 + (1 - advantage.leftPressure) * 0.42) * (0.5 + 0.5 * wave(elapsedMs, 420, seed * 0.001 + 1.2)));
    const rightDodge = clamp01(intensity * (0.12 + (1 - advantage.rightPressure) * 0.42) * (0.5 + 0.5 * wave(elapsedMs, 390, seed * 0.001 + 2.7)));
    const leftHit = clamp01(rightAttack * (1 - leftBlock * 0.62 - leftDodge * 0.24));
    const rightHit = clamp01(leftAttack * (1 - rightBlock * 0.62 - rightDodge * 0.24));
    const leftCounter = clamp01(leftBlock * rightAttack * 0.72 + leftDodge * rightAttack * 0.35);
    const rightCounter = clamp01(rightBlock * leftAttack * 0.72 + rightDodge * leftAttack * 0.35);
    const leftTaunt = clamp01((1 - leftAttack) * (0.12 + 0.18 * wave(elapsedMs, 760, seed * 0.0004)));
    const rightTaunt = clamp01((1 - rightAttack) * (0.12 + 0.18 * wave(elapsedMs, 790, seed * 0.0005 + 1)));
    const leftMotion = { attack: leftAttack, block: leftBlock, dodge: leftDodge, hit: leftHit, counter: leftCounter, taunt: leftTaunt };
    const rightMotion = { attack: rightAttack, block: rightBlock, dodge: rightDodge, hit: rightHit, counter: rightCounter, taunt: rightTaunt };
    const bias = advantage.leftPressure - 0.5;
    // A small shift preserves a fighting stance without making the pair
    // oscillate across the arena while their market candles remain fixed.
    const footwork = Math.sin(elapsedMs / 650 + seed * 0.0017) * 3;
    const centerOffset = bias * 24 + footwork;
    const approach = Math.min(1, progress * 4.4);
    const easedApproach = approach * approach * (3 - 2 * approach);
    const exchangeSpace = Math.abs(Math.sin(elapsedMs / 700 + seed * 0.0012)) * 5;
    return { centerOffset, separation: 620 - 460 * easedApproach + exchangeSpace, intensity, left: leftMotion, right: rightMotion };
}

/** Owns market state only. A confirmed round is never mutated by a newer tick. */
export class MarketHeartbeat {
    private latest = new Map<Side, Readonly<Candle>>();
    accept(side: Side, candle: Candle): boolean {
        if (!validCandle(candle)) return false;
        const prev = this.latest.get(side);
        if (prev && (candle.openTime < prev.openTime || (candle.openTime === prev.openTime &&
            (candle.updatedAt <= prev.updatedAt || prev.confirmed)))) return false;
        this.latest.set(side, Object.freeze({ ...candle }));
        return true;
    }
    get(side: Side): Readonly<Candle> | undefined { return this.latest.get(side); }
    clear(): void { this.latest.clear(); }
}

export class BattleClock {
    private seen = new Set<string>();
    private intervals = new Set<string>();
    private pending: Readonly<Round>[] = [];
    enqueue(round: Round): boolean {
        const key = `${round.matchId}:5m:${round.left?.openTime}`;
        if (!validRound(round) || this.seen.has(round.id) || this.intervals.has(key)) return false;
        this.seen.add(round.id); this.intervals.add(key);
        this.pending.push(Object.freeze({ ...round, left: Object.freeze({ ...round.left }), right: Object.freeze({ ...round.right }) }));
        this.pending.sort((a, b) => a.left.openTime - b.left.openTime || a.id.localeCompare(b.id));
        return true;
    }
    next(): Readonly<Round> | undefined { return this.pending.shift(); }
    peek(): Readonly<Round> | undefined { return this.pending[0]; }
    get count(): number { return this.pending.length; }
    clear(): void { this.seen.clear(); this.intervals.clear(); this.pending = []; }
}

export interface Tile { id: string; side: Side; column: number; row: number; page: number }
export class TerritoryManager {
    readonly columns = 20;
    readonly rows = 6;
    readonly history: Tile[] = [];
    readonly score = { left: 0, right: 0 };
    private seen = new Set<string>();
    private intervals = new Set<string>();
    private trailing = new Set<Side>();
    lines = 0;
    streak = 0;
    lastWinner: Winner = "draw";
    special: "combo" | "domination" | "comeback" | "" = "";
    apply(r: Round): Tile | null {
        const interval = `${r.matchId}:5m:${r.left?.openTime}`;
        if (!validRound(r) || this.seen.has(r.id) || this.intervals.has(interval)) return null;
        this.seen.add(r.id); this.intervals.add(interval);
        this.special = "";
        if (r.winner === "draw") { this.streak = 0; this.lastWinner = "draw"; return null; }
        const side = r.winner, other = side === "left" ? "right" : "left";
        const wasBehind = this.trailing.has(side);
        this.score[side]++;
        if (this.score[side] > this.score[other]) { this.trailing.add(other); this.trailing.delete(side); }
        this.streak = this.lastWinner === side ? this.streak + 1 : 1;
        this.lastWinner = side;
        this.special = wasBehind && this.score[side] > this.score[other] ? "comeback" : this.streak === 5 ? "domination" : this.streak === 3 ? "combo" : "";
        const n = this.history.length, capacity = this.columns * this.rows;
        const tile = { id: r.id, side, column: n % this.columns, row: this.rows - 1 - Math.floor(n % capacity / this.columns), page: Math.floor(n / capacity) };
        this.history.push(tile);
        this.lines = Math.floor(this.history.length / this.columns);
        return tile;
    }
    get page(): number { return Math.max(0, Math.floor((this.history.length - 1) / (this.columns * this.rows))); }
    get percentLeft(): number { const n = this.history.length; return n ? this.score.left / n * 100 : 50; }
    reset(): void { this.history.length = 0; this.score.left = this.score.right = this.lines = this.streak = 0; this.lastWinner = "draw"; this.special = ""; this.seen.clear(); this.intervals.clear(); this.trailing.clear(); }
}

export const PHASES = ["SPAWNING", "APPROACHING", "ATTACKING", "COLLISION", "DESTROYING", "VICTORY", "BLOCK_FALLING", "BLOCK_LOCKING", "ROUND_COMPLETE"] as const;
export type Phase = typeof PHASES[number] | "WAITING_MARKET" | "FORMING_CANDLE";
export type FighterAnimation = "idle" | "run" | "punch" | "break" | "recover";

/**
 * Maps the authoritative battle phase to an available illustrated sequence.
 * The financial body and wick remain procedural; this function only selects
 * the presentation layer and is deterministic for replay/TV.
 */
export function fighterAnimationForPhase(phase: Phase): FighterAnimation {
    if (phase === "APPROACHING") return "run";
    if (phase === "ATTACKING" || phase === "COLLISION") return "punch";
    if (phase === "DESTROYING" || phase === "BLOCK_FALLING" || phase === "BLOCK_LOCKING") return "break";
    if (phase === "VICTORY" || phase === "ROUND_COMPLETE") return "recover";
    return "idle";
}
const DURATIONS = [350, 650, 350, 180, 600, 550, 800, 220, 100];
export class BattleStateMachine {
    phase: Phase = "WAITING_MARKET";
    elapsed = 0;
    private index = -1;
    readonly durationMs: number;
    constructor(durationMs = 3800) { this.durationMs = Number.isFinite(durationMs) ? Math.max(3000, Math.min(5000, durationMs)) : 3800; }
    start(): void { this.index = 0; this.elapsed = 0; this.phase = PHASES[0]; }
    advance(delta: number, enter: (phase: Phase) => void): void {
        if (this.index < 0) return;
        this.elapsed += Math.max(0, delta);
        while (this.index >= 0 && this.elapsed >= DURATIONS[this.index] * this.durationMs / 3800) {
            this.elapsed -= DURATIONS[this.index] * this.durationMs / 3800; this.index++;
            if (this.index === PHASES.length) { this.index = -1; this.phase = "FORMING_CANDLE"; }
            else this.phase = PHASES[this.index];
            enter(this.phase);
        }
    }
    get progress(): number { return this.index < 0 ? 0 : Math.min(1, this.elapsed / (DURATIONS[this.index] * this.durationMs / 3800)); }
    reset(): void { this.index = -1; this.elapsed = 0; this.phase = "WAITING_MARKET"; }
}

/** A deterministic fixture only. LIVE never calls this resolver. */
export function demoRound(index: number): Round {
    const openTime = Date.UTC(2026, 0, 1) + index * PERIOD;
    const make = (symbol: string, base: number, phase: number): Candle => {
        const change = Math.sin(index * 1.71 + phase) * 0.014;
        const close = base * (1 + change);
        return { symbol, openTime, closeTime: openTime + PERIOD, updatedAt: openTime + PERIOD, open: base, close,
            high: Math.max(base, close) + base * 0.003, low: Math.min(base, close) - base * 0.002, volume: 100 + index % 17, confirmed: true };
    };
    const left = make("BTC", 67000, 1), right = make("ETH", 3100, 2);
    const a = 30 + (index * 13 + 37) % 60, b = index % 9 === 8 ? a : 30 + (index * 19 + 11) % 60;
    return { id: `demo:5m:${openTime}`, matchId: 0, left, right, winner: index % 9 === 8 ? "draw" : a > b ? "left" : "right", ruleVersion: "demo-fixture-v1", leftStrength:a, rightStrength:b };
}
