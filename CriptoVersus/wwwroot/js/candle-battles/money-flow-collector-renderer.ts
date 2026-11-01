import type PhaserTypes from 'phaser';
import type { Side } from './model.js';

export type CollectorPolarity = 'positive' | 'negative';
export type CollectorAnimationState =
    | 'angel-fly-empty' | 'angel-approach' | 'angel-descend' | 'angel-grab'
    | 'angel-carry' | 'angel-ascend' | 'angel-depart'
    | 'demon-emerge' | 'demon-idle' | 'demon-approach' | 'demon-grab'
    | 'demon-carry' | 'demon-run' | 'demon-descend' | 'demon-disappear' | 'demon-tug';

type Direction = 'left' | 'right';

const COLLECTOR_ATLAS = 'money-flow-collectors';
const EFFECT_ATLAS = 'money-flow-effects';

const counts: Record<string, number> = {
    'angel-empty': 3,
    'angel-grab': 4,
    'angel-carry': 6,
    'demon-emerge': 3,
    'demon-approach': 3,
    'demon-grab': 3,
    'demon-descend': 3,
    'demon-run': 6,
};

const animationKey = (name: string, direction?: Direction): string =>
    `money-flow-${name}${direction ? `-${direction}` : ''}`;

const frameNames = (name: string, direction: Direction, count: number): string[] =>
    Array.from({ length: count }, (_, index) => `${name}-${direction}-${index + 1}`);

export function collectorAtlasesAvailable(scene: PhaserTypes.Scene): boolean {
    return scene.textures.exists(COLLECTOR_ATLAS) && scene.textures.exists(EFFECT_ATLAS);
}

export function registerCollectorAnimations(scene: PhaserTypes.Scene): void {
    if (!collectorAtlasesAvailable(scene)) return;
    for (const direction of ['left', 'right'] as const) {
        for (const [name, count] of Object.entries(counts)) {
            const key = animationKey(name, direction);
            if (scene.anims.exists(key)) continue;
            scene.anims.create({
                key,
                frames: frameNames(name, direction, count).map(frame => ({ key: COLLECTOR_ATLAS, frame })),
                frameRate: name.includes('grab') ? 9 : name.includes('run') ? 11 : 8,
                repeat: name.includes('empty') || name.includes('carry') || name.includes('run') || name.includes('approach') ? -1 : 0,
            });
        }
    }
    const pitKey = animationKey('infernal-pit');
    if (!scene.anims.exists(pitKey)) {
        scene.anims.create({
            key: pitKey,
            frames: Array.from({ length: 10 }, (_, index) => ({ key: EFFECT_ATLAS, frame: `infernal-pit-${index + 1}` })),
            frameRate: 10,
            repeat: -1,
        });
    }
}

export interface CollectorVisualSnapshot {
    state: CollectorAnimationState;
    frame: string;
    x: number;
    y: number;
    portalVisible: boolean;
    masked: boolean;
}

interface Visual {
    id: string;
    side: Side;
    polarity: CollectorPolarity;
    direction: Direction;
    state: CollectorAnimationState;
    sprite: PhaserTypes.GameObjects.Sprite;
    portal: PhaserTypes.GameObjects.Sprite;
    portalLip: PhaserTypes.GameObjects.Graphics;
    maskShape: PhaserTypes.GameObjects.Graphics;
    mask: PhaserTypes.Display.Masks.GeometryMask;
    masked: boolean;
}

/** Phaser-only owner of collector sprites, portal depth and ground clipping. */
export class CollectorRenderer {
    private readonly visuals = new Map<string, Visual>();
    private reducedMotion: boolean;

    constructor(private readonly scene: PhaserTypes.Scene, reducedMotion: boolean) {
        this.reducedMotion = reducedMotion;
        registerCollectorAnimations(scene);
    }

    create(id: string, side: Side, polarity: CollectorPolarity, x: number, y: number): void {
        const direction: Direction = side === 'left' ? 'right' : 'left';
        const firstFrame = polarity === 'positive' ? `angel-empty-${direction}-1` : `demon-emerge-${direction}-1`;
        const sprite = this.scene.add.sprite(x, y, COLLECTOR_ATLAS, firstFrame)
            .setOrigin(.5, 1).setScale(polarity === 'positive' ? .58 : .62).setDepth(5);
        const portal = this.scene.add.sprite(x, y, EFFECT_ATLAS, 'infernal-pit-1')
            .setOrigin(.5, .7).setScale(.72).setDepth(2.35).setVisible(false);
        const portalLip = this.scene.add.graphics().setDepth(6).setVisible(false);
        const maskShape = this.scene.add.graphics().setVisible(false);
        const mask = maskShape.createGeometryMask();
        const state: CollectorAnimationState = polarity === 'positive' ? 'angel-fly-empty' : 'demon-emerge';
        this.visuals.set(id, { id, side, polarity, direction, state, sprite, portal, portalLip, maskShape, mask, masked: false });
        this.setState(id, state);
    }

