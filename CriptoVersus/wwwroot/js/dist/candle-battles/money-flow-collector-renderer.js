import { MONEY_FLOW_EFFECTS_ATLAS, INFERNAL_PIT_FRAMES } from './money-flow-effects-renderer.js?v=20261106b';
const COLLECTOR_ATLAS = 'money-flow-collectors';
const EFFECT_ATLAS = MONEY_FLOW_EFFECTS_ATLAS;
/**
 * Authored source-pixel bounds of the money bag inside collector frames.
 * Collector frames contain a large character cell, so the full sprite bounds
 * are not a valid anchor for a financial label. These rectangles follow the
 * actual bag artwork in the shipped atlas, including the GRAB handoff frames.
 */
const CARRIED_BAG_SOURCE_BOUNDS = {
    'demon-grab-right-1': { left: 92, top: 76, right: 154, bottom: 156 },
    'demon-carry-right-1': { left: 99, top: 60, right: 147, bottom: 119 },
    'demon-carry-right-2': { left: 89, top: 78, right: 137, bottom: 127 },
    'demon-grab-left-1': { left: 28, top: 78, right: 84, bottom: 157 },
    'demon-carry-left-1': { left: 31, top: 60, right: 83, bottom: 116 },
    'demon-carry-left-2': { left: 41, top: 78, right: 87, bottom: 132 },
    'angel-grab-right-1': { left: 93, top: 126, right: 129, bottom: 170 },
    'angel-carry-right-1': { left: 96, top: 116, right: 130, bottom: 158 },
    'angel-carry-right-2': { left: 95, top: 107, right: 130, bottom: 149 },
    'angel-grab-left-1': { left: 39, top: 119, right: 88, bottom: 170 },
    'angel-carry-left-1': { left: 43, top: 111, right: 90, bottom: 156 },
    'angel-carry-left-2': { left: 32, top: 98, right: 82, bottom: 145 },
    // Special tug uses one wide frame shared by both demons; the bag is the
    // central prop between them rather than either character's full bounds.
    'demon-tug-1': { left: 132, top: 70, right: 188, bottom: 162 },
};
/** `angel-empty` + `right` + 2 -> `angel-empty-right-1`, `angel-empty-right-2`. */
const run = (name, direction, count) => Array.from({ length: count }, (_, index) => `${name}-${direction}-${index + 1}`);
const SPECS = {
    'angel-empty': d => ({ frames: run('angel-empty', d, 2), frameRate: 10, repeat: -1 }),
    'angel-approach': d => ({ frames: run('angel-approach', d, 2), frameRate: 10, repeat: -1 }),
    'angel-hover': d => ({ frames: [`angel-approach-${d}-2`], frameRate: 1, repeat: -1 }),
    'angel-grab': d => ({ frames: run('angel-grab', d, 1), frameRate: 9, repeat: 0 }),
    'angel-hold': d => ({ frames: run('angel-hold', d, 1), frameRate: 9, repeat: 0 }),
    'angel-carry': d => ({ frames: run('angel-carry', d, 2), frameRate: 10, repeat: -1 }),
    'angel-fly': d => ({ frames: run('angel-fly', d, 6), frameRate: 12, repeat: -1 }),
    'demon-emerge': d => ({ frames: run('demon-emerge', d, 2), frameRate: 8, repeat: 0 }),
    'demon-idle': d => ({ frames: [`demon-idle-${d}-1`], frameRate: 1, repeat: -1 }),
    'demon-approach': d => ({ frames: [`demon-approach-${d}-1`], frameRate: 1, repeat: -1 }),
    'demon-grab': d => ({ frames: run('demon-grab', d, 1), frameRate: 8, repeat: 0 }),
    'demon-carry': d => ({ frames: run('demon-carry', d, 2), frameRate: 8, repeat: -1 }),
    'demon-run': d => ({ frames: run('demon-run', d, 6), frameRate: 12, repeat: -1 }),
    'demon-descend': d => ({ frames: run('demon-descend', d, 1), frameRate: 8, repeat: 0 }),
};
/** State -> animation key.  Empty-hand and carrying walks are strictly distinct. */
const STATE_ANIMATION = {
    'angel-fly-empty': 'angel-empty',
    'angel-approach': 'angel-empty',
    'angel-descend': 'angel-empty',
    'angel-hover': 'angel-hover',
    'angel-reach': 'angel-approach',
    'angel-grab': 'angel-grab',
    'angel-hold': 'angel-hold',
    'angel-carry': 'angel-fly',
    'angel-ascend': 'angel-fly',
    'angel-depart': 'angel-fly',
    'demon-emerge': 'demon-emerge',
    'demon-idle': 'demon-idle',
    'demon-approach': 'demon-idle',
    'demon-stop': 'demon-idle',
    'demon-reach': 'demon-approach',
    'demon-grab': 'demon-grab',
    'demon-carry': 'demon-carry',
    'demon-return': 'demon-run',
    'demon-descend': 'demon-descend',
    'demon-disappear': 'demon-descend',
    'demon-tug': null,
};
/** Returns the authored atlas sequence associated with a choreography state. */
export function collectorAnimationForState(state) {
    return STATE_ANIMATION[state];
}
/** Exposed for regression tests that validate atlas sequencing without Phaser. */
export function collectorAnimationFrames(animation, direction) {
    return SPECS[animation]?.(direction).frames ?? [];
}
/** Completed one-shots remain held until choreography or facing changes. */
export function collectorAnimationChanged(previousState, previousDirection, nextState, nextDirection) {
    return previousState !== nextState || previousDirection !== nextDirection;
}
export function collectorAtlasesAvailable(scene) {
    return scene.textures.exists(COLLECTOR_ATLAS) && scene.textures.exists(EFFECT_ATLAS);
}
export function registerCollectorAnimations(scene) {
    if (!collectorAtlasesAvailable(scene))
        return;
    // A frame that does not exist would register an animation that silently
    // renders nothing, so the table is checked against the loaded atlas first.
    const missing = [];
    for (const direction of ['left', 'right']) {
        for (const [name, make] of Object.entries(SPECS)) {
            const key = `money-flow-${name}-${direction}`;
            const spec = make(direction);
            for (const frame of spec.frames) {
                if (!scene.textures.get(COLLECTOR_ATLAS).has(frame))
                    missing.push(frame);
            }
            if (scene.anims.exists(key))
                continue;
            scene.anims.create({
                key,
                frames: spec.frames.map(frame => ({ key: COLLECTOR_ATLAS, frame })),
                frameRate: spec.frameRate,
                repeat: spec.repeat,
            });
        }
    }
    if (missing.length) {
        throw new Error(`Money Flow collector atlas is missing frames: ${[...new Set(missing)].join(', ')}`);
    }
    const pitKey = 'money-flow-infernal-pit';
    if (!scene.anims.exists(pitKey)) {
        scene.anims.create({
            key: pitKey,
            frames: Array.from({ length: INFERNAL_PIT_FRAMES }, (_, index) => ({ key: EFFECT_ATLAS, frame: `infernal-pit-${index + 1}` })),
            frameRate: 10,
            repeat: -1,
        });
    }
}
/** Phaser-only owner of collector sprites, portal depth and ground clipping. */
export class CollectorRenderer {
    constructor(scene, reducedMotion) {
        this.scene = scene;
        this.visuals = new Map();
        this.reducedMotion = reducedMotion;
        registerCollectorAnimations(scene);
    }
    create(id, side, polarity, x, y) {
        // The opening facing is only a first guess; setPosition() re-derives it
        // from the real displacement on every tick.
        const direction = side === 'left' ? 'right' : 'left';
        const firstFrame = polarity === 'positive' ? `angel-empty-${direction}-1` : `demon-emerge-${direction}-1`;
        const sprite = this.scene.add.sprite(x, y, COLLECTOR_ATLAS, firstFrame)
            .setOrigin(.5, 1).setScale(polarity === 'positive' ? .58 : .62).setDepth(5);
        const portal = this.scene.add.sprite(x, y, EFFECT_ATLAS, 'infernal-pit-1')
            .setOrigin(.5, .7).setScale(.72).setDepth(2.35).setVisible(false);
        const portalLip = this.scene.add.graphics().setDepth(6).setVisible(false);
        const maskShape = this.scene.add.graphics().setVisible(false);
        const mask = maskShape.createGeometryMask();
        const state = polarity === 'positive' ? 'angel-fly-empty' : 'demon-emerge';
        const visual = { id, side, polarity, direction, state, sprite, portal, portalLip, maskShape, mask, masked: false };
        this.visuals.set(id, visual);
        // The state is assigned at creation, so start it once explicitly and
        // let later equal-state ticks remain no-ops.
        this.applyAnimation(visual);
    }
    /**
     * Face the sprite along its real travel direction.  Called every tick with
     * the displacement actually applied, so the collector looks where it goes
     * both on the way out and on the way back.
     */
    setDirection(id, direction) {
        const visual = this.visuals.get(id);
        if (!visual || visual.direction === direction)
            return;
        visual.direction = direction;
        this.applyAnimation(visual);
    }
    setState(id, state) {
        const visual = this.visuals.get(id);
        if (!visual)
            return;
        const changed = collectorAnimationChanged(visual.state, visual.direction, state, visual.direction);
        visual.state = state;
        // Underground demon states keep the ground mask across their own
        // transitions so the sprite is never exposed below the floor line.
        const underground = state === 'demon-emerge' || state === 'demon-descend' || state === 'demon-disappear';
        if (!underground) {
            visual.sprite.clearMask();
            visual.masked = false;
        }
        if (changed)
            this.applyAnimation(visual);
    }
    applyAnimation(visual) {
        const state = visual.state;
        if (state === 'demon-tug') {
            visual.sprite.anims.stop();
            visual.sprite.setTexture(COLLECTOR_ATLAS, 'demon-tug-1').setScale(.52);
            return;
        }
        const key = collectorAnimationForState(state);
        visual.sprite.setScale(visual.polarity === 'positive' ? .58 : .62);
        if (!key)
            return;
        visual.sprite.anims.play(`money-flow-${key}-${visual.direction}`, true);
        if (this.reducedMotion)
            visual.sprite.anims.pause();
    }
    setPosition(id, x, y, direction) {
        const visual = this.visuals.get(id);
        if (!visual)
            return;
        if (direction)
            this.setDirection(id, direction);
        visual.sprite.setPosition(x, y);
    }
    carriedBagBounds(id) {
        const visual = this.visuals.get(id);
        if (!visual)
            return null;
        const frameName = String(visual.sprite.frame?.name ?? '');
        const source = CARRIED_BAG_SOURCE_BOUNDS[frameName];
        if (!source)
            return null;
        const spriteBounds = visual.sprite.getBounds();
        const frame = visual.sprite.frame;
        const sourceWidth = Math.max(1, Number(frame.width ?? frame.cutWidth ?? 176));
        const scaleX = spriteBounds.width / sourceWidth;
        const sourceHeight = Math.max(1, Number(visual.sprite.frame.height
            ?? visual.sprite.frame.cutHeight ?? 176));
        const scaleY = spriteBounds.height / sourceHeight;
        return {
            left: spriteBounds.x + source.left * scaleX,
            top: spriteBounds.y + source.top * scaleY,
            right: spriteBounds.x + source.right * scaleX,
            bottom: spriteBounds.y + source.bottom * scaleY,
        };
    }
    setPortal(id, x, groundY, visible, descending = false, openProgress = 1) {
        const visual = this.visuals.get(id);
        if (!visual)
            return;
        const openness = Math.max(0, Math.min(1, openProgress));
        visual.portal.setPosition(x, groundY + 5).setVisible(visible)
            .setScale(.72 * Math.max(.05, openness), .72 * Math.max(.08, openness));
        visual.portalLip.clear().setVisible(visible);
        if (visible) {
            visual.portalLip.lineStyle(5, 0x26070a, .95).strokeEllipse(x, groundY + 7, 94 * openness, 24 * openness);
            visual.portalLip.lineStyle(2, 0xff4b1f, .65).strokeEllipse(x, groundY + 5, 82 * openness, 18 * openness);
            if (!visual.portal.anims.isPlaying)
                visual.portal.anims.play('money-flow-infernal-pit');
            if (this.reducedMotion)
                visual.portal.anims.pause();
        }
        else
            visual.portal.anims.stop();
        if (descending) {
            // The mask ends exactly on the floor line, so the pit's front lip
            // occludes the demon progressively as it sinks below the surface.
            const width = this.scene.scale?.width ?? 1280;
            visual.maskShape.clear().fillStyle(0xffffff).fillRect(0, 0, width, groundY + 8);
            visual.sprite.setMask(visual.mask).setDepth(4.8);
            visual.masked = true;
        }
    }
    setReducedMotion(reduced) {
        this.reducedMotion = reduced;
        for (const visual of this.visuals.values()) {
            if (reduced) {
                visual.sprite.anims.pause();
                visual.portal.anims.pause();
            }
            else {
                visual.sprite.anims.resume();
                visual.portal.anims.resume();
            }
        }
    }
    inspect(id) {
        const visual = this.visuals.get(id);
        if (!visual)
            return null;
        return {
            state: visual.state,
            direction: visual.direction,
            frame: String(visual.sprite.frame?.name ?? ''),
            x: visual.sprite.x,
            y: visual.sprite.y,
            portalVisible: visual.portal.visible,
            masked: visual.masked,
        };
    }
    remove(id) {
        const visual = this.visuals.get(id);
        if (!visual)
            return;
        visual.sprite.clearMask();
        visual.sprite.destroy();
        visual.portal.destroy();
        visual.portalLip.destroy();
        visual.mask.destroy();
        visual.maskShape.destroy();
        this.visuals.delete(id);
    }
    destroy() {
        for (const id of [...this.visuals.keys()])
            this.remove(id);
    }
}
