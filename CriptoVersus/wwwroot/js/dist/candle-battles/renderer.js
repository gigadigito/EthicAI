import { TEAM, OUTLINE, candleDirection, fighterAnimationForPhase, project, interpolate } from './model.js';
const ACTION_FRAME_COUNTS = {
    run: 8,
    punch: 6,
    break: 8,
    recover: 3,
};
const fighterFrame = (side, direction, action, frame) => `fighter-${side}-${direction}-${action === 'idle' ? 'recover' : action}-${Math.max(1, frame)}`;
const animationKey = (side, direction, action) => `candle-${side}-${direction}-${action}`;
/** Register real sprite-sheet sequences once the atlas has loaded. */
export function registerFighterAnimations(scene) {
    for (const side of ['left', 'right'])
        for (const direction of ['neutral', 'up', 'down']) {
            for (const action of ['idle', 'run', 'punch', 'break', 'recover']) {
                const key = animationKey(side, direction, action);
                if (scene.anims.exists(key))
                    continue;
                const sourceAction = action === 'idle' ? 'recover' : action;
                const count = ACTION_FRAME_COUNTS[sourceAction];
                scene.anims.create({
                    key,
                    frames: Array.from({ length: count }, (_, i) => ({ key: 'modular', frame: fighterFrame(side, direction, sourceAction, i + 1) })),
                    frameRate: action === 'run' ? 12 : action === 'punch' ? 18 : action === 'break' ? 14 : 8,
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
        this.impulse = 0;
        this.range = 0;
        this.frozen = false;
        this.phase = 'FORMING_CANDLE';
        this.win = true;
        this.outline = OUTLINE.neutral;
        this.animation = 'idle';
        this.combat = { attack: 0, block: 0, dodge: 0, hit: 0, counter: 0, taunt: 0 };
        registerFighterAnimations(scene);
        this.aura = scene.add.graphics();
        this.body = scene.add.graphics();
        this.sprite = scene.add.sprite(0, 0, 'modular', fighterFrame(side, 'neutral', 'recover', 1));
        this.sprite.setOrigin(.5, 1);
        this.root = scene.add.container(x, y, [this.aura, this.body, this.sprite]);
        this.root.setVisible(false);
        this.playAnimation(true);
    }
    setCandle(candle, range, immediate = false) {
        if (!immediate && this.last && candle.open === this.last.open && candle.close === this.last.close && candle.high === this.last.high && candle.low === this.last.low && candle.openTime === this.last.openTime && candle.updatedAt === this.last.updatedAt && this.range === range)
            return;
        this.from = this.visibleGeometry ?? project(candle, range, 200);
        this.target = project(candle, range, 200);
        this.elapsed = immediate ? 240 : 0;
        this.last = { ...candle };
        this.range = range;
        this.direction = candleDirection(candle);
        this.impulse = 1;
        this.root.setVisible(true);
        if (immediate)
            this.visibleGeometry = { ...this.target };
        this.playAnimation(true);
    }
    setPose(phase, winner) {
        const changed = this.phase !== phase;
        this.phase = phase;
        this.win = winner;
        const next = fighterAnimationForPhase(phase);
        if (changed || next !== this.animation) {
            this.animation = next;
            this.playAnimation(true);
        }
    }
    setCombatMotion(motion) { this.combat = { ...motion }; }
    setReducedMotion(reduced) {
        this.frozen = reduced;
        if (reduced)
            this.sprite.anims.pause();
        else
            this.sprite.anims.resume();
    }
    get geometry() { return this.visibleGeometry && { ...this.visibleGeometry }; }
    get financialSnapshot() { return this.last && { ...this.last }; }
    get faceSize() { return { width: this.sprite.width, height: this.sprite.height }; }
    get outlineColor() { return OUTLINE[this.direction]; }
    update(time, delta, progress = 0) {
        if (!this.target || !this.from)
            return;
        this.elapsed += Math.max(0, delta);
        const t = this.frozen ? 1 : Math.min(1, this.elapsed / 240);
        this.visibleGeometry = interpolate(this.from, this.target, t * t * (3 - 2 * t));
        const g = this.visibleGeometry;
        const color = TEAM[this.side];
        this.outline = OUTLINE[this.direction];
        const bounce = this.frozen ? 0 : Math.sin(time / 280) * 2;
        const reaction = this.combat.hit * 8;
        const jitter = this.frozen ? reaction : Math.sin(time / 31) * this.impulse * 1.5 + Math.sin(time / 23) * reaction;
        this.impulse = Math.max(0, this.impulse - delta / 350);
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
        // Uniform scaling preserves the original sprite aspect ratio while
        // keeping a large financial body visibly larger than a small one.
        const spriteScale = Math.max(.58, Math.min(1.3, .72 + Math.min(128, g.height) / 128 * .46));
        const facing = this.side === 'left' ? 1 : -1;
        const footY = g.bottom + 30 + bounce + (this.combat.hit * 3);
        const spriteX = jitter + (this.combat.dodge - this.combat.hit) * 8 + facing * (this.combat.attack * 12 + this.combat.counter * 6);
        this.sprite.setPosition(spriteX, footY).setScale(spriteScale).setFlipX(this.side === 'right');
        const breakFrame = Math.min(7, Math.floor(progress * 8));
        const recovery = this.phase === 'SPAWNING' ? (Math.min(2, Math.floor(progress * 3)) + 1) / 3 : 1;
        const alpha = (this.phase === 'DESTROYING' && !this.win) ? 1 - breakFrame / 7 :
            (!this.win && ['VICTORY', 'BLOCK_FALLING', 'BLOCK_LOCKING', 'ROUND_COMPLETE'].includes(this.phase)) ? 0 : recovery;
        this.body.setAlpha(alpha);
        this.sprite.setAlpha(alpha);
        this.aura.setAlpha(alpha);
    }
    playAnimation(restart) {
        const key = animationKey(this.side, this.direction, this.animation);
        if (!this.scene.anims.exists(key))
            return;
        this.sprite.anims.play(key, restart);
        if (this.frozen)
            this.sprite.anims.pause();
    }
    destroy() { this.root.destroy(true); }
}
