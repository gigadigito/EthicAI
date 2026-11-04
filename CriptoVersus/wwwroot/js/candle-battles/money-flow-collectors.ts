import type PhaserTypes from 'phaser';
import type { Side } from './model.js';
import {
    CollectorAnimationState,
    CollectorCarriedBagBounds,
    CollectorRenderer,
    Direction,
    collectorAtlasesAvailable,
} from './money-flow-collector-renderer.js';

export type CollectorQuality = 'low' | 'medium' | 'high';
export type BagCollectionState = 'FLOWING' | 'AVAILABLE' | 'RESERVED' | 'COLLECTING' | 'CARRIED' | 'REMOVED';

export interface CollectibleMoneyBag {
    id: number;
    active: boolean;
    side: Side;
    positive: boolean;
    state: BagCollectionState;
    age: number;
    availableAge: number;
    x: number;
    y: number;
    /** Quote volume represented by this visual parcel; never a scoring value. */
    amount?: number;
    currency?: string;
    intensity?: number;
    sizeCategory?: 'small' | 'medium' | 'large' | 'very-large';
    ownerId?: string;
}

export interface MoneyFlowBagHost {
    availableBags(side: Side): readonly CollectibleMoneyBag[];
    reserveBag(bagId: number, collectorId: string): boolean;
    beginCollection(bagId: number, collectorId: string): boolean;
    markCarried(bagId: number, collectorId: string): boolean;
    completeCollection(bagId: number, collectorId: string): void;
    releaseReservation(bagId: number, collectorId: string): void;
    bagById(bagId: number): CollectibleMoneyBag | undefined;
    /** Keeps a carried bag's coordinates and visibility on the collector. */
    trackCarried?(bagId: number, collectorId: string, x: number, y: number, visible?: boolean, visualBounds?: CollectorCarriedBagBounds | null): void;
}

export interface MoneyFlowAnchorPoint { x: number; y: number; }

/** Fighter-relative emission/collection envelope, clamped to the arena half and UI margins. */
export interface MoneyFlowRegion {
    centerX: number;
    left: number;
    right: number;
    /** Highest legal bag bottom-anchor: clears the top HUD panel and labels. */
    top: number;
    floorY: number;
    fighterWidth: number;
    fighterHeight: number;
}

export interface MoneyFlowAnchors {
    head: MoneyFlowAnchorPoint;
    body: MoneyFlowAnchorPoint;
    hands: MoneyFlowAnchorPoint;
    feet: MoneyFlowAnchorPoint;
    ground: MoneyFlowAnchorPoint;
    collectionBounds: { left: number; right: number; top: number; bottom: number };
    region: MoneyFlowRegion;
}

export interface MoneyFlowAnchorsInput {
    side: Side;
    centreX: number;
    groundY: number;
    /** Fighter presentation scale; anchor offsets were tuned at 0.8. */
    fighterScale?: number;
    laneLeft: number;
    laneRight: number;
}

const ARENA_SAFE_LEFT = { left: 180, right: 560 };
const ARENA_SAFE_RIGHT = { left: 720, right: 1100 };
/** Bottom of the fixed top HUD panel (24..178) plus one bag body height. */
const HUD_PANEL_CLEARANCE_Y = 252;

/**
 * Single builder for the dynamic money-flow region. Anchor offsets scale with
 * the fighter sprite so shell mode (1.55) no longer reports head/hands inside
 * the character. Horizontal reach is 1.5-2x the fighter width per side before
 * the arena-half and UI margins clamp it. The spawn ceiling stays under the
 * fixed HUD panel and, on taller fighters, just above their head.
 */
