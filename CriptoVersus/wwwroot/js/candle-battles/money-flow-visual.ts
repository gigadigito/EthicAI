import type PhaserTypes from 'phaser';
import type { MoneyFlowBatch } from './money-flow.js';
import { getMoneyFlowBuffer, inspectMoneyFlowBuffer } from './money-flow.js';
import type { Side } from './model.js';

export type MoneyFlowDirection = 'positive' | 'negative' | 'neutral';

export interface MoneyFlowVisualDecision {
    direction: MoneyFlowDirection;
    intensity: number;
}

export interface MoneyFlowVisualSnapshot {
    positiveEnergy: number;
    negativeEnergy: number;
    accumulator: number;
    displayedCandle: number;
    referencePrice?: number;
}

const clamp = (value: number, min = 0, max = 1): number => Math.max(min, Math.min(max, value));
const finite = (value: string): number => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
};

/** Price movement is authoritative for the visual direction; quote flow only weights its strength. */
export function decideMoneyFlow(batch: MoneyFlowBatch, previousPrice?: number): MoneyFlowVisualDecision {
    const first = finite(batch.firstPrice);
    const last = finite(batch.lastPrice);
    if (first <= 0 || last <= 0) return { direction: 'neutral', intensity: 0 };
    // A 250ms window may contain only one trade, in which case first === last.
    // Compare it to the preceding valid observation rather than discarding it.
    const baseline = previousPrice != null && previousPrice > 0 ? previousPrice : first;
    if (last === baseline) return { direction: 'neutral', intensity: 0 };

    const relativeMove = Math.abs(last - baseline) / Math.max(Math.abs(baseline), Number.EPSILON);
    // Sub-precision jitter is not market movement: keep the flow neutral
    // instead of flickering signs over float noise.
    if (relativeMove < 1e-9) return { direction: 'neutral', intensity: 0 };
    const buy = Math.abs(finite(batch.takerBuyQuote));
    const sell = Math.abs(finite(batch.takerSellQuote));
    const net = Math.abs(finite(batch.netQuote));
    const flowBalance = net / Math.max(buy + sell, 1);
    const tradeSignal = Math.min(1, Math.log10(Math.max(1, batch.tradeCount)) / 3);
    const intensity = clamp((.18 + clamp(relativeMove / .004) * .57 + clamp(flowBalance) * .17 + tradeSignal * .08)
        * (batch.isPartial ? .55 : 1));
    return { direction: last > baseline ? 'positive' : 'negative', intensity };
}

/** Framework-free smoothing state so the visual rules are testable without a Phaser canvas. */
export class MoneyFlowVisualState {
    private positiveEnergy = 0;
    private negativeEnergy = 0;
    private accumulator = 0;
    private displayedCandle = .5;
    private lastObservedPrice?: number;

    ingest(batch: MoneyFlowBatch): MoneyFlowVisualDecision {
        const last = finite(batch.lastPrice);
        const decision = decideMoneyFlow(batch, this.lastObservedPrice);
        // Establish a baseline from the first valid observation without
        // inventing movement; subsequent one-trade batches use this reference.
        if (last > 0) this.lastObservedPrice = last;
        if (decision.direction === 'positive') {
            this.positiveEnergy = clamp(this.positiveEnergy + decision.intensity);
            this.accumulator = clamp(this.accumulator + decision.intensity * .38, -1, 1);
        } else if (decision.direction === 'negative') {
            this.negativeEnergy = clamp(this.negativeEnergy + decision.intensity);
            this.accumulator = clamp(this.accumulator - decision.intensity * .38, -1, 1);
        }
        return decision;
    }

    advance(deltaMs: number): void {
        const seconds = Math.max(0, Math.min(100, deltaMs)) / 1000;
        // Exponential decay avoids frame-rate-dependent visual energy.
        const decay = Math.exp(-seconds * 1.35);
        this.positiveEnergy *= decay;
        this.negativeEnergy *= decay;
        this.accumulator *= Math.exp(-seconds * .22);
        const target = clamp(.5 + this.accumulator * .42, .16, .84);
        this.displayedCandle += (target - this.displayedCandle) * (1 - Math.exp(-seconds * 7));
    }

    get positive(): number { return this.positiveEnergy; }
    get negative(): number { return this.negativeEnergy; }
    get displayed(): number { return this.displayedCandle; }
    get accumulatorValue(): number { return this.accumulator; }
    get referencePrice(): number | undefined { return this.lastObservedPrice; }

    snapshot(): MoneyFlowVisualSnapshot {
        return {
            positiveEnergy: this.positiveEnergy,
            negativeEnergy: this.negativeEnergy,
            accumulator: this.accumulator,
            displayedCandle: this.displayedCandle,
            referencePrice: this.lastObservedPrice
        };
    }