    setState(id: string, state: CollectorAnimationState): void {
        const visual = this.visuals.get(id);
        if (!visual || visual.state === state && visual.sprite.anims.isPlaying) return;
        visual.state = state;
        visual.sprite.clearMask();
        visual.masked = false;
        let animation: string | null = null;
        if (state === 'demon-tug') {
            visual.sprite.anims.stop();
            visual.sprite.setTexture(COLLECTOR_ATLAS, 'demon-tug').setScale(.52);
        } else if (state.startsWith('angel-')) {
            const action = state === 'angel-grab' ? 'angel-grab'
                : state === 'angel-carry' || state === 'angel-ascend' || state === 'angel-depart' ? 'angel-carry'
                    : 'angel-empty';
            animation = animationKey(action, visual.direction);
            visual.sprite.setScale(.58);
        } else {
            const action = state === 'demon-grab' ? 'demon-grab'
                : state === 'demon-carry' || state === 'demon-run' ? 'demon-run'
                    : state === 'demon-descend' || state === 'demon-disappear' ? 'demon-descend'
                        : state === 'demon-emerge' ? 'demon-emerge' : 'demon-approach';
            animation = animationKey(action, visual.direction);
            visual.sprite.setScale(.62);
        }
        if (animation) visual.sprite.anims.play(animation, true);
        if (this.reducedMotion) visual.sprite.anims.pause();
    }

    setPosition(id: string, x: number, y: number): void {
        this.visuals.get(id)?.sprite.setPosition(x, y);
    }

    setPortal(id: string, x: number, groundY: number, visible: boolean, descending = false, openProgress = 1): void {
        const visual = this.visuals.get(id);
        if (!visual) return;
        const openness = Math.max(0, Math.min(1, openProgress));
        visual.portal.setPosition(x, groundY + 5).setVisible(visible)
            .setScale(.72 * Math.max(.05, openness), .72 * Math.max(.08, openness));
        visual.portalLip.clear().setVisible(visible);
        if (visible) {
            visual.portalLip.lineStyle(5, 0x26070a, .95).strokeEllipse(x, groundY + 7, 94 * openness, 24 * openness);
            visual.portalLip.lineStyle(2, 0xff4b1f, .65).strokeEllipse(x, groundY + 5, 82 * openness, 18 * openness);
            if (!visual.portal.anims.isPlaying) visual.portal.anims.play(animationKey('infernal-pit'));
            if (this.reducedMotion) visual.portal.anims.pause();
        } else visual.portal.anims.stop();
        if (descending) {
            visual.maskShape.clear().fillStyle(0xffffff).fillRect(0, 0, 1280, groundY + 8);
            visual.sprite.setMask(visual.mask).setDepth(4.8);
            visual.masked = true;
        }
    }

    setReducedMotion(reduced: boolean): void {
        this.reducedMotion = reduced;
        for (const visual of this.visuals.values()) {
            if (reduced) { visual.sprite.anims.pause(); visual.portal.anims.pause(); }
            else { visual.sprite.anims.resume(); visual.portal.anims.resume(); }
        }
    }

    inspect(id: string): CollectorVisualSnapshot | null {
        const visual = this.visuals.get(id);
        if (!visual) return null;
        return {
            state: visual.state,
            frame: String((visual.sprite.frame as { name?: string })?.name ?? ''),
            x: visual.sprite.x,
            y: visual.sprite.y,
            portalVisible: visual.portal.visible,
            masked: visual.masked,
        };
    }

    remove(id: string): void {
        const visual = this.visuals.get(id);
        if (!visual) return;
        visual.sprite.clearMask();
        visual.sprite.destroy();
        visual.portal.destroy();
        visual.portalLip.destroy();
        visual.mask.destroy();
        visual.maskShape.destroy();
        this.visuals.delete(id);
    }

    destroy(): void {
        for (const id of [...this.visuals.keys()]) this.remove(id);
    }
}
