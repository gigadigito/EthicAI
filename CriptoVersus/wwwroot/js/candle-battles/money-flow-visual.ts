import type PhaserTypes from 'phaser';
import type { MoneyFlowBatch } from './money-flow.js';
import { getMoneyFlowBuffer, inspectMoneyFlowBuffer } from './money-flow.js';
import type { Side } from './model.js';
import {
    BagCollectionState,
    CollectibleMoneyBag,
    CollectorController,
    CollectorQuality,
    MoneyFlowAnchors,
    MoneyFlowBagHost,
    MoneyFlowRegion,
    normalizeCollectorQuality,
} from './money-flow-collectors.js';
import {
    BAG_ABSORB_MS,
    BAG_LANDING_MS,
    BagVisualPhase,
    MONEY_FLOW_EFFECTS_ATLAS,
    MoneyFlowTerminalFx,
    bagFrameForPhase,
    moneyFlowEffectsAvailable,
    prepareMoneyFlowEffectsTextures,
} from './money-flow-effects-renderer.js';

export type MoneyFlowDirection = 'positive' | 'negative' | 'neutral';

export interface MoneyFlowVisualDecision {
    direction: MoneyFlowDirection;
    intensity: number;
    buyVolume: number;
    sellVolume: number;
    buyIntensity: number;
    sellIntensity: number;
}

export interface MoneyFlowVisualSnapshot {
    positiveEnergy: number;
    negativeEnergy: number;
    accumulator: number;
    displayedCandle: number;
    referencePrice?: number;
}

export interface MoneyFlowCounters {
    buy: number;
    sell: number;
    partial: boolean;
}

export type MoneyFlowCounterPolarity = 'buy' | 'sell';

export type MoneyFlowCountersBySide = Record<Side, MoneyFlowCounters>;

/** The official five-minute window currently shown by the live arena. */
export interface MoneyFlowRoundWindow {
    id: string;
    startMs: number;
    endMs: number;
}

const emptyCounters = (): MoneyFlowCountersBySide => ({
    left: { buy: 0, sell: 0, partial: false },
    right: { buy: 0, sell: 0, partial: false },
});

const eventTimeMs = (batch: MoneyFlowBatch): number => Date.parse(batch.eventTimeUtc);

/** The event timestamp, not SignalR arrival time, owns the visual round. */
export function moneyFlowBatchBelongsToRound(batch: MoneyFlowBatch, round: MoneyFlowRoundWindow): boolean {
    const eventTime = eventTimeMs(batch);
    return Number.isFinite(eventTime) && eventTime >= round.startMs && eventTime < round.endMs;
}

/**
 * Stable visual-event identity. A counter is independent from pooled sprites,
 * so a performance cap can never make an accepted market batch disappear from
 * the panel.
 */
export function moneyFlowEventKey(roundId: string, side: Side, polarity: MoneyFlowCounterPolarity, batch: MoneyFlowBatch): string {
    return `${batch.matchId}:${roundId}:${side}:${polarity}:${batch.symbol.toUpperCase()}:${batch.sequence}`;
}

/** Pure presentation ledger, isolated by round, side and polarity. */
export class MoneyFlowEventCounter {
    private readonly seenByRound = new Map<string, Set<string>>();
    private readonly valuesByRound = new Map<string, MoneyFlowCountersBySide>();
    private activeRoundId?: string;

    setRound(roundId: string): boolean {
        if (this.activeRoundId === roundId) return false;
        this.activeRoundId = roundId;
        if (!this.valuesByRound.has(roundId)) this.valuesByRound.set(roundId, emptyCounters());
        if (!this.seenByRound.has(roundId)) this.seenByRound.set(roundId, new Set());
        return true;
    }

    accept(roundId: string, side: Side, batch: MoneyFlowBatch, polarity: MoneyFlowCounterPolarity, amount = 1): boolean {
        this.setRound(roundId);
        const seen = this.seenByRound.get(roundId)!;
        const key = moneyFlowEventKey(roundId, side, polarity, batch);
        if (seen.has(key)) return false;
        seen.add(key);
        const value = Number(amount);
        if (!Number.isFinite(value) || value <= 0) return false;
        this.valuesByRound.get(roundId)![side][polarity] += value;
        if (batch.isPartial) this.valuesByRound.get(roundId)![side].partial = true;
        return true;
    }

    snapshot(): MoneyFlowCountersBySide {
        const values = this.activeRoundId == null ? undefined : this.valuesByRound.get(this.activeRoundId);
        return values == null ? emptyCounters() : { left: { ...values.left }, right: { ...values.right } };
    }

    reset(): void {
        this.activeRoundId = undefined;
        this.seenByRound.clear();
        this.valuesByRound.clear();
    }
}

/** Resolves every arena side that owns an incoming symbol without cross-talk. */
export function moneyFlowSidesForBatch(batch: MoneyFlowBatch, symbols: Record<Side, string>): Side[] {
    const symbol = batch.symbol.toUpperCase();
    const sides: Side[] = [];
    if (symbol === symbols.left) sides.push('left');
    if (symbol === symbols.right) sides.push('right');
    return sides;
}

/**
 * A taker field is only measured data when it is present and numeric. Missing
 * or unparseable values are "unavailable", never a measured zero flow: the two
 * cases are classified apart so absence can never fabricate or suppress a
 * real flow event silently.
 */
export type MoneyFlowTakerFieldState = 'flow' | 'zero' | 'unavailable';

export function moneyFlowTakerFieldState(batch: MoneyFlowBatch, polarity: MoneyFlowCounterPolarity): MoneyFlowTakerFieldState {
    const raw = polarity === 'buy' ? batch.takerBuyQuote : batch.takerSellQuote;
    if (raw == null || (typeof raw === 'string' && raw.trim() === '')) return 'unavailable';
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return 'unavailable';
    return parsed > 0 ? 'flow' : 'zero';
}

