import { ARENA_COLORS } from './model.js';
export class WheelMechanism {
    constructor(scene, x = 480, y = 277, size = 320) {
        this.currentRotation = 0;
        this.targetRotationVelocity = 0;
        this.currentRotationVelocity = 0;
        this.x = x;
        this.y = y;
        this.size = size;
        // 1. Floor shadow and foundation anchor
        this.shadow = scene.add.ellipse(x, y + size * 0.48, size * 1.15, size * 0.14, 0x000000, 0.65).setDepth(4);
        this.floorMount = scene.add.rectangle(x, y + size * 0.35, size * 0.62, size * 0.22, 0x141b25)
            .setStrokeStyle(3, 0x3d4d63)
            .setDepth(5);
        // 2. Fixed Outer Base (Gear rim and floor brackets)
        this.baseSprite = scene.add.image(x, y, 'wheel-base')
            .setDisplaySize(size, size)
            .setDepth(6);
        // 3. Rotating Mechanical Disc (Inner spokes turbine)
        this.discSprite = scene.add.image(x, y, 'wheel-disc')
            .setDisplaySize(size, size)
            .setDepth(7);
        // 4. Dynamic LED Ring Graphics (Neon segments showing relative pressure)
        this.ringGraphics = scene.add.graphics().setDepth(8);
        // 5. Stationary Central Hub with Golden Crown
        this.hubSprite = scene.add.image(x, y, 'wheel-hub')
            .setDisplaySize(size, size)
            .setDepth(9);
    }
    /**
     * Updates rotation and renders LED rings.
     * @param currentPressure Interpolated left pressure (0..100)
     * @param targetPressure Target left pressure (0..100)
     * @param delta Delta time in ms
     */
    update(currentPressure, targetPressure, delta) {
        const left = Math.max(0, Math.min(100, currentPressure));
        const right = 100 - left;
        const pressureDelta = targetPressure - currentPressure;
        // Rotational momentum reacts gently to CHANGES in pressure and continuous dominance
        // Dominance bias gives a very subtle mechanical creep in the winning team's direction
        const dominanceBias = (left - 50) * 0.00003;
        const changeImpulse = pressureDelta * 0.00015;
        this.targetRotationVelocity = changeImpulse + dominanceBias;
        // Smooth damping
        this.currentRotationVelocity += (this.targetRotationVelocity - this.currentRotationVelocity) * 0.12;
        this.currentRotation += this.currentRotationVelocity * (delta / 16.6);
        this.discSprite.setRotation(this.currentRotation);
        // Render LED ring segments
        this.drawLedRing(left, right);
    }
    drawLedRing(left, right) {
        const g = this.ringGraphics;
        g.clear();
        const radius = this.size * 0.4;
        const totalSegments = 24;
        const arcThickness = 12;
        // Fractional fill: the boundary segment lights up gradually, so a reversal of
        // dominance animates the lighting instead of jumping one whole tile at a time.
        const activeLeft = totalSegments * (left / 100);
        const activeRight = totalSegments * (right / 100);
        // LEFT SEMICIRCLE: angles from PI/2 (bottom) clockwise to 3*PI/2 (top)
        for (let i = 0; i < totalSegments; i++) {
            const startAngle = Math.PI * 0.5 + (i / totalSegments) * Math.PI;
            const endAngle = Math.PI * 0.5 + ((i + 0.74) / totalSegments) * Math.PI;
            const intensity = Math.max(0, Math.min(1, activeLeft - i));
            this.drawSegment(g, this.x, this.y, radius, startAngle, endAngle, arcThickness, ARENA_COLORS.left, ARENA_COLORS.leftDim, 0xffe6b0, intensity);
        }
        // RIGHT SEMICIRCLE: angles from -PI/2 (top) clockwise to PI/2 (bottom)
        for (let i = 0; i < totalSegments; i++) {
            const startAngle = -Math.PI * 0.5 + (i / totalSegments) * Math.PI;
            const endAngle = -Math.PI * 0.5 + ((i + 0.74) / totalSegments) * Math.PI;
            const intensity = Math.max(0, Math.min(1, activeRight - i));
            this.drawSegment(g, this.x, this.y, radius, startAngle, endAngle, arcThickness, ARENA_COLORS.right, ARENA_COLORS.rightDim, 0xd0fffd, intensity);
        }
    }
    drawSegment(g, cx, cy, radius, startAngle, endAngle, thickness, color, dimColor, beadColor, intensity) {
        const arc = () => {
            g.beginPath();
            g.arc(cx, cy, radius, startAngle, endAngle, false);
            g.strokePath();
        };
        if (intensity <= 0.001) {
            g.lineStyle(thickness, dimColor, 0.45);
            arc();
            return;
        }
        // Outer glow
        g.lineStyle(thickness + 6, color, 0.28 * intensity);
        arc();
        // Core neon line, blended against the dim tile so partial fills read smoothly
        g.lineStyle(thickness, color, 0.35 + 0.65 * intensity);
        arc();
        // Bright center bead
        g.lineStyle(thickness * 0.45, beadColor, 0.9 * intensity);
        arc();
    }
    /**
     * Attachment point for the left rope connector (the fixed rope cleat of the base art).
     */
    getLeftAnchor() {
        return { x: this.x - this.size * 0.42, y: this.y };
    }
    /**
     * Attachment point for the right rope connector (the fixed rope cleat of the base art).
     */
    getRightAnchor() {
        return { x: this.x + this.size * 0.42, y: this.y };
    }
    destroy() {
        this.shadow.destroy();
        this.floorMount.destroy();
        this.baseSprite.destroy();
        this.discSprite.destroy();
        this.ringGraphics.destroy();
        this.hubSprite.destroy();
    }
}
