import type Phaser from 'phaser';
import type { RopePoint } from './model.js';

export class RopeRenderer {
    private readonly graphics: Phaser.GameObjects.Graphics;

    constructor(scene: Phaser.Scene, depth: number = 5) {
        this.graphics = scene.add.graphics().setDepth(depth);
    }

    /**
     * Renders dynamic ropes on both sides, anchored to the moving hands and to the
     * fixed rope cleats of the central mechanism.
     */
    public render(
        time: number,
        leftAnchor: RopePoint,
        rightAnchor: RopePoint,
        leftHandPoints: RopePoint[],
        rightHandPoints: RopePoint[],
        leftPressure: number,
        rightPressure: number
    ): void {
        this.graphics.clear();

        // 1. Left Side: from the outer candle through the middle one to the inner candle,
        //    then into the wheel's left rope cleat.
        if (leftHandPoints.length > 0) {
            this.drawSideRope(time, leftHandPoints, leftAnchor, leftPressure, -1);
        }

        // 2. Right Side: mirrored into the wheel's right rope cleat.
        if (rightHandPoints.length > 0) {
            this.drawSideRope(time, rightHandPoints, rightAnchor, rightPressure, 1);
        }
    }

    private drawSideRope(
        time: number,
        handPoints: RopePoint[],
        wheelAnchor: RopePoint,
        pressure: number,
        direction: number // -1 for left, 1 for right
    ): void {
        const points: RopePoint[] = [...handPoints, wheelAnchor];

        const strain = Math.max(0.1, Math.min(1.0, pressure / 100));
        const maxSag = (1.0 - strain) * 7.0 + 1.5;
        const vibFreq = 0.012 + strain * 0.015;
        const vibAmp = 1.0 + strain * 2.0;

        for (let i = 0; i < points.length - 1; i++) {
            const p1 = points[i];
            const p2 = points[i + 1];

            const midX = (p1.x + p2.x) * 0.5;
            const midY = (p1.y + p2.y) * 0.5;

            const phase = time * vibFreq + i * 1.3 + direction;
            const wave = Math.sin(phase) * vibAmp;
            const controlY = midY + maxSag * 2.0 + wave;

            // 1. Dark core rope layer (thick braided shadow)
            this.graphics.lineStyle(9, 0x2e2017, 0.95);
            this.drawBezier(p1.x, p1.y, midX, controlY + 1, p2.x, p2.y);

            // 2. Main hemp / synthetic fiber body
            this.graphics.lineStyle(6, 0xa37e58, 1.0);
            this.drawBezier(p1.x, p1.y, midX, controlY, p2.x, p2.y);

            // 3. Highlight braid sheen (reflection under neon light)
            const highlightColor = direction < 0 ? 0xffc58d : 0x8df6f3;
            this.graphics.lineStyle(2, highlightColor, 0.7);
            this.drawBezier(p1.x, p1.y - 1.5, midX, controlY - 1.5, p2.x, p2.y - 1.5);

            // 4. Joint wrap node at grip
            this.graphics.fillStyle(0x403126, 1);
            this.graphics.fillCircle(p1.x, p1.y, 4.5);
        }

        // Connection cleat at the wheel entry point
        this.graphics.fillStyle(0x19212d, 1);
        this.graphics.fillRoundedRect(wheelAnchor.x - 7, wheelAnchor.y - 7, 14, 14, 4);
        this.graphics.lineStyle(2, direction < 0 ? 0xff9100 : 0x18d8d2, 0.9);
        this.graphics.strokeRoundedRect(wheelAnchor.x - 7, wheelAnchor.y - 7, 14, 14, 4);
    }

    private drawBezier(
        x0: number, y0: number,
        cx: number, cy: number,
        x1: number, y1: number,
        steps: number = 8
    ): void {
        this.graphics.beginPath();
        this.graphics.moveTo(x0, y0);
        for (let s = 1; s <= steps; s++) {
            const t = s / steps;
            const oneMinusT = 1.0 - t;
            const px = oneMinusT * oneMinusT * x0 + 2.0 * oneMinusT * t * cx + t * t * x1;
            const py = oneMinusT * oneMinusT * y0 + 2.0 * oneMinusT * t * cy + t * t * y1;
            this.graphics.lineTo(px, py);
        }
        this.graphics.strokePath();
    }

    public destroy(): void {
        this.graphics.destroy();
    }
}
