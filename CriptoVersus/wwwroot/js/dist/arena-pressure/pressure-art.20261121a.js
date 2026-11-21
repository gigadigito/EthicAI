import { PressureVisualStateMachine, PRESSURE_SPRITE_KEYS } from './pressure-visual.20261121a.js';
// Sections follow transparent gaps where possible. Centers come from visible alpha.
const SECTIONS = {
    buy_state_1_balanced: { cuts: [450, 722], centers: [300, 586, 912] },
    buy_state_2_advantage: { cuts: [434, 726], centers: [262, 580, 896] },
    buy_state_2_pressed: { cuts: [400, 738], centers: [286, 569, 890] },
    buy_state_3_dominant: { cuts: [396, 736], centers: [230, 566, 926] },
    buy_state_3_struggling: { cuts: [432, 776], centers: [288, 604, 926] },
    buy_state_4_collapsed: { cuts: [378, 672], centers: [254, 525, 870] },
    buy_state_4_extreme: { cuts: [448, 772], centers: [255, 610, 950] },
    sell_state_1_balanced: { cuts: [402, 700], centers: [258, 551, 908] },
    sell_state_2_advantage: { cuts: [404, 722], centers: [240, 563, 914] },
    sell_state_2_pressed: { cuts: [458, 732], centers: [278, 595, 890] },
    sell_state_3_dominant: { cuts: [404, 816], centers: [240, 610, 971] },
    sell_state_3_struggling: { cuts: [410, 726], centers: [264, 568, 898] },
    sell_state_4_collapsed: { cuts: [466, 744], centers: [276, 605, 932] },
    sell_state_4_extreme: { cuts: [436, 682], centers: [322, 559, 841] }
};
const SOURCE_WIDTH = 1200;
const SOURCE_HEIGHT = 528;
const BASE_WIDTH = 412.5;
const BASE_HEIGHT = 181.25;
const GROUND_Y = 434;
const ROPE_Y = 350;
const TRACTION_SCALE = (GROUND_Y - ROPE_Y) / (GROUND_Y - 361);
const HAND_HEIGHT_FROM_BOTTOM = (GROUND_Y - 361) / BASE_HEIGHT;
// Inner member stays outside the wheel's x=275..685 sprite bounds.
const LEFT_INNER_X = 174;
const RIGHT_INNER_X = 786;
const TEAM_SPACING = 49;
const HAND_OFFSET_TOWARD_GAUGE = 30;
const INTACT_PRESSED_KEY = 'buy_state_2_pressed';
function characterScale(key) {
    return key.endsWith('_collapsed') ? 1 : TRACTION_SCALE;
}
function memberCenter(side, sourceIndex) {
    return side === 'buy'
        ? LEFT_INNER_X - sourceIndex * TEAM_SPACING
        : RIGHT_INNER_X + (2 - sourceIndex) * TEAM_SPACING;
}
export class PressureArt {
    constructor(scene, candles, reducedMotion, initialBuy) {
        this.scene = scene;
        this.candles = candles;
        this.reducedMotion = reducedMotion;
        this.active = {};
        this.fading = new Set();
        this.machine = new PressureVisualStateMachine(initialBuy, 100 - initialBuy);
        this.available = PRESSURE_SPRITE_KEYS.every(key => this.scene.textures.exists(key));
        if (this.available) {
            for (const key of PRESSURE_SPRITE_KEYS) {
                const texture = this.scene.textures.get(key);
                const boundaries = [0, ...SECTIONS[key].cuts, SOURCE_WIDTH];
                for (let index = 0; index < 3; index++)
                    texture.add(`member-${index}`, 0, boundaries[index], 0, boundaries[index + 1] - boundaries[index], SOURCE_HEIGHT);
            }
            this.candles.setCharactersVisible(false);
            this.show('buy', this.machine.state.buy, 0);
            this.show('sell', this.machine.state.sell, 0);
        }
    }
    get state() { return this.machine.state; }
    getCharacterScale(side) {
        const trio = this.active[side];
        return trio ? trio.images[0].displayHeight / BASE_HEIGHT : undefined;
    }
    getRopeGripPoints(side) {
        const trio = this.active[side];
        if (!trio)
            return undefined;
        if (trio.key === 'sell_state_4_extreme')
            return [];
        if (trio.key === INTACT_PRESSED_KEY) {
            const image = trio.images[0];
            return [79, 165, 249].map(x => ({ x, y: image.y - 69 }));
        }
        const direction = side === 'buy' ? 1 : -1;
        const handY = trio.images[0].y - HAND_HEIGHT_FROM_BOTTOM * trio.images[0].displayHeight;
        return [2, 1, 0].map(index => ({
            x: memberCenter(side, side === 'buy' ? index : 2 - index)
                + direction * HAND_OFFSET_TOWARD_GAUGE,
            y: handY
        }));
    }
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
            const trio = this.active[side];
            if (!trio)
                continue;
            const y = GROUND_Y + (this.reducedMotion ? 0 : Math.sin(time * 0.006 + (side === 'buy' ? 0 : 1.8)) * 1.2);
            for (const image of trio.images)
                image.y = y;
        }
    }
    show(side, key, duration) {
        const old = this.active[side];
        let images;
        if (key === INTACT_PRESSED_KEY) {
            // The first two silhouettes overlap in this source; splitting them cuts a face.
            const image = this.scene.add.image(143, GROUND_Y, key, '__BASE')
                .setOrigin(0.5, 1).setDisplaySize(335, 335 * SOURCE_HEIGHT / SOURCE_WIDTH)
                .setDepth(12).setAlpha(duration ? 0 : 1);
            image.setFlipX(true);
            images = [image];
        }
        else {
            const sections = SECTIONS[key];
            const width = BASE_WIDTH * characterScale(key);
            const height = BASE_HEIGHT * characterScale(key);
            const boundaries = [0, ...sections.cuts, SOURCE_WIDTH];
            images = [0, 1, 2].map(index => {
                const sectionWidth = boundaries[index + 1] - boundaries[index];
                const visibleCenterOffset = (sectionWidth / 2 - sections.centers[index] + boundaries[index])
                    * width / SOURCE_WIDTH;
                const image = this.scene.add.image(memberCenter(side, index) - visibleCenterOffset, GROUND_Y, key, `member-${index}`)
                    .setOrigin(0.5, 1).setDisplaySize(sectionWidth * width / SOURCE_WIDTH, height)
                    .setDepth(12).setAlpha(duration ? 0 : 1);
                image.setFlipX(true);
                return image;
            });
        }
        this.active[side] = { key, images };
        if (duration && !this.reducedMotion) {
            for (const image of images)
                this.scene.tweens.add({ targets: image, alpha: 1, duration, ease: 'Sine.easeInOut' });
            if (old)
                for (const image of old.images) {
                    this.fading.add(image);
                    this.scene.tweens.killTweensOf(image);
                    this.scene.tweens.add({ targets: image, alpha: 0, duration,
                        onComplete: () => { this.fading.delete(image); image.destroy(); } });
                }
        }
        else {
            for (const image of images)
                image.setAlpha(1);
            for (const image of old?.images ?? [])
                image.destroy();
        }
    }
    destroy() {
        for (const image of [...Object.values(this.active).flatMap(trio => trio?.images ?? []), ...this.fading]) {
            this.scene.tweens.killTweensOf(image);
            image.destroy();
        }
        this.fading.clear();
        this.active.buy = undefined;
        this.active.sell = undefined;
    }
}
