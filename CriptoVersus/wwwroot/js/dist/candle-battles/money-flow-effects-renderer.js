/** Shared owner of the money-flow-effects atlas identity and its frame vocabulary. */
export const MONEY_FLOW_EFFECTS_ATLAS = 'money-flow-effects';
/** Runtime value of Phaser.Textures.FilterMode.NEAREST: the atlas is pixel art. */
const NEAREST_FILTER = 1;
export const BAG_LANDING_MS = 240;
export const TERMINAL_BURN_MS = 750;
export const TERMINAL_SPARKLE_MS = 600;
export const ACCENT_LOOP_MS = 700;
export function moneyFlowEffectsAvailable(scene) {
    return scene.textures.exists(MONEY_FLOW_EFFECTS_ATLAS);
}
/** Nearest-neighbour sampling keeps the pixel-art outlines crisp under scaling. */
export function prepareMoneyFlowEffectsTextures(scene) {
    if (!moneyFlowEffectsAvailable(scene))
        return;
    scene.textures.get(MONEY_FLOW_EFFECTS_ATLAS).setFilter(NEAREST_FILTER);
}
const clamp01 = (value) => Math.max(0, Math.min(1, value));
const step = (count, progress) => Math.max(1, Math.min(count, 1 + Math.floor(clamp01(progress) * count)));
/** Deterministic frame selection: phase progress maps onto the atlas order. */
export function bagFrameForPhase(phase, progress = 0) {
    switch (phase) {
        case 'falling': return `bag-fall-${step(12, progress)}`;
        case 'landing': return `bag-squash-${step(4, progress)}`;
        case 'resting': return 'bag-burn-1';
        case 'carried': return 'bag-burn-1';
        case 'burning': return `bag-burn-${step(12, progress)}`;
    }
}
export function accentFrameFor(positive, progress = 0) {
    return positive ? `positive-coins-${step(8, progress)}` : `negative-arrows-${step(8, progress)}`;
}
const MAX_TERMINAL_FX = 6;
/**
 * Pooled bag-burn / absorption sprites. Terminal effects are independent from
 * the bag lifecycle: they can never re-enter the collection state machine.
 */
export class MoneyFlowTerminalFx {
    constructor(scene, options) {
        this.scene = scene;
        this.items = [];
        this.reducedMotion = options.reducedMotion === true;
    }
    get available() { return moneyFlowEffectsAvailable(this.scene); }
    get activeCount() { return this.items.filter(item => item.active).length; }
    get poolSize() { return this.items.length; }
    setReducedMotion(reduced) { this.reducedMotion = reduced === true; }
    spawn(x, y, scale, kind) {
        if (!this.available)
            return false;
        let item = this.items.find(candidate => !candidate.active);
        if (!item) {
            if (this.items.length >= MAX_TERMINAL_FX)
                return false;
            item = {
                active: false,
                sprite: this.scene.add.sprite(0, 0, MONEY_FLOW_EFFECTS_ATLAS, 'bag-burn-1')
                    .setOrigin(.5, 1).setDepth(12),
                kind, age: 0, duration: 0, scale,
            };
            this.items.push(item);
        }
        item.active = true;
        item.kind = kind;
        item.age = 0;
        item.duration = kind === 'burn' ? TERMINAL_BURN_MS : TERMINAL_SPARKLE_MS;
        item.scale = scale;
        item.sprite.setTexture(MONEY_FLOW_EFFECTS_ATLAS, kind === 'burn' ? 'bag-burn-1' : 'positive-coins-1')
            .setPosition(x, y).setScale(scale).setAlpha(1).setVisible(true);
        return true;
    }
    update(deltaMs) {
        const delta = Math.max(0, Math.min(100, deltaMs));
        for (const item of this.items) {
            if (!item.active)
                continue;
            item.age += delta;
            const progress = clamp01(item.age / item.duration);
            const frame = this.reducedMotion
                ? (item.kind === 'burn' ? 'bag-burn-1' : 'positive-coins-1')
                : item.kind === 'burn' ? bagFrameForPhase('burning', progress) : accentFrameFor(true, progress);
            const fade = item.kind === 'burn'
                ? (progress > .82 ? 1 - (progress - .82) / .18 : 1)
                : 1 - progress * progress;
            item.sprite.setFrame(frame)
                .setAlpha(Math.max(0, fade))
                .setScale(item.scale * (item.kind === 'sparkle' ? 1 + progress * .25 : 1));
            if (item.age >= item.duration) {
                item.active = false;
                item.sprite.setVisible(false);
            }
        }
    }
    clear() {
        for (const item of this.items) {
            item.active = false;
            item.sprite.setVisible(false);
        }
    }
    destroy() {
        for (const item of this.items)
            item.sprite.destroy();
        this.items.length = 0;
    }
}
