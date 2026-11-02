import { getMoneyFlowBuffer, inspectMoneyFlowBuffer } from './money-flow.js?v=20261102a';
import { CollectorController, normalizeCollectorQuality, } from './money-flow-collectors.js?v=20261102a';
import { ACCENT_LOOP_MS, BAG_ABSORB_MS, BAG_LANDING_MS, MONEY_FLOW_EFFECTS_ATLAS, MoneyFlowTerminalFx, accentFrameFor, bagFrameForPhase, moneyFlowEffectsAvailable, prepareMoneyFlowEffectsTextures, } from './money-flow-effects-renderer.js?v=20261102a';
const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));
const finite = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
};
/** Price movement is authoritative for the visual direction; quote flow only weights its strength. */
export function decideMoneyFlow(batch, previousPrice) {
    const first = finite(batch.firstPrice);
    const last = finite(batch.lastPrice);
    if (first <= 0 || last <= 0)
        return { direction: 'neutral', intensity: 0 };
    // A 250ms window may contain only one trade, in which case first === last.
    // Compare it to the preceding valid observation rather than discarding it.
    const baseline = previousPrice != null && previousPrice > 0 ? previousPrice : first;
    if (last === baseline)
        return { direction: 'neutral', intensity: 0 };
    const relativeMove = Math.abs(last - baseline) / Math.max(Math.abs(baseline), Number.EPSILON);
    // Sub-precision jitter is not market movement: keep the flow neutral
    // instead of flickering signs over float noise.
    if (relativeMove < 1e-9)
        return { direction: 'neutral', intensity: 0 };
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
    constructor() {
        this.positiveEnergy = 0;
        this.negativeEnergy = 0;
        this.accumulator = 0;
        this.displayedCandle = .5;
    }
    ingest(batch) {
        const last = finite(batch.lastPrice);
        const decision = decideMoneyFlow(batch, this.lastObservedPrice);
        // Establish a baseline from the first valid observation without
        // inventing movement; subsequent one-trade batches use this reference.
        if (last > 0)
            this.lastObservedPrice = last;
        if (decision.direction === 'positive') {
            this.positiveEnergy = clamp(this.positiveEnergy + decision.intensity);
            this.accumulator = clamp(this.accumulator + decision.intensity * .38, -1, 1);
        }
        else if (decision.direction === 'negative') {
            this.negativeEnergy = clamp(this.negativeEnergy + decision.intensity);
            this.accumulator = clamp(this.accumulator - decision.intensity * .38, -1, 1);
        }
        return decision;
    }
    advance(deltaMs) {
        const seconds = Math.max(0, Math.min(100, deltaMs)) / 1000;
        // Exponential decay avoids frame-rate-dependent visual energy.
        const decay = Math.exp(-seconds * 1.35);
        this.positiveEnergy *= decay;
        this.negativeEnergy *= decay;
        this.accumulator *= Math.exp(-seconds * .22);
        const target = clamp(.5 + this.accumulator * .42, .16, .84);
        this.displayedCandle += (target - this.displayedCandle) * (1 - Math.exp(-seconds * 7));
    }
    get positive() { return this.positiveEnergy; }
    get negative() { return this.negativeEnergy; }
    get displayed() { return this.displayedCandle; }
    get accumulatorValue() { return this.accumulator; }
    get referencePrice() { return this.lastObservedPrice; }
    snapshot() {
        return {
            positiveEnergy: this.positiveEnergy,
            negativeEnergy: this.negativeEnergy,
            accumulator: this.accumulator,
            displayedCandle: this.displayedCandle,
            referencePrice: this.lastObservedPrice
        };
    }
    reset() {
        this.positiveEnergy = 0;
        this.negativeEnergy = 0;
        this.accumulator = 0;
        this.displayedCandle = .5;
        this.lastObservedPrice = undefined;
    }
}
/** A fixed-capacity pool. Released instances are reused instead of recreated for each batch. */
export class ReusablePool {
    constructor(capacity, create) {
        this.capacity = capacity;
        this.create = create;
        this.items = [];
    }
    acquire() {
        const reusable = this.items.find(item => !item.active);
        if (reusable) {
            reusable.active = true;
            return reusable;
        }
        if (this.items.length >= this.capacity)
            return undefined;
        const item = this.create();
        item.active = true;
        this.items.push(item);
        return item;
    }
    release(item) { item.active = false; }
    releaseAll() { for (const item of this.items)
        item.active = false; }
    get activeCount() { return this.items.filter(item => item.active).length; }
    get size() { return this.items.length; }
    forEach(callback) { this.items.forEach(callback); }
}
/**
 * Protected central zone of a fighter: the candle body and face must stay
 * readable. Bags spawn and settle on the lateral lanes instead of dropping on
 * top of the character, then positive bags converge on the hands to be
 * absorbed.
 */
