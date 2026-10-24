import { TEAM, OUTLINE, candleDirection, fighterAnimationForPhase, project, interpolate } from './model.20261024a.js';
const CANDLE_LIFT = 60;
const ACTION_FRAME_COUNTS = {
    // Hold the damage pose while its alpha fades; cycling the source montage
    // would reveal neighbouring colour variants.
    run: 4,
    punch: 4,
    break: 1,
    recover: 3,
};
const fighterFrame = (side, direction, action, frame) => `fighter-${side}-${direction}-${action}-${Math.max(1, frame)}`;
const animationKey = (side, direction, action) => `candle-${side}-${direction}-${action}`;
/** Optional second atlas. Its absence only selects the modular.png fallback. */
export const FINISHER_ATLAS = 'candle-finishers';
export const FINISHER_FRAME_COUNTS = {
    charge: 3,
    attack: 4,
    'hurt-stagger': 3,
    knockout: 4,
    'defeated-idle': 2,
    'victory-loop': 3,
    dizzy: 3,
};
export const FINISHER_FRAME_RATES = {
    charge: 8,
    attack: 14,
    'hurt-stagger': 10,
    knockout: 8,
    'defeated-idle': 4,
    'victory-loop': 6,
    dizzy: 6,
};
export const finisherFrameName = (side, action, frame) => `finisher-${side}-${action}-${Math.max(1, frame)}`;
export const finisherAnimationKey = (side, action) => `finisher-${side}-${action}`;
export const OVERLAY_KINDS = ['bandage', 'bruise', 'star'];
/** Overlay frames are team-neutral; the anchor carries the body position. */
export const OVERLAY_FRAMES = {
    bandage: ['overlay-bandage-1', 'overlay-bandage-2'],
    bruise: ['overlay-bruise-1', 'overlay-bruise-2'],
    star: ['overlay-star-1', 'overlay-star-2', 'overlay-star-3'],
};
/**
 * Anchors in sprite-local units, where (0,0) is the bottom-centre of the
 * 200x200 cell. Derived from the measured ink boxes: feet at cell y=197, head
 * top at y in [82,115], face centre near (104,150), speech anchor at y=32.
 */
