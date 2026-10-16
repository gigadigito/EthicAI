import type Phaser from 'phaser';
import { Candle, CombatMotion, FighterAnimation, Geometry, Phase, Side, TEAM, OUTLINE, candleDirection, fighterAnimationForPhase, project, interpolate } from './model.js';

type FighterDirection = keyof typeof OUTLINE;

const ACTION_FRAME_COUNTS: Record<Exclude<FighterAnimation, 'idle'>, number> = {
    // Hold the damage pose while its alpha fades; cycling the source montage
    // would reveal neighbouring colour variants.
    run: 4,
    punch: 4,
    break: 1,
    recover: 3,
};

const fighterFrame = (side: Side, direction: FighterDirection, action: FighterAnimation, frame: number): string =>
    `fighter-${side}-${direction}-${action}-${Math.max(1, frame)}`;

const animationKey = (side: Side, direction: FighterDirection, action: FighterAnimation): string =>
    `candle-${side}-${direction}-${action}`;

/** Register real sprite-sheet sequences once the atlas has loaded. */
export function registerFighterAnimations(scene: Phaser.Scene): void {
    for (const side of ['left', 'right'] as const) for (const direction of ['neutral', 'up', 'down'] as const) {
        for (const action of ['idle', 'run', 'punch', 'break', 'recover'] as const) {
            const key = animationKey(side, direction, action);
            if (scene.anims.exists(key)) continue;
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
    readonly root: Phaser.GameObjects.Container;
    private readonly body: Phaser.GameObjects.Graphics;
    private readonly aura: Phaser.GameObjects.Graphics;
    private readonly sprite: Phaser.GameObjects.Sprite;
    private from?: Geometry;
    private target?: Geometry;
    private visibleGeometry?: Geometry;
    private elapsed = 0;
    private direction: FighterDirection = 'neutral';
    private last?: Candle;
    private range = 0;
    private frozen = false;
    private phase: Phase = 'FORMING_CANDLE';
    private win = true;
    private draw = false;
    private outline = OUTLINE.neutral;
    private animation: FighterAnimation = 'idle';
    private combat: CombatMotion = { attack: 0, block: 0, dodge: 0, hit: 0, counter: 0, taunt: 0 };

    constructor(private scene: Phaser.Scene, readonly side: Side, x: number, y: number) {
        registerFighterAnimations(scene);
        this.aura = scene.add.graphics();
        this.body = scene.add.graphics();
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

    setCandle(candle: Candle, range: number, immediate = false): void {
        if (!immediate && this.last && candle.open === this.last.open && candle.close === this.last.close && candle.high === this.last.high && candle.low === this.last.low && candle.openTime === this.last.openTime && candle.updatedAt === this.last.updatedAt && this.range === range) return;
        this.from = this.visibleGeometry ?? project(candle, range, 90);
        this.target = project(candle, range, 90);
        this.elapsed = immediate ? 240 : 0;
        this.last = { ...candle };
        this.range = range;
        const nextDirection = candleDirection(candle);
        this.direction = nextDirection;
        this.root.setVisible(true);
        if (immediate) this.visibleGeometry = { ...this.target };
        if (!this.sprite.anims.isPlaying) this.playAnimation(true);
    }

    setPose(phase: Phase, winner: boolean, draw = false): void {
        this.phase = phase;
        this.win = winner;
        this.draw = draw;
        let next = fighterAnimationForPhase(phase);
        if (next === 'recover') next = 'idle';
        if (!draw && winner && ['BLOCK_FALLING', 'BLOCK_LOCKING'].includes(phase)) next = 'idle';
        if (next !== this.animation) {
            this.animation = next;
            this.playAnimation(true);
        }
    }

    setCombatMotion(motion: CombatMotion): void { this.combat = { ...motion }; }
    setReducedMotion(reduced: boolean): void {
        this.frozen = reduced;
        if (reduced) this.sprite.anims.pause();
        else this.sprite.anims.resume();
    }
    get geometry(): Geometry | undefined { return this.visibleGeometry && { ...this.visibleGeometry }; }
    get financialSnapshot(): Candle | undefined { return this.last && { ...this.last }; }
    get faceSize(): { width: number; height: number } { return { width: this.sprite.width, height: this.sprite.height }; }
    get outlineColor(): number { return OUTLINE[this.direction]; }

    update(time: number, delta: number, progress = 0): void {
        if (!this.target || !this.from) return;
        this.elapsed += Math.max(0, delta);
        const t = this.frozen ? 1 : Math.min(1, this.elapsed / 240);
        this.visibleGeometry = interpolate(this.from, this.target, t * t * (3 - 2 * t));
        const g = this.visibleGeometry;
        const color = TEAM[this.side];
        this.outline = OUTLINE[this.direction];
        const bounce = this.frozen ? 0 : Math.sin(time / 650) * .7;

        // This layer is the exact financial OHLC body/wick. It is never scaled
        // or transformed with the illustrated fighter sprite.
        this.body.clear().lineStyle(6, 0x071317, 1).lineBetween(0, g.highY, 0, g.lowY);
        this.body.lineStyle(2, this.outline, 1).lineBetween(0, g.highY, 0, g.lowY);
        if (g.height > 0) {
            this.body.fillStyle(color).fillRect(-24, g.top, 48, g.height);
            this.body.fillStyle(0xffffff, .15).fillRect(-22, g.top, 10, g.height);
            this.body.fillStyle(0x001015, .2).fillRect(14, g.top, 8, g.height);
            this.body.lineStyle(2, this.outline).strokeRect(-24, g.top, 48, g.height);
            if (g.height > 8) this.body.lineStyle(1, 0xf3fff3, .7).lineBetween(-20, g.top + 3, 19, g.top + 3);
        } else this.body.lineStyle(2, this.outline).lineBetween(-24, g.top, 24, g.top);

        this.aura.clear();
        for (let i = 4; i >= 1; i--) this.aura.lineStyle(3 + i * 3, this.outline, (.012 + (this.frozen ? 0 : .006 * Math.sin(time / 170))) * (5 - i))
            .strokeRect(-25, g.top, 50, Math.max(1, g.height));

        const facing = this.side === 'left' ? 1 : -1;
        // The candle stays above the fighter. A fixed foot line keeps market
        // updates from resizing or lifting the character mid-fight.
        const footY = 185 + bounce + this.combat.hit * 2;
        const spriteX = facing * (this.combat.attack * 5 - this.combat.dodge * 3);
        this.sprite.setPosition(spriteX, footY).setScale(.8).setFlipX(this.side === 'right');

        const breakFrame = Math.min(7, Math.floor(progress * 8));
        const recovery = this.phase === 'SPAWNING' ? (Math.min(2, Math.floor(progress * 3)) + 1) / 3 : 1;
        const alpha = (this.phase === 'DESTROYING' && !this.win) ? 1 - breakFrame / 7 :
            (!this.draw && !this.win && ['VICTORY', 'BLOCK_FALLING', 'BLOCK_LOCKING', 'ROUND_COMPLETE'].includes(this.phase)) ? 0 : recovery;
        this.body.setAlpha(alpha);
        this.sprite.setAlpha(alpha);
        this.aura.setAlpha(alpha);
    }

    private playAnimation(restart: boolean): void {
        // The colour variants overlap in the supplied triptych. Keep each
        // team's neutral character while the OHLC outline conveys direction.
        const key = animationKey(this.side, 'neutral', this.animation);
        if (!this.scene.anims.exists(key)) return;
        this.sprite.anims.play(key, restart);
        if (this.frozen) this.sprite.anims.pause();
    }

    destroy(): void { this.root.destroy(true); }
}
