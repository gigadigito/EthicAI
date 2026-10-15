import { TEAM, OUTLINE, project, interpolate } from './model.js';
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
        this.combat = { attack: 0, block: 0, dodge: 0, hit: 0, counter: 0, taunt: 0 };
        this.aura = scene.add.graphics();
        this.body = scene.add.graphics();
        this.limbs = scene.add.graphics();
        this.facePlate = scene.add.graphics();
        this.face = scene.add.image(0, 0, 'modular', 'face');
        this.root = scene.add.container(x, y, [this.aura, this.body, this.limbs, this.facePlate, this.face]);
        this.root.setVisible(false);
    }
    setCandle(candle, range, immediate = false) {
        if (!immediate && this.last && candle.open === this.last.open && candle.close === this.last.close && candle.high === this.last.high && candle.low === this.last.low && candle.openTime === this.last.openTime && candle.updatedAt === this.last.updatedAt && this.range === range)
            return;
        this.from = this.visibleGeometry ?? project(candle, range, 200);
        this.target = project(candle, range, 200);
        this.elapsed = immediate ? 240 : 0;
        this.last = { ...candle };
        this.range = range;
        this.direction = candle.close > candle.open ? 'up' : candle.close < candle.open ? 'down' : 'neutral';
        this.impulse = 1;
        this.root.setVisible(true);
        if (immediate)
            this.visibleGeometry = { ...this.target };
    }
    setPose(phase, winner) { this.phase = phase; this.win = winner; }
    setCombatMotion(motion) { this.combat = { ...motion }; }
    setReducedMotion(reduced) { this.frozen = reduced; }
    get geometry() { return this.visibleGeometry && { ...this.visibleGeometry }; }
    get financialSnapshot() { return this.last && { ...this.last }; }
    get faceSize() { return { width: this.face.width, height: this.face.height }; }
    get outlineColor() { return OUTLINE[this.direction]; }
    update(time, delta, progress = 0) {
        if (!this.target || !this.from)
            return;
        this.elapsed += Math.max(0, delta);
        const t = this.frozen ? 1 : Math.min(1, this.elapsed / 240);
        this.visibleGeometry = interpolate(this.from, this.target, t * t * (3 - 2 * t));
        const g = this.visibleGeometry, color = TEAM[this.side];
        this.outline = OUTLINE[this.direction];
        const bounce = this.frozen ? 0 : Math.sin(time / 280) * 2;
        const reaction = this.combat.hit * 8;
        const jitter = this.frozen ? reaction : Math.sin(time / 31) * this.impulse * 1.5 + Math.sin(time / 23) * reaction;
        this.impulse = Math.max(0, this.impulse - delta / 350);
        // Financial graphics have no scale or bounce transform. Pulse changes aura opacity only.
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
        // A tiny body/doji gets a floating expression above it, never an inflated financial rectangle.
        const faceY = g.height < 36 ? g.top - 22 : (g.top + g.bottom) / 2;
        const taunt = this.frozen ? 0 : Math.sin(time / 150) * this.combat.taunt * 3;
        this.facePlate.clear();
        if (g.height < 36) {
            this.facePlate.fillStyle(color).fillCircle(0, 0, 19);
            this.facePlate.lineStyle(1, this.side === 'left' ? 0xe5ff82 : 0x37dbca, .8).strokeCircle(0, 0, 19);
        }
        this.facePlate.setPosition(jitter + (this.combat.dodge - this.combat.hit) * 8, faceY + bounce + taunt - this.combat.hit * 5);
        this.face.setPosition(jitter + (this.combat.dodge - this.combat.hit) * 8, faceY + bounce + taunt - this.combat.hit * 5).setAlpha(this.phase === 'DESTROYING' && !this.win ? 1 - progress : 1);
        this.face.setFlipX(this.side === 'right');
        const dir = this.side === 'left' ? 1 : -1;
        const running = this.phase === 'APPROACHING';
        const runFrame = Math.floor(progress * 8) % 8;
        const punchFrame = Math.min(5, Math.floor(progress * 6));
        const phaseAttack = this.phase === 'ATTACKING' || this.phase === 'COLLISION' ? [0, 10, 30, 38, 26, 7][punchFrame] : 0;
        const attack = this.combat.attack * 42 + this.combat.counter * 18 + phaseAttack;
        const guard = this.combat.block;
        const lift = this.phase === 'VICTORY' && this.win ? -28 : 0;
        const swing = running && !this.frozen ? Math.sin(runFrame / 8 * Math.PI * 2) * 12 : bounce + taunt + this.combat.dodge * 8;
        this.limbs.clear();
        const armY = (g.top + g.bottom) / 2 + jitter;
        this.strokeLimb(-23, armY, -37 - swing * .3, armY + 9 + lift, -39, armY + 18 + lift, color);
        const guardX = 37 - guard * 18;
        const guardY = armY + 6 - guard * 20;
        this.strokeLimb(23, armY, guardX + attack * .5, guardY + lift, guardX + attack, guardY + 8 + lift, color);
        if (guard > .18)
            this.strokeLimb(-23, armY, -13, armY - guard * 14, 18 - guard * 10, armY - guard * 18 + lift, color);
        this.strokeLimb(-12, g.bottom + 2, -14 + swing, g.bottom + 17, -21 + swing, g.bottom + 27, color, false);
        this.strokeLimb(12, g.bottom + 2, 14 - swing, g.bottom + 17, 22 - swing, g.bottom + 27, color, false);
        this.limbs.setScale(dir, 1);
        // Break is eight opacity/fragment steps. Neither the body nor accessories are stretched.
        const breakFrame = Math.min(7, Math.floor(progress * 8));
        const recovery = this.phase === 'SPAWNING' ? (Math.min(2, Math.floor(progress * 3)) + 1) / 3 : 1;
        const alpha = (this.phase === 'DESTROYING' && !this.win) ? 1 - breakFrame / 7 :
            (!this.win && ['VICTORY', 'BLOCK_FALLING', 'BLOCK_LOCKING', 'ROUND_COMPLETE'].includes(this.phase)) ? 0 : recovery;
        this.body.setAlpha(alpha);
        this.limbs.setAlpha(alpha);
        this.face.setAlpha(alpha);
        this.facePlate.setAlpha(alpha);
        this.aura.setAlpha(alpha);
    }
    strokeLimb(x, y, elbowX, elbowY, endX, endY, color, fist = true) {
        for (const [width, ink] of [[9, 0x061417], [4, color]]) {
            this.limbs.lineStyle(width, ink).beginPath().moveTo(x, y).lineTo(elbowX, elbowY).lineTo(endX, endY).strokePath();
        }
        this.limbs.fillStyle(0x061417).fillRoundedRect(endX - 7, endY - 5, 15, 11, 4);
        this.limbs.lineStyle(2, this.side === 'right' ? 0x2ba99e : color).strokeRoundedRect(endX - 7, endY - 5, 15, 11, 4);
        if (fist)
            this.limbs.lineStyle(1, 0xffffff, .3).lineBetween(endX - 3, endY - 2, endX + 3, endY - 2);
    }
    destroy() { this.root.destroy(true); }
}
