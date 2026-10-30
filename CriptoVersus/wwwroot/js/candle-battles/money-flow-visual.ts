import type PhaserTypes from 'phaser';
import type { MoneyFlowBatch } from './money-flow.js';
import { getMoneyFlowBuffer } from './money-flow.js';
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
}

const clamp = (value: number, min = 0, max = 1): number => Math.max(min, Math.min(max, value));
const finite = (value: string): number => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
};

/** Price movement is authoritative for the visual direction; quote flow only weights its strength. */
export function decideMoneyFlow(batch: MoneyFlowBatch): MoneyFlowVisualDecision {
    const first = finite(batch.firstPrice);
    const last = finite(batch.lastPrice);
    if (first <= 0 || last <= 0 || last === first) return { direction: 'neutral', intensity: 0 };

    const relativeMove = Math.abs(last - first) / Math.max(Math.abs(first), Number.EPSILON);
    const buy = Math.abs(finite(batch.takerBuyQuote));
    const sell = Math.abs(finite(batch.takerSellQuote));
    const net = Math.abs(finite(batch.netQuote));
    const flowBalance = net / Math.max(buy + sell, 1);
    const tradeSignal = Math.min(1, Math.log10(Math.max(1, batch.tradeCount)) / 3);
    const intensity = clamp((.18 + clamp(relativeMove / .004) * .57 + clamp(flowBalance) * .17 + tradeSignal * .08)
        * (batch.isPartial ? .55 : 1));
    return { direction: last > first ? 'positive' : 'negative', intensity };
}

/** Framework-free smoothing state so the visual rules are testable without a Phaser canvas. */
export class MoneyFlowVisualState {
    private positiveEnergy = 0;
    private negativeEnergy = 0;
    private accumulator = 0;
    private displayedCandle = .5;

