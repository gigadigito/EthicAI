import { TEAM, OUTLINE, candleDirection, fighterAnimationForPhase, project, interpolate, resolveRoundResultPose, ROUND_RESULT_RETURN_MS } from './model.js?v=20261030b';
import { frameAt, transformAt } from './combat-animations.js?v=20261030b';
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
/** Stable atlas frames used when a poster capture freezes an animated pose. */
export const FINISHER_CAPTURE_FRAMES = {
    charge: 3,
    attack: 4,
    'hurt-stagger': 3,
    knockout: 4,
    'defeated-idle': 2,
    'victory-loop': 2,
    dizzy: 2,
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
/** Overlay art occupies only the centre of a 200px atlas cell. */
export const OVERLAY_SCALES = {
    bandage: .42,
    bruise: .36,
    star: .48,
};
export const overlayAnchor = (kind) => OVERLAY_ANCHORS[kind];
/**
 * Impact particle frames. They already ship in candle-finishers.png but were
 * never registered: they are arena VFX, not body decals, so they keep their own
 * anchor and scale instead of joining OVERLAY_KINDS.
 */
export const IMPACT_FX_KINDS = ['spark', 'dust', 'ring', 'trail'];
export const IMPACT_FX_FRAMES = {
    spark: ['overlay-spark'],
    dust: ['overlay-dust'],
    ring: ['overlay-ring'],
    trail: ['overlay-trail'],
};
/** Impact point between the fighters, in sprite-local units. */
export const IMPACT_FX_ANCHORS = {
    spark: { x: 26, y: -96 },
    dust: { x: 0, y: -22 },
    ring: { x: 20, y: -88 },
    trail: { x: 34, y: -104 },
};
export const IMPACT_FX_SCALES = {
    spark: .55, dust: .7, ring: .62, trail: .5,
};
export const IMPACT_FX_LIFETIME_MS = {
    spark: 260, dust: 420, ring: 340, trail: 300,
};
export const impactFxAnchor = (kind) => IMPACT_FX_ANCHORS[kind];
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
        this.combatStartedAt = 0;
        this.impactFx = [];
        /** Latest simulation-clock reading; drives the round-result reaction window. */
        this.clockNow = 0;
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
        const hadFinisher = this.finisher != null;
        // A new round is a hard presentation boundary. Phaser retains the
        // current texture, frame and transform when an animation is stopped,
        // including frames sourced from candle-finishers. Restore the shared
        // 200px-cell baseline before selecting the next modular animation so a
        // knockout/fall can never leak its pose into the next candle.
        if (phase === 'SPAWNING' || phase === 'WAITING_MARKET')
            this.resetRoundVisualState();
        this.finalState = 'none';
        this.celebration = 0;
        this.defeat = 0;
        this.heldFrame = undefined;
        this.finisher = undefined;
        this.phase = phase;
        if (phase !== 'FORMING_CANDLE')
            this.preparation = 0;
        this.win = winner;
        this.draw = draw;
        if (phase === 'SPAWNING' || phase === 'WAITING_MARKET') {
            this.resultRole = undefined;
            this.resultHeldSince = undefined;
        }
        if (phase === 'DESTROYING' || phase === 'VICTORY')
            this.resultRole = draw ? 'draw' : winner ? 'winner' : 'loser';
        if (this.resultRole) {
            const pose = resolveRoundResultPose(phase, this.resultRole, finishersAvailable(this.scene, this.side));
            if (pose) {
                // The reaction keeps holding briefly once the fighter is back in
                // its corner, then it must stand up again: the candle-forming
                // wait can last minutes and a looping reaction would leave the
                // character flat on the floor for all of it.
                if (phase === 'FORMING_CANDLE' && this.resultHeldSince == null)
                    this.resultHeldSince = this.clockNow;
                this.applyPose(pose);
                return;
            }
        }
        let next = fighterAnimationForPhase(phase);
        if (next === 'recover')
            next = 'idle';
        if (!draw && winner && ['BLOCK_FALLING', 'BLOCK_LOCKING'].includes(phase))
            next = 'idle';
        if (next !== this.animation || hadFinisher) {
            this.animation = next;
            this.playAnimation(true);
        }
    }
    setFinalState(state) {
        this.finalState = state;
        this.resultRole = undefined;
        this.resultHeldSince = undefined;
        this.combatPlan = undefined;
        this.clearImpactFx();
        this.phase = 'FORMING_CANDLE';
        this.preparation = 0;
        this.heldFrame = undefined;
        this.finisher = undefined;
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
        this.resultRole = undefined;
        this.resultHeldSince = undefined;
        this.applyPose(pose);
    }
    /** Shared pose application for the closing cinematic and round-result beats. */
    applyPose(pose) {
        // A round-result or closing beat owns the sprite frame outright.
        this.combatPlan = undefined;
        this.clearImpactFx();
        this.celebration = pose.celebration;
        this.defeat = pose.defeat;
        this.combat = { attack: 0, block: 0, dodge: 0, hit: 0, counter: 0, taunt: 0 };
        this.preparation = 0;
        const preferred = pose.finisher;
        const useFinisher = !!preferred && finishersAvailable(this.scene, this.side)
            && sceneHasAnimation(this.scene, finisherAnimationKey(this.side, preferred));
        if (useFinisher && preferred) {
            this.animation = 'idle';
            this.finisher = preferred;
            this.heldFrame = finisherFrameName(this.side, preferred, FINISHER_CAPTURE_FRAMES[preferred]);
            this.sprite.anims.play(finisherAnimationKey(this.side, preferred), !pose.loop);
            if (this.frozen)
                this.sprite.anims.pause();
            return;
        }
        this.finisher = undefined;
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
    /** Round-result/finale sequence currently played from the optional atlas. */
    get finisherAnimation() { return this.finisher; }
    get overlaysAvailable() { return this.overlays.length > 0; }
    get overlayKinds() { return this.overlays.map(entry => entry.kind); }
    resetPresentation() {
        this.resultRole = undefined;
        this.resultHeldSince = undefined;
        this.combatPlan = undefined;
        this.combatStartedAt = 0;
        this.clearImpactFx();
        this.resetRoundVisualState();
        this.setPose('FORMING_CANDLE', true);
        this.clearOverlays();
        this.combat = { attack: 0, block: 0, dodge: 0, hit: 0, counter: 0, taunt: 0 };
        this.sprite.setPosition(0, 185).setScale(this.presentationScale).setRotation(0).setAlpha(1);
        this.body.setAlpha(1);
        this.aura.clear().setAlpha(1);
        this.root.setVisible(true);
    }
    /**
     * Clears only transient presentation ownership at a battle boundary. The
     * OHLC geometry deliberately remains separate, preserving candle-size
     * proportions while the fighter returns to its canonical atlas cell.
     */
    resetRoundVisualState() {
        this.combatPlan = undefined;
        this.combatStartedAt = 0;
        this.clearImpactFx();
        this.clearOverlays();
        this.finalState = 'none';
        this.resultRole = undefined;
        this.resultHeldSince = undefined;
        this.finisher = undefined;
        this.heldFrame = undefined;
        this.celebration = 0;
        this.defeat = 0;
        this.combat = { attack: 0, block: 0, dodge: 0, hit: 0, counter: 0, taunt: 0 };
        // The idle animation must be re-entered explicitly: a bare anims.stop()
        // leaves currentAnim pointing at the stale finisher sequence after a
        // replay or a new confrontation.
        this.animation = 'idle';
        this.sprite.anims.stop();
        this.sprite.setTexture('modular', fighterFrame(this.side, 'neutral', 'idle', 1))
            .setOrigin(.5, 1)
            .setPosition(0, 185)
            .setScale(this.presentationScale)
            .setFlipX(this.side === 'right')
            .setRotation(0)
            .setAlpha(1);
        this.playAnimation(true);
        this.body.setAlpha(1);
        this.aura.setAlpha(1);
    }
    setCombatMotion(motion) { this.combat = { ...motion }; }
    /**
     * True while a combat beat owns the sprite frame. The closing cinematic and
     * the round-result beats always take precedence, so their frames cannot be
     * stolen by an in-round idle or attack.
     */
    get ownsSpriteFrame() {
        return this.combatPlan != null && this.finalState === 'none' && this.resultRole == null && this.finisher == null;
    }
    /**
     * Applies one in-round combat beat. Refused while a result or closing pose
     * is on screen so the cinematic keeps playing untouched.
     */
    setCombatPlan(plan, elapsedMs = 0) {
        if (!plan) {
            this.combatPlan = undefined;
            this.combatStartedAt = 0;
            return false;
        }
        if (this.finalState !== 'none' || this.resultRole || this.finisher != null)
            return false;
        const restart = this.combatPlan?.state !== plan.state;
        this.combatPlan = { ...plan, motion: { ...plan.motion }, fx: { ...plan.fx } };
        if (restart) {
            this.combatStartedAt = Number.isFinite(elapsedMs) ? elapsedMs : 0;
            // The combat beat owns the texture frame from here on.
            this.sprite.anims.stop();
            this.spawnImpactFx(plan);
        }
        return true;
    }
    /** Releases the sprite frame back to the phase-driven sequences. */
    clearCombatPlan() {
        if (!this.combatPlan)
            return;
        this.combatPlan = undefined;
        this.combatStartedAt = 0;
        this.clearImpactFx();
        this.playAnimation(true);
    }
    /**
     * Ends the round-result reaction and puts the fighter back in a combat
     * stance. The closing cinematic is the only pose that holds indefinitely.
     */
    releaseResultBeat() {
        this.resultRole = undefined;
        this.resultHeldSince = undefined;
        this.finisher = undefined;
        this.heldFrame = undefined;
        this.celebration = 0;
        this.defeat = 0;
        this.combat = { attack: 0, block: 0, dodge: 0, hit: 0, counter: 0, taunt: 0 };
        this.animation = 'idle';
        this.playAnimation(true);
    }
    /**
     * Drops an overdue round-result reaction. The candle-forming wait lasts until
     * the next five-minute close, so a looping reaction would otherwise leave the
     * character on the floor for the whole gap.
     */
    expireResultBeat(time) {
        if (this.resultHeldSince == null || this.resultRole == null)
            return;
        if (this.phase !== 'FORMING_CANDLE')
            return;
        const now = Number.isFinite(time) ? time : this.clockNow;
        if (now - this.resultHeldSince < ROUND_RESULT_RETURN_MS)
            return;
        this.releaseResultBeat();
    }
    get combatState() { return this.ownsSpriteFrame && this.combatPlan ? this.combatPlan.state : 'none'; }
    get combatPlanSnapshot() { return this.combatPlan && { ...this.combatPlan }; }
    get impactFxCount() { return this.impactFx.length; }
    /** Instantiates the plan's impact frame from the optional finisher atlas. */
    spawnImpactFx(plan) {
        const kind = plan.fx.overlay;
        if (!kind || this.frozen)
            return;
        const names = IMPACT_FX_FRAMES[kind];
        const name = names[0];
        if (!hasFrame(this.scene, FINISHER_ATLAS, name))
            return;
        const anchor = IMPACT_FX_ANCHORS[kind];
        const facing = this.side === 'left' ? 1 : -1;
        const image = this.scene.add.sprite(0, 0, FINISHER_ATLAS, name);
        image.setOrigin(.5, .5).setDepth(2);
        this.root.add(image);
        image.setPosition(anchor.x * facing, anchor.y);
        this.impactFx.push({ kind, age: 0, image });
    }
    clearImpactFx() {
        for (const entry of this.impactFx)
            entry.image.destroy();
        this.impactFx = [];
    }
    setPresentationScale(scale) {
        this.presentationScale = scale;
        // Keep the sprite on the presentation baseline immediately; otherwise
        // the fighter visibly resizes only at the first geometry update.
        this.sprite.setScale(scale);
    }
    setPreparation(tension, time) {
        this.expireResultBeat(time);
        // The closing cinematic owns the fighter pose; idle tension must not
        // steal the held victory/defeat frame every tick. Round-result beats
        // own the pose the same way until the next battle starts.
        if (this.finalState !== 'none' || this.resultRole)
            return;
        this.preparation = Math.max(0, Math.min(1, tension));
        // An active combat beat owns the pose and the transform.
        if (this.ownsSpriteFrame)
            return;
        this.combat = { attack: 0, block: .2 + this.preparation * .35, dodge: .12 * Math.abs(Math.sin(time / 1700)), hit: 0, counter: 0,
            taunt: this.preparation > .8 ? .18 : .08 * Math.abs(Math.sin(time / 2100)) };
        // Forming candle is an inter-round state.  Its old intermittent `run`
        // selection exposed side-profile source frames while fighters were
        // stationary, making them look vertically sliced.  Keep the canonical
        // idle cell on screen; tension still drives the candle aura and the
        // subtle stance motion above.
        const next = 'idle';
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
        if (this.finisher && this.heldFrame) {
            this.sprite.setTexture(FINISHER_ATLAS, this.heldFrame);
            return;
        }
        if (this.combatPlan) {
            // The combat beat already put a real frame on screen; hold it.
            this.sprite.setTexture('modular', fighterFrame(this.side, 'neutral', this.combatPlan.animation, this.combatPlan.captureFrame ?? this.combatPlan.frameWindow[0]));
            return;
        }
        const frames = this.animation === 'idle' ? 1 : ACTION_FRAME_COUNTS[this.animation];
        this.sprite.setTexture('modular', this.heldFrame ?? fighterFrame(this.side, 'neutral', this.animation, frames));
    }
    /** Resume animated playback after <see cref="freezePose"/> (dev inspection). */
    releaseFrame() {
        this.frozen = false;
        if (this.finisher) {
            this.sprite.anims.play(finisherAnimationKey(this.side, this.finisher), false);
            return;
        }
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
        return { x: this.speechAnchorX, y: this.speechAnchorY };
    }
    get speechAnchorX() { return this.root.x + this.sprite.x; }
    get speechAnchorY() { return this.root.y + this.sprite.y - 165; }
    update(time, delta, progress = 0) {
        this.clockNow = Number.isFinite(time) ? time : this.clockNow;
        this.expireResultBeat(this.clockNow);
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
        // The solid body and wick remain the exact OHLC projection. A very
        // faint envelope only on an unconfirmed forming candle breathes around
        // those bounds, making incoming market updates legible without
        // falsifying the candle size or either fighter's scale.
        if (this.phase === 'FORMING_CANDLE' && !this.last?.confirmed && !this.frozen) {
            const pulse = .8 + (Math.sin(time / 430) + 1) * Math.min(2.4, Math.max(.8, g.height * .055));
            const top = g.top - pulse, height = Math.max(1, g.height + pulse * 2);
            this.aura.fillStyle(color, .055).fillRect(-27, top, 54, height);
            this.aura.lineStyle(1.5, this.outline, .38).strokeRect(-27, top, 54, height);
        }
        const facing = this.side === 'left' ? 1 : -1;
        // The candle stays above the fighter. A fixed foot line keeps market
        // updates from resizing or lifting the character mid-fight. The closing
        // cinematic drives celebration/defeat as intensities so the winner keeps
        // celebrating and the loser keeps an animated defeat until capture.
        const illustrated = this.finisher != null;
        const celebration = !this.frozen ? this.celebration * Math.abs(Math.sin(time / 190)) * (illustrated ? 2 : 17) : 0;
        const defeat = illustrated ? (this.frozen ? 0 : this.defeat * Math.sin(time / 800) * .8)
            : this.defeat * (18 + (this.frozen ? 0 : Math.sin(time / 800) * 2));
        const stateAge = this.frozen ? 1e6 : Math.max(0, time - this.combatStartedAt);
        // Reduced motion and frozen captures stay still: only the frame driver
        // runs below, and it parks on the plan's stable capture frame.
        const ct = this.ownsSpriteFrame && this.combatPlan && !this.frozen
            ? transformAt(this.combatPlan, time, facing, this.presentationScale, stateAge)
            : null;
        const footY = 185 + bounce + this.combat.hit * 2 - celebration + defeat + (ct ? ct.y : 0);
        const spriteX = facing * (this.combat.attack * 5 - this.combat.dodge * 3 + (this.frozen ? 0 : Math.sin(time / 900) * (.8 + this.preparation * 1.5)))
            + (ct ? ct.x : 0);
        const scale = ct ? ct.scale : this.presentationScale + (this.frozen ? 0 : Math.sin(time / 730) * .008);
        const rotation = (illustrated ? 0 : this.celebration > 0 && this.defeat === 0 ? Math.sin(time / 190) * .08 * this.celebration
            : this.defeat > 0 && this.celebration === 0 ? facing * .27 * this.defeat
                : this.frozen || this.phase !== 'FORMING_CANDLE' ? 0 : Math.sin(time / 1150) * (0.012 + this.preparation * .015))
            + (ct ? ct.rotation : 0);
        this.sprite.setPosition(spriteX, footY).setScale(scale).setFlipX(this.side === 'right').setRotation(rotation);
        if (this.ownsSpriteFrame && this.combatPlan) {
            // Frames come from the simulation clock, so live, replay, seeking,
            // accelerated playback and pause all land on the same drawing.
            const plan = this.combatPlan;
            const index = this.frozen ? (plan.captureFrame ?? plan.frameWindow[0]) : frameAt(plan, time);
            this.sprite.setTexture('modular', fighterFrame(this.side, 'neutral', plan.animation, index));
        }
        const breakFrame = Math.min(7, Math.floor(progress * 8));
        const recovery = this.phase === 'SPAWNING' ? (Math.min(2, Math.floor(progress * 3)) + 1) / 3 : 1;
        const bodyAlpha = (this.phase === 'DESTROYING' && !this.win) ? 1 - breakFrame / 7 :
            (!this.draw && !this.win && ['VICTORY', 'BLOCK_FALLING', 'BLOCK_LOCKING', 'ROUND_COMPLETE'].includes(this.phase)) ? 0 : recovery;
        this.body.setAlpha(bodyAlpha);
        if (this.celebration > 0) {
            const strength = Math.min(1, this.celebration);
            for (let i = 0; i < 3; i++)
                this.aura.lineStyle(2, this.outline, (.3 - i * .06) * strength)
                    .strokeCircle(0, 178 - celebration, 28 + i * 12 + Math.sin(time / 230 + i) * 5);
        }
        this.aura.setAlpha(bodyAlpha);
        // The destroyed candle fades while the fighter stays visible to reel or
        // celebrate the round result until the next battle starts. The spawn
        // recovery ramp belongs to the candle body only: the fighter sprite is
        // restored to its full baseline whenever a new confrontation begins.
        const spriteAlpha = this.resultRole ? recovery : 1;
        this.sprite.setAlpha(spriteAlpha * (1 - .28 * Math.min(1, this.defeat)) * (1 - .45 * (ct?.flash ?? 0)));
        this.positionImpactFx(Math.max(0, delta), facing, scale);
        this.positionOverlays(time);
    }
    /**
     * Ages and re-anchors the impact particles. Each one is a real frame from
     * candle-finishers.png; nothing generic is drawn when the atlas is absent.
     */
    positionImpactFx(delta, facing, scale) {
        for (let i = this.impactFx.length - 1; i >= 0; i--) {
            const entry = this.impactFx[i];
            entry.age += delta;
            const life = IMPACT_FX_LIFETIME_MS[entry.kind];
            const anchor = IMPACT_FX_ANCHORS[entry.kind];
            entry.image.setPosition(this.sprite.x + anchor.x * facing * scale, this.sprite.y + anchor.y * scale);
            entry.image.setScale(scale * IMPACT_FX_SCALES[entry.kind] * (1 + entry.age / life))
                .setFlipX(this.side === 'right')
                .setAlpha(Math.max(0, 1 - entry.age / life) * this.sprite.alpha);
            if (entry.age >= life) {
                entry.image.destroy();
                this.impactFx.splice(i, 1);
            }
        }
    }
    /** Closing pose motion that does not depend on candle geometry. */
    applyClosingMotion(time) {
        if (this.finalState === 'none') {
            this.positionOverlays(time);
            return;
        }
        const facing = this.side === 'left' ? 1 : -1;
        const illustrated = this.finisher != null;
        const celebration = this.frozen ? 0 : this.celebration * Math.abs(Math.sin(time / 190)) * (illustrated ? 2 : 17);
        const defeat = illustrated ? (this.frozen ? 0 : this.defeat * Math.sin(time / 800) * .8)
            : this.defeat * (18 + (this.frozen ? 0 : Math.sin(time / 800) * 2));
        const footY = 185 - celebration + defeat;
        const spriteX = this.frozen ? 0 : facing * Math.sin(time / 900) * .8;
        const scale = this.presentationScale + (this.frozen ? 0 : Math.sin(time / 730) * .008);
        const rotation = illustrated ? 0 : this.celebration > 0 && this.defeat === 0 ? Math.sin(time / 190) * .08 * this.celebration
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
            const fallen = this.finisher === 'knockout' || this.finisher === 'defeated-idle';
            const anchor = fallen
                ? entry.kind === 'bandage' ? { x: 18, y: -18 }
                    : entry.kind === 'bruise' ? { x: -18, y: -12 }
                        : { x: 0, y: -62 }
                : OVERLAY_ANCHORS[entry.kind];
            const sway = entry.star && !this.frozen ? Math.sin(time / 260) * 9 : 0;
            const ax = (anchor.x + sway) * facing * scale;
            const ay = anchor.y * scale;
            entry.image.setPosition(this.sprite.x + ax * cos - ay * sin, this.sprite.y + ax * sin + ay * cos);
            entry.image.setScale(scale * OVERLAY_SCALES[entry.kind]).setRotation(rotation * .5)
                .setFlipX(this.side === 'right').setAlpha(this.sprite.alpha);
        }
    }
    playAnimation(restart) {
        // The combat beat drives its own frames from the simulation clock.
        if (this.ownsSpriteFrame)
            return;
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
