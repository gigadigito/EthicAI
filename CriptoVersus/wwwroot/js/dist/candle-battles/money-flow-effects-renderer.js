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
export const POSITIVE_BAG_WINGS_FRAMES = 2;
export const BAG_LANDING_MS = 240;
export const BAG_ABSORB_MS = 900;
export const TERMINAL_BURN_MS = 750;
export const TERMINAL_SPARKLE_MS = 600;
export const ACCENT_LOOP_MS = 700;
export const POSITIVE_BAG_WINGS_CYCLE_MS = 520;
export const POSITIVE_BAG_WINGS_OPEN_FRAME = 'positive-bag-wings-1';
export const POSITIVE_BAG_WINGS_CLOSED_FRAME = 'positive-bag-wings-2';
/**
 * Source-pixel bounds of the bag artwork, excluding the transparent/glow
 * padding in the atlas frame. The label uses these authored visual edges, not
 * the wider animation cell, so scaling the effect does not push the value away.
 */
const MONEY_BAG_SOURCE_BOUNDS = {
    'bag-fall-1': { left: 28, top: 74, right: 84, bottom: 142 },
    'bag-fall-2': { left: 25, top: 63, right: 85, bottom: 146 },
    'bag-fall-3': { left: 30, top: 54, right: 86, bottom: 146 },
    'bag-fall-4': { left: 28, top: 45, right: 86, bottom: 145 },
    'bag-fall-5': { left: 28, top: 28, right: 84, bottom: 143 },
    'bag-fall-6': { left: 29, top: 23, right: 87, bottom: 143 },
    'bag-fall-7': { left: 27, top: 17, right: 86, bottom: 135 },
    'bag-fall-8': { left: 20, top: 24, right: 94, bottom: 141 },
    'bag-fall-9': { left: 10, top: 35, right: 96, bottom: 143 },
    'bag-fall-10': { left: 14, top: 45, right: 102, bottom: 143 },
    'bag-fall-11': { left: 17, top: 74, right: 105, bottom: 142 },
    'bag-fall-12': { left: 16, top: 74, right: 104, bottom: 143 },
    'bag-squash-1': { left: 24, top: 21, right: 105, bottom: 119 },
    'bag-squash-2': { left: 25, top: 16, right: 105, bottom: 119 },
    'bag-squash-3': { left: 37, top: 16, right: 120, bottom: 119 },
    'bag-squash-4': { left: 17, top: 36, right: 113, bottom: 120 },
};
export function moneyBagSourceBounds(frameName) {
    return MONEY_BAG_SOURCE_BOUNDS[frameName] ?? null;
}
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
/** Cyclic open/closed wing beat for the loose positive bag overlay. */
export function positiveBagWingsFrame(ageMs = 0, reducedMotion = false) {
    if (reducedMotion)
        return POSITIVE_BAG_WINGS_CLOSED_FRAME;
    const age = Math.max(0, Number(ageMs) || 0) % POSITIVE_BAG_WINGS_CYCLE_MS;
    return age < POSITIVE_BAG_WINGS_CYCLE_MS / 2
        ? POSITIVE_BAG_WINGS_OPEN_FRAME
        : POSITIVE_BAG_WINGS_CLOSED_FRAME;
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