    ingest(batch: MoneyFlowBatch): MoneyFlowVisualDecision {
        const decision = decideMoneyFlow(batch);
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

    snapshot(): MoneyFlowVisualSnapshot {
        return {
            positiveEnergy: this.positiveEnergy,
            negativeEnergy: this.negativeEnergy,
            accumulator: this.accumulator,
            displayedCandle: this.displayedCandle
        };
    }

    reset(): void {
        this.positiveEnergy = 0;
        this.negativeEnergy = 0;
        this.accumulator = 0;
        this.displayedCandle = .5;
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

interface BagParticle { active: boolean; graphic: PhaserTypes.GameObjects.Graphics; side: Side; positive: boolean; age: number; lifetime: number; x: number; y: number; vx: number; vy: number; targetX: number; targetY: number; }
interface SignParticle { active: boolean; text: PhaserTypes.GameObjects.Text; side: Side; age: number; lifetime: number; x: number; y: number; vx: number; vy: number; }
interface SideFx { state: MoneyFlowVisualState; candle: PhaserTypes.GameObjects.Graphics; glow: PhaserTypes.GameObjects.Graphics; positiveCooldown: number; negativeCooldown: number; }

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
            active: false, graphic: scene.add.graphics().setDepth(5).setVisible(false), side: 'left', positive: true,
            age: 0, lifetime: 0, x: 0, y: 0, vx: 0, vy: 0, targetX: 0, targetY: 0
        }));
        this.signs = new ReusablePool(MAX_SIGNS_PER_SIDE * 2, () => ({
            active: false, text: scene.add.text(0, 0, '+', { fontFamily: 'monospace', fontSize: '20px', fontStyle: 'bold', color: '#b8ff64' })
                .setOrigin(.5).setDepth(6).setVisible(false), side: 'left', age: 0, lifetime: 0, x: 0, y: 0, vx: 0, vy: 0
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
            this.drawOverheadCandle(fx, anchorX, anchorY);
            this.drawGlow(fx, anchorX, anchorY);
            if (fx.state.positive > .12 && fx.positiveCooldown === 0) {
                this.spawnBag(side, true, anchorX, anchorY, fx.state.positive);
                this.spawnSign(side, true, anchorX, anchorY);
                fx.positiveCooldown = 210 + (1 - fx.state.positive) * 260;
            }
            if (fx.state.negative > .12 && fx.negativeCooldown === 0) {
                this.spawnBag(side, false, anchorX, anchorY, fx.state.negative);
                this.spawnSign(side, false, anchorX, anchorY);
                fx.negativeCooldown = 240 + (1 - fx.state.negative) * 280;
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
        for (const side of SIDES) { this.effects[side].candle.destroy(); this.effects[side].glow.destroy(); }
    }

    private createSideFx(): SideFx {
        return { state: new MoneyFlowVisualState(), candle: this.scene.add.graphics().setDepth(6).setVisible(false), glow: this.scene.add.graphics().setDepth(3).setVisible(false), positiveCooldown: 0, negativeCooldown: 0 };
    }

    private consumeBufferedBatches(): void {
        if (!this.matchId) return;
        for (const batch of getMoneyFlowBuffer(this.matchId)) {
            const side = batch.symbol.toUpperCase() === this.symbols.left ? 'left' : batch.symbol.toUpperCase() === this.symbols.right ? 'right' : undefined;
            if (!side) continue;
            const key = `${side}:${batch.symbol}`;
            if ((this.lastSequence.get(key) ?? 0) >= batch.sequence) continue;
            this.lastSequence.set(key, batch.sequence);
            this.effects[side].state.ingest(batch);
        }
    }

    private spawnBag(side: Side, positive: boolean, anchorX: number, anchorY: number, energy: number): void {
        let activeForSide = 0;
        this.bags.forEach(item => { if (item.active && item.side === side) activeForSide++; });
        if (activeForSide >= MAX_BAGS_PER_SIDE) return;
        const bag = this.bags.acquire();
        if (!bag) return;
        bag.side = side; bag.positive = positive; bag.age = 0;
        bag.lifetime = positive ? 760 : 1350;
        bag.x = anchorX + (Math.random() - .5) * 78;
        bag.y = positive ? anchorY - 125 - Math.random() * 48 : anchorY + 18;
        bag.targetX = anchorX + (Math.random() - .5) * 22;
        bag.targetY = positive ? anchorY + 8 : anchorY + 118 + Math.random() * 16;
        bag.vx = (Math.random() - .5) * (positive ? 22 : 48);
        bag.vy = positive ? 130 + energy * 125 : 80 + energy * 80;
        this.drawBag(bag.graphic, positive);
        bag.graphic.setPosition(bag.x, bag.y).setScale(1).setAlpha(positive ? .94 : .9).setVisible(true);
    }

    private spawnSign(side: Side, positive: boolean, anchorX: number, anchorY: number): void {
        let activeForSide = 0;
        this.signs.forEach(item => { if (item.active && item.side === side) activeForSide++; });
        if (activeForSide >= MAX_SIGNS_PER_SIDE) return;
        const sign = this.signs.acquire();
        if (!sign) return;
        sign.side = side; sign.age = 0; sign.lifetime = 640;
        sign.x = anchorX + (Math.random() - .5) * 90;
        sign.y = positive ? anchorY - 82 : anchorY + 30;
        sign.vx = (Math.random() - .5) * 18;
        sign.vy = positive ? -30 : 24;
        sign.text.setText(positive ? '+' : '-').setColor(positive ? '#b9ff69' : '#ff7777').setPosition(sign.x, sign.y).setAlpha(.95).setVisible(true);
    }

    private updateBags(deltaMs: number): void {
        this.bags.forEach(bag => {
            if (!bag.active) return;
            bag.age += deltaMs;
            const t = clamp(bag.age / (bag.positive ? 650 : 700));
            if (bag.positive) {
                bag.x += (bag.targetX - bag.x) * Math.min(1, deltaMs / 240) + bag.vx * deltaMs / 1000;
                bag.y += (bag.targetY - bag.y) * Math.min(1, deltaMs / 220) + bag.vy * deltaMs / 1000;
                bag.graphic.setScale(1 - t * .22).setAlpha(Math.max(0, .94 - Math.max(0, t - .72) * 3.4));
            } else {
                bag.x += bag.vx * deltaMs / 1000;
                bag.vy += deltaMs * .19;
                bag.y = Math.min(bag.targetY, bag.y + bag.vy * deltaMs / 1000);
                const settled = bag.y >= bag.targetY - .5;
                bag.graphic.setScale(settled ? .9 : 1).setAlpha(settled ? Math.max(0, 1 - (bag.age - 700) / 650) : .9);
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
        for (const side of ['left', 'right'] as const) { this.effects[side].candle.setVisible(false); this.effects[side].glow.setVisible(false); }
    }

    private drawBag(graphic: PhaserTypes.GameObjects.Graphics, positive: boolean): void {
        const fabric = positive ? 0xc7a647 : 0xa87842;
        graphic.clear().fillStyle(0x201710, .9).fillRect(-9, -9, 18, 19)
            .fillStyle(fabric, 1).fillRect(-7, -7, 14, 16).fillRect(-4, -11, 8, 5)
            .fillStyle(positive ? 0x203f20 : 0x482222, 1).fillRect(-2, -2, 4, 6)
            .lineStyle(1, 0xffef9c, .8).strokeRect(-7, -7, 14, 16);
    }

    private drawOverheadCandle(fx: SideFx, anchorX: number, anchorY: number): void {
        const height = 22 + fx.state.displayed * 46;
        const positive = fx.state.accumulatorValue >= 0;
        const color = positive ? 0x9fe84b : 0xed6868;
        const y = anchorY - 93;
        fx.candle.clear().setVisible(true).lineStyle(2, 0x06131b, 1).lineBetween(anchorX, y - height / 2 - 9, anchorX, y + height / 2 + 9)
            .lineStyle(1, color, .95).lineBetween(anchorX, y - height / 2 - 9, anchorX, y + height / 2 + 9)
            .fillStyle(0x07131b, .95).fillRect(anchorX - 10, y - height / 2, 20, height)
            .fillStyle(color, .95).fillRect(anchorX - 8, y - height / 2 + 2, 16, Math.max(4, height - 4));
    }

    private drawGlow(fx: SideFx, anchorX: number, anchorY: number): void {
        const energy = Math.max(fx.state.positive, fx.state.negative);
        if (energy < .03) { fx.glow.setVisible(false); return; }
        const color = fx.state.positive >= fx.state.negative ? 0xa4ee56 : 0xf06c6c;
        fx.glow.clear().setVisible(true).fillStyle(color, .035 + energy * .07).fillCircle(anchorX, anchorY + 22, 35 + energy * 28);
    }
}
