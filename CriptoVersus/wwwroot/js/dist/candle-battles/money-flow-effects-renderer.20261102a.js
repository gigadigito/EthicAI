/** Shared owner of the money-flow-effects atlas identity and its frame vocabulary. */
export const MONEY_FLOW_EFFECTS_ATLAS = 'money-flow-effects';
/** Runtime value of Phaser.Textures.FilterMode.NEAREST: the atlas is pixel art. */
const NEAREST_FILTER = 1;
/**
 * Frame counts owned by `tools/candle-battles/money-flow-catalog.json`.
 * `BAG_FLYING_FRAMES` is the aerial prefix of `bag-fall`; the remaining frames
 * hold the ground-plate and are only reachable through `landing`.
 * A unit test asserts these stay in sync with the catalog.
 */
export const BAG_FALL_FRAMES = 12;
export const BAG_FLYING_FRAMES = 7;
export const BAG_SQUASH_FRAMES = 4;
export const BAG_BURN_FRAMES = 8;
export const BAG_INTO_PIT_FRAMES = 10;
export const POSITIVE_COINS_FRAMES = 8;
export const NEGATIVE_ARROWS_FRAMES = 8;
export const INFERNAL_PIT_FRAMES = 10;
export const BAG_LANDING_MS = 240;
export const BAG_ABSORB_MS = 900;
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
        // Aerial: only the plate-free prefix may be shown.
        case 'flying':
        case 'descending':
            return `bag-fall-${step(BAG_FLYING_FRAMES, progress)}`;
        case 'floating':
            return `bag-fall-${BAG_FLYING_FRAMES}`;
        // Ground impact belongs exclusively to a real landing.
        case 'landing':
            return `bag-squash-${step(BAG_SQUASH_FRAMES, progress)}`;
        // A resting or carried bag is a plain bag; never a burn frame.
        case 'resting':
        case 'carried':
            return 'bag-fall-1';
        case 'absorbed':
            return `bag-into-pit-${step(BAG_INTO_PIT_FRAMES, progress)}`;
        case 'burning':
            return `bag-burn-${step(BAG_BURN_FRAMES, progress)}`;
    }
}
export function accentFrameFor(positive, progress = 0) {
    return positive
        ? `positive-coins-${step(POSITIVE_COINS_FRAMES, progress)}`
        : `negative-arrows-${step(NEGATIVE_ARROWS_FRAMES, progress)}`;
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
        item.duration = kind === 'burn' ? TERMINAL_BURN_MS
            : kind === 'absorb' ? BAG_ABSORB_MS : TERMINAL_SPARKLE_MS;
        item.scale = scale;
        item.sprite.setTexture(MONEY_FLOW_EFFECTS_ATLAS, this.firstFrame(kind))
            .setPosition(x, y).setScale(scale).setAlpha(1).setVisible(true);
        return true;
    }
    firstFrame(kind) {
        return kind === 'absorb' ? 'bag-into-pit-1' : kind === 'burn' ? 'bag-burn-1' : 'positive-coins-1';
    }
    frameFor(kind, progress) {
        if (this.reducedMotion)
            return this.firstFrame(kind);
        if (kind === 'absorb')
            return bagFrameForPhase('absorbed', progress);
        return kind === 'burn' ? bagFrameForPhase('burning', progress) : accentFrameFor(true, progress);
    }
    update(deltaMs) {
        const delta = Math.max(0, Math.min(100, deltaMs));
        for (const item of this.items) {
            if (!item.active)
                continue;
            item.age += delta;
            const progress = clamp01(item.age / item.duration);
            const fade = item.kind === 'burn'
                ? (progress > .82 ? 1 - (progress - .82) / .18 : 1)
                : item.kind === 'absorb'
                    ? (progress > .88 ? 1 - (progress - .88) / .12 : 1)
                    : 1 - progress * progress;
            item.sprite.setFrame(this.frameFor(item.kind, progress))
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