    reset(): void {
        this.positiveEnergy = 0;
        this.negativeEnergy = 0;
        this.accumulator = 0;
        this.displayedCandle = .5;
        this.lastObservedPrice = undefined;
    }
}

/** A fixed-capacity pool. Released instances are reused instead of recreated for each batch. */
export class ReusablePool<T extends { active: boolean }> {
    private readonly items: T[] = [];
    constructor(private readonly capacity: number, private readonly create: () => T) { }
    acquire(): T | undefined {
        const reusable = this.items.find(item => !item.active);
        if (reusable) { reusable.active = true; return reusable; }
        if (this.items.length >= this.capacity) return undefined;
        const item = this.create(); item.active = true; this.items.push(item); return item;
    }
    release(item: T): void { item.active = false; }
    releaseAll(): void { for (const item of this.items) item.active = false; }
    get activeCount(): number { return this.items.filter(item => item.active).length; }
    get size(): number { return this.items.length; }
    forEach(callback: (item: T) => void): void { this.items.forEach(callback); }
}

interface BagParticle { active: boolean; graphic: PhaserTypes.GameObjects.Graphics; side: Side; positive: boolean; age: number; lifetime: number; x: number; y: number; startX: number; startY: number; targetX: number; targetY: number; phase: number; }
interface SignParticle { active: boolean; text: PhaserTypes.GameObjects.Text; side: Side; age: number; lifetime: number; x: number; y: number; vx: number; vy: number; }
interface SideFx { state: MoneyFlowVisualState; glow: PhaserTypes.GameObjects.Graphics; positiveCooldown: number; negativeCooldown: number; }

const MAX_BAGS_PER_SIDE = 6;
const MAX_SIGNS_PER_SIDE = 6;
const SIDES: readonly Side[] = ['left', 'right'];

/**
 * Presentation-only Phaser layer for live Money Flow. It owns no match data,
 * score, combat state or OHLC; all of its state can be discarded at any time.
 */
export class MoneyFlowController {
    private readonly effects: Record<Side, SideFx>;
    private readonly bags: ReusablePool<BagParticle>;
    private readonly signs: ReusablePool<SignParticle>;
    private matchId?: number;
    private symbols: Record<Side, string> = { left: '', right: '' };
    private readonly lastSequence = new Map<string, number>();
    private enabled = false;

    constructor(private readonly scene: PhaserTypes.Scene) {
        this.effects = {
            left: this.createSideFx(),
            right: this.createSideFx()
        };
        this.bags = new ReusablePool(MAX_BAGS_PER_SIDE * 2, () => ({
            active: false, graphic: scene.add.graphics().setDepth(12).setVisible(false), side: 'left', positive: true,
            age: 0, lifetime: 0, x: 0, y: 0, startX: 0, startY: 0, targetX: 0, targetY: 0, phase: 0
        }));
        this.signs = new ReusablePool(MAX_SIGNS_PER_SIDE * 2, () => ({
            active: false, text: scene.add.text(0, 0, '+', { fontFamily: 'monospace', fontSize: '28px', fontStyle: 'bold', color: '#b8ff64', stroke: '#071317', strokeThickness: 4 })
                .setOrigin(.5).setDepth(13).setVisible(false), side: 'left', age: 0, lifetime: 0, x: 0, y: 0, vx: 0, vy: 0
        }));
    }

    setLiveMatch(matchId: number, leftSymbol: string, rightSymbol: string, enabled: boolean): void {
        const changed = this.matchId !== matchId || this.symbols.left !== leftSymbol || this.symbols.right !== rightSymbol;
        const enabledChanged = this.enabled !== enabled;
        this.matchId = matchId;
        this.symbols = { left: leftSymbol.toUpperCase(), right: rightSymbol.toUpperCase() };
        this.enabled = enabled;
        if (changed) this.reset();
        if (!enabled && enabledChanged) this.clearParticles();
        if (enabled) this.consumeBufferedBatches();
    }

    setEnabled(enabled: boolean): void {
        this.enabled = enabled;
        if (!enabled) this.clearParticles();
    }

