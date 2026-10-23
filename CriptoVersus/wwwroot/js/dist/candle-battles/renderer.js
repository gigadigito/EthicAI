import { TEAM, OUTLINE, candleDirection, fighterAnimationForPhase, project, interpolate } from './model.js?v=20261023c';
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
        registerFighterAnimations(scene);
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
        this.combat = { attack: 0, block: 0, dodge: 0, hit: 0, counter: 0, taunt: 0 };
        const next = state === 'winner' ? 'recover' : state === 'loser' ? 'break' : 'idle';
        if (next !== this.animation) {
            this.animation = next;
            this.playAnimation(true);
        }
    }
    resetPresentation() {
        this.setPose('FORMING_CANDLE', true);
        this.combat = { attack: 0, block: 0, dodge: 0, hit: 0, counter: 0, taunt: 0 };
        this.sprite.setPosition(0, 185).setScale(this.presentationScale).setRotation(0).setAlpha(1);
        this.body.setAlpha(1);
        this.aura.clear().setAlpha(1);
        this.root.setVisible(true);
    }
    setCombatMotion(motion) { this.combat = { ...motion }; }
    setPresentationScale(scale) { this.presentationScale = scale; }
    setPreparation(tension, time) {
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
        this.sprite.setFrame(fighterFrame(this.side, 'neutral', this.animation, frames));
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
        if (!this.target || !this.from)
            return;
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
        // updates from resizing or lifting the character mid-fight.
        const celebration = this.finalState === 'winner' && !this.frozen ? Math.abs(Math.sin(time / 190)) * 17 : 0;
        const defeat = this.finalState === 'loser' ? 18 + (this.frozen ? 0 : Math.sin(time / 800) * 2) : 0;
        const footY = 185 + bounce + this.combat.hit * 2 - celebration + defeat;
        const spriteX = facing * (this.combat.attack * 5 - this.combat.dodge * 3 + (this.frozen ? 0 : Math.sin(time / 900) * (.8 + this.preparation * 1.5)));
        const scale = this.presentationScale + (this.frozen ? 0 : Math.sin(time / 730) * .008) + (this.finalState === 'winner' ? .035 : 0);
        const rotation = this.finalState === 'winner' ? Math.sin(time / 190) * .08 : this.finalState === 'loser' ? facing * .27 :
            this.frozen || this.phase !== 'FORMING_CANDLE' ? 0 : Math.sin(time / 1150) * (0.012 + this.preparation * .015);
        this.sprite.setPosition(spriteX, footY).setScale(scale).setFlipX(this.side === 'right').setRotation(rotation);
        const breakFrame = Math.min(7, Math.floor(progress * 8));
        const recovery = this.phase === 'SPAWNING' ? (Math.min(2, Math.floor(progress * 3)) + 1) / 3 : 1;
        const alpha = (this.phase === 'DESTROYING' && !this.win) ? 1 - breakFrame / 7 :
            (!this.draw && !this.win && ['VICTORY', 'BLOCK_FALLING', 'BLOCK_LOCKING', 'ROUND_COMPLETE'].includes(this.phase)) ? 0 : recovery;
        this.body.setAlpha(alpha);
        this.sprite.setAlpha(alpha);
        if (this.finalState === 'winner') {
            for (let i = 0; i < 3; i++)
                this.aura.lineStyle(2, this.outline, .3 - i * .06)
                    .strokeCircle(0, 178 - celebration, 28 + i * 12 + Math.sin(time / 230 + i) * 5);
        }
        this.aura.setAlpha(alpha);
        this.sprite.setAlpha(this.finalState === 'loser' ? alpha * .72 : alpha);
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