export function buildMoneyFlowAnchors(input: MoneyFlowAnchorsInput): MoneyFlowAnchors {
    const scale = input.fighterScale ?? .8;
    const unit = scale / .8;
    const fighterWidth = 200 * scale;
    const fighterHeight = 200 * scale;
    const { centreX, groundY, side } = input;
    const safe = side === 'left' ? ARENA_SAFE_LEFT : ARENA_SAFE_RIGHT;
    const regionLeft = Math.max(input.laneLeft, safe.left);
    const regionRight = Math.min(input.laneRight, safe.right);
    const extension = fighterWidth * 1.75;
    const headY = groundY - 165 * unit;
    const region: MoneyFlowRegion = {
        centerX: centreX,
        left: Math.max(regionLeft, centreX - Math.min(extension, centreX - regionLeft)),
        right: Math.min(regionRight, centreX + Math.min(extension, regionRight - centreX)),
        top: Math.min(HUD_PANEL_CLEARANCE_Y, headY + 40),
        floorY: groundY + 4,
        fighterWidth,
        fighterHeight,
    };
    return {
        head: { x: centreX, y: headY },
        body: { x: centreX, y: groundY - 90 * unit },
        hands: { x: centreX + (side === 'left' ? 28 : -28) * unit, y: groundY - 92 * unit },
        feet: { x: centreX, y: groundY - 4 * unit },
        ground: { x: centreX, y: groundY + 4 },
        collectionBounds: {
            left: input.laneLeft,
            right: input.laneRight,
            top: 20,
            bottom: Math.min(460, groundY + 12),
        },
        region,
    };
}

export interface CollectorArenaFrame {
    allowSpawn: boolean;
    anchors: Record<Side, MoneyFlowAnchors>;
    energy: Record<Side, { positive: number; negative: number }>;
}

/**
 * Chosen side of the fighter for a money bag.
 *
 * The candle's body and face are the protected central zone.  Bags descend and
 * settle laterally so they never cover the character, while still converging on
 * the hands when they are absorbed.
 */
export function pickLateralX(region: MoneyFlowRegion, side: Side, seed: number): number {
    const centre = region.centerX;
    const half = region.fighterWidth * .55;
    // Two lateral lanes outside the protected core, biased away from the
    // arena centre so bags never pile up on the fighter.
    const outer = side === 'left' ? region.left + 18 : region.right - 18;
    const inner = side === 'left' ? centre - half : centre + half;
    const t = ((seed % 100) / 100) * .75 + .25;
    return clamp(inner + (outer - inner) * t, region.left, region.right);
}

interface Cycle {
    id: string;
    side: Side;
    positive: boolean;
    bagId: number;
    state: CollectorAnimationState;
    stateAge: number;
    age: number;
    x: number;
    y: number;
    portalX: number;
    portalY: number;
    special: boolean;
    /** Traversal speed in px/s; the walk lasts exactly as long as the distance. */
    speed: number;
    grabbed: boolean;
}

const SIDES: readonly Side[] = ['left', 'right'];

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
const smooth = (value: number): number => {
    const t = clamp(value, 0, 1);
    return t * t * (3 - 2 * t);
};
/** Deterministic per-cycle jitter so entrances never repeat one coordinate. */
const jitterOffset = (id: string): number => {
    let hash = 0;
    for (let index = 0; index < id.length; index++) hash = (hash * 31 + id.charCodeAt(index)) | 0;
    return (Math.abs(hash) % 61) - 30;
};

/**
 * Distance at which a collector is close enough to touch the bag.  The bag is
 * only marked carried inside this radius, so a capture can never happen while
 * the collector is still travelling.
 */
const GRAB_RADIUS = 34;
const REACH_MS = 170;
const SETTLE_MS = 220;
const MAX_CYCLE_MS = 9000;

/**
 * Facing follows the real displacement, never the arena side the collector was
 * spawned on.  This is what makes a demon look at the bag on the way out and at
 * the portal on the way back, in both halves of the arena.
 */
export function travelDirection(targetX: number, currentX: number, fallback: Direction): Direction {
    if (targetX < currentX - 1) return 'left';
    if (targetX > currentX + 1) return 'right';
    return fallback;
}

export interface CollectorStepInput {
    state: CollectorAnimationState;
    positive: boolean;
    stateAge: number;
    /** Distance from the collector to the target of its current state. */
    distance: number;
    x: number;
    y: number;
    portalX: number;
    groundY: number;
    special: boolean;
}

/**
 * Pure choreography rule: which state comes next, or null to keep going.
 *
 * Movement states end on a *spatial* predicate, so a collector always walks the
 * real distance before it may reach, grab or return.  Only the short hand
 * beats (reach/settle) are timed, because they describe a gesture rather than
 * a traversal.
 */
