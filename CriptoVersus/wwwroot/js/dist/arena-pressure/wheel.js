import { ARENA_COLORS } from './model.js';
const TAU = Math.PI * 2;
const RING_START_ANGLE = Math.PI * 0.5;
const RING_SEGMENTS = 64;
const RING_GAP_RADIANS = 0.018;
const RING_RADIUS_RATIO = 0.36;
const RING_THICKNESS_RATIO = 0.075;
const MIN_RING_REDRAW_DELTA = 0.02;
/**
 * Maps the left pressure to one continuous clockwise 360-degree ring.
 * The ring starts at the lower centre of the mechanism, travels around the
 * left side first, and assigns the remainder to cyan. Keeping this pure makes
 * the angular contract testable without a Phaser scene.
 */
export function buildWheelRingSegments(leftPressure, segmentCount = RING_SEGMENTS) {
    const safePressure = Math.max(0, Math.min(100, leftPressure));
    const orangeSweep = TAU * safePressure / 100;
    const segmentSweep = TAU / segmentCount;
    const gap = Math.min(RING_GAP_RADIANS, segmentSweep * 0.3);
    return Array.from({ length: segmentCount }, (_, index) => {
        const rawStart = index * segmentSweep;
        const rawEnd = rawStart + segmentSweep;
        const visibleStart = rawStart + gap * 0.5;
        const visibleEnd = rawEnd - gap * 0.5;
        const orangeStart = Math.max(rawStart, 0);
        const orangeEnd = Math.min(rawEnd, orangeSweep);
        const orangePortion = Math.max(0, orangeEnd - orangeStart) / segmentSweep;
        return {
            index,
            startAngle: RING_START_ANGLE + visibleStart,
            endAngle: RING_START_ANGLE + visibleEnd,
            orangePortion,
            cyanPortion: 1 - orangePortion
        };
    });
}
export class WheelMechanism {
    constructor(scene, x = 480, y = 277, size = 320) {
        this.currentRotation = 0;
        this.targetRotationVelocity = 0;
        this.currentRotationVelocity = 0;
        this.lastRingPressure = Number.NaN;
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
        this.drawLedRing(left);
    }
    drawLedRing(left) {
        const g = this.ringGraphics;
        if (Number.isFinite(this.lastRingPressure)
            && Math.abs(left - this.lastRingPressure) < MIN_RING_REDRAW_DELTA) {
            return;
        }
        this.lastRingPressure = left;
        g.clear();
        const radius = this.size * RING_RADIUS_RATIO;
        const arcThickness = this.size * RING_THICKNESS_RATIO;
        const segments = buildWheelRingSegments(left);
        // A dark underlay keeps the ring physically seated in the recessed metal track.
        for (const segment of segments) {
            this.drawArc(g, this.x, this.y, radius, segment.startAngle, segment.endAngle, arcThickness + 4, 0x060b12, 0.92);
        }
        // Each segment is split at the exact pressure boundary. This preserves the
        // requested angular ratio even when the boundary falls through a segment.
        for (const segment of segments) {
            const span = segment.endAngle - segment.startAngle;
            const orangeEnd = segment.startAngle + span * segment.orangePortion;
            const cyanStart = orangeEnd;
            if (segment.orangePortion > 0) {
                this.drawNeonArc(g, this.x, this.y, radius, segment.startAngle, orangeEnd, arcThickness, ARENA_COLORS.left, 0xffe6b0);
            }
            if (segment.cyanPortion > 0) {
                this.drawNeonArc(g, this.x, this.y, radius, cyanStart, segment.endAngle, arcThickness, ARENA_COLORS.right, 0xd0fffd);
            }
        }
    }
    drawNeonArc(g, cx, cy, radius, startAngle, endAngle, thickness, color, highlightColor) {
        if (endAngle - startAngle <= 0.0001) {
            return;
        }
        this.drawArc(g, cx, cy, radius + 2, startAngle, endAngle, thickness + 8, color, 0.18);
        this.drawArc(g, cx, cy, radius, startAngle, endAngle, thickness, color, 0.96);
        this.drawArc(g, cx, cy, radius - thickness * 0.18, startAngle, endAngle, thickness * 0.34, highlightColor, 0.8);
    }
    drawArc(g, cx, cy, radius, startAngle, endAngle, thickness, color, alpha) {
        g.lineStyle(thickness, color, alpha);
        g.beginPath();
        g.arc(cx, cy, radius, startAngle, endAngle, false);
        g.strokePath();
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