export const OVERLAY_ANCHORS = {
    bandage: { x: 0, y: -82 },
    bruise: { x: 10, y: -50 },
    star: { x: 0, y: -130 },
};
export const overlayAnchor = (kind) => OVERLAY_ANCHORS[kind];
const hasFrame = (scene, textureKey, frame) => {
    if (!scene.textures?.exists?.(textureKey))
        return false;
    const texture = scene.textures.get(textureKey);
    return typeof texture?.has === 'function' ? texture.has(frame) : true;
};
const sceneHasAnimation = (scene, key) => typeof scene.anims?.exists === 'function' ? scene.anims.exists(key) : false;
export const finishersAvailable = (scene, side) => scene.textures?.exists?.(FINISHER_ATLAS) === true && hasFrame(scene, FINISHER_ATLAS, finisherFrameName(side, 'charge', 1));
/** Register optional candle-finishers sequences when the atlas is present. */
export function registerFinisherAnimations(scene, side) {
    if (!finishersAvailable(scene, side))
        return;
    for (const action of Object.keys(FINISHER_FRAME_COUNTS)) {
        const key = finisherAnimationKey(side, action);
        if (scene.anims.exists(key))
            continue;
        const count = FINISHER_FRAME_COUNTS[action];
        const frames = Array.from({ length: count }, (_, i) => finisherFrameName(side, action, i + 1))
            .filter(frame => hasFrame(scene, FINISHER_ATLAS, frame));
        if (!frames.length)
            continue;
        scene.anims.create({
            key,
            frames: frames.map(frame => ({ key: FINISHER_ATLAS, frame })),
            frameRate: FINISHER_FRAME_RATES[action],
            repeat: action === 'defeated-idle' || action === 'victory-loop' || action === 'dizzy' || action === 'charge' ? -1 : 0,
        });
    }
}
/** Register real sprite-sheet sequences once the atlas has loaded. */
export function registerFighterAnimations(scene) {
    for (const side of ['left', 'right'])
        for (const direction of ['neutral', 'up', 'down']) {
            for (const action of ['idle', 'run', 'punch', 'break', 'recover']) {
                const key = animationKey(side, direction, action);
                if (scene.anims.exists(key))
                    continue;
                const count = action === 'idle' ? 1 : ACTION_FRAME_COUNTS[action];
                scene.anims.create({
                    key,
                    frames: Array.from({ length: count }, (_, i) => ({ key: 'modular', frame: fighterFrame(side, direction, action, i + 1) })),
                    frameRate: action === 'run' ? 8 : action === 'punch' ? 12 : action === 'break' ? 14 : 8,
                    repeat: action === 'idle' || action === 'run' ? -1 : 0,
                });
            }
        }
}
export class CandleRenderer {
    constructor(scene, side, x, y) {
        this.scene = scene;
        this.side = side;
        this.elapsed = 0;
        this.direction = 'neutral';
        this.range = 0;
        this.frozen = false;
        this.phase = 'FORMING_CANDLE';
        this.win = true;
        this.draw = false;
        this.outline = OUTLINE.neutral;
        this.animation = 'idle';
        this.combat = { attack: 0, block: 0, dodge: 0, hit: 0, counter: 0, taunt: 0 };
        this.preparation = 0;
        this.finalState = 'none';
        this.presentationScale = .8;
        this.celebration = 0;
        this.defeat = 0;
        this.overlays = [];
        registerFighterAnimations(scene);
        registerFinisherAnimations(scene, side);
        this.aura = scene.add.graphics();
        this.body = scene.add.graphics();
        this.aura.setY(-CANDLE_LIFT);
        this.body.setY(-CANDLE_LIFT);
        this.sprite = scene.add.sprite(0, 0, 'modular', fighterFrame(side, 'neutral', 'idle', 1));
        this.sprite.setOrigin(.5, 1);
        this.root = scene.add.container(x, y, [this.aura, this.body, this.sprite]);
        // Keep a neutral fighter visible while LIVE is waiting for the first
        // OHLC snapshot.  The direction remains neutral until setCandle()
        // receives real data, so this is only a visual idle placeholder.
        this.root.setVisible(true);
        this.sprite.setPosition(0, 185).setScale(.8);
        this.playAnimation(true);
    }
    setCandle(candle, range, immediate = false) {
        if (!immediate && this.last && candle.open === this.last.open && candle.close === this.last.close && candle.high === this.last.high && candle.low === this.last.low && candle.openTime === this.last.openTime && candle.updatedAt === this.last.updatedAt && this.range === range)
            return;
        this.from = this.visibleGeometry ?? project(candle, range, 90);
        this.target = project(candle, range, 90);
        this.elapsed = immediate ? 240 : 0;
        this.last = { ...candle };
        this.range = range;
        const nextDirection = candleDirection(candle);
        this.direction = nextDirection;
        this.root.setVisible(true);
        if (immediate)
            this.visibleGeometry = { ...this.target };
        if (!this.sprite.anims.isPlaying)
            this.playAnimation(true);
    }
    setPose(phase, winner, draw = false) {
        this.finalState = 'none';
        this.celebration = 0;
        this.defeat = 0;
        this.heldFrame = undefined;
        this.phase = phase;
        if (phase !== 'FORMING_CANDLE')
            this.preparation = 0;
        this.win = winner;
        this.draw = draw;
        let next = fighterAnimationForPhase(phase);
        if (next === 'recover')
            next = 'idle';
        if (!draw && winner && ['BLOCK_FALLING', 'BLOCK_LOCKING'].includes(phase))
            next = 'idle';
        if (next !== this.animation) {
            this.animation = next;
            this.playAnimation(true);
        }
    }
    setFinalState(state) {
        this.finalState = state;
        this.phase = 'FORMING_CANDLE';
        this.preparation = 0;
        this.heldFrame = undefined;
        this.celebration = state === 'winner' ? 1 : 0;
        this.defeat = state === 'loser' ? 1 : 0;
        this.combat = { attack: 0, block: 0, dodge: 0, hit: 0, counter: 0, taunt: 0 };
        const next = state === 'winner' ? 'recover' : state === 'loser' ? 'break' : 'idle';
        if (next !== this.animation) {
            this.animation = next;
            this.playAnimation(true);
        }
    }
    /**
     * Applies one closing-cinematic pose. The resolved pose always names frames
     * that exist in modular.png, so the sequence stays visible when the optional
     * candle-finishers atlas is absent.
     */
    applyFinalePose(pose) {
        this.finalState = pose.role;
        this.celebration = pose.celebration;
        this.defeat = pose.defeat;
        this.combat = { attack: 0, block: 0, dodge: 0, hit: 0, counter: 0, taunt: 0 };
        this.preparation = 0;
        const preferred = pose.finisher;
        const useFinisher = !!preferred && finishersAvailable(this.scene, this.side)
            && sceneHasAnimation(this.scene, finisherAnimationKey(this.side, preferred));
        if (useFinisher && preferred) {
            this.animation = 'idle';
            this.heldFrame = undefined;
            this.sprite.anims.play(finisherAnimationKey(this.side, preferred), !pose.loop);
            if (this.frozen)
                this.sprite.anims.pause();
            return;
        }
        this.animation = pose.animation;
        if (pose.holdFrame == null) {
            this.heldFrame = undefined;
            this.playAnimation(true);
            return;
        }
        this.heldFrame = fighterFrame(this.side, 'neutral', pose.animation, pose.holdFrame);
        this.sprite.anims.stop();
        this.sprite.setFrame(this.heldFrame);
    }
    /**
     * Attaches a damage/celebration decal. Returns false when the optional
     * overlay frames are not present, so nothing generic is drawn instead.
     */
    attachOverlay(kind, frame = 1) {
        const names = OVERLAY_FRAMES[kind];
        const name = names[Math.max(0, Math.min(names.length - 1, frame - 1))];
        if (!hasFrame(this.scene, FINISHER_ATLAS, name))
            return false;
        if (this.overlays.some(entry => entry.kind === kind))
            return true;
        const image = this.scene.add.sprite(0, 0, FINISHER_ATLAS, name);
        image.setOrigin(.5, .5).setDepth(1);
        this.root.add(image);
        this.overlays.push({ kind, frame: Math.max(1, frame), image, star: kind === 'star' });
        this.positionOverlays(0);
        return true;
    }
    clearOverlays() {
        for (const entry of this.overlays)
            entry.image.destroy();
        this.overlays = [];
    }
    get finishersAvailable() { return finishersAvailable(this.scene, this.side); }
    get overlaysAvailable() { return this.overlays.length > 0; }
    get overlayKinds() { return this.overlays.map(entry => entry.kind); }
    resetPresentation() {
        this.setPose('FORMING_CANDLE', true);
        this.clearOverlays();
        this.combat = { attack: 0, block: 0, dodge: 0, hit: 0, counter: 0, taunt: 0 };
        this.sprite.setPosition(0, 185).setScale(this.presentationScale).setRotation(0).setAlpha(1);
        this.body.setAlpha(1);
        this.aura.clear().setAlpha(1);
        this.root.setVisible(true);
    }
    setCombatMotion(motion) { this.combat = { ...motion }; }
    setPresentationScale(scale) { this.presentationScale = scale; }
    setPreparation(tension, time) {
        // The closing cinematic owns the fighter pose; idle tension must not
        // steal the held victory/defeat frame every tick.
        if (this.finalState !== 'none')
            return;
        this.preparation = Math.max(0, Math.min(1, tension));
        this.combat = { attack: 0, block: .2 + this.preparation * .35, dodge: .12 * Math.abs(Math.sin(time / 1700)), hit: 0, counter: 0,
            taunt: this.preparation > .8 ? .18 : .08 * Math.abs(Math.sin(time / 2100)) };
        const next = this.preparation > .8 && Math.sin(time / 1400) > .8 ? 'run' : 'idle';
        if (this.phase === 'FORMING_CANDLE' && next !== this.animation) {
            this.animation = next;
            this.playAnimation(true);
        }
        if (!this.target && !this.frozen) {
            this.sprite.setPosition(Math.sin(time / 900) * (.8 + this.preparation * 1.5), 185 + Math.sin(time / 650) * (1.2 + this.preparation * 1.8));
            this.sprite.setRotation(Math.sin(time / 1150) * (0.012 + this.preparation * .015));
        }
    }
    setReducedMotion(reduced) {
        this.frozen = reduced;
        if (reduced)
            this.sprite.anims.pause();
        else
            this.sprite.anims.resume();
    }
    /** Hold the last illustrated frame so social captures stay still. */
    freezePose() {
        this.frozen = true;
        this.sprite.anims.stop();
        const frames = this.animation === 'idle' ? 1 : ACTION_FRAME_COUNTS[this.animation];
        this.sprite.setFrame(this.heldFrame ?? fighterFrame(this.side, 'neutral', this.animation, frames));
    }
    /** Resume animated playback after <see cref="freezePose"/> (dev inspection). */
    releaseFrame() {
        this.frozen = false;
        this.playAnimation(false);
    }
    /** Drop every candle/pose residue so a seeked timeline starts visually clean. */
    clearCandle() {
        this.from = undefined;
        this.target = undefined;
        this.visibleGeometry = undefined;
        this.last = undefined;
        this.range = 0;
        this.body.clear();
        this.aura.clear();
    }
    get poseAction() { return this.animation; }
    get poseDirection() { return this.direction; }
    get posePhase() { return this.phase; }
    get isFrozen() { return this.frozen; }
    get frameName() {
        // The displayed texture frame is authoritative: a held finale pose stops
        // the animation, which leaves anims.currentFrame pointing at the stale
        // sequence frame instead of the frame actually on screen.
        const frame = this.sprite.frame;
        const anim = this.sprite.anims.currentFrame;
        return String(frame?.name ?? anim?.textureFrame?.name ?? anim?.name ?? '');
    }
    get geometry() { return this.visibleGeometry && { ...this.visibleGeometry }; }
    get financialSnapshot() { return this.last && { ...this.last }; }
    get faceSize() { return { width: this.sprite.width, height: this.sprite.height }; }
    get outlineColor() { return OUTLINE[this.direction]; }
    get finalVisualState() { return this.finalState; }
    get speechAnchor() {
        // The atlas frame includes transparent padding above the illustrated face.
        return { x: this.root.x + this.sprite.x, y: this.root.y + this.sprite.y - 165 };
    }
    update(time, delta, progress = 0) {
        if (!this.target || !this.from) {
            // The closing pose keeps celebrating/defending even when a seek has
            // cleared the candle geometry; only the OHLC layer needs a snapshot.
            this.applyClosingMotion(time);
            return;
        }
        this.elapsed += Math.max(0, delta);
        const t = this.frozen ? 1 : Math.min(1, this.elapsed / 240);
        this.visibleGeometry = interpolate(this.from, this.target, t * t * (3 - 2 * t));
        const g = this.visibleGeometry;
        const color = TEAM[this.side];
        this.outline = OUTLINE[this.direction];
        const bounce = this.frozen ? 0 : Math.sin(time / (650 - this.preparation * 250)) * (1.2 + this.preparation * 1.8);
        // This layer is the exact financial OHLC body/wick. It is never scaled
        // or transformed with the illustrated fighter sprite.
        this.body.clear().lineStyle(6, 0x071317, 1).lineBetween(0, g.highY, 0, g.lowY);
        this.body.lineStyle(2, this.outline, 1).lineBetween(0, g.highY, 0, g.lowY);
        if (g.height > 0) {
            this.body.fillStyle(color).fillRect(-24, g.top, 48, g.height);
            this.body.fillStyle(0xffffff, .15).fillRect(-22, g.top, 10, g.height);
            this.body.fillStyle(0x001015, .2).fillRect(14, g.top, 8, g.height);
            this.body.lineStyle(2, this.outline).strokeRect(-24, g.top, 48, g.height);
            if (g.height > 8)
                this.body.lineStyle(1, 0xf3fff3, .7).lineBetween(-20, g.top + 3, 19, g.top + 3);
        }
        else
            this.body.lineStyle(2, this.outline).lineBetween(-24, g.top, 24, g.top);
        this.aura.clear();
        for (let i = 4; i >= 1; i--)
            this.aura.lineStyle(3 + i * 3, this.outline, (.012 + (this.frozen ? 0 : .006 * Math.sin(time / 170))) * (5 - i))
                .strokeRect(-25, g.top, 50, Math.max(1, g.height));
        const facing = this.side === 'left' ? 1 : -1;
        // The candle stays above the fighter. A fixed foot line keeps market
        // updates from resizing or lifting the character mid-fight. The closing
        // cinematic drives celebration/defeat as intensities so the winner keeps
        // celebrating and the loser keeps an animated defeat until capture.
        const celebration = !this.frozen ? this.celebration * Math.abs(Math.sin(time / 190)) * 17 : 0;
        const defeat = this.defeat * (18 + (this.frozen ? 0 : Math.sin(time / 800) * 2));
        const footY = 185 + bounce + this.combat.hit * 2 - celebration + defeat;
        const spriteX = facing * (this.combat.attack * 5 - this.combat.dodge * 3 + (this.frozen ? 0 : Math.sin(time / 900) * (.8 + this.preparation * 1.5)));
        const scale = this.presentationScale + (this.frozen ? 0 : Math.sin(time / 730) * .008) + this.celebration * .035;
        const rotation = this.celebration > 0 && this.defeat === 0 ? Math.sin(time / 190) * .08 * this.celebration
            : this.defeat > 0 && this.celebration === 0 ? facing * .27 * this.defeat
                : this.frozen || this.phase !== 'FORMING_CANDLE' ? 0 : Math.sin(time / 1150) * (0.012 + this.preparation * .015);
        this.sprite.setPosition(spriteX, footY).setScale(scale).setFlipX(this.side === 'right').setRotation(rotation);
        const breakFrame = Math.min(7, Math.floor(progress * 8));
        const recovery = this.phase === 'SPAWNING' ? (Math.min(2, Math.floor(progress * 3)) + 1) / 3 : 1;
        const alpha = (this.phase === 'DESTROYING' && !this.win) ? 1 - breakFrame / 7 :
            (!this.draw && !this.win && ['VICTORY', 'BLOCK_FALLING', 'BLOCK_LOCKING', 'ROUND_COMPLETE'].includes(this.phase)) ? 0 : recovery;
        this.body.setAlpha(alpha);
        if (this.celebration > 0) {
            const strength = Math.min(1, this.celebration);
            for (let i = 0; i < 3; i++)
                this.aura.lineStyle(2, this.outline, (.3 - i * .06) * strength)
                    .strokeCircle(0, 178 - celebration, 28 + i * 12 + Math.sin(time / 230 + i) * 5);
        }
        this.aura.setAlpha(alpha);
        this.sprite.setAlpha(alpha * (1 - .28 * Math.min(1, this.defeat)));
        this.positionOverlays(time);
    }
    /** Closing pose motion that does not depend on candle geometry. */
    applyClosingMotion(time) {
        if (this.finalState === 'none') {
            this.positionOverlays(time);
            return;
        }
        const facing = this.side === 'left' ? 1 : -1;
        const celebration = this.frozen ? 0 : this.celebration * Math.abs(Math.sin(time / 190)) * 17;
        const defeat = this.defeat * (18 + (this.frozen ? 0 : Math.sin(time / 800) * 2));
        const footY = 185 - celebration + defeat;
        const spriteX = this.frozen ? 0 : facing * Math.sin(time / 900) * .8;
        const scale = this.presentationScale + (this.frozen ? 0 : Math.sin(time / 730) * .008) + this.celebration * .035;
        const rotation = this.celebration > 0 && this.defeat === 0 ? Math.sin(time / 190) * .08 * this.celebration
            : this.defeat > 0 && this.celebration === 0 ? facing * .27 * this.defeat
                : this.frozen ? 0 : Math.sin(time / 1150) * .012;
        this.sprite.setPosition(spriteX, footY).setScale(scale).setFlipX(this.side === 'right').setRotation(rotation);
        this.positionOverlays(time);
    }
    /** Keeps decals glued to the fighter's cell space, including flip and tilt. */
    positionOverlays(time) {
        if (!this.overlays.length)
            return;
        const facing = this.side === 'left' ? 1 : -1;
        const scale = Math.abs(this.sprite.scaleX);
        const rotation = this.sprite.rotation;
        const cos = Math.cos(rotation), sin = Math.sin(rotation);
        for (const entry of this.overlays) {
            const anchor = OVERLAY_ANCHORS[entry.kind];
            const sway = entry.star && !this.frozen ? Math.sin(time / 260) * 9 : 0;
            const ax = (anchor.x + sway) * facing * scale;
            const ay = anchor.y * scale;
            entry.image.setPosition(this.sprite.x + ax * cos - ay * sin, this.sprite.y + ax * sin + ay * cos);
            entry.image.setScale(scale).setRotation(rotation * .5).setFlipX(this.side === 'right').setAlpha(this.sprite.alpha);
        }
    }
    playAnimation(restart) {
        // The colour variants overlap in the supplied triptych. Keep each
        // team's neutral character while the OHLC outline conveys direction.
        const key = animationKey(this.side, 'neutral', this.animation);
        if (!this.scene.anims.exists(key))
            return;
        this.sprite.anims.play(key, restart);
        if (this.frozen)
            this.sprite.anims.pause();
    }
    destroy() { this.root.destroy(true); }
}