export function nextCollectorState(input: CollectorStepInput): CollectorAnimationState | null {
    const { distance, stateAge, groundY, y, positive, special } = input;
    const near = distance <= GRAB_RADIUS;

    if (positive) {
        switch (input.state) {
            case 'angel-fly-empty': return distance <= 26 ? 'angel-approach' : null;
            case 'angel-approach': return distance <= 26 ? 'angel-descend' : null;
            case 'angel-descend': return distance <= 22 ? 'angel-hover' : null;
            case 'angel-hover': return stateAge >= SETTLE_MS ? 'angel-reach' : null;
            case 'angel-reach': return stateAge >= REACH_MS ? 'angel-grab' : null;
            // The bag becomes carried exactly when the hand meets it.
            case 'angel-grab': return near || stateAge >= REACH_MS ? 'angel-hold' : null;
            case 'angel-hold': return stateAge >= SETTLE_MS ? 'angel-carry' : null;
            case 'angel-carry': return stateAge >= 180 ? 'angel-ascend' : null;
            case 'angel-ascend': return y <= 40 ? 'angel-depart' : null;
            case 'angel-depart': return null;
            default: return null;
        }
    }

    switch (input.state) {
        case 'demon-emerge': return y <= groundY + 3 ? 'demon-idle' : null;
        case 'demon-idle': return stateAge >= SETTLE_MS ? 'demon-approach' : null;
        // Close enough to reach: stop, then extend the hands.
        case 'demon-approach': return distance <= 54 ? 'demon-stop' : null;
        case 'demon-stop': return distance <= GRAB_RADIUS ? 'demon-reach' : null;
        case 'demon-reach': return stateAge >= REACH_MS ? 'demon-grab' : null;
        case 'demon-grab': return near || stateAge >= REACH_MS ? 'demon-carry' : null;
        case 'demon-carry': return stateAge >= SETTLE_MS ? (special ? 'demon-tug' : 'demon-return') : null;
        case 'demon-tug': return stateAge >= 600 ? 'demon-return' : null;
        case 'demon-return': return distance <= 30 ? 'demon-descend' : null;
        case 'demon-descend': return y >= groundY + 110 ? 'demon-disappear' : null;
        case 'demon-disappear': return null;
        default: return null;
    }
}

/** True when the collector has finished and its bag may be released. */
export function isCollectorTerminal(input: CollectorStepInput): boolean {
    return input.positive
        ? input.state === 'angel-depart' && input.y <= -60
        : input.state === 'demon-disappear' && input.stateAge > 320;
}

export function normalizeCollectorQuality(value?: string): CollectorQuality {
    const normalized = value?.toLowerCase();
    return normalized === 'low' || normalized === 'high' ? normalized : 'medium';
}

export function collectorLimit(quality: CollectorQuality, reducedMotion: boolean): number {
    if (reducedMotion) return 1;
    return quality === 'high' ? 2 : 1;
}

export function shouldStartCollector(bags: readonly CollectibleMoneyBag[], activeBags: number): boolean {
    if (!bags.length) return false;
    const oldest = Math.max(...bags.map(bag => bag.availableAge));
    return bags.length >= 3 || activeBags >= 5 || oldest >= 1200 || bags.length >= 2 && oldest >= 500;
}

/** Scheduling and ownership layer. It never receives trades or mutates finance. */
export class CollectorController {
    private readonly renderer?: CollectorRenderer;
    private readonly cycles = new Map<string, Cycle>();
    private readonly cooldown: Record<Side, number> = { left: 0, right: 0 };
    private sequence = 0;
    private enabled: boolean;
    private reducedMotion: boolean;
    private readonly quality: CollectorQuality;

    constructor(
        scene: PhaserTypes.Scene,
        private readonly bags: MoneyFlowBagHost,
        options: { enabled: boolean; quality: CollectorQuality; reducedMotion: boolean },
    ) {
        this.quality = options.quality;
        this.reducedMotion = options.reducedMotion;
        this.enabled = options.enabled && collectorAtlasesAvailable(scene);
        if (this.enabled) this.renderer = new CollectorRenderer(scene, options.reducedMotion || options.quality === 'low');
    }

    get available(): boolean { return this.enabled && this.renderer != null; }

    setEnabled(enabled: boolean): void {
        this.enabled = enabled && this.renderer != null;
        if (!this.enabled) this.reset();
    }

