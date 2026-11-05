export class RopeRenderer {
    constructor(scene, depth = 5) {
        this.graphics = scene.add.graphics().setDepth(depth);
    }
    /**
     * Renders dynamic ropes on both sides, anchored to the moving hands and to the
     * fixed rope cleats of the central mechanism.
     */
    render(time, leftAnchor, rightAnchor, leftHandPoints, rightHandPoints, leftPressure, rightPressure) {
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
    drawSideRope(time, handPoints, wheelAnchor, pressure, direction // -1 for left, 1 for right
    ) {
        const points = [...handPoints, wheelAnchor];
        // The rope is intentionally kept taut. Pressure only adds a restrained
        // vibration, so the line never turns into a hanging wave between grips.
        const tension = Math.max(0.78, Math.min(1.0, 0.82 + Math.abs(pressure - 50) * 0.008));
        const sag = 1.1 + (1.0 - tension) * 2.4;
        const vibration = 0.35 + Math.abs(pressure - 50) * 0.018;
        for (let i = 0; i < points.length - 1; i++) {
            const p1 = points[i];
            const p2 = points[i + 1];
            const phase = time * 0.014 + i * 1.3 + direction;
            // 1. Dark core rope layer (thick braided shadow).
            this.graphics.lineStyle(11, 0x2e2017, 0.96);
            this.drawRopePath(p1, p2, phase, sag, vibration, 12);
            // 2. Main hemp / synthetic fiber body.
            this.graphics.lineStyle(7, 0xb18a61, 1.0);
            this.drawRopePath(p1, p2, phase, sag, vibration, 12);
            // 3. Repeated diagonal fibers make the rope read as braided instead of
            // a flat tube. The same strokes are reused for both sides every frame.
            this.drawBraidedFibers(p1, p2, phase, sag, vibration, direction);
            // 4. Joint wrap node at each grip.
            this.graphics.fillStyle(0x403126, 1);
            this.graphics.fillCircle(p1.x, p1.y, 4.8);
        }
        // Connection cleat at the wheel entry point
        this.graphics.fillStyle(0x19212d, 1);
        this.graphics.fillRoundedRect(wheelAnchor.x - 7, wheelAnchor.y - 7, 14, 14, 4);
        this.graphics.lineStyle(2, direction < 0 ? 0xff9100 : 0x18d8d2, 0.9);
        this.graphics.strokeRoundedRect(wheelAnchor.x - 7, wheelAnchor.y - 7, 14, 14, 4);
    }
    drawRopePath(p1, p2, phase, sag, vibration, steps) {
        this.graphics.beginPath();
        const start = this.ropePoint(p1, p2, 0, phase, sag, vibration);
        this.graphics.moveTo(start.x, start.y);
        for (let step = 1; step <= steps; step++) {
            const point = this.ropePoint(p1, p2, step / steps, phase, sag, vibration);
            this.graphics.lineTo(point.x, point.y);
        }
        this.graphics.strokePath();
    }
    drawBraidedFibers(p1, p2, phase, sag, vibration, direction) {
        const fiberColor = direction < 0 ? 0xffd09c : 0x91f8f3;
        const shadowColor = direction < 0 ? 0x6f4c31 : 0x236a6b;
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const length = Math.max(1, Math.hypot(dx, dy));
        const tx = dx / length;
        const ty = dy / length;
        const nx = -ty;
        const ny = tx;
        const count = Math.max(2, Math.floor(length / 13));
        for (let index = 1; index < count; index++) {
            const center = this.ropePoint(p1, p2, index / count, phase, sag, vibration);
            const directionSign = index % 2 === 0 ? 1 : -1;
            const along = 3.2;
            const across = 2.7 * directionSign;
            this.graphics.lineStyle(1.35, index % 2 === 0 ? fiberColor : shadowColor, 0.82);
            this.graphics.beginPath();
            this.graphics.moveTo(center.x - tx * along - nx * across, center.y - ty * along - ny * across);
            this.graphics.lineTo(center.x + tx * along + nx * across, center.y + ty * along + ny * across);
            this.graphics.strokePath();
        }
    }
    ropePoint(p1, p2, t, phase, sag, vibration) {
        const wave = Math.sin(phase + t * Math.PI * 2.0) * vibration * Math.sin(t * Math.PI);
        return {
            x: p1.x + (p2.x - p1.x) * t,
            y: p1.y + (p2.y - p1.y) * t + Math.sin(t * Math.PI) * sag + wave
        };
    }
    destroy() {
        this.graphics.destroy();
    }
}
