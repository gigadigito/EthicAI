import { CollectorRenderer, collectorAtlasesAvailable, } from './money-flow-collector-renderer.20261101a.js';
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
        const portalX = clamp(selection.x + (side === 'left' ? 92 : -92), anchors.collectionBounds.left, anchors.collectionBounds.right);
        const cycle = {
            id, side, positive: selection.positive, bagId: selection.id, stages,
            stageIndex: 0, stageAge: 0, age: 0,
            x: selection.positive ? selection.x + (side === 'left' ? -110 : 110) : portalX,
            y: selection.positive ? Math.max(-40, anchors.collectionBounds.top - 100) : anchors.ground.y + 90,
            portalX, portalY: anchors.ground.y, special,
        };
        this.cycles.set(id, cycle);
        this.renderer?.create(id, side, selection.positive ? 'positive' : 'negative', cycle.x, cycle.y);
        this.enterStage(cycle, cycle.stages[0].state);
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
        if (cycle.positive) {
            if (state === 'angel-fly-empty') {
                targetX = bag.x + (cycle.side === 'left' ? -70 : 70);
                targetY = Math.max(35, bag.y - 140);
            }
            else if (state === 'angel-descend') {
                targetX = bag.x + (cycle.side === 'left' ? -48 : 48);
                targetY = bag.y - 70;
            }
            else if (state === 'angel-approach' || state === 'angel-grab') {
                targetX = bag.x;
                targetY = bag.y + 12;
            }
            else if (state === 'angel-carry') {
                targetX = bag.x + (cycle.side === 'left' ? 18 : -18);
                targetY = bag.y - 65;
            }
            else if (state === 'angel-ascend') {
                targetX = clamp(cycle.x + (cycle.side === 'left' ? 48 : -48), anchors.collectionBounds.left, anchors.collectionBounds.right);
                targetY = 28;
            }
            else if (state === 'angel-depart') {
                targetX = cycle.x + (cycle.side === 'left' ? 35 : -35);
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
            this.renderer?.setPortal(cycle.id, cycle.portalX, groundY, true, state === 'demon-descend' || state === 'demon-disappear', closing);
        }
        const follow = state.endsWith('grab') ? .42 : .18 + progress * .32;
        cycle.x += (targetX - cycle.x) * follow;
        cycle.y += (targetY - cycle.y) * follow;
        this.renderer?.setPosition(cycle.id, cycle.x, cycle.y);
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