    update(deltaMs: number, leftX: number, leftY: number, rightX: number, rightY: number): void {
        if (!this.enabled || !this.matchId) return;
        this.consumeBufferedBatches();
        for (const side of SIDES) {
            const fx = this.effects[side];
            fx.state.advance(deltaMs);
            const anchorX = side === 'left' ? leftX : rightX;
            const anchorY = side === 'left' ? leftY : rightY;
            fx.positiveCooldown = Math.max(0, fx.positiveCooldown - deltaMs);
            fx.negativeCooldown = Math.max(0, fx.negativeCooldown - deltaMs);
            // The original overhead OHLC candle belongs to CandleRenderer and is
            // never duplicated here. Money Flow only adds discrete absorption
            // lighting around the fighter plus the money-bag stream.
            this.drawGlow(fx, anchorX, anchorY);
            const positiveDominant = fx.state.positive >= fx.state.negative;
            if (positiveDominant && fx.state.positive > .055 && fx.positiveCooldown === 0) {
                this.spawnBag(side, true, anchorX, anchorY, fx.state.positive);
                this.spawnSign(side, true, anchorX, anchorY);
                // Higher energy emits more often, within the hard object limits.
                fx.positiveCooldown = 240 + (1 - fx.state.positive) * 260;
            }
            if (!positiveDominant && fx.state.negative > .055 && fx.negativeCooldown === 0) {
                this.spawnBag(side, false, anchorX, anchorY, fx.state.negative);
                this.spawnSign(side, false, anchorX, anchorY);
                fx.negativeCooldown = 260 + (1 - fx.state.negative) * 270;
            }
        }
        this.updateBags(deltaMs);
        this.updateSigns(deltaMs);
    }

    inspect(): object {
        return {
            active: this.enabled,
            matchId: this.matchId ?? null,
            bags: this.bags.activeCount,
            signs: this.signs.activeCount,
            bagPoolSize: this.bags.size,
            signPoolSize: this.signs.size,
            buffer: this.matchId ? inspectMoneyFlowBuffer(this.matchId) : null,
            left: this.effects.left.state.snapshot(),
            right: this.effects.right.state.snapshot()
        };
    }

    reset(): void {
        this.lastSequence.clear();
        this.clearParticles();
        for (const side of SIDES) this.effects[side].state.reset();
    }

    destroy(): void {
        this.reset();
        this.bags.forEach(item => item.graphic.destroy());
        this.signs.forEach(item => item.text.destroy());
        for (const side of SIDES) this.effects[side].glow.destroy();
    }

    private createSideFx(): SideFx {
        return { state: new MoneyFlowVisualState(), glow: this.scene.add.graphics().setDepth(3).setVisible(false), positiveCooldown: 0, negativeCooldown: 0 };
    }

    private consumeBufferedBatches(): void {
        if (!this.matchId) return;
        const left = this.symbols.left, right = this.symbols.right;
        for (const batch of getMoneyFlowBuffer(this.matchId)) {
            const symbol = batch.symbol.toUpperCase();
            const sides: Side[] = [];
            if (symbol === left) sides.push('left');
            if (symbol === right) sides.push('right');
            for (const side of sides) {
                const key = `${side}:${batch.symbol}`;
                if ((this.lastSequence.get(key) ?? 0) >= batch.sequence) continue;
                this.lastSequence.set(key, batch.sequence);
                this.effects[side].state.ingest(batch);
            }
        }
    }

    private spawnBag(side: Side, positive: boolean, anchorX: number, anchorY: number, energy: number): void {
        let activeForSide = 0;
        this.bags.forEach(item => { if (item.active && item.side === side) activeForSide++; });
        if (activeForSide >= MAX_BAGS_PER_SIDE) return;
        const bag = this.bags.acquire();
        if (!bag) return;
        bag.side = side; bag.positive = positive; bag.age = 0;
        bag.lifetime = positive ? 1250 : 2300;
        bag.x = anchorX + (Math.random() - .5) * 72;
        bag.y = positive ? anchorY - 128 - Math.random() * 36 : anchorY + 18;
        bag.startX = bag.x; bag.startY = bag.y;
        bag.targetX = anchorX + (Math.random() - .5) * 26;
        bag.targetY = positive ? anchorY + 14 : anchorY + 138 + Math.random() * 10;
        bag.phase = Math.random() * Math.PI * 2;
        this.drawBag(bag.graphic, positive);
        bag.graphic.setPosition(bag.x, bag.y).setScale(.9 + energy * .22).setAlpha(1).setVisible(true);
    }

    private spawnSign(side: Side, positive: boolean, anchorX: number, anchorY: number): void {
        let activeForSide = 0;
        this.signs.forEach(item => { if (item.active && item.side === side) activeForSide++; });
        if (activeForSide >= MAX_SIGNS_PER_SIDE) return;
        const sign = this.signs.acquire();
        if (!sign) return;
        sign.side = side; sign.age = 0; sign.lifetime = 1100;
        sign.x = anchorX + (Math.random() - .5) * 82;
        sign.y = positive ? anchorY - 96 : anchorY + 46;
        sign.vx = (Math.random() - .5) * 18;
        sign.vy = positive ? -30 : 24;
        sign.text.setText(positive ? '+' : '\u2212').setColor(positive ? '#b9ff69' : '#ff7777')
            .setPosition(sign.x, sign.y).setAlpha(.95).setVisible(true);
    }

