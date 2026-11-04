import type Phaser from 'phaser';
import { CandlePullState, determineCandleState, RopePoint } from './model.js';

export interface CandleCharacter {
    sprite: Phaser.GameObjects.Sprite;
    shadow: Phaser.GameObjects.Ellipse;
    baseX: number;
    baseY: number;
    team: 'left' | 'right';
    index: number;
    state: CandlePullState;
    currentDisplacementX: number;
    currentDisplacementY: number;
    /** Smoothed body lean in radians. Positive leans away from the wheel (pulling). */
    lean: number;
    /** Decaying slide kick applied when a candle loses its footing. */
    slipKick: number;
    /** Decaying vertical hop used by recover / victory beats. */
    hop: number;
    previousState: CandlePullState;
    stateSince: number;
}

/**
 * Hand anchor inside the 112x160 frame, expressed in display pixels relative to the
 * sprite centre. Indexed by animation frame so the rope tracks the pulling hands
 * instead of floating on a fixed point.
 */
const HAND_OFFSETS_X = [22, 24, 26, 26, 24, 22, 20, 20] as const;
const HAND_OFFSETS_Y = [4, 6, 8, 6, 4, 2, 2, 3] as const;

/** Safety rails so a candle can never reach the fixed central wheel. */
const LEFT_TEAM_MAX_X = 300;
const RIGHT_TEAM_MIN_X = 660;

export class CandleTeamManager {
    public readonly leftCandles: CandleCharacter[] = [];
    public readonly rightCandles: CandleCharacter[] = [];

    private readonly scene: Phaser.Scene;
    private readonly reducedMotion: boolean;
    private previousLeftPressure: number = 50;

    constructor(scene: Phaser.Scene, reducedMotion: boolean = false) {
        this.scene = scene;
        this.reducedMotion = reducedMotion;
        this.createAnimations();
        this.createTeams();
    }

