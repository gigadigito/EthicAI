import { PressureVisualStateMachine } from './pressure-visual.20261106a.js';
export class PressureArt {
    constructor(scene, candles, reducedMotion, initialBuy) {
        this.scene = scene;
        this.candles = candles;
        this.reducedMotion = reducedMotion;
        this.active = {};
        this.fading = new Set();
        this.machine = new PressureVisualStateMachine(initialBuy, 100 - initialBuy);
        this.available = this.hasAllTextures();
        if (this.available) {
            this.candles.setCharactersVisible(false);
            this.show('buy', this.machine.state.buy, 0);
            this.show('sell', this.machine.state.sell, 0);
        }
    }
    get state() { return this.machine.state; }
    update(time, buy, sell) {
        const previous = this.machine.state;
        const next = this.machine.update(buy, sell, time);
        if (!this.available)
            return;
        if (next.buy !== previous.buy)
            this.show('buy', next.buy, 200);
        if (next.sell !== previous.sell)
            this.show('sell', next.sell, 200);
        for (const side of ['buy', 'sell']) {
            const art = this.active[side];
            if (!art)
                continue;
            art.y = 434 + (this.reducedMotion ? 0 : Math.sin(time * 0.006 + (side === 'buy' ? 0 : 1.8)) * 1.2);
        }
    }
    hasAllTextures() {
        const keys = [
            'buy_state_1_balanced', 'buy_state_2_advantage', 'buy_state_2_pressed',
            'buy_state_3_dominant', 'buy_state_3_struggling', 'buy_state_4_extreme', 'buy_state_4_collapsed',
            'sell_state_1_balanced', 'sell_state_2_advantage', 'sell_state_2_pressed',
            'sell_state_3_dominant', 'sell_state_3_struggling', 'sell_state_4_extreme', 'sell_state_4_collapsed'
        ];
        const missing = keys.filter(key => !this.scene.textures.exists(key));
        if (missing.length)
            this.scene.add.text(10, 450, `Pressure textures missing: ${missing.join(', ')}`, { color: '#ffffff', fontSize: '12px' }).setDepth(100);
        return missing.length === 0;
    }
    show(side, key, duration) {
        const old = this.active[side];
        const image = this.scene.add.image(side === 'buy' ? 170 : 790, 434, key)
            .setOrigin(0.5, 1).setDisplaySize(330, 145).setDepth(12).setAlpha(duration ? 0 : 1);
        this.active[side] = image;
        if (duration && !this.reducedMotion) {
            this.scene.tweens.add({ targets: image, alpha: 1, duration, ease: 'Sine.easeInOut' });
            if (old) {
                this.fading.add(old);
                this.scene.tweens.killTweensOf(old);
                this.scene.tweens.add({ targets: old, alpha: 0, duration,
                    onComplete: () => { this.fading.delete(old); old.destroy(); } });
            }
        }
        else {
            image.setAlpha(1);
            old?.destroy();
        }
    }
    destroy() {
        for (const image of [...Object.values(this.active), ...this.fading]) {
            if (image) {
                this.scene.tweens.killTweensOf(image);
                image.destroy();
            }
        }
        this.fading.clear();
        this.active.buy = undefined;
        this.active.sell = undefined;
    }
}