    setReducedMotion(reduced: boolean): void {
        this.reducedMotion = reduced;
        this.renderer?.setReducedMotion(reduced || this.quality === 'low');
    }

    update(deltaMs: number, frame: CollectorArenaFrame): void {
        if (!this.available) return;
        const delta = Math.max(0, Math.min(100, deltaMs));
        for (const side of SIDES) this.cooldown[side] = Math.max(0, this.cooldown[side] - delta);
        for (const cycle of [...this.cycles.values()]) this.updateCycle(cycle, delta, frame.anchors[cycle.side]);
        if (!frame.allowSpawn) return;
        for (const side of SIDES) this.trySpawn(side, frame);
    }

    inspect(): object {
        const cycles = [...this.cycles.values()].map(cycle => ({
            id: cycle.id,
            side: cycle.side,
            polarity: cycle.positive ? 'positive' : 'negative',
            bagId: cycle.bagId,
            age: cycle.age,
            state: cycle.state,
            grabbed: cycle.grabbed,
            special: cycle.special,
            ...this.renderer?.inspect(cycle.id),
        }));
        return {
            enabled: this.available,
            quality: this.quality,
            reducedMotion: this.reducedMotion,
            active: cycles.length,
            cycles,
        };
    }

    reset(): void {
        for (const cycle of [...this.cycles.values()]) this.cancel(cycle);
        this.cycles.clear();
        this.cooldown.left = 0;
        this.cooldown.right = 0;
    }

    destroy(): void {
        this.reset();
        this.renderer?.destroy();
    }

    private trySpawn(side: Side, frame: CollectorArenaFrame): void {
        if (this.cooldown[side] > 0) return;
        const sideCycles = [...this.cycles.values()].filter(cycle => cycle.side === side);
        if (sideCycles.length >= collectorLimit(this.quality, this.reducedMotion)) return;
        const candidates = this.bags.availableBags(side).filter(bag => bag.active && bag.state === 'AVAILABLE');
        const activeBags = candidates.length + sideCycles.length;
        if (!shouldStartCollector(candidates, activeBags)) return;

        const positiveEnergy = frame.energy[side].positive;
        const negativeEnergy = frame.energy[side].negative;
        const activePositive = sideCycles.filter(cycle => cycle.positive).length;
        const activeNegative = sideCycles.length - activePositive;
        let preferredPositive = positiveEnergy >= negativeEnergy;
        // Do not let a persistent buy stream starve sell bags (or vice versa)
        // while the opposite polarity is waiting on the same side. A side can
        // host both collectors; their bag ownership still remains exclusive.
        if (candidates.some(bag => bag.positive) && candidates.some(bag => !bag.positive)
            && activePositive !== activeNegative)
            preferredPositive = activePositive < activeNegative;
        const preferred = candidates.filter(bag => bag.positive === preferredPositive);
        const selection = (preferred.length ? preferred : candidates)
            .sort((a, b) => b.availableAge - a.availableAge || a.id - b.id)[0];
        if (!selection) return;

        const id = `collector-${++this.sequence}`;
        if (!this.bags.reserveBag(selection.id, id)) return;
        const anchors = frame.anchors[side];
        const special = !selection.positive && this.quality === 'high' && !this.reducedMotion
            && negativeEnergy >= .72 && candidates.filter(bag => !bag.positive).length >= 3;
        const region = anchors.region;

        // The demon portal sits on the far side of the bag from the fighter, so
        // the demon never walks under the candle; the angel enters from its own
        // side and therefore never sweeps across the character's face.
        const outward = selection.x <= region.centerX ? -1 : 1;
        const angelSide = side === 'left' ? -1 : 1;
        const jitter = ((this.sequence * 37) % 61) - 30;
        const minFighterGap = region.fighterWidth * .6;
        let portalX = clamp(selection.x + outward * 92, region.left, region.right);
        if (Math.abs(portalX - region.centerX) < minFighterGap)
            portalX = clamp(region.centerX + outward * minFighterGap, region.left, region.right);

        const cycle: Cycle = {
            id, side, positive: selection.positive, bagId: selection.id,
            state: selection.positive ? 'angel-fly-empty' : 'demon-emerge',
            stateAge: 0, age: 0,
            x: selection.positive
                ? clamp(selection.x + angelSide * (110 + jitter), anchors.collectionBounds.left, anchors.collectionBounds.right)
                : portalX,
            y: selection.positive ? Math.max(-40, anchors.collectionBounds.top - 100) : anchors.ground.y + 90,
            portalX, portalY: anchors.ground.y, special,
            speed: selection.positive ? 250 : 210,
            grabbed: false,
        };
        this.cycles.set(id, cycle);
        this.renderer?.create(id, side, selection.positive ? 'positive' : 'negative', cycle.x, cycle.y);
        this.enterState(cycle);
        // Establish the first frame's portal, mask and offset before any update
        // tick: an emerging demon is clipped by the ground mask from frame one.
        this.position(cycle, selection, anchors);
        this.cooldown[side] = this.quality === 'high' ? 900 : 1300;
    }