/**
 * The top counters reflect actual taker-flow fields, not the separate
 * positive/negative price-motion effect used by the arena particles. A batch
 * may legitimately contribute to both counters because it aggregates trades.
 * Only present, positive taker flow creates a count; unavailable data and
 * measured zero flow both create none, each for its own documented reason.
 */
export function moneyFlowCounterPolarities(batch: MoneyFlowBatch): MoneyFlowCounterPolarity[] {
    const polarities: MoneyFlowCounterPolarity[] = [];
    if (moneyFlowTakerFieldState(batch, 'buy') === 'flow') polarities.push('buy');
    if (moneyFlowTakerFieldState(batch, 'sell') === 'flow') polarities.push('sell');
    return polarities;
}

const clamp = (value: number, min = 0, max = 1): number => Math.max(min, Math.min(max, value));
const finite = (value: string | number | undefined): number => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
};

/** Quote flow alone determines visual polarity; OHLC is deliberately ignored. */
export function decideMoneyFlow(batch: MoneyFlowBatch): MoneyFlowVisualDecision {
    const buyVolume = Math.max(0, finite(batch.takerBuyQuote));
    const sellVolume = Math.max(0, finite(batch.takerSellQuote));
    const total = buyVolume + sellVolume;
    const buyIntensity = total > 0 ? clamp(.2 + .8 * buyVolume / total) : 0;
    const sellIntensity = total > 0 ? clamp(.2 + .8 * sellVolume / total) : 0;
    const intensity = Math.max(buyIntensity, sellIntensity) * (batch.isPartial ? .7 : 1);
    return {
        direction: buyVolume === 0 && sellVolume === 0 ? 'neutral' : buyVolume >= sellVolume ? 'positive' : 'negative',
        intensity,
        buyVolume,
        sellVolume,
        buyIntensity: buyIntensity * (batch.isPartial ? .7 : 1),
        sellIntensity: sellIntensity * (batch.isPartial ? .7 : 1),
    };
}

export type MoneyFlowSizeCategory = 'small' | 'medium' | 'large' | 'very-large';

export interface MoneyFlowVolumeSample {
    amount: number;
    intensity: number;
    sizeCategory: MoneyFlowSizeCategory;
}

/**
 * Adaptive per-symbol/polarity scale. The label remains the real quote amount;
 * only the sprite scale uses the exponentially smoothed local baseline.
 */
export class MoneyFlowVolumeNormalizer {
    private readonly baselineByKey = new Map<string, number>();

    private intensityFor(key: string, amount: number, partial: boolean): number {
        const previous = this.baselineByKey.get(key) ?? amount;
        const ratio = amount / Math.max(previous, Number.EPSILON);
        const relative = clamp(.5 + Math.log2(Math.max(ratio, .0625)) * .22, .12, 1);
        return relative * (partial ? .7 : 1);
    }

    observe(symbol: string, polarity: MoneyFlowCounterPolarity, rawAmount: string | number | undefined, partial = false): MoneyFlowVolumeSample {
        const amount = Math.max(0, finite(rawAmount));
        if (amount <= 0) return { amount: 0, intensity: 0, sizeCategory: 'small' };
        const key = `${symbol.toUpperCase()}:${polarity}`;
        const intensity = this.intensityFor(key, amount, partial);
        const previous = this.baselineByKey.get(key) ?? amount;
        this.baselineByKey.set(key, previous * .88 + amount * .12);
        const sizeCategory: MoneyFlowSizeCategory = intensity < .35 ? 'small'
            : intensity < .58 ? 'medium'
                : intensity < .8 ? 'large' : 'very-large';
        return { amount, intensity, sizeCategory };
    }

    scaleFor(symbol: string, polarity: MoneyFlowCounterPolarity, amount: number): MoneyFlowVolumeSample {
        const safeAmount = Math.max(0, amount);
        if (safeAmount <= 0) return { amount: 0, intensity: 0, sizeCategory: 'small' };
        const intensity = this.intensityFor(`${symbol.toUpperCase()}:${polarity}`, safeAmount, false);
        const sizeCategory: MoneyFlowSizeCategory = intensity < .35 ? 'small'
            : intensity < .58 ? 'medium'
                : intensity < .8 ? 'large' : 'very-large';
        return { amount: safeAmount, intensity, sizeCategory };
    }

    reset(): void { this.baselineByKey.clear(); }
}

export function formatMoneyFlowAmount(amount: number, symbol: string): string {
    const value = Math.max(0, Number(amount) || 0);
    const suffix = value >= 1_000_000_000 ? 'B' : value >= 1_000_000 ? 'M' : value >= 1_000 ? 'K' : '';
    const scaled = suffix === 'B' ? value / 1_000_000_000 : suffix === 'M' ? value / 1_000_000 : suffix === 'K' ? value / 1_000 : value;
    const decimals = suffix ? scaled < 10 ? 1 : 0 : scaled < 100 ? 0 : 0;
    const numberText = scaled.toFixed(decimals).replace(/\.0$/, '');
    const upper = symbol.toUpperCase();
    const quotes = ['USDT', 'USDC', 'FDUSD', 'BUSD', 'TUSD', 'BTC', 'ETH', 'BNB', 'EUR', 'TRY', 'BRL'];
    const quote = quotes.find(candidate => upper.endsWith(candidate));
    return `${numberText}${suffix}${quote ? ` ${quote}` : ''}`;
}

export interface FinancialLabelPositionInput {
    bagX: number;
    bagY: number;
    bagWidth: number;
    bagHeight: number;
    labelWidth: number;
    labelHeight: number;
    region: MoneyFlowRegion;
    /** Prefer the side away from the fighter, but switch sides near an edge. */
    preferredSide: 'left' | 'right';
    /** Carried labels follow the collector outside the resting bag region. */
    clampToRegion?: boolean;
}

export interface FinancialLabelPosition {
    x: number;
    y: number;
    side: 'left' | 'right';
}

/**
 * Places a label beside the bag's current visual bounds. The fallback side is
 * chosen from the available region width, so a small or very-large bag cannot
 * force a fixed offset through the arena edge or back over its own sprite.
 */