    private updateBags(deltaMs: number): void {
        this.bags.forEach(bag => {
            if (!bag.active) return;
            bag.age += deltaMs;
            if (bag.positive) {
                // Money descends smoothly toward the fighter and is absorbed:
                // gentle sway on the way down, shrink + fade at the body.
                const fallDuration = 1000;
                const t = clamp(bag.age / fallDuration);
                const eased = t * t * (3 - 2 * t);
                bag.x = bag.startX + (bag.targetX - bag.startX) * eased + Math.sin(bag.phase + t * Math.PI * 3) * 7 * (1 - t);
                bag.y = bag.startY + (bag.targetY - bag.startY) * eased;
                bag.graphic.setScale(1 - t * .18).setAlpha(Math.max(0, 1 - Math.max(0, bag.age - 1000) / 250));
            } else {
                // Money leaves the fighter under light gravity, settles near
                // the feet briefly, then is removed in a controlled fade.
                const fallDuration = 850;
                const t = clamp(bag.age / fallDuration);
                const gravity = t * t;
                bag.x = bag.startX + (bag.targetX - bag.startX) * gravity + Math.sin(bag.phase + t * Math.PI * 2) * 4 * (1 - t);
                bag.y = bag.startY + (bag.targetY - bag.startY) * gravity;
                const settled = t >= 1;
                bag.graphic.setScale(settled ? .94 : 1.04).setAlpha(settled ? Math.max(0, 1 - Math.max(0, bag.age - 1750) / 550) : 1);
            }
            bag.graphic.setPosition(bag.x, bag.y);
            if (bag.age >= bag.lifetime) { bag.graphic.setVisible(false); this.bags.release(bag); }
        });
    }

    private updateSigns(deltaMs: number): void {
        this.signs.forEach(sign => {
            if (!sign.active) return;
            sign.age += deltaMs; sign.x += sign.vx * deltaMs / 1000; sign.y += sign.vy * deltaMs / 1000;
            sign.text.setPosition(sign.x, sign.y).setAlpha(Math.max(0, 1 - sign.age / sign.lifetime));
            if (sign.age >= sign.lifetime) { sign.text.setVisible(false); this.signs.release(sign); }
        });
    }

    private clearParticles(): void {
        this.bags.forEach(bag => bag.graphic.setVisible(false)); this.bags.releaseAll();
        this.signs.forEach(sign => sign.text.setVisible(false)); this.signs.releaseAll();
        for (const side of SIDES) this.effects[side].glow.setVisible(false);
    }

    private drawBag(graphic: PhaserTypes.GameObjects.Graphics, positive: boolean): void {
        // Pixel-art money sack: gold fabric, tied neck, chunky '$' stamp and a
        // discrete bright rim so the bags read clearly against the dark arena.
        const fabric = positive ? 0xd9b356 : 0xb98f4a;
        const shade = positive ? 0xa97f2e : 0x8d6431;
        graphic.clear()
            .fillStyle(0x1b1206, .95).fillRect(-15, -14, 30, 34)
            .fillStyle(fabric, 1).fillRect(-13, -11, 26, 28)
            .fillStyle(shade, 1).fillRect(-13, 10, 26, 7)
            .fillRect(-10, -16, 20, 6).fillRect(-6, -19, 12, 4)
            .fillStyle(0x7c4f1d, 1).fillRect(-8, -13, 16, 4)
            .fillStyle(0x2c1d07, 1).fillRect(-2, -7, 4, 18)
            .fillRect(-6, -6, 12, 4).fillRect(-6, 1, 12, 4)
            .fillRect(-6, -6, 4, 5).fillRect(2, -2, 4, 5)
            .fillStyle(0xffe9a8, .55).fillRect(-11, -9, 4, 8)
            .lineStyle(2, positive ? 0xffe9a8 : 0xe7c98c, .85).strokeRect(-13, -11, 26, 28);
    }

    private drawGlow(fx: SideFx, anchorX: number, anchorY: number): void {
        const energy = Math.max(fx.state.positive, fx.state.negative);
        if (energy < .03) { fx.glow.setVisible(false); return; }
        const color = fx.state.positive >= fx.state.negative ? 0xa4ee56 : 0xf06c6c;
        fx.glow.clear().setVisible(true).fillStyle(color, .035 + energy * .07).fillCircle(anchorX, anchorY + 22, 35 + energy * 28);
    }
}