    private updateCycle(cycle: Cycle, delta: number, anchors: MoneyFlowAnchors): void {
        const bag = this.bags.bagById(cycle.bagId);
        if (!bag || !bag.active || bag.ownerId !== cycle.id || cycle.age > MAX_CYCLE_MS) {
            this.cancel(cycle);
            return;
        }
        cycle.age += delta;
        cycle.stateAge += delta;

        this.advanceMotion(cycle, delta, bag, anchors);
        this.position(cycle, bag, anchors);

        const groundY = anchors.ground.y;
        const stepInput: CollectorStepInput = {
            state: cycle.state,
            positive: cycle.positive,
            stateAge: cycle.stateAge,
            distance: Math.hypot(
                this.targetFor(cycle, bag, anchors).x - cycle.x,
                this.targetFor(cycle, bag, anchors).y - cycle.y,
            ),
            x: cycle.x, y: cycle.y,
            portalX: cycle.portalX,
            groundY,
            special: cycle.special,
        };

        const next = nextCollectorState(stepInput);
        if (next) {
            cycle.state = next;
            cycle.stateAge = 0;
            this.enterState(cycle);
        }

        if (isCollectorTerminal({ ...stepInput, state: cycle.state, stateAge: cycle.stateAge })) {
            this.bags.completeCollection(cycle.bagId, cycle.id);
            this.renderer?.remove(cycle.id);
            this.cycles.delete(cycle.id);
        }
    }

    /** Movement is real displacement at a constant speed: a long trip takes longer. */
    private advanceMotion(cycle: Cycle, delta: number, bag: CollectibleMoneyBag, anchors: MoneyFlowAnchors): void {
        const seconds = delta / 1000;
        const state = cycle.state;
        const target = this.targetFor(cycle, bag, anchors);
        const dx = target.x - cycle.x;
        const dy = target.y - cycle.y;
        const distance = Math.hypot(dx, dy);
        if (distance <= .5) return;

        // Decelerate over the last stretch so the collector visibly stops at
        // the bag instead of snapping into the grab pose at full speed.
        const slowRadius = state === 'demon-approach' || state === 'angel-approach' || state === 'angel-descend'
            ? Math.max(46, distance * .34) : 0;
        const factor = slowRadius > 0 && distance < slowRadius ? smooth(distance / slowRadius) * .85 + .15 : 1;
        const step = Math.min(distance, cycle.speed * factor * seconds);
        cycle.x += dx / distance * step;
        cycle.y += dy / distance * step;
    }

