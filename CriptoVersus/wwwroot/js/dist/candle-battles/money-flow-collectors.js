import { CollectorRenderer, collectorAtlasesAvailable, } from './money-flow-collector-renderer.js?v=20261101b';
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
export function buildMoneyFlowAnchors(input) {
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
    const region = {
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
const SIDES = ['left', 'right'];
const POSITIVE_STAGES = [
    { state: 'angel-fly-empty', duration: 350 },
    { state: 'angel-descend', duration: 500 },
    { state: 'angel-approach', duration: 450 },
    { state: 'angel-grab', duration: 350 },
    { state: 'angel-carry', duration: 250 },
    { state: 'angel-ascend', duration: 650 },
    { state: 'angel-depart', duration: 300 },
];
const NEGATIVE_STAGES = [
    { state: 'demon-emerge', duration: 550 },
    { state: 'demon-idle', duration: 150 },
    { state: 'demon-approach', duration: 650 },
    { state: 'demon-grab', duration: 350 },
    { state: 'demon-carry', duration: 200 },
    { state: 'demon-run', duration: 650 },
    { state: 'demon-descend', duration: 650 },
    { state: 'demon-disappear', duration: 200 },
];
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const smooth = (value) => {
    const t = clamp(value, 0, 1);
    return t * t * (3 - 2 * t);
};
/** Deterministic per-cycle jitter so entrances never repeat one coordinate. */
const jitterOffset = (id) => {
    let hash = 0;
    for (let index = 0; index < id.length; index++)
        hash = (hash * 31 + id.charCodeAt(index)) | 0;
    return (Math.abs(hash) % 61) - 30;
};
export function normalizeCollectorQuality(value) {
    const normalized = value?.toLowerCase();
    return normalized === 'low' || normalized === 'high' ? normalized : 'medium';
}
export function collectorLimit(quality, reducedMotion) {
    if (reducedMotion)
        return 1;
    return quality === 'high' ? 2 : 1;
}
export function shouldStartCollector(bags, activeBags) {
    if (!bags.length)
        return false;
    const oldest = Math.max(...bags.map(bag => bag.availableAge));
    return bags.length >= 3 || activeBags >= 5 || oldest >= 1200 || bags.length >= 2 && oldest >= 500;
}
/** Scheduling and ownership layer. It never receives trades or mutates finance. */
export class CollectorController {
    constructor(scene, bags, options) {
        this.bags = bags;
        this.cycles = new Map();
        this.cooldown = { left: 0, right: 0 };
        this.sequence = 0;
        this.quality = options.quality;
        this.reducedMotion = options.reducedMotion;
        this.enabled = options.enabled && collectorAtlasesAvailable(scene);
        if (this.enabled)
            this.renderer = new CollectorRenderer(scene, options.reducedMotion || options.quality === 'low');
    }
    get available() { return this.enabled && this.renderer != null; }
    setEnabled(enabled) {
        this.enabled = enabled && this.renderer != null;
        if (!this.enabled)
            this.reset();
    }
    setReducedMotion(reduced) {
        this.reducedMotion = reduced;
        this.renderer?.setReducedMotion(reduced || this.quality === 'low');
    }
    update(deltaMs, frame) {
        if (!this.available)
            return;
        const delta = Math.max(0, Math.min(100, deltaMs));
        for (const side of SIDES)
            this.cooldown[side] = Math.max(0, this.cooldown[side] - delta);
        for (const cycle of [...this.cycles.values()])
            this.updateCycle(cycle, delta, frame.anchors[cycle.side]);
        if (!frame.allowSpawn)
            return;
        for (const side of SIDES)
            this.trySpawn(side, frame);
    }
    inspect() {
        const cycles = [...this.cycles.values()].map(cycle => ({
            id: cycle.id,
            side: cycle.side,
            polarity: cycle.positive ? 'positive' : 'negative',
            bagId: cycle.bagId,
            age: cycle.age,
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
    reset() {
        for (const cycle of [...this.cycles.values()])
            this.cancel(cycle);
        this.cycles.clear();
        this.cooldown.left = 0;
        this.cooldown.right = 0;
    }
    destroy() {
        this.reset();
        this.renderer?.destroy();
    }
    trySpawn(side, frame) {
        if (this.cooldown[side] > 0)
            return;
        const sideCycles = [...this.cycles.values()].filter(cycle => cycle.side === side);
        if (sideCycles.length >= collectorLimit(this.quality, this.reducedMotion))
            return;
        const candidates = this.bags.availableBags(side).filter(bag => bag.active && bag.state === 'AVAILABLE');
        const activeBags = candidates.length + sideCycles.length;
        if (!shouldStartCollector(candidates, activeBags))
            return;
        const positiveEnergy = frame.energy[side].positive;
        const negativeEnergy = frame.energy[side].negative;
        const preferredPositive = positiveEnergy >= negativeEnergy;
        const compatible = sideCycles.length ? candidates.filter(bag => bag.positive === sideCycles[0].positive) : candidates;
        const preferred = compatible.filter(bag => bag.positive === preferredPositive);
        const selection = (preferred.length ? preferred : compatible)
            .sort((a, b) => b.availableAge - a.availableAge || a.id - b.id)[0];
        if (!selection)
            return;
        const id = `collector-${++this.sequence}`;
        if (!this.bags.reserveBag(selection.id, id))
            return;
        const anchors = frame.anchors[side];
        const special = !selection.positive && this.quality === 'high' && !this.reducedMotion
            && negativeEnergy >= .72 && candidates.filter(bag => !bag.positive).length >= 3;
        const stages = (selection.positive ? POSITIVE_STAGES : NEGATIVE_STAGES).map(stage => ({ ...stage }));
        if (special)
            stages.splice(5, 0, { state: 'demon-tug', duration: 600 });
        const region = anchors.region;
        // Angels enter from their own side of the bag (matching their capture
        // path); the demon portal sits on the far side of the bag from the
        // fighter so the demon never walks under the character.
        const outward = selection.x <= region.centerX ? -1 : 1;
        const angelSide = side === 'left' ? -1 : 1;
        const jitter = ((this.sequence * 37) % 61) - 30;
        const minFighterGap = region.fighterWidth * .6;
        let portalX = clamp(selection.x + outward * 92, region.left, region.right);
        if (Math.abs(portalX - region.centerX) < minFighterGap)
            portalX = clamp(region.centerX + outward * minFighterGap, region.left, region.right);
        const cycle = {
            id, side, positive: selection.positive, bagId: selection.id, stages,
            stageIndex: 0, stageAge: 0, age: 0,
            x: selection.positive
                ? clamp(selection.x + angelSide * (110 + jitter), anchors.collectionBounds.left, anchors.collectionBounds.right)
                : portalX,
            y: selection.positive ? Math.max(-40, anchors.collectionBounds.top - 100) : anchors.ground.y + 90,
            portalX, portalY: anchors.ground.y, special,
        };
        this.cycles.set(id, cycle);
        this.renderer?.create(id, side, selection.positive ? 'positive' : 'negative', cycle.x, cycle.y);
        this.enterStage(cycle, cycle.stages[0].state);
        // Establish the first frame's portal, mask and offset before any update
        // tick: an emerging demon is clipped by the ground mask from frame one.
        this.position(cycle, cycle.stages[0].state, 0, selection, anchors);
        this.cooldown[side] = this.quality === 'high' ? 900 : 1300;
    }
    updateCycle(cycle, delta, anchors) {
        const bag = this.bags.bagById(cycle.bagId);
        if (!bag || !bag.active || bag.ownerId !== cycle.id || cycle.age > 4500) {
            this.cancel(cycle);
            return;
        }
        cycle.age += delta;
        cycle.stageAge += delta;
        const stage = cycle.stages[cycle.stageIndex];
        const progress = smooth(cycle.stageAge / stage.duration);
        this.position(cycle, stage.state, progress, bag, anchors);
        if (cycle.stageAge < stage.duration)
            return;
        cycle.stageIndex++;
        cycle.stageAge = 0;
        if (cycle.stageIndex >= cycle.stages.length) {
            this.bags.completeCollection(cycle.bagId, cycle.id);
            this.renderer?.remove(cycle.id);
            this.cycles.delete(cycle.id);
            return;
        }
        this.enterStage(cycle, cycle.stages[cycle.stageIndex].state);
    }
    enterStage(cycle, state) {
        this.renderer?.setState(cycle.id, state);
        if (state === 'angel-approach' || state === 'demon-approach')
            this.bags.beginCollection(cycle.bagId, cycle.id);
        if (state === 'angel-grab' || state === 'demon-grab')
            this.bags.markCarried(cycle.bagId, cycle.id);
    }
    position(cycle, state, progress, bag, anchors) {
        let targetX = cycle.x;
        let targetY = cycle.y;
        // Angels always approach and leave on their own side of the bag, so the
        // capture path never sweeps across the fighter; lateral bags are reached
        // through bag-relative anchors.
        const angelSide = cycle.side === 'left' ? -1 : 1;
        if (cycle.positive) {
            if (state === 'angel-fly-empty') {
                targetX = bag.x + angelSide * (70 + Math.abs(jitterOffset(cycle.id)) * .4);
                targetY = Math.max(35, bag.y - 140);
            }
            else if (state === 'angel-descend') {
                targetX = bag.x + angelSide * 48;
                targetY = bag.y - 70;
            }
            else if (state === 'angel-approach' || state === 'angel-grab') {
                targetX = bag.x;
                targetY = bag.y + 12;
            }
            else if (state === 'angel-carry') {
                targetX = bag.x - angelSide * 18;
                targetY = bag.y - 65;
            }
            else if (state === 'angel-ascend') {
                targetX = clamp(cycle.x + angelSide * 48, anchors.collectionBounds.left, anchors.collectionBounds.right);
                targetY = 28;
            }
            else if (state === 'angel-depart') {
                targetX = cycle.x + angelSide * 35;
                targetY = -90;
            }
            this.renderer?.setPortal(cycle.id, cycle.portalX, cycle.portalY, false);
        }
        else {
            const groundY = anchors.ground.y;
            if (state === 'demon-emerge') {
                targetX = cycle.portalX;
                targetY = groundY;
            }
            else if (state === 'demon-idle') {
                targetX = cycle.portalX;
                targetY = groundY;
            }
            else if (state === 'demon-approach' || state === 'demon-grab') {
                targetX = bag.x;
                targetY = groundY;
            }
            else if (state === 'demon-tug') {
                targetX = bag.x;
                targetY = groundY + 8;
            }
            else if (state === 'demon-carry' || state === 'demon-run') {
                targetX = cycle.portalX;
                targetY = groundY;
            }
            else if (state === 'demon-descend' || state === 'demon-disappear') {
                targetX = cycle.portalX;
                targetY = groundY + (state === 'demon-descend' ? 115 : 145);
            }
            const closing = state === 'demon-disappear' ? 1 - progress : 1;
            // The ground mask hides everything below the floor line: the demon
            // is revealed while emerging and hidden again while sinking away.
            const masked = state === 'demon-emerge' || state === 'demon-descend' || state === 'demon-disappear';
            this.renderer?.setPortal(cycle.id, cycle.portalX, groundY, true, masked, closing);
        }
        const follow = state.endsWith('grab') ? .42 : .18 + progress * .32;
        cycle.x += (targetX - cycle.x) * follow;
        cycle.y += (targetY - cycle.y) * follow;
        this.renderer?.setPosition(cycle.id, cycle.x, cycle.y);
        // A carried bag keeps its coordinates on the collector so the terminal
        // effect (demon portal burn) lands where the bag actually is.
        if (bag.state === 'CARRIED')
            this.bags.trackCarried?.(cycle.bagId, cycle.id, cycle.x, cycle.y);
    }
    cancel(cycle) {
        const bag = this.bags.bagById(cycle.bagId);
        if (bag?.state === 'CARRIED')
            this.bags.completeCollection(cycle.bagId, cycle.id);
        else
            this.bags.releaseReservation(cycle.bagId, cycle.id);
        this.renderer?.remove(cycle.id);
        this.cycles.delete(cycle.id);
    }
}