export function calculateFinancialLabelPosition(input: FinancialLabelPositionInput): FinancialLabelPosition {
    const bagWidth = Math.max(1, input.bagWidth);
    const bagHeight = Math.max(1, input.bagHeight);
    const labelWidth = Math.max(1, input.labelWidth);
    const labelHeight = Math.max(1, input.labelHeight);
    // Keep the label visibly beside the bag, but close enough that the value
    // reads as part of the same financial particle. The side selection and
    // region clamping below still protect the bag, fighter and arena edges.
    const gap = Math.max(4, Math.min(12, bagWidth * .12));
    const leftCandidate = input.bagX - bagWidth / 2 - gap - labelWidth / 2;
    const rightCandidate = input.bagX + bagWidth / 2 + gap + labelWidth / 2;
    const minX = input.region.left + labelWidth / 2;
    const maxX = input.region.right - labelWidth / 2;
    const canFitLeft = leftCandidate >= minX;
    const canFitRight = rightCandidate <= maxX;
    const preferred = input.preferredSide === 'left' ? 'left' : 'right';
    const side = preferred === 'left'
        ? canFitLeft || !canFitRight ? 'left' : 'right'
        : canFitRight || !canFitLeft ? 'right' : 'left';
    const candidate = side === 'left' ? leftCandidate : rightCandidate;
    const x = input.clampToRegion === false ? candidate : Math.max(minX, Math.min(maxX, candidate));
    const unclampedY = input.bagY - bagHeight * .52;
    const y = input.clampToRegion === false
        ? unclampedY
        : Math.max(input.region.top - labelHeight, Math.min(input.region.floorY + labelHeight, unclampedY));
    return { x, y, side };
}

/** Framework-free smoothing state so the visual rules are testable without a Phaser canvas. */
export class MoneyFlowVisualState {
    private positiveEnergy = 0;
    private negativeEnergy = 0;
    private accumulator = 0;
    private displayedCandle = .5;
    private pendingBuy = 0;
    private pendingSell = 0;

