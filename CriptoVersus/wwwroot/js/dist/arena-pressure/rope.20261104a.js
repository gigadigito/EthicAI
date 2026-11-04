export class RopeRenderer {
    constructor(scene, depth = 5) {
        this.graphics = scene.add.graphics().setDepth(depth);
    }
    /**
     * Renders dynamic ropes on both sides anchored to the characters and the central wheel.
     */
    render(time, wheelCenter, wheelAttachmentOffset, leftHandPoints, rightHandPoints, leftPressure, rightPressure) {
        this.graphics.clear();
        // 1. Left Side: From outer candle through middle candle to inner candle, then to wheel connector
        if (leftHandPoints.length > 0) {
            const wheelAnchor = {
                x: wheelCenter.x - wheelAttachmentOffset,
                y: wheelCenter.y
            };
            this.drawSideRope(time, leftHandPoints, wheelAnchor, leftPressure, -1);
        }
        // 2. Right Side: From outer candle through middle candle to inner candle, then to wheel connector
        if (rightHandPoints.length > 0) {
            const wheelAnchor = {
                x: wheelCenter.x + wheelAttachmentOffset,
                y: wheelCenter.y
            };
            this.drawSideRope(time, rightHandPoints, wheelAnchor, rightPressure, 1);
        }
    }
    drawSideRope(time, handPoints, wheelAnchor, pressure, direction // -1 for left, 1 for right
    ) {
        const points = [...handPoints, wheelAnchor];
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
    drawBezier(x0, y0, cx, cy, x1, y1, steps = 8) {
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
    destroy() {
        this.graphics.destroy();
    }
}
