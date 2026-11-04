import { ARENA_COLORS } from './model.20261104a.js';
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
        // 6. Directional Indicators on Hub Sides
        if (scene.textures.exists('arrow-orange')) {
            this.arrowLeft = scene.add.image(x - size * 0.22, y, 'arrow-orange')
                .setDisplaySize(38, 26)
                .setDepth(10);
        }
        if (scene.textures.exists('arrow-cyan')) {
            this.arrowRight = scene.add.image(x + size * 0.22, y, 'arrow-cyan')
                .setDisplaySize(38, 26)
                .setDepth(10);
        }
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
        // Subtle arrow pulses on dominant side
        if (this.arrowLeft) {
            const leftAlpha = left > 52 ? 0.7 + Math.sin(Date.now() * 0.006) * 0.3 : 0.35;
            this.arrowLeft.setAlpha(leftAlpha);
        }
        if (this.arrowRight) {
            const rightAlpha = right > 52 ? 0.7 + Math.sin(Date.now() * 0.006) * 0.3 : 0.35;
            this.arrowRight.setAlpha(rightAlpha);
        }
    }
    drawLedRing(left, right) {
        const g = this.ringGraphics;
        g.clear();
        const radius = this.size * 0.332; // ~106px at 320 size
        const totalSegments = 24;
        const arcThickness = 12;
        // Active segment counts
        const activeLeft = Math.round(totalSegments * (left / 100));
        const activeRight = Math.round(totalSegments * (right / 100));
        // LEFT SEMICIRCLE: angles from PI/2 (bottom) clockwise to 3*PI/2 (top)
        for (let i = 0; i < totalSegments; i++) {
            const startAngle = Math.PI * 0.5 + (i / totalSegments) * Math.PI;
            const endAngle = Math.PI * 0.5 + ((i + 0.74) / totalSegments) * Math.PI;
            const isActive = i < activeLeft;
            if (isActive) {
                // Outer glow
                g.lineStyle(arcThickness + 6, ARENA_COLORS.left, 0.28);
                g.beginPath();
                g.arc(this.x, this.y, radius, startAngle, endAngle, false);
                g.strokePath();
                // Core neon line
                g.lineStyle(arcThickness, ARENA_COLORS.left, 1.0);
                g.beginPath();
                g.arc(this.x, this.y, radius, startAngle, endAngle, false);
                g.strokePath();
                // Bright center bead
                g.lineStyle(arcThickness * 0.45, 0xffe6b0, 0.9);
                g.beginPath();
                g.arc(this.x, this.y, radius, startAngle, endAngle, false);
                g.strokePath();
            }
            else {
                // Dimmed inactive segment
                g.lineStyle(arcThickness, ARENA_COLORS.leftDim, 0.45);
                g.beginPath();
                g.arc(this.x, this.y, radius, startAngle, endAngle, false);
                g.strokePath();
            }
        }
        // RIGHT SEMICIRCLE: angles from -PI/2 (top) clockwise to PI/2 (bottom)
        for (let i = 0; i < totalSegments; i++) {
            const startAngle = -Math.PI * 0.5 + (i / totalSegments) * Math.PI;
            const endAngle = -Math.PI * 0.5 + ((i + 0.74) / totalSegments) * Math.PI;
            const isActive = i < activeRight;
            if (isActive) {
                // Outer glow
                g.lineStyle(arcThickness + 6, ARENA_COLORS.right, 0.28);
                g.beginPath();
                g.arc(this.x, this.y, radius, startAngle, endAngle, false);
                g.strokePath();
                // Core neon line
                g.lineStyle(arcThickness, ARENA_COLORS.right, 1.0);
                g.beginPath();
                g.arc(this.x, this.y, radius, startAngle, endAngle, false);
                g.strokePath();
                // Bright center bead
                g.lineStyle(arcThickness * 0.45, 0xd0fffd, 0.9);
                g.beginPath();
                g.arc(this.x, this.y, radius, startAngle, endAngle, false);
                g.strokePath();
            }
            else {
                // Dimmed inactive segment
                g.lineStyle(arcThickness, ARENA_COLORS.rightDim, 0.45);
                g.beginPath();
                g.arc(this.x, this.y, radius, startAngle, endAngle, false);
                g.strokePath();
            }
        }
    }
    /**
     * Attachment point for the left rope connector.
     */
    getLeftAnchor() {
        return { x: this.x - this.size * 0.46, y: this.y };
    }
    /**
     * Attachment point for the right rope connector.
     */
    getRightAnchor() {
        return { x: this.x + this.size * 0.46, y: this.y };
    }
    destroy() {
        this.shadow.destroy();
        this.floorMount.destroy();
        this.baseSprite.destroy();
        this.discSprite.destroy();
        this.ringGraphics.destroy();
        this.hubSprite.destroy();
        this.arrowLeft?.destroy();
        this.arrowRight?.destroy();
    }
}