    private targetFor(cycle: Cycle, bag: CollectibleMoneyBag, anchors: MoneyFlowAnchors): { x: number; y: number } {
        const groundY = anchors.ground.y;
        switch (cycle.state) {
            case 'demon-emerge':
                return { x: cycle.portalX, y: groundY };
            case 'demon-idle':
            case 'demon-approach':
            case 'demon-stop':
            case 'demon-reach':
                return { x: bag.x, y: groundY };
            case 'demon-grab':
            case 'demon-carry':
                return { x: bag.x, y: groundY };
            case 'demon-return':
                return { x: cycle.portalX, y: groundY };
            case 'demon-descend':
                return { x: cycle.portalX, y: groundY + 115 };
            case 'demon-disappear':
                return { x: cycle.portalX, y: groundY + 150 };
            case 'demon-tug':
                return { x: bag.x, y: groundY + 8 };
            case 'angel-fly-empty':
                return {
                    x: bag.x + (cycle.side === 'left' ? -1 : 1) * (70 + Math.abs(jitterOffset(cycle.id)) * .4),
                    y: Math.max(35, bag.y - 140),
                };
            case 'angel-approach':
                return { x: bag.x + (cycle.side === 'left' ? -1 : 1) * 48, y: bag.y - 70 };
            case 'angel-descend':
                return { x: bag.x + (cycle.side === 'left' ? -1 : 1) * 24, y: bag.y - 34 };
            case 'angel-hover':
            case 'angel-reach':
            case 'angel-grab':
                return { x: bag.x, y: bag.y + 6 };
            case 'angel-hold':
            case 'angel-carry':
                return { x: bag.x - (cycle.side === 'left' ? -1 : 1) * 18, y: bag.y - 62 };
            case 'angel-ascend':
                return {
                    x: clamp(cycle.x + (cycle.side === 'left' ? -1 : 1) * 48, anchors.collectionBounds.left, anchors.collectionBounds.right),
                    y: 28,
                };
            case 'angel-depart':
                return { x: cycle.x + (cycle.side === 'left' ? -1 : 1) * 35, y: -90 };
            default:
                return { x: cycle.x, y: cycle.y };
        }
    }

    private enterState(cycle: Cycle): void {
        this.renderer?.setState(cycle.id, cycle.state);
        // Collection only begins once the collector is committed to the bag;
        // the bag becomes carried exclusively at the grab, on contact.
        if (cycle.state === 'demon-stop' || cycle.state === 'angel-hover')
            this.bags.beginCollection(cycle.bagId, cycle.id);
        if (cycle.state === 'demon-grab' || cycle.state === 'angel-grab') {
            const bag = this.bags.bagById(cycle.bagId);
            const onContact = bag ? Math.hypot(bag.x - cycle.x, bag.y - cycle.y) <= GRAB_RADIUS * 1.6 : false;
            if (onContact) {
                if (this.bags.markCarried(cycle.bagId, cycle.id)) {
                    // The state transition happens after the regular position
                    // tick. Re-anchor immediately so the bag and its label do
                    // not spend one frame at the pre-GRAB coordinates.
                    this.bags.trackCarried?.(
                        cycle.bagId, cycle.id, cycle.x, cycle.y, true,
                        this.renderer?.carriedBagBounds(cycle.id),
                    );
                    cycle.grabbed = true;
                }
            }
        }
    }

    private position(cycle: Cycle, bag: CollectibleMoneyBag, anchors: MoneyFlowAnchors): void {
        // Facing follows the real displacement, both outward and on return.
        const target = this.targetFor(cycle, bag, anchors);
        const direction = travelDirection(target.x, cycle.x, cycle.portalX < cycle.x ? 'left' : 'right');
        const groundY = anchors.ground.y;

        if (cycle.positive) {
            this.renderer?.setPortal(cycle.id, cycle.portalX, cycle.portalY, false);
        } else {
            const closing = cycle.state === 'demon-disappear' ? 1 - cycle.stateAge / 320 : 1;
            const masked = cycle.state === 'demon-emerge' || cycle.state === 'demon-descend' || cycle.state === 'demon-disappear';
            this.renderer?.setPortal(cycle.id, cycle.portalX, groundY, true, masked, closing);
        }
        this.renderer?.setPosition(cycle.id, cycle.x, cycle.y, direction);

        // A carried bag keeps its coordinates on the collector so the terminal
        // effect (demon portal burn) lands where the bag actually is.
        if (bag.state === 'CARRIED') {
            // The carried bag is represented by the collector atlas. During a
            // demon's underground descent that representation is clipped by
            // the same ground mask, so its financial label must be hidden too.
            const visible = cycle.positive || (cycle.state !== 'demon-descend' && cycle.state !== 'demon-disappear');
            this.bags.trackCarried?.(
                cycle.bagId, cycle.id, cycle.x, cycle.y, visible,
                this.renderer?.carriedBagBounds(cycle.id),
            );
        }
    }

    private cancel(cycle: Cycle): void {
        const bag = this.bags.bagById(cycle.bagId);
        if (bag?.state === 'CARRIED') this.bags.completeCollection(cycle.bagId, cycle.id);
        else this.bags.releaseReservation(cycle.bagId, cycle.id);
        this.renderer?.remove(cycle.id);
        this.cycles.delete(cycle.id);
    }
}