    ingest(batch: MoneyFlowBatch, buyIntensity?: number, sellIntensity?: number): MoneyFlowVisualDecision {
        const decision = decideMoneyFlow(batch);
        const buy = buyIntensity ?? decision.buyIntensity;
        const sell = sellIntensity ?? decision.sellIntensity;
        this.pendingBuy += decision.buyVolume;
        this.pendingSell += decision.sellVolume;
        this.positiveEnergy = clamp(this.positiveEnergy + buy);
        this.negativeEnergy = clamp(this.negativeEnergy + sell);
        this.accumulator = clamp(this.accumulator + (buy - sell) * .38, -1, 1);
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
    get pendingPositiveVolume(): number { return this.pendingBuy; }
    get pendingNegativeVolume(): number { return this.pendingSell; }
    takePending(polarity: MoneyFlowCounterPolarity): number {
        const value = polarity === 'buy' ? this.pendingBuy : this.pendingSell;
        if (polarity === 'buy') this.pendingBuy = 0;
        else this.pendingSell = 0;
        return value;
    }
    /** Discards only visual parcels accumulated while the arena was frozen. */
    discardPendingVisualEffects(): void {
        this.pendingBuy = 0;
        this.pendingSell = 0;
    }

    snapshot(): MoneyFlowVisualSnapshot {
        return {
            positiveEnergy: this.positiveEnergy,
            negativeEnergy: this.negativeEnergy,
            accumulator: this.accumulator,
            displayedCandle: this.displayedCandle,
            referencePrice: undefined
        };
    }

    reset(): void {
        this.positiveEnergy = 0;
        this.negativeEnergy = 0;
        this.accumulator = 0;
        this.displayedCandle = .5;
        this.pendingBuy = 0;
        this.pendingSell = 0;
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

type BagView = PhaserTypes.GameObjects.Sprite | PhaserTypes.GameObjects.Graphics;
type SignView = PhaserTypes.GameObjects.Text;

interface BagParticle extends CollectibleMoneyBag {
    view: BagView;
    lifetime: number;
    startX: number;
    startY: number;
    targetX: number;
    targetY: number;
    phase: number;
    fallDuration: number;
    visualPhase: BagVisualPhase;
    phaseAge: number;
    restY: number;
    groundY: number;
    baseScale: number;
    viewScale: number;
    viewAlpha: number;
    amount: number;
    currency: string;
    intensity: number;
    sizeCategory: MoneyFlowSizeCategory;
    financialLabel?: SignParticle;
}
interface SignParticle {
    active: boolean;
    view: SignView;
    bagId: number;
    positive: boolean;
    side: Side;
    x: number;
    y: number;
    text: string;
    carriedVisible: boolean;
}
interface SideFx { state: MoneyFlowVisualState; glow: PhaserTypes.GameObjects.Graphics; positiveCooldown: number; negativeCooldown: number; }

export interface BagSpawnPlan {
    x: number;
    y: number;
    targetX: number;
    targetY: number;
    sway: number;
    fallDuration: number;
}

/**
 * Protected central zone of a fighter: the candle body and face must stay
 * readable. Bags spawn and settle on the lateral lanes instead of dropping on
 * top of the character, then positive bags converge on the hands to be
 * absorbed.
 */
function protectedHalf(region: MoneyFlowRegion): number {
    return region.fighterWidth * .55;
}

/** Lateral lane at `t` (0 = nearest the fighter, 1 = outer edge), away from centre. */
function lateralX(region: MoneyFlowRegion, towardLeft: boolean, t: number): number {
    const half = protectedHalf(region);
    const outer = towardLeft ? region.left : region.right;
    const inner = towardLeft ? region.centerX - half : region.centerX + half;
    const clamped = Math.max(.18, Math.min(1, t));
    return Math.max(region.left, Math.min(region.right, inner + (outer - inner) * clamped));
}

/**
 * Deterministic emission across the dynamic region. Bags are routed down the
 * lateral lanes so the candle's body and face are never covered, while still
 * filling the full region so no side collapses into a single falling column.
 */
export function planBagSpawn(
    positive: boolean,
    anchors: MoneyFlowAnchors,
    randoms: readonly number[],
): BagSpawnPlan {
    const region = anchors.region;
    const rand = (index: number): number => randoms[index] ?? .5;
    const triangle = (rand(0) + rand(1)) / 2;
    const offset = (triangle - .5) * 2;
    const sway = (rand(4) - .5) * (positive ? 14 : 8);
    if (positive) {
        // Descend beside the fighter, then converge on the hands to be
        // absorbed: the bag is never left sitting on the face.
        const x = lateralX(region, offset < 0, Math.abs(offset));
        const y = region.top + rand(2) * Math.max(8, anchors.body.y - region.top) * .6;
        const targetX = Math.max(region.left, Math.min(region.right,
            anchors.hands.x + (rand(3) - .5) * region.fighterWidth * 1.25));
        const targetY = anchors.hands.y + 34;
        const distance = Math.abs(targetY - y);
        return { x, y, targetX, targetY, sway, fallDuration: Math.max(850, Math.min(1450, 700 + distance * 1.6)) };
    }
    // Negative bags settle on the floor beside the fighter's feet.
    const x = lateralX(region, offset < 0, Math.abs(offset) * .8 + .2);
    const y = anchors.body.y - 30 + rand(2) * 50;
    const drift = (rand(3) - .5) * (region.right - region.left) * .45;
    const targetX = Math.max(region.left, Math.min(region.right, x + drift));
    return { x, y, targetX, targetY: region.floorY, sway, fallDuration: 850 };
}

const MAX_BAGS_PER_SIDE = 6;
const MAX_SIGNS_PER_SIDE = 6;
const SIDES: readonly Side[] = ['left', 'right'];

export interface MoneyFlowControllerOptions {
    collectorsEnabled?: boolean;
    collectorQuality?: CollectorQuality | string;
    reducedMotion?: boolean;
}

/**
 * Presentation-only Phaser layer for live Money Flow. It owns no match data,
 * score, combat state or OHLC; all of its state can be discarded at any time.
 */
export class MoneyFlowController implements MoneyFlowBagHost {
    private readonly effects: Record<Side, SideFx>;
    private readonly bags: ReusablePool<BagParticle>;
    private readonly signs: ReusablePool<SignParticle>;
    private readonly collectors: CollectorController;
    private readonly collectorsConfigured: boolean;
    private readonly spriteMode: boolean;
    private readonly terminalFx: MoneyFlowTerminalFx;
    private readonly volumeNormalizer = new MoneyFlowVolumeNormalizer();
    private reducedMotion: boolean;
    private matchId?: number;
    private symbols: Record<Side, string> = { left: '', right: '' };
    private round?: MoneyFlowRoundWindow;
    private readonly lastSequence = new Map<string, number>();
    private readonly counter = new MoneyFlowEventCounter();
    private enabled = false;
    private particleSequence = 0;

    constructor(private readonly scene: PhaserTypes.Scene, options: MoneyFlowControllerOptions = {}) {
        this.collectorsConfigured = options.collectorsEnabled === true;
        this.reducedMotion = options.reducedMotion === true;
        // Real atlas sprites are the primary rendering path; the procedural
        // drawing below only runs when the optional atlas failed to load.
        this.spriteMode = moneyFlowEffectsAvailable(scene);
        if (this.spriteMode) prepareMoneyFlowEffectsTextures(scene);
        this.terminalFx = new MoneyFlowTerminalFx(scene, { reducedMotion: this.reducedMotion });
        this.effects = {
            left: this.createSideFx(),
            right: this.createSideFx()
        };
        this.bags = new ReusablePool(MAX_BAGS_PER_SIDE * 2, () => ({
            id: 0, active: false, view: this.createBagView(), side: 'left', positive: true,
            state: 'REMOVED', age: 0, availableAge: 0, lifetime: 0, x: 0, y: 0,
            startX: 0, startY: 0, targetX: 0, targetY: 0, phase: 0,
            fallDuration: 1000, visualPhase: 'flying', phaseAge: 0, restY: 0, groundY: 0,
            baseScale: 1, viewScale: 1, viewAlpha: 1, amount: 0, currency: '', intensity: 0, sizeCategory: 'small'
        }));
        this.signs = new ReusablePool(MAX_SIGNS_PER_SIDE * 2, () => ({
            active: false, view: this.createSignView(), bagId: 0, positive: true, side: 'left',
            x: 0, y: 0, text: '', carriedVisible: false
        }));
        this.collectors = new CollectorController(scene, this, {
            enabled: this.collectorsConfigured,
            quality: normalizeCollectorQuality(options.collectorQuality),
            reducedMotion: options.reducedMotion === true,
        });
    }

    private createBagView(): BagView {
        return this.spriteMode
            ? this.scene.add.sprite(0, 0, MONEY_FLOW_EFFECTS_ATLAS, 'bag-fall-1')
                .setOrigin(.5, 1).setDepth(12).setVisible(false)
            : this.scene.add.graphics().setDepth(12).setVisible(false);
    }

    private createSignView(): SignView {
        return this.scene.add.text(0, 0, '', {
            fontFamily: 'monospace', fontSize: '14px', fontStyle: 'bold', color: '#b8ff64',
            stroke: '#071317', strokeThickness: 4
        }).setOrigin(.5).setDepth(13).setVisible(false);
    }

    setLiveMatch(matchId: number, leftSymbol: string, rightSymbol: string, enabled: boolean): void {
        const normalizedSymbols = { left: leftSymbol.toUpperCase(), right: rightSymbol.toUpperCase() };
        const changed = this.matchId !== matchId
            || this.symbols.left !== normalizedSymbols.left
            || this.symbols.right !== normalizedSymbols.right;
        const enabledChanged = this.enabled !== enabled;
        this.matchId = matchId;
        this.symbols = normalizedSymbols;
        this.enabled = enabled;
        if (changed) { this.round = undefined; this.reset(); }
        if (!enabled && enabledChanged) this.clearParticles();
        this.collectors.setEnabled(enabled && this.collectorsConfigured);
        if (enabled && this.round) this.consumeBufferedBatches();
    }

    /**
     * Called from the engine's server-anchored clock. This is a round identity
     * transition, never a local 300-second reset timer.
     */
    setLiveRound(round: MoneyFlowRoundWindow | undefined): void {
        if (round && (!Number.isFinite(round.startMs) || !Number.isFinite(round.endMs) || round.endMs <= round.startMs)) return;
        const changed = this.round?.id !== round?.id;
        this.round = round;
        if (!round || !changed) return;
        this.counter.setRound(round.id);
        // Reset only transient presentation. Match-scoped sequence dedupe is
        // retained, so a reconnect cannot replay an older batch.
        this.clearParticles();
        for (const side of SIDES) this.effects[side].state.reset();
        if (this.enabled) this.consumeBufferedBatches();
    }

    /** Reconciles the current official window without replaying frozen parcels. */
    resumeAfterFreeze(round: MoneyFlowRoundWindow | undefined): void {
        this.setLiveRound(round);
        if (!this.enabled || !round) return;
        this.consumeBufferedBatches();
        this.effects.left.state.discardPendingVisualEffects();
        this.effects.right.state.discardPendingVisualEffects();
    }

    setEnabled(enabled: boolean): void {
        this.enabled = enabled;
        this.collectors.setEnabled(enabled && this.collectorsConfigured);
        if (!enabled) this.clearParticles();
    }

    setReducedMotion(reduced: boolean): void {
        this.reducedMotion = reduced === true;
        this.collectors.setReducedMotion(reduced);
        this.terminalFx.setReducedMotion(reduced);
    }

    update(deltaMs: number, left: MoneyFlowAnchors, right: MoneyFlowAnchors, allowCollectors = true): void {
        if (!this.enabled || !this.matchId) return;
        this.consumeBufferedBatches();
        const anchors = { left, right };
        for (const side of SIDES) {
            const fx = this.effects[side];
            fx.state.advance(deltaMs);
            const anchorX = anchors[side].body.x;
            const anchorY = anchors[side].body.y;
            fx.positiveCooldown = Math.max(0, fx.positiveCooldown - deltaMs);
            fx.negativeCooldown = Math.max(0, fx.negativeCooldown - deltaMs);
            // The original overhead OHLC candle belongs to CandleRenderer and is
            // never duplicated here. Money Flow only adds discrete absorption
            // lighting around the fighter plus the money-bag stream.
            this.drawGlow(fx, anchorX, anchorY);
            // Positive and negative energy are independent real batch streams.
            // Selecting only the dominant value made a valid stream disappear
            // whenever the other polarity decayed more slowly.
            if (fx.state.pendingPositiveVolume > 0 && fx.positiveCooldown === 0) {
                const amount = fx.state.pendingPositiveVolume;
                const intensity = this.volumeNormalizer.scaleFor(this.symbols[side], 'buy', amount).intensity;
                const bag = this.spawnBag(side, true, anchors[side], amount, intensity);
                if (bag) fx.state.takePending('buy');
                // Higher energy emits more often, within the hard object limits.
                fx.positiveCooldown = 240 + (1 - fx.state.positive) * 260;
            }
            if (fx.state.pendingNegativeVolume > 0 && fx.negativeCooldown === 0) {
                const amount = fx.state.pendingNegativeVolume;
                const intensity = this.volumeNormalizer.scaleFor(this.symbols[side], 'sell', amount).intensity;
                const bag = this.spawnBag(side, false, anchors[side], amount, intensity);
                if (bag) fx.state.takePending('sell');
                fx.negativeCooldown = 260 + (1 - fx.state.negative) * 270;
            }
        }
        this.updateBags(deltaMs, anchors);
        this.terminalFx.update(deltaMs);
        this.collectors.update(deltaMs, {
            allowSpawn: allowCollectors,
            anchors,
            energy: {
                left: { positive: this.effects.left.state.positive, negative: this.effects.left.state.negative },
                right: { positive: this.effects.right.state.positive, negative: this.effects.right.state.negative },
            },
        });
        // Collector motion updates carried bag coordinates and underground
        // clipping before labels are positioned, keeping both in the same tick.
        this.updateFinancialLabels(anchors);
    }

    inspect(): object {
        return {
            active: this.enabled,
            matchId: this.matchId ?? null,
            roundId: this.round?.id ?? null,
            bags: this.bags.activeCount,
            signs: this.signs.activeCount,
            bagPoolSize: this.bags.size,
            signPoolSize: this.signs.size,
            renderMode: this.spriteMode ? 'sprites' : 'procedural',
            reducedMotion: this.reducedMotion,
            terminalFx: this.terminalFx.activeCount,
            counters: this.counter.snapshot(),
            bagStates: this.inspectBags(),
            signStates: this.inspectSigns(),
            collectors: this.collectors.inspect(),
            buffer: this.matchId ? inspectMoneyFlowBuffer(this.matchId) : null,
            left: this.effects.left.state.snapshot(),
            right: this.effects.right.state.snapshot()
        };
    }

    reset(): void {
        this.collectors.reset();
        this.lastSequence.clear();
        this.counter.reset();
        this.round = undefined;
        this.particleSequence = 0;
        this.volumeNormalizer.reset();
        this.clearParticles();
        for (const side of SIDES) this.effects[side].state.reset();
    }

    destroy(): void {
        this.reset();
        this.collectors.destroy();
        this.terminalFx.destroy();
        this.bags.forEach(item => item.view.destroy());
        this.signs.forEach(item => item.view.destroy());
        for (const side of SIDES) this.effects[side].glow.destroy();
    }

    private createSideFx(): SideFx {
        return { state: new MoneyFlowVisualState(), glow: this.scene.add.graphics().setDepth(3).setVisible(false), positiveCooldown: 0, negativeCooldown: 0 };
    }

    private consumeBufferedBatches(): void {
        if (!this.matchId || !this.round) return;
        for (const batch of getMoneyFlowBuffer(this.matchId)) {
            const sides = moneyFlowSidesForBatch(batch, this.symbols);
            if (sides.length === 0) continue;
            const acceptedSides: Side[] = [];
            for (const side of sides) {
                const key = `${side}:${batch.symbol.toUpperCase()}`;
                if ((this.lastSequence.get(key) ?? 0) >= batch.sequence) continue;
                this.lastSequence.set(key, batch.sequence);
                if (!moneyFlowBatchBelongsToRound(batch, this.round)) continue;
                acceptedSides.push(side);
            }
            if (acceptedSides.length === 0) continue;
            const decision = decideMoneyFlow(batch);
            const buy = this.volumeNormalizer.observe(batch.symbol, 'buy', batch.takerBuyQuote, batch.isPartial);
            const sell = this.volumeNormalizer.observe(batch.symbol, 'sell', batch.takerSellQuote, batch.isPartial);
            for (const side of acceptedSides) {
                // Relative normalization controls parcel size only. Directional
                // pressure must retain the batch's absolute buy/sell balance.
                this.effects[side].state.ingest(batch, decision.buyIntensity, decision.sellIntensity);
                if (buy.amount > 0) this.counter.accept(this.round.id, side, batch, 'buy', buy.amount);
                if (sell.amount > 0) this.counter.accept(this.round.id, side, batch, 'sell', sell.amount);
            }
        }
    }

    private spawnBag(side: Side, positive: boolean, anchors: MoneyFlowAnchors, amount: number, intensity: number): BagParticle | undefined {
        let activeForSide = 0;
        this.bags.forEach(item => { if (item.active && item.side === side) activeForSide++; });
        if (activeForSide >= MAX_BAGS_PER_SIDE) return undefined;
        const bag = this.bags.acquire();
        if (!bag) return undefined;
        const plan = planBagSpawn(positive, anchors, [
            this.random(side), this.random(side), this.random(side), this.random(side), this.random(side)
        ]);
        bag.id = ++this.particleSequence;
        bag.side = side; bag.positive = positive; bag.age = 0; bag.availableAge = 0; bag.ownerId = undefined;
        bag.amount = amount;
        bag.currency = this.symbols[side];
        bag.intensity = intensity;
        bag.sizeCategory = intensity < .35 ? 'small' : intensity < .58 ? 'medium' : intensity < .8 ? 'large' : 'very-large';
        bag.state = 'FLOWING';
        bag.visualPhase = 'flying'; bag.phaseAge = 0;
        bag.fallDuration = plan.fallDuration;
        bag.lifetime = plan.fallDuration + (positive ? 250 : 1450);
        bag.x = plan.x; bag.y = plan.y;
        bag.startX = plan.x; bag.startY = plan.y;
        bag.targetX = plan.targetX; bag.targetY = plan.targetY;
        bag.restY = plan.targetY;
        bag.groundY = anchors.ground.y;
        bag.phase = plan.sway;
        const sizeScale = bag.sizeCategory === 'small' ? .8 : bag.sizeCategory === 'medium' ? 1 : bag.sizeCategory === 'large' ? 1.2 : 1.4;
        bag.baseScale = clamp(anchors.region.fighterHeight / 290, .55, 1) * sizeScale;
        if (this.spriteMode) {
            (bag.view as PhaserTypes.GameObjects.Sprite).setFrame(bagFrameForPhase('flying', 0));
        } else {
            this.drawBag(bag.view as PhaserTypes.GameObjects.Graphics, positive);
        }
        this.applyBagView(bag, bag.baseScale, 1);
        // A bag is not admitted to the visual pool without its one financial
        // label. This makes the identity relationship atomic at birth.
        if (!this.attachFinancialLabel(bag, anchors)) {
            bag.state = 'REMOVED';
            bag.view.setVisible(false);
            this.bags.release(bag);
            return undefined;
        }
        return bag;
    }

    private attachFinancialLabel(bag: BagParticle, anchors: MoneyFlowAnchors): boolean {
        if (bag.financialLabel?.active) return true;
        const sign = this.signs.acquire();
        if (!sign) return false;
        sign.bagId = bag.id;
        sign.side = bag.side;
        sign.positive = bag.positive;
        sign.text = formatMoneyFlowAmount(bag.amount, bag.currency);
        sign.carriedVisible = true;
        sign.view.setText(sign.text).setColor(bag.positive ? '#d9ff84' : '#ff9b65');
        bag.financialLabel = sign;
        this.positionFinancialLabel(sign, bag, anchors, false);
        sign.view.setAlpha(1).setVisible(Boolean(sign.text));
        return true;
    }

    private updateBags(deltaMs: number, anchors: Record<Side, MoneyFlowAnchors>): void {
        this.bags.forEach(bag => {
            if (!bag.active) return;
            bag.age += deltaMs;
            if (bag.state === 'CARRIED') return;
            if (bag.state === 'AVAILABLE') bag.availableAge += deltaMs;
            if (bag.visualPhase === 'landing') {
                bag.phaseAge += deltaMs;
                if (bag.phaseAge >= BAG_LANDING_MS) { bag.visualPhase = 'resting'; bag.phaseAge = 0; }
            }
            if (bag.state !== 'FLOWING') {
                if (bag.positive && bag.state !== 'AVAILABLE') {
                    // Mid-collection the bag stays with the fighter's hands.
                    const target = anchors[bag.side].hands;
                    bag.x += (target.x - bag.x) * .16;
                    bag.y += (target.y + 34 - bag.y) * .16;
                } else if (bag.positive && bag.visualPhase === 'resting') {
                    // Available bags rest where they landed: independent objects
                    // spread around the fighter until an angel claims one.
                    bag.y = bag.restY + Math.sin(bag.phase + bag.age / 520) * 3;
                }
                this.applyBagView(bag, bag.viewScale, bag.viewAlpha);
                if (bag.state === 'AVAILABLE' && bag.age >= bag.lifetime) this.terminateBag(bag);
                return;
            }
            if (bag.positive) {
                // Money descends smoothly toward the fighter and is absorbed:
                // gentle sway on the way down, shrink + fade at the body.
                const fallDuration = bag.fallDuration;
                const t = clamp(bag.age / fallDuration);
                const eased = t * t * (3 - 2 * t);
                bag.targetX = anchors[bag.side].hands.x;
                bag.targetY = anchors[bag.side].hands.y + 34;
                bag.x = bag.startX + (bag.targetX - bag.startX) * eased + Math.sin(bag.phase + t * Math.PI * 3) * 7 * (1 - t);
                bag.y = bag.startY + (bag.targetY - bag.startY) * eased;
                if (t >= 1 && bag.visualPhase === 'flying') {
                    // The descent is over but the bag is not claimed yet: hold
                    // the last aerial frame instead of touching the ground set.
                    bag.visualPhase = 'floating';
                    bag.phaseAge = 0;
                }
                if (t >= 1 && this.collectors.available) this.makeAvailable(bag, 3500);
                else {
                    bag.viewScale = bag.baseScale * (1 - t * .18);
                    bag.viewAlpha = Math.max(0, 1 - Math.max(0, bag.age - fallDuration) / 250);
                }
            } else {
                // Money leaves the fighter under light gravity, settles near
                // the feet briefly, then is removed in a controlled fade.
                const fallDuration = bag.fallDuration;
                const t = clamp(bag.age / fallDuration);
                const gravity = t * t;
                bag.targetY = anchors[bag.side].region.floorY;
                bag.x = bag.startX + (bag.targetX - bag.startX) * gravity + Math.sin(bag.phase + t * Math.PI * 2) * 4 * (1 - t);
                bag.y = bag.startY + (bag.targetY - bag.startY) * gravity;
                const settled = t >= 1;
                if (settled && this.collectors.available) this.makeAvailable(bag, 4000);
                else {
                    bag.viewScale = bag.baseScale * (settled ? .96 : 1.04);
                    bag.viewAlpha = settled
                        ? Math.max(0, 1 - Math.max(0, bag.age - fallDuration - 900) / 550)
                        : 1;
                }
            }
            this.applyBagView(bag, bag.viewScale, bag.viewAlpha);
            if (bag.age >= bag.lifetime) this.terminateBag(bag);
        });
    }

    private positionFinancialLabel(sign: SignParticle, bag: BagParticle, anchors: MoneyFlowAnchors, clampToRegion: boolean): void {
        const bagSize = bag.view as unknown as { displayWidth?: number; displayHeight?: number };
        const labelBounds = sign.view.getBounds();
        const position = calculateFinancialLabelPosition({
            bagX: bag.x,
            bagY: bag.y,
            bagWidth: Number.isFinite(bagSize.displayWidth) && (bagSize.displayWidth ?? 0) > 0 ? bagSize.displayWidth! : 32 * bag.viewScale,
            bagHeight: Number.isFinite(bagSize.displayHeight) && (bagSize.displayHeight ?? 0) > 0 ? bagSize.displayHeight! : 38 * bag.viewScale,
            labelWidth: labelBounds.width,
            labelHeight: labelBounds.height,
            region: anchors.region,
            preferredSide: bag.x <= anchors.region.centerX ? 'left' : 'right',
            clampToRegion,
        });
        sign.x = position.x;
        sign.y = position.y;
        sign.view.setPosition(sign.x, sign.y);
    }

    private updateFinancialLabels(anchors: Record<Side, MoneyFlowAnchors>): void {
        this.signs.forEach(sign => {
            if (!sign.active) return;
            const bag = this.mutableBag(sign.bagId);
            if (!bag || bag.state === 'REMOVED' || bag.financialLabel !== sign) {
                this.releaseFinancialLabel(sign, bag);
                return;
            }
            this.positionFinancialLabel(sign, bag, anchors[bag.side], bag.state !== 'CARRIED');
            const visible = sign.text.length > 0
                && sign.carriedVisible
                && bag.viewAlpha > .01
                && (bag.state === 'CARRIED' || bag.view.visible);
            sign.view.setAlpha(visible ? bag.viewAlpha : 0).setVisible(visible);
            sign.view.setScale(1);
        });
    }

    private applyBagView(bag: BagParticle, scale: number, alpha: number): void {
        bag.viewScale = scale;
        bag.viewAlpha = alpha;
        bag.view.setPosition(bag.x, bag.y).setScale(scale).setAlpha(alpha).setVisible(alpha > .01);
        if (!this.spriteMode) return;
        const progress = bag.visualPhase === 'flying' || bag.visualPhase === 'descending'
            ? clamp(bag.age / bag.fallDuration)
            : bag.visualPhase === 'landing' ? clamp(bag.phaseAge / BAG_LANDING_MS)
                : bag.visualPhase === 'absorbed' ? clamp(bag.phaseAge / BAG_ABSORB_MS) : 0;
        (bag.view as PhaserTypes.GameObjects.Sprite).setFrame(
            bagFrameForPhase(bag.visualPhase, this.reducedMotion ? 0 : progress));
    }

    availableBags(side: Side): readonly CollectibleMoneyBag[] {
        const result: CollectibleMoneyBag[] = [];
        this.bags.forEach(bag => { if (bag.active && bag.side === side && bag.state === 'AVAILABLE') result.push(bag); });
        return result;
    }

    bagById(bagId: number): CollectibleMoneyBag | undefined {
        let found: BagParticle | undefined;
        this.bags.forEach(bag => { if (bag.active && bag.id === bagId) found = bag; });
        return found;
    }

    reserveBag(bagId: number, collectorId: string): boolean {
        const bag = this.mutableBag(bagId);
        if (!bag || bag.state !== 'AVAILABLE' || bag.ownerId) return false;
        bag.state = 'RESERVED';
        bag.ownerId = collectorId;
        return true;
    }

    beginCollection(bagId: number, collectorId: string): boolean {
        const bag = this.mutableBag(bagId);
        if (!bag || bag.state !== 'RESERVED' || bag.ownerId !== collectorId) return false;
        bag.state = 'COLLECTING';
        return true;
    }

    markCarried(bagId: number, collectorId: string): boolean {
        const bag = this.mutableBag(bagId);
        if (!bag || bag.state !== 'COLLECTING' || bag.ownerId !== collectorId) return false;
        bag.state = 'CARRIED';
        bag.visualPhase = 'carried';
        // The collector sprites already carry the bag in their frames; showing
        // the loose sprite again would duplicate it.
        bag.view.setVisible(false);
        return true;
    }

    completeCollection(bagId: number, collectorId: string): void {
        const bag = this.mutableBag(bagId);
        if (!bag || bag.ownerId !== collectorId) return;
        // A negative bag only burns once, at the demon portal, after the
        // handoff completed; landing and availability never consume its frames.
        if (!bag.positive && bag.state === 'CARRIED')
            this.terminalFx.spawn(bag.x, bag.groundY || bag.y, bag.baseScale, 'burn');
        this.removeBag(bag);
    }

    trackCarried(bagId: number, collectorId: string, x: number, y: number, visible = true): void {
        const bag = this.mutableBag(bagId);
        if (!bag || bag.state !== 'CARRIED' || bag.ownerId !== collectorId) return;
        bag.x = x;
        bag.y = y;
        if (bag.financialLabel) bag.financialLabel.carriedVisible = visible;
    }

    releaseReservation(bagId: number, collectorId: string): void {
        const bag = this.mutableBag(bagId);
        if (!bag || bag.ownerId !== collectorId || bag.state === 'CARRIED') return;
        bag.state = 'AVAILABLE';
        bag.ownerId = undefined;
        bag.view.setVisible(true).setAlpha(1);
        bag.viewAlpha = 1;
    }

    private mutableBag(bagId: number): BagParticle | undefined {
        let found: BagParticle | undefined;
        this.bags.forEach(bag => { if (bag.active && bag.id === bagId) found = bag; });
        return found;
    }

    private makeAvailable(bag: BagParticle, windowMs: number): void {
        bag.state = 'AVAILABLE';
        bag.availableAge = 0;
        bag.lifetime = bag.age + windowMs;
        // Only a bag that actually reached the floor plays the impact.  A
        // positive bag stays airborne and is absorbed by the candle, so it
        // floats on the last aerial frame and never shows a landing plate.
        bag.visualPhase = bag.positive ? 'floating' : 'landing';
        bag.phaseAge = 0;
        bag.restY = bag.y;
        bag.viewScale = bag.baseScale;
        bag.viewAlpha = 1;
        bag.view.setScale(bag.baseScale).setAlpha(1).setVisible(true);
    }

    /** Expiry ending: the bag is released and a terminal effect plays in place. */
    private terminateBag(bag: BagParticle): void {
        this.terminalFx.spawn(bag.x, bag.y, bag.baseScale, bag.positive ? 'sparkle' : 'burn');
        this.removeBag(bag);
    }

    private removeBag(bag: BagParticle): void {
        bag.state = 'REMOVED';
        bag.ownerId = undefined;
        bag.view.setVisible(false);
        this.releaseFinancialLabel(bag.financialLabel, bag);
        this.bags.release(bag);
    }

    /** Idempotent release for the one label owned by a bag. */
    private releaseFinancialLabel(sign: SignParticle | undefined, bag?: BagParticle): void {
        if (!sign?.active) {
            if (bag && bag.financialLabel === sign) bag.financialLabel = undefined;
            return;
        }
        if (bag && bag.financialLabel === sign) bag.financialLabel = undefined;
        sign.bagId = 0;
        sign.carriedVisible = false;
        sign.view.setVisible(false).setAlpha(0);
        this.signs.release(sign);
    }

    private inspectBags(): object[] {
        const result: object[] = [];
        this.bags.forEach(bag => {
            if (bag.active) result.push({
                id: bag.id, side: bag.side, polarity: bag.positive ? 'positive' : 'negative',
                state: bag.state, visualPhase: bag.visualPhase,
                frame: this.spriteMode
                    ? String((bag.view as PhaserTypes.GameObjects.Sprite).frame?.name ?? '')
                    : 'procedural',
                age: bag.age, availableAge: bag.availableAge,
                ownerId: bag.ownerId ?? null, x: bag.x, y: bag.y,
            });
        });
        return result;
    }

    private inspectSigns(): object[] {
        const result: object[] = [];
        this.signs.forEach(sign => {
            if (!sign.active) return;
            const bag = this.mutableBag(sign.bagId);
            result.push({
                bagId: sign.bagId,
                polarity: sign.positive ? 'positive' : 'negative',
                frame: sign.text,
                x: sign.x, y: sign.y,
                visible: sign.view.visible,
                bagState: bag?.state ?? 'REMOVED',
            });
        });
        return result;
    }

    private random(side: Side): number {
        const seed = (this.matchId ?? 0) * 1103515245 + (++this.particleSequence) * 12345 + (side === 'left' ? 17 : 97);
        const value = Math.sin(seed) * 43758.5453123;
        return value - Math.floor(value);
    }

    private clearParticles(): void {
        this.collectors.reset();
        this.terminalFx.clear();
        this.bags.forEach(bag => {
            bag.state = 'REMOVED'; bag.ownerId = undefined; bag.visualPhase = 'flying';
            bag.view.setVisible(false);
            this.releaseFinancialLabel(bag.financialLabel, bag);
        });
        this.bags.releaseAll();
        this.signs.forEach(sign => this.releaseFinancialLabel(sign));
        this.signs.releaseAll();
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
