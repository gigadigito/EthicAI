export const PERIOD = 300000;
export const TEAM = { left: 0xc1f20f, right: 0x185957 };
export const OUTLINE = { up: 0x54ff72, down: 0xff354f, neutral: 0xc3cddd };
export function validCandle(c) {
    return !!c && !!c.symbol && [c.open, c.close, c.high, c.low, c.openTime, c.closeTime, c.updatedAt].every(Number.isFinite)
        && c.open > 0 && c.low > 0 && c.high >= Math.max(c.open, c.close)
        && c.low <= Math.min(c.open, c.close) && c.openTime % PERIOD === 0
        && c.closeTime === c.openTime + PERIOD && c.updatedAt >= c.openTime && (!c.confirmed || c.updatedAt >= c.closeTime)
        && (c.volume === null || (Number.isFinite(c.volume) && c.volume >= 0));
}
export function validRound(r) {
    return !!r && Number.isSafeInteger(r.matchId) && r.matchId >= 0 && !!r.id && !!r.ruleVersion && ["left", "right", "draw"].includes(r.winner)
        && validCandle(r.left) && validCandle(r.right) && r.left.confirmed && r.right.confirmed
        && r.left.openTime === r.right.openTime && r.left.closeTime === r.right.closeTime;
}
export function project(c, rangePercent, height) {
    if (!validCandle(c) || !Number.isFinite(rangePercent) || rangePercent <= 0 || !Number.isFinite(height) || height <= 0)
        throw new Error("Invalid candle geometry");
    const y = (v) => height / 2 - ((v - c.open) / c.open * 100) / rangePercent * height / 2;
    const openY = y(c.open), closeY = y(c.close);
    return geometry(openY, closeY, y(c.high), y(c.low));
}
export function geometry(openY, closeY, highY, lowY) {
    return { openY, closeY, highY, lowY, top: Math.min(openY, closeY), bottom: Math.max(openY, closeY), height: Math.abs(closeY - openY) };
}
export function interpolate(a, b, progress) {
    const p = Math.max(0, Math.min(1, progress));
    const mix = (x, y) => p === 1 ? y : x + (y - x) * p;
    return geometry(mix(a.openY, b.openY), mix(a.closeY, b.closeY), mix(a.highY, b.highY), mix(a.lowY, b.lowY));
}
export function sharedRange(candles) {
    return Math.max(0.1, ...candles.filter(validCandle).flatMap(c => [Math.abs((c.high - c.open) / c.open * 100), Math.abs((c.low - c.open) / c.open * 100)])) * 1.18;
}
/** Owns market state only. A confirmed round is never mutated by a newer tick. */
export class MarketHeartbeat {
    constructor() {
        this.latest = new Map();
    }
    accept(side, candle) {
        if (!validCandle(candle))
            return false;
        const prev = this.latest.get(side);
        if (prev && (candle.openTime < prev.openTime || (candle.openTime === prev.openTime &&
            (candle.updatedAt <= prev.updatedAt || prev.confirmed))))
            return false;
        this.latest.set(side, Object.freeze({ ...candle }));
        return true;
    }
    get(side) { return this.latest.get(side); }
    clear() { this.latest.clear(); }
}
export class BattleClock {
    constructor() {
        this.seen = new Set();
        this.intervals = new Set();
        this.pending = [];
    }
    enqueue(round) {
        const key = `${round.matchId}:5m:${round.left?.openTime}`;
        if (!validRound(round) || this.seen.has(round.id) || this.intervals.has(key))
            return false;
        this.seen.add(round.id);
        this.intervals.add(key);
        this.pending.push(Object.freeze({ ...round, left: Object.freeze({ ...round.left }), right: Object.freeze({ ...round.right }) }));
        this.pending.sort((a, b) => a.left.openTime - b.left.openTime || a.id.localeCompare(b.id));
        return true;
    }
    next() { return this.pending.shift(); }
    get count() { return this.pending.length; }
    clear() { this.seen.clear(); this.intervals.clear(); this.pending = []; }
}
export class TerritoryManager {
    constructor() {
        this.columns = 20;
        this.rows = 6;
        this.history = [];
        this.score = { left: 0, right: 0 };
        this.seen = new Set();
        this.intervals = new Set();
        this.trailing = new Set();
        this.lines = 0;
        this.streak = 0;
        this.lastWinner = "draw";
        this.special = "";
    }
    apply(r) {
        const interval = `${r.matchId}:5m:${r.left?.openTime}`;
        if (!validRound(r) || this.seen.has(r.id) || this.intervals.has(interval))
            return null;
        this.seen.add(r.id);
        this.intervals.add(interval);
        this.special = "";
        if (r.winner === "draw") {
            this.streak = 0;
            this.lastWinner = "draw";
            return null;
        }
        const side = r.winner, other = side === "left" ? "right" : "left";
        const wasBehind = this.trailing.has(side);
        this.score[side]++;
        if (this.score[side] > this.score[other]) {
            this.trailing.add(other);
            this.trailing.delete(side);
        }
        this.streak = this.lastWinner === side ? this.streak + 1 : 1;
        this.lastWinner = side;
        this.special = wasBehind && this.score[side] > this.score[other] ? "comeback" : this.streak === 5 ? "domination" : this.streak === 3 ? "combo" : "";
        const n = this.history.length, capacity = this.columns * this.rows;
        const tile = { id: r.id, side, column: n % this.columns, row: this.rows - 1 - Math.floor(n % capacity / this.columns), page: Math.floor(n / capacity) };
        this.history.push(tile);
        this.lines = Math.floor(this.history.length / this.columns);
        return tile;
    }
    get page() { return Math.max(0, Math.floor((this.history.length - 1) / (this.columns * this.rows))); }
    get percentLeft() { const n = this.history.length; return n ? this.score.left / n * 100 : 50; }
    reset() { this.history.length = 0; this.score.left = this.score.right = this.lines = this.streak = 0; this.lastWinner = "draw"; this.special = ""; this.seen.clear(); this.intervals.clear(); this.trailing.clear(); }
}
export const PHASES = ["SPAWNING", "APPROACHING", "ATTACKING", "COLLISION", "DESTROYING", "VICTORY", "BLOCK_FALLING", "BLOCK_LOCKING", "ROUND_COMPLETE"];
const DURATIONS = [350, 650, 350, 180, 600, 550, 800, 220, 100];
export class BattleStateMachine {
    constructor(durationMs = 3800) {
        this.phase = "WAITING_MARKET";
        this.elapsed = 0;
        this.index = -1;
        this.durationMs = Number.isFinite(durationMs) ? Math.max(3000, Math.min(5000, durationMs)) : 3800;
    }
    start() { this.index = 0; this.elapsed = 0; this.phase = PHASES[0]; }
    advance(delta, enter) {
        if (this.index < 0)
            return;
        this.elapsed += Math.max(0, delta);
        while (this.index >= 0 && this.elapsed >= DURATIONS[this.index] * this.durationMs / 3800) {
            this.elapsed -= DURATIONS[this.index] * this.durationMs / 3800;
            this.index++;
            if (this.index === PHASES.length) {
                this.index = -1;
                this.phase = "FORMING_CANDLE";
            }
            else
                this.phase = PHASES[this.index];
            enter(this.phase);
        }
    }
    get progress() { return this.index < 0 ? 0 : Math.min(1, this.elapsed / (DURATIONS[this.index] * this.durationMs / 3800)); }
    reset() { this.index = -1; this.elapsed = 0; this.phase = "WAITING_MARKET"; }
}
/** A deterministic fixture only. LIVE never calls this resolver. */
export function demoRound(index) {
    const openTime = Date.UTC(2026, 0, 1) + index * PERIOD;
    const make = (symbol, base, phase) => {
        const change = Math.sin(index * 1.71 + phase) * 0.014;
        const close = base * (1 + change);
        return { symbol, openTime, closeTime: openTime + PERIOD, updatedAt: openTime + PERIOD, open: base, close,
            high: Math.max(base, close) + base * 0.003, low: Math.min(base, close) - base * 0.002, volume: 100 + index % 17, confirmed: true };
    };
    const left = make("BTC", 67000, 1), right = make("ETH", 3100, 2);
    const a = 30 + (index * 13 + 37) % 60, b = index % 9 === 8 ? a : 30 + (index * 19 + 11) % 60;
    return { id: `demo:5m:${openTime}`, matchId: 0, left, right, winner: index % 9 === 8 ? "draw" : a > b ? "left" : "right", ruleVersion: "demo-fixture-v1", leftStrength: a, rightStrength: b };
}