function protectedHalf(region) {
    return region.fighterWidth * .55;
}
/** Lateral lane at `t` (0 = nearest the fighter, 1 = outer edge), away from centre. */
function lateralX(region, towardLeft, t) {
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
export function planBagSpawn(positive, anchors, randoms) {
    const region = anchors.region;
    const rand = (index) => randoms[index] ?? .5;
    const triangle = (rand(0) + rand(1)) / 2;
    const offset = (triangle - .5) * 2;
    const sway = (rand(4) - .5) * (positive ? 14 : 8);
    if (positive) {
        // Descend beside the fighter, then converge on the hands to be
        // absorbed: the bag is never left sitting on the face.
        const x = lateralX(region, offset < 0, Math.abs(offset));
        const y = region.top + rand(2) * Math.max(8, anchors.body.y - region.top) * .6;
        const targetX = Math.max(region.left, Math.min(region.right, anchors.hands.x + (rand(3) - .5) * region.fighterWidth * 1.25));
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
const SIDES = ['left', 'right'];
/**
 * Presentation-only Phaser layer for live Money Flow. It owns no match data,
 * score, combat state or OHLC; all of its state can be discarded at any time.
 */
export class MoneyFlowController {
    constructor(scene, options = {}) {
        this.scene = scene;
        this.symbols = { left: '', right: '' };
        this.lastSequence = new Map();
        this.enabled = false;
        this.particleSequence = 0;
        this.collectorsConfigured = options.collectorsEnabled === true;
        this.reducedMotion = options.reducedMotion === true;
        // Real atlas sprites are the primary rendering path; the procedural
        // drawing below only runs when the optional atlas failed to load.
        this.spriteMode = moneyFlowEffectsAvailable(scene);
        if (this.spriteMode)
            prepareMoneyFlowEffectsTextures(scene);
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
            baseScale: 1, viewScale: 1, viewAlpha: 1
        }));
        this.signs = new ReusablePool(MAX_SIGNS_PER_SIDE * 2, () => ({
            active: false, view: this.createSignView(), positive: true, side: 'left',
            age: 0, lifetime: 0, x: 0, y: 0, vx: 0, vy: 0, offsetX: 0, offsetY: 0
        }));
        this.collectors = new CollectorController(scene, this, {
            enabled: this.collectorsConfigured,
            quality: normalizeCollectorQuality(options.collectorQuality),
            reducedMotion: options.reducedMotion === true,
        });
    }
    createBagView() {
        return this.spriteMode
            ? this.scene.add.sprite(0, 0, MONEY_FLOW_EFFECTS_ATLAS, 'bag-fall-1')
                .setOrigin(.5, 1).setDepth(12).setVisible(false)
            : this.scene.add.graphics().setDepth(12).setVisible(false);
    }
    createSignView() {
        return this.spriteMode
            ? this.scene.add.sprite(0, 0, MONEY_FLOW_EFFECTS_ATLAS, 'positive-coins-1')
                .setOrigin(.5, .5).setDepth(13).setVisible(false)
            : this.scene.add.text(0, 0, '+', {
                fontFamily: 'monospace', fontSize: '28px', fontStyle: 'bold', color: '#b8ff64',
                stroke: '#071317', strokeThickness: 4
            }).setOrigin(.5).setDepth(13).setVisible(false);
    }
    setLiveMatch(matchId, leftSymbol, rightSymbol, enabled) {
        const changed = this.matchId !== matchId || this.symbols.left !== leftSymbol || this.symbols.right !== rightSymbol;
        const enabledChanged = this.enabled !== enabled;
        this.matchId = matchId;
        this.symbols = { left: leftSymbol.toUpperCase(), right: rightSymbol.toUpperCase() };
        this.enabled = enabled;
        if (changed)
            this.reset();
        if (!enabled && enabledChanged)
            this.clearParticles();
        this.collectors.setEnabled(enabled && this.collectorsConfigured);
        if (enabled)
            this.consumeBufferedBatches();
    }
    setEnabled(enabled) {
        this.enabled = enabled;
        this.collectors.setEnabled(enabled && this.collectorsConfigured);
        if (!enabled)
            this.clearParticles();
    }
    setReducedMotion(reduced) {
        this.reducedMotion = reduced === true;
        this.collectors.setReducedMotion(reduced);
        this.terminalFx.setReducedMotion(reduced);
    }
    update(deltaMs, left, right, allowCollectors = true) {
        if (!this.enabled || !this.matchId)
            return;
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
            const positiveDominant = fx.state.positive >= fx.state.negative;
            if (positiveDominant && fx.state.positive > .055 && fx.positiveCooldown === 0) {
                const bag = this.spawnBag(side, true, anchors[side], fx.state.positive);
                this.spawnSign(side, true, bag, anchors[side]);
                // Higher energy emits more often, within the hard object limits.
                fx.positiveCooldown = 240 + (1 - fx.state.positive) * 260;
            }
            if (!positiveDominant && fx.state.negative > .055 && fx.negativeCooldown === 0) {
                const bag = this.spawnBag(side, false, anchors[side], fx.state.negative);
                this.spawnSign(side, false, bag, anchors[side]);
                fx.negativeCooldown = 260 + (1 - fx.state.negative) * 270;
            }
        }
        this.updateBags(deltaMs, anchors);
        this.updateSigns(deltaMs, anchors);
        this.terminalFx.update(deltaMs);
        this.collectors.update(deltaMs, {
            allowSpawn: allowCollectors,
            anchors,
            energy: {
                left: { positive: this.effects.left.state.positive, negative: this.effects.left.state.negative },
                right: { positive: this.effects.right.state.positive, negative: this.effects.right.state.negative },
            },
        });
    }
    inspect() {
        return {
            active: this.enabled,
            matchId: this.matchId ?? null,
            bags: this.bags.activeCount,
            signs: this.signs.activeCount,
            bagPoolSize: this.bags.size,
            signPoolSize: this.signs.size,
            renderMode: this.spriteMode ? 'sprites' : 'procedural',
            reducedMotion: this.reducedMotion,
            terminalFx: this.terminalFx.activeCount,
            bagStates: this.inspectBags(),
            signStates: this.inspectSigns(),
            collectors: this.collectors.inspect(),
            buffer: this.matchId ? inspectMoneyFlowBuffer(this.matchId) : null,
            left: this.effects.left.state.snapshot(),
            right: this.effects.right.state.snapshot()
        };
    }
    reset() {
        this.collectors.reset();
        this.lastSequence.clear();
        this.particleSequence = 0;
        this.clearParticles();
        for (const side of SIDES)
            this.effects[side].state.reset();
    }
    destroy() {
        this.reset();
        this.collectors.destroy();
        this.terminalFx.destroy();
        this.bags.forEach(item => item.view.destroy());
        this.signs.forEach(item => item.view.destroy());
        for (const side of SIDES)
            this.effects[side].glow.destroy();
    }
    createSideFx() {
        return { state: new MoneyFlowVisualState(), glow: this.scene.add.graphics().setDepth(3).setVisible(false), positiveCooldown: 0, negativeCooldown: 0 };
    }
    consumeBufferedBatches() {
        if (!this.matchId)
            return;
        const left = this.symbols.left, right = this.symbols.right;
        for (const batch of getMoneyFlowBuffer(this.matchId)) {
            const symbol = batch.symbol.toUpperCase();
            const sides = [];
            if (symbol === left)
                sides.push('left');
            if (symbol === right)
                sides.push('right');
            for (const side of sides) {
                const key = `${side}:${batch.symbol}`;
                if ((this.lastSequence.get(key) ?? 0) >= batch.sequence)
                    continue;
                this.lastSequence.set(key, batch.sequence);
                this.effects[side].state.ingest(batch);
            }
        }
    }
    spawnBag(side, positive, anchors, energy) {
        let activeForSide = 0;
        this.bags.forEach(item => { if (item.active && item.side === side)
            activeForSide++; });
        if (activeForSide >= MAX_BAGS_PER_SIDE)
            return undefined;
        const bag = this.bags.acquire();
        if (!bag)
            return undefined;
        const plan = planBagSpawn(positive, anchors, [
            this.random(side), this.random(side), this.random(side), this.random(side), this.random(side)
        ]);
        bag.id = ++this.particleSequence;
        bag.side = side;
        bag.positive = positive;
        bag.age = 0;
        bag.availableAge = 0;
        bag.ownerId = undefined;
        bag.state = 'FLOWING';
        bag.visualPhase = 'flying';
        bag.phaseAge = 0;
        bag.fallDuration = plan.fallDuration;
        bag.lifetime = plan.fallDuration + (positive ? 250 : 1450);
        bag.x = plan.x;
        bag.y = plan.y;
        bag.startX = plan.x;
        bag.startY = plan.y;
        bag.targetX = plan.targetX;
        bag.targetY = plan.targetY;
        bag.restY = plan.targetY;
        bag.groundY = anchors.ground.y;
        bag.phase = plan.sway;
        bag.baseScale = clamp(anchors.region.fighterHeight / 290, .55, 1) * (.92 + energy * .16);
        if (this.spriteMode) {
            bag.view.setFrame(bagFrameForPhase('flying', 0));
        }
        else {
            this.drawBag(bag.view, positive);
        }
        this.applyBagView(bag, bag.baseScale, 1);
        return bag;
    }
    spawnSign(side, positive, bag, anchors) {
        let activeForSide = 0;
        this.signs.forEach(item => { if (item.active && item.side === side)
            activeForSide++; });
        if (activeForSide >= MAX_SIGNS_PER_SIDE)
            return;
        const sign = this.signs.acquire();
        if (!sign)
            return;
        const randomA = this.random(side), randomB = this.random(side);
        sign.side = side;
        sign.positive = positive;
        sign.age = 0;
        sign.lifetime = 1100;
        sign.offsetX = (randomA - .5) * 88 + (positive ? 34 : -34);
        sign.offsetY = -10 - randomB * 30;
        sign.followBagId = bag?.id;
        sign.x = bag ? bag.x + sign.offsetX : anchors.body.x + (randomA - .5) * 120;
        sign.y = bag ? bag.y + sign.offsetY : positive ? anchors.head.y + 40 : anchors.body.y + 30;
        sign.vx = (randomB - .5) * 18;
        sign.vy = positive ? -30 : 24;
        if (this.spriteMode) {
            sign.view
                .setTexture(MONEY_FLOW_EFFECTS_ATLAS, accentFrameFor(positive, 0))
                .setScale(.38).setAlpha(.95).setPosition(sign.x, sign.y).setVisible(true);
        }
        else {
            sign.view.setText(positive ? '+' : '\u2212')
                .setColor(positive ? '#b9ff69' : '#ff7777')
                .setPosition(sign.x, sign.y).setAlpha(.95).setVisible(true);
        }
    }
    updateBags(deltaMs, anchors) {
        this.bags.forEach(bag => {
            if (!bag.active)
                return;
            bag.age += deltaMs;
            if (bag.state === 'CARRIED')
                return;
            if (bag.state === 'AVAILABLE')
                bag.availableAge += deltaMs;
            if (bag.visualPhase === 'landing') {
                bag.phaseAge += deltaMs;
                if (bag.phaseAge >= BAG_LANDING_MS) {
                    bag.visualPhase = 'resting';
                    bag.phaseAge = 0;
                }
            }
            if (bag.state !== 'FLOWING') {
                if (bag.positive && bag.state !== 'AVAILABLE') {
                    // Mid-collection the bag stays with the fighter's hands.
                    const target = anchors[bag.side].hands;
                    bag.x += (target.x - bag.x) * .16;
                    bag.y += (target.y + 34 - bag.y) * .16;
                }
                else if (bag.positive && bag.visualPhase === 'resting') {
                    // Available bags rest where they landed: independent objects
                    // spread around the fighter until an angel claims one.
                    bag.y = bag.restY + Math.sin(bag.phase + bag.age / 520) * 3;
                }
                this.applyBagView(bag, bag.viewScale, bag.viewAlpha);
                if (bag.state === 'AVAILABLE' && bag.age >= bag.lifetime)
                    this.terminateBag(bag);
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
                if (t >= 1 && this.collectors.available)
                    this.makeAvailable(bag, 3500);
                else {
                    bag.viewScale = bag.baseScale * (1 - t * .18);
                    bag.viewAlpha = Math.max(0, 1 - Math.max(0, bag.age - fallDuration) / 250);
                }
            }
            else {
                // Money leaves the fighter under light gravity, settles near
                // the feet briefly, then is removed in a controlled fade.
                const fallDuration = bag.fallDuration;
                const t = clamp(bag.age / fallDuration);
                const gravity = t * t;
                bag.targetY = anchors[bag.side].region.floorY;
                bag.x = bag.startX + (bag.targetX - bag.startX) * gravity + Math.sin(bag.phase + t * Math.PI * 2) * 4 * (1 - t);
                bag.y = bag.startY + (bag.targetY - bag.startY) * gravity;
                const settled = t >= 1;
                if (settled && this.collectors.available)
                    this.makeAvailable(bag, 4000);
                else {
                    bag.viewScale = bag.baseScale * (settled ? .96 : 1.04);
                    bag.viewAlpha = settled
                        ? Math.max(0, 1 - Math.max(0, bag.age - fallDuration - 900) / 550)
                        : 1;
                }
            }
            this.applyBagView(bag, bag.viewScale, bag.viewAlpha);
            if (bag.age >= bag.lifetime)
                this.terminateBag(bag);
        });
    }
    updateSigns(deltaMs, anchors) {
        this.signs.forEach(sign => {
            if (!sign.active)
                return;
            sign.age += deltaMs;
            const bag = sign.followBagId != null ? this.mutableBag(sign.followBagId) : undefined;
            if (bag && bag.state !== 'CARRIED' && bag.state !== 'REMOVED') {
                sign.x = bag.x + sign.offsetX;
                sign.y = bag.y + sign.offsetY + Math.sin(sign.age / 300) * 4;
            }
            else {
                sign.followBagId = undefined;
                sign.x += sign.vx * deltaMs / 1000;
                sign.y += sign.vy * deltaMs / 1000;
            }
            const region = anchors[sign.side].region;
            sign.x = Math.max(region.left, Math.min(region.right, sign.x));
            sign.y = Math.max(region.top - 44, Math.min(region.floorY + 40, sign.y));
            sign.view.setPosition(sign.x, sign.y).setAlpha(Math.max(0, 1 - sign.age / sign.lifetime));
            if (this.spriteMode) {
                sign.view.setFrame(this.reducedMotion
                    ? accentFrameFor(sign.positive, 0)
                    : accentFrameFor(sign.positive, (sign.age % ACCENT_LOOP_MS) / ACCENT_LOOP_MS));
            }
            if (sign.age >= sign.lifetime) {
                sign.view.setVisible(false);
                this.signs.release(sign);
            }
        });
    }
    applyBagView(bag, scale, alpha) {
        bag.viewScale = scale;
        bag.viewAlpha = alpha;
        bag.view.setPosition(bag.x, bag.y).setScale(scale).setAlpha(alpha).setVisible(alpha > .01);
        if (!this.spriteMode)
            return;
        const progress = bag.visualPhase === 'flying' || bag.visualPhase === 'descending'
            ? clamp(bag.age / bag.fallDuration)
            : bag.visualPhase === 'landing' ? clamp(bag.phaseAge / BAG_LANDING_MS)
                : bag.visualPhase === 'absorbed' ? clamp(bag.phaseAge / BAG_ABSORB_MS) : 0;
        bag.view.setFrame(bagFrameForPhase(bag.visualPhase, this.reducedMotion ? 0 : progress));
    }
    availableBags(side) {
        const result = [];
        this.bags.forEach(bag => { if (bag.active && bag.side === side && bag.state === 'AVAILABLE')
            result.push(bag); });
        return result;
    }
    bagById(bagId) {
        let found;
        this.bags.forEach(bag => { if (bag.active && bag.id === bagId)
            found = bag; });
        return found;
    }
    reserveBag(bagId, collectorId) {
        const bag = this.mutableBag(bagId);
        if (!bag || bag.state !== 'AVAILABLE' || bag.ownerId)
            return false;
        bag.state = 'RESERVED';
        bag.ownerId = collectorId;
        return true;
    }
    beginCollection(bagId, collectorId) {
        const bag = this.mutableBag(bagId);
        if (!bag || bag.state !== 'RESERVED' || bag.ownerId !== collectorId)
            return false;
        bag.state = 'COLLECTING';
        return true;
    }
    markCarried(bagId, collectorId) {
        const bag = this.mutableBag(bagId);
        if (!bag || bag.state !== 'COLLECTING' || bag.ownerId !== collectorId)
            return false;
        bag.state = 'CARRIED';
        bag.visualPhase = 'carried';
        // The collector sprites already carry the bag in their frames; showing
        // the loose sprite again would duplicate it.
        bag.view.setVisible(false);
        return true;
    }
    completeCollection(bagId, collectorId) {
        const bag = this.mutableBag(bagId);
        if (!bag || bag.ownerId !== collectorId)
            return;
        // A negative bag only burns once, at the demon portal, after the
        // handoff completed; landing and availability never consume its frames.
        if (!bag.positive && bag.state === 'CARRIED')
            this.terminalFx.spawn(bag.x, bag.groundY || bag.y, bag.baseScale, 'burn');
        this.removeBag(bag);
    }
    trackCarried(bagId, collectorId, x, y) {
        const bag = this.mutableBag(bagId);
        if (!bag || bag.state !== 'CARRIED' || bag.ownerId !== collectorId)
            return;
        bag.x = x;
        bag.y = y;
    }
    releaseReservation(bagId, collectorId) {
        const bag = this.mutableBag(bagId);
        if (!bag || bag.ownerId !== collectorId || bag.state === 'CARRIED')
            return;
        bag.state = 'AVAILABLE';
        bag.ownerId = undefined;
        bag.view.setVisible(true).setAlpha(1);
        bag.viewAlpha = 1;
    }
    mutableBag(bagId) {
        let found;
        this.bags.forEach(bag => { if (bag.active && bag.id === bagId)
            found = bag; });
        return found;
    }
    makeAvailable(bag, windowMs) {
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
    terminateBag(bag) {
        this.terminalFx.spawn(bag.x, bag.y, bag.baseScale, bag.positive ? 'sparkle' : 'burn');
        this.removeBag(bag);
    }
    removeBag(bag) {
        bag.state = 'REMOVED';
        bag.ownerId = undefined;
        bag.view.setVisible(false);
        this.bags.release(bag);
    }
    inspectBags() {
        const result = [];
        this.bags.forEach(bag => {
            if (bag.active)
                result.push({
                    id: bag.id, side: bag.side, polarity: bag.positive ? 'positive' : 'negative',
                    state: bag.state, visualPhase: bag.visualPhase,
                    frame: this.spriteMode
                        ? String(bag.view.frame?.name ?? '')
                        : 'procedural',
                    age: bag.age, availableAge: bag.availableAge,
                    ownerId: bag.ownerId ?? null, x: bag.x, y: bag.y,
                });
        });
        return result;
    }
    inspectSigns() {
        const result = [];
        this.signs.forEach(sign => {
            if (!sign.active)
                return;
            result.push({
                polarity: sign.positive ? 'positive' : 'negative',
                frame: this.spriteMode
                    ? String(sign.view.frame?.name ?? '')
                    : sign.positive ? '+' : '\u2212',
                x: sign.x, y: sign.y,
            });
        });
        return result;
    }
    random(side) {
        const seed = (this.matchId ?? 0) * 1103515245 + (++this.particleSequence) * 12345 + (side === 'left' ? 17 : 97);
        const value = Math.sin(seed) * 43758.5453123;
        return value - Math.floor(value);
    }
    clearParticles() {
        this.collectors.reset();
        this.terminalFx.clear();
        this.bags.forEach(bag => {
            bag.state = 'REMOVED';
            bag.ownerId = undefined;
            bag.visualPhase = 'flying';
            bag.view.setVisible(false);
        });
        this.bags.releaseAll();
        this.signs.forEach(sign => { sign.followBagId = undefined; sign.view.setVisible(false); });
        this.signs.releaseAll();
        for (const side of SIDES)
            this.effects[side].glow.setVisible(false);
    }
    drawBag(graphic, positive) {
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
    drawGlow(fx, anchorX, anchorY) {
        const energy = Math.max(fx.state.positive, fx.state.negative);
        if (energy < .03) {
            fx.glow.setVisible(false);
            return;
        }
        const color = fx.state.positive >= fx.state.negative ? 0xa4ee56 : 0xf06c6c;
        fx.glow.clear().setVisible(true).fillStyle(color, .035 + energy * .07).fillCircle(anchorX, anchorY + 22, 35 + energy * 28);
    }
}
