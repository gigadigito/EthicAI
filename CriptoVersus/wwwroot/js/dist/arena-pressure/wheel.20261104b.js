import { ARENA_COLORS } from './model.20261104b.js';
const TAU = Math.PI * 2;
const RING_START_ANGLE = Math.PI * 0.5;
const RING_SEGMENTS = 64;
const RING_GAP_RADIANS = 0.018;
const RING_RADIUS_RATIO = 0.36;
const RING_THICKNESS_RATIO = 0.075;
const MIN_RING_REDRAW_DELTA = 0.02;
const MAX_ANGULAR_VELOCITY = 2.4;
const MAX_ANGULAR_ACCELERATION = 4.6;
const MAX_PRESSURE_IMPULSE = 0.55;
const PRESSURE_IMPULSE_GAIN = 2.1;
const TARGET_VELOCITY_DECAY_PER_SECOND = 0.08;
export function crownColorForPressure(leftPressure) {
    if (leftPressure > 50) {
        return ARENA_COLORS.left;
    }
    if (leftPressure < 50) {
        return ARENA_COLORS.right;
    }
    return ARENA_COLORS.gold;
}
function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}
function approach(current, target, amount) {
    if (current < target) {
        return Math.min(target, current + amount);
    }
    return Math.max(target, current - amount);
}
/**
 * Advances the heavy-disc motion without depending on Phaser. A positive market
 * pressure delta means the left side advanced, so the disc receives a negative
 * (counter-clockwise) Phaser rotation impulse. A missing delta is inert.
 */
export function stepWheelMotion(state, pressureDelta, deltaMs, motionActive = true) {
    const deltaSeconds = Math.min(64, Math.max(0, deltaMs)) / 1000;
    if (!motionActive || deltaSeconds <= 0) {
        return state;
    }
    const safePressureDelta = Number.isFinite(pressureDelta)
        ? clamp(pressureDelta, -100, 100)
        : 0;
    const balanceDelta = safePressureDelta * 2 / 100;
    const impulse = clamp(-balanceDelta * PRESSURE_IMPULSE_GAIN, -MAX_PRESSURE_IMPULSE, MAX_PRESSURE_IMPULSE);
    const decay = Math.pow(TARGET_VELOCITY_DECAY_PER_SECOND, deltaSeconds);
    const targetAngularVelocity = clamp((state.targetAngularVelocity + impulse) * decay, -MAX_ANGULAR_VELOCITY, MAX_ANGULAR_VELOCITY);
    const maxVelocityStep = MAX_ANGULAR_ACCELERATION * deltaSeconds;
    let angularVelocity = approach(state.angularVelocity, targetAngularVelocity, maxVelocityStep);
    // A heavy mechanism must pass through a brief zero-velocity point when the
    // impulse changes sign; never snap directly from clockwise to counter-clockwise.
    if (state.angularVelocity !== 0
        && targetAngularVelocity !== 0
        && Math.sign(state.angularVelocity) !== Math.sign(targetAngularVelocity)
        && Math.abs(state.angularVelocity) <= maxVelocityStep) {
        angularVelocity = 0;
    }
    return {
        rotation: state.rotation + angularVelocity * deltaSeconds,
        angularVelocity,
        targetAngularVelocity
    };
}
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
        // Only the crown is dynamic. The hub shell and side brackets remain fixed.
        this.crownSprite = scene.add.image(x, y, 'wheel-crown')
            .setDisplaySize(size, size)
            .setDepth(10)
            .setTint(ARENA_COLORS.gold);
    }
    /**
     * Updates the mechanical disc and renders the fixed LED ring.
     * @param currentPressure Interpolated left pressure (0..100)
     * @param targetPressure Target left pressure (0..100)
     * @param delta Delta time in ms
     * @param pressureDelta Change in the real pressure sample since the previous update
     * @param motionActive False while replay transport is paused
     */
    update(currentPressure, targetPressure, delta, pressureDelta = 0, motionActive = true) {
        const left = Math.max(0, Math.min(100, currentPressure));
        const motion = stepWheelMotion({
            rotation: this.currentRotation,
            angularVelocity: this.currentRotationVelocity,
            targetAngularVelocity: this.targetRotationVelocity
        }, pressureDelta, delta, motionActive);
        this.currentRotation = motion.rotation;
        this.currentRotationVelocity = motion.angularVelocity;
        this.targetRotationVelocity = motion.targetAngularVelocity;
        this.discSprite.setRotation(this.currentRotation);
        this.crownSprite
            .setRotation(this.currentRotation)
            .setTint(crownColorForPressure(left));
        // Render LED ring segments
        this.drawLedRing(left);
    }
    /** Clears momentum after a replay seek without jumping the current angle. */
    resetMotion() {
        this.currentRotationVelocity = 0;
        this.targetRotationVelocity = 0;
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
        this.crownSprite.destroy();
    }
}