    private createAnimations(): void {
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

    private createTeams(): void {
        const spriteWidth = 125;
        const spriteHeight = 180;
        const groundY = 342;

        // LEFT TEAM (Orange): 3 characters stepping towards the left edge
        for (let i = 0; i < 3; i++) {
            const x = 75 + i * 95;
            this.leftCandles.push(this.createCandle(x, groundY, spriteWidth, spriteHeight, 'left', i, 'orange-pull'));
        }

        // RIGHT TEAM (Cyan): mirrored, stepping towards the right edge
        for (let i = 0; i < 3; i++) {
            const x = 885 - i * 95;
            this.rightCandles.push(this.createCandle(x, groundY, spriteWidth, spriteHeight, 'right', i, 'cyan-pull'));
        }
    }

    private createCandle(
        x: number,
        groundY: number,
        spriteWidth: number,
        spriteHeight: number,
        team: 'left' | 'right',
        index: number,
        animationKey: string
    ): CandleCharacter {
        const shadow = this.scene.add.ellipse(x, groundY + 76, 85, 20, 0x000000, 0.45).setDepth(10);
        const sprite = this.scene.add.sprite(x, groundY, team === 'left' ? 'orange' : 'cyan')
            .setDisplaySize(spriteWidth, spriteHeight)
            .setDepth(11 + index);

        sprite.play(animationKey);
        // Stagger timing so the team never moves as one rigid block.
        sprite.anims.setProgress(((index * 0.28) + (team === 'right' ? 0.14 : 0)) % 1.0);

        return {
            sprite,
            shadow,
            baseX: x,
            baseY: groundY,
            team,
            index,
            state: 'pull-light',
            previousState: 'pull-light',
            stateSince: 0,
            currentDisplacementX: 0,
            currentDisplacementY: 0,
            lean: 0,
            slipKick: 0,
            hop: 0
        };
    }

    /**
     * Updates character positions, strain displacement, animation speeds and states.
     */
    public update(
        time: number,
        leftPressure: number,
        rightPressure: number,
        isFinished: boolean = false
    ): void {
        const leftDominant = leftPressure > 50;
        const rightDominant = rightPressure > 50;
        const leftWon = leftPressure > rightPressure;

        // Update Left Team
        this.leftCandles.forEach(candle => {
            const state = determineCandleState(
                leftPressure,
                leftDominant,
                isFinished,
                leftWon,
                this.previousLeftPressure
            );
            this.applyStateBehaviors(candle, state, time, leftPressure, leftDominant, isFinished);
        });

        // Update Right Team
        this.rightCandles.forEach(candle => {
            const state = determineCandleState(
                rightPressure,
                rightDominant,
                isFinished,
                !leftWon,
                100 - this.previousLeftPressure
            );
            this.applyStateBehaviors(candle, state, time, rightPressure, rightDominant, isFinished);
        });

        this.previousLeftPressure = leftPressure;
    }

    private applyStateBehaviors(
        candle: CandleCharacter,
        state: CandlePullState,
        time: number,
        pressure: number,
        isDominant: boolean,
        isFinished: boolean
    ): void {
        const sprite = candle.sprite;
        const shadow = candle.shadow;
        const isLeft = candle.team === 'left';
        const direction = isLeft ? -1 : 1;

        const stateChanged = candle.state !== state;
        if (stateChanged) {
            candle.previousState = candle.state;
            candle.state = state;
            candle.stateSince = time;
            this.triggerStateBeat(candle, state, direction, time);
        }

        // 1. Animation playback rate: effort reads through the tempo of the pull cycle.
        if (isFinished) {
            sprite.anims.timeScale = state === 'victory' ? 1.15 : state === 'defeat' ? 0.4 : 0.5;
        } else if (isDominant) {
            sprite.anims.timeScale = Math.min(1.45, 0.95 + (pressure - 50) * 0.01);
        } else {
            sprite.anims.timeScale = Math.max(0.6, 0.9 - (50 - pressure) * 0.007);
        }

        if (this.reducedMotion) {
            sprite.anims.timeScale = Math.min(sprite.anims.timeScale, 0.9);
        }

        // 2. Body lean: the dominant side hauls backwards, the losing side is dragged in.
        const strain = Math.min(1, Math.abs(pressure - 50) / 22);
        let targetLean = 0;
        let targetOffsetX = 0;

        switch (state) {
            case 'pull-light':
                targetLean = direction * 0.035;
                targetOffsetX = direction * 2;
                break;
            case 'pull-medium':
                targetLean = direction * (0.06 + strain * 0.03);
                targetOffsetX = direction * (3 + strain * 6);
                break;
            case 'pull-heavy':
                targetLean = direction * (0.1 + strain * 0.05);
                targetOffsetX = direction * (5 + strain * 9);
                break;
            case 'resist':
                targetLean = -direction * (0.045 + strain * 0.03);
                targetOffsetX = -direction * (2 + strain * 5);
                break;
            case 'exhausted':
                targetLean = -direction * (0.1 + strain * 0.06);
                targetOffsetX = -direction * (4 + strain * 9);
                break;
            case 'recover':
                targetLean = direction * 0.02;
                targetOffsetX = direction * 2;
                break;
            case 'victory':
                targetLean = direction * 0.02;
                targetOffsetX = direction * 3;
                break;
            case 'defeat':
                targetLean = -direction * 0.12;
                targetOffsetX = -direction * 4;
                break;
            default:
                targetLean = 0;
                targetOffsetX = 0;
        }

        if (isFinished) {
            targetOffsetX *= 0.35;
        }

        candle.lean += (targetLean - candle.lean) * 0.09;
        candle.currentDisplacementX += (targetOffsetX - candle.currentDisplacementX) * 0.08;

        // 3. One-shot beats (slip, recover hop, victory bounce) decay on their own.
        candle.slipKick *= 0.9;
        candle.hop *= 0.88;

        // 4. Never let a candle reach the fixed wheel.
        const rawX = candle.baseX + candle.currentDisplacementX + candle.slipKick;
        const clampedX = isLeft
            ? Math.min(rawX, LEFT_TEAM_MAX_X)
            : Math.max(rawX, RIGHT_TEAM_MIN_X);

        // 5. Organic breathing / effort bob on top of the state beats.
        const bounceFreq = this.reducedMotion ? 0.004 : 0.007;
        const bounceAmp = (this.reducedMotion ? 0.6 : 1.0) * (1.0 + (pressure / 100) * 2.0);
        const bounceY = Math.sin(time * bounceFreq + candle.index * 1.5) * bounceAmp;

        const trembling = state === 'resist' || state === 'exhausted'
            ? Math.sin(time * 0.045 + candle.index * 2.1) * (this.reducedMotion ? 0.4 : 1.2)
            : 0;

        const posY = candle.baseY + bounceY + candle.hop + trembling;

        sprite.setPosition(clampedX, posY);
        sprite.setRotation(candle.lean);

        // Bracing legs read slightly taller, defeat slumps and squashes.
        const stretch = state === 'pull-heavy' ? 1.03 : state === 'defeat' ? 0.94 : state === 'exhausted' ? 0.97 : 1;
        sprite.setScale(1 / Math.max(0.6, stretch), stretch);

        shadow.setPosition(clampedX, candle.baseY + 76);
        shadow.setScale(1.0 + Math.abs(bounceY) * 0.02, 1.0);
        shadow.setAlpha(state === 'defeat' ? 0.3 : 0.45);
    }

    /**
     * Starts the one-shot animation beats attached to a state transition.
     */
    private triggerStateBeat(
        candle: CandleCharacter,
        state: CandlePullState,
        direction: number,
        time: number
    ): void {
        if (this.reducedMotion) {
            return;
        }

        switch (state) {
            case 'exhausted':
                // Footing gives way: a short slide towards the wheel.
                candle.slipKick = -direction * 9;
                break;
            case 'recover':
                candle.hop = -7;
                candle.slipKick = direction * 5;
                break;
            case 'victory':
                candle.hop = -11;
                break;
            case 'defeat':
                candle.hop = 4;
                break;
            case 'pull-heavy':
                candle.hop = -3;
                break;
            default:
                break;
        }

        candle.stateSince = time;
    }

    /**
     * Retrieves the rope grip coordinates for each candle of the team.
     * Order: from outermost candle inwards to the candle nearest the wheel.
     */
    public getRopeGripPoints(team: 'left' | 'right'): RopePoint[] {
        const candles = team === 'left' ? this.leftCandles : this.rightCandles;
        return candles.map(c => {
            const progress = this.readAnimationProgress(c.sprite);
            const frame = Math.min(7, Math.max(0, Math.floor(progress * 7.999)));
            const sign = team === 'left' ? 1 : -1;
            return {
                x: c.sprite.x + sign * HAND_OFFSETS_X[frame],
                y: c.sprite.y + HAND_OFFSETS_Y[frame]
            };
        });
    }

    private readAnimationProgress(sprite: Phaser.GameObjects.Sprite): number {
        try {
            const progress = sprite.anims.getProgress();
            return Number.isFinite(progress) ? progress : 0;
        } catch {
            return 0;
        }
    }

    public destroy(): void {
        this.leftCandles.forEach(c => {
            c.sprite.destroy();
            c.shadow.destroy();
        });
        this.rightCandles.forEach(c => {
            c.sprite.destroy();
            c.shadow.destroy();
        });
        this.leftCandles.length = 0;
        this.rightCandles.length = 0;
    }
}
