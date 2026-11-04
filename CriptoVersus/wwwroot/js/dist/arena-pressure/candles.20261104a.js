import { determineCandleState } from './model.20261104a.js';
export class CandleTeamManager {
    constructor(scene) {
        this.leftCandles = [];
        this.rightCandles = [];
        this.previousLeftPressure = 50;
        this.scene = scene;
        this.createAnimations();
        this.createTeams();
    }
    createAnimations() {
        if (!this.scene.anims.exists('orange-pull')) {
            this.scene.anims.create({
                key: 'orange-pull',
                frames: this.scene.anims.generateFrameNumbers('orange', { start: 0, end: 7 }),
                frameRate: 7,
                repeat: -1
            });
        }
        if (!this.scene.anims.exists('cyan-pull')) {
            this.scene.anims.create({
                key: 'cyan-pull',
                frames: this.scene.anims.generateFrameNumbers('cyan', { start: 0, end: 7 }),
                frameRate: 7,
                repeat: -1
            });
        }
    }
    createTeams() {
        const spriteWidth = 125;
        const spriteHeight = 180;
        const groundY = 342;
        // LEFT TEAM (Orange): 3 characters at x = 75, 170, 265
        for (let i = 0; i < 3; i++) {
            const x = 75 + i * 95;
            const shadow = this.scene.add.ellipse(x, groundY + 76, 85, 20, 0x000000, 0.45).setDepth(10);
            const sprite = this.scene.add.sprite(x, groundY, 'orange')
                .setDisplaySize(spriteWidth, spriteHeight)
                .setDepth(11 + i);
            sprite.play('orange-pull');
            // Stagger animation timing so candles do not pull in robotic unison
            sprite.anims.setProgress((i * 0.28) % 1.0);
            this.leftCandles.push({
                sprite,
                shadow,
                baseX: x,
                baseY: groundY,
                team: 'left',
                index: i,
                state: 'pull-light',
                currentDisplacementX: 0,
                currentDisplacementY: 0
            });
        }
        // RIGHT TEAM (Cyan): 3 characters at x = 885, 790, 695
        for (let i = 0; i < 3; i++) {
            const x = 885 - i * 95;
            const shadow = this.scene.add.ellipse(x, groundY + 76, 85, 20, 0x000000, 0.45).setDepth(10);
            const sprite = this.scene.add.sprite(x, groundY, 'cyan')
                .setDisplaySize(spriteWidth, spriteHeight)
                .setDepth(11 + i);
            sprite.play('cyan-pull');
            sprite.anims.setProgress((i * 0.28 + 0.14) % 1.0);
            this.rightCandles.push({
                sprite,
                shadow,
                baseX: x,
                baseY: groundY,
                team: 'right',
                index: i,
                state: 'pull-light',
                currentDisplacementX: 0,
                currentDisplacementY: 0
            });
        }
    }
    /**
     * Updates character positions, strain displacement, animation speeds and states.
     */
    update(time, leftPressure, rightPressure, isFinished = false) {
        const leftDominant = leftPressure > 50;
        const rightDominant = rightPressure > 50;
        const leftWon = leftPressure > rightPressure;
        // Update Left Team
        this.leftCandles.forEach(candle => {
            const state = determineCandleState(leftPressure, leftDominant, isFinished, leftWon, this.previousLeftPressure);
            candle.state = state;
            this.applyStateBehaviors(candle, time, leftPressure, leftDominant, isFinished);
        });
        // Update Right Team
        this.rightCandles.forEach(candle => {
            const state = determineCandleState(rightPressure, rightDominant, isFinished, !leftWon, 100 - this.previousLeftPressure);
            candle.state = state;
            this.applyStateBehaviors(candle, time, rightPressure, rightDominant, isFinished);
        });
        this.previousLeftPressure = leftPressure;
    }
    applyStateBehaviors(candle, time, pressure, isDominant, isFinished) {
        const sprite = candle.sprite;
        const shadow = candle.shadow;
        const isLeft = candle.team === 'left';
        const direction = isLeft ? -1 : 1;
        // 1. Animation Speed (Playback Rate)
        if (isFinished) {
            sprite.anims.timeScale = 0.5;
        }
        else if (isDominant) {
            // Dominant candles pull with vigor: 1.0x to 1.45x
            sprite.anims.timeScale = Math.min(1.45, 0.95 + (pressure - 50) * 0.01);
        }
        else {
            // Defending candles strain and brace: 0.6x to 0.85x
            sprite.anims.timeScale = Math.max(0.6, 0.9 - (50 - pressure) * 0.007);
        }
        // 2. Physical Displacement & Strain Slip
        // Under high dominance, dominant side leans backwards deeper (-direction * 8px)
        // Defending side slips forward towards wheel (+direction * 12px max), never exceeding safety bounds
        let targetOffsetX = 0;
        if (!isFinished) {
            if (isDominant) {
                targetOffsetX = direction * ((pressure - 50) * 0.28);
            }
            else {
                targetOffsetX = -direction * ((50 - pressure) * 0.24);
            }
        }
        // Smooth position interpolation
        candle.currentDisplacementX += (targetOffsetX - candle.currentDisplacementX) * 0.08;
        // 3. Subtle organic bounce / breathing rhythm
        const bounceFreq = 0.007;
        const bounceAmp = 1.0 + (pressure / 100) * 2.0;
        const bounceY = Math.sin(time * bounceFreq + candle.index * 1.5) * bounceAmp;
        const posX = candle.baseX + candle.currentDisplacementX;
        const posY = candle.baseY + bounceY;
        sprite.setPosition(posX, posY);
        shadow.setPosition(posX, candle.baseY + 76);
        shadow.setScale(1.0 + bounceY * 0.02, 1.0);
    }
    /**
     * Retrieves the rope grip coordinates for each candle of the team.
     * Order: from outermost candle inwards to the candle nearest the wheel.
     */
    getRopeGripPoints(team) {
        const candles = team === 'left' ? this.leftCandles : this.rightCandles;
        return candles.map(c => {
            // Orange candles pull left, grip is on the right side of the torso (x + 18, y + 2)
            // Cyan candles pull right, grip is on the left side of the torso (x - 18, y + 2)
            const gripOffsetX = team === 'left' ? 22 : -22;
            const gripOffsetY = 4;
            return {
                x: c.sprite.x + gripOffsetX,
                y: c.sprite.y + gripOffsetY
            };
        });
    }
    destroy() {
        this.leftCandles.forEach(c => {
            c.sprite.destroy();
            c.shadow.destroy();
        });
        this.rightCandles.forEach(c => {
            c.sprite.destroy();
            c.shadow.destroy();
        });
    }
}
