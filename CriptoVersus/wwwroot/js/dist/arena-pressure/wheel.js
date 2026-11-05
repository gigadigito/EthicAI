import { ARENA_COLORS } from './model.js';
const TAU = Math.PI * 2;
const RING_START_ANGLE = Math.PI * 0.5;
const RING_SEGMENTS = 18;
const RING_GAP_RADIANS = 0.055;
const RING_RADIUS_RATIO = 0.36;
const RING_THICKNESS_RATIO = 0.105;
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
/**
 * Returns the neutral-up, left, or right orientation of the mechanical pointer.
 * The crown remains upright; only this separate pointer changes direction.
 */
export function dominancePointerRotationForPressure(leftPressure) {
    const bias = clamp((clamp(leftPressure, 0, 100) - 50) / 15, -1, 1);
    return -Math.PI * 0.5 - bias * Math.PI * 0.5;
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
function approachAngle(current, target, amount) {
    const difference = Math.atan2(Math.sin(target - current), Math.cos(target - current));
    return current + difference * amount;
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
 * Adds a small, damped reaction to the fixed mechanism even while the pressure
 * sample is stable. The base and rope anchors stay fixed; only the inner
 * assembly receives this sub-pixel mechanical play.
 */
export function stepWheelMechanicalTension(state, leftPressure, deltaMs, motionActive = true) {
    const deltaSeconds = Math.min(64, Math.max(0, deltaMs)) / 1000;
    if (!motionActive || deltaSeconds <= 0) {
        return state;
    }
    const pressureBias = clamp((leftPressure - 50) / 50, -1, 1);
    const effort = 0.58 + Math.abs(pressureBias) * 0.42;
    const clock = state.clock + deltaSeconds;
    const pullSway = Math.sin(clock * 2.15) * 0.52 * effort;
    const compression = Math.sin(clock * 3.7 + 1.1) * 0.18 * effort;
    const targetOffsetX = -pressureBias * 1.9 + pullSway + compression;
    const targetOffsetY = Math.sin(clock * 2.8 + 0.6) * 0.28 * effort;
    const targetAngle = -pressureBias * 0.012 + Math.sin(clock * 2.0) * 0.0025 * effort;
    const response = 1 - Math.exp(-deltaSeconds * 8);
    return {
        clock,
        offsetX: state.offsetX + (targetOffsetX - state.offsetX) * response,
        offsetY: state.offsetY + (targetOffsetY - state.offsetY) * response,
        angle: state.angle + (targetAngle - state.angle) * response
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
        this.pointerRotation = -Math.PI * 0.5;
        this.mechanicalState = {
            clock: 0,
            offsetX: 0,
            offsetY: 0,
            angle: 0
        };
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
        // 5. Central hub and independent dominance pointer. The pointer is drawn
        // procedurally so it can move without rotating the crown artwork.
        this.hubSprite = scene.add.image(x, y, 'wheel-hub')
            .setDisplaySize(size, size)
            .setDepth(9);
        this.pointerGraphics = scene.add.graphics().setDepth(9.5);
        // The crown artwork is always upright. Its tint changes, but its orientation
        // is never used as a proxy for dominance.
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
        this.mechanicalState = stepWheelMechanicalTension(this.mechanicalState, left, delta, motionActive);
        this.discSprite
            .setPosition(this.x + this.mechanicalState.offsetX * 0.38, this.y + this.mechanicalState.offsetY * 0.3)
            .setRotation(this.currentRotation + this.mechanicalState.angle);
        this.ringGraphics.setPosition(this.mechanicalState.offsetX * 0.34, this.mechanicalState.offsetY * 0.26);
        this.hubSprite.setPosition(this.x + this.mechanicalState.offsetX * 0.68, this.y + this.mechanicalState.offsetY * 0.52);
        const targetPointerRotation = dominancePointerRotationForPressure(left);
        const crownResponse = 1 - Math.exp(-Math.min(64, Math.max(0, delta)) / 1000 * 7);
        this.pointerRotation = approachAngle(this.pointerRotation, targetPointerRotation, crownResponse);
        const hubX = this.x + this.mechanicalState.offsetX * 0.68;
        const hubY = this.y + this.mechanicalState.offsetY * 0.52;
        this.crownSprite
            .setPosition(hubX, hubY)
            .setRotation(0)
            .setTint(crownColorForPressure(left));
        this.pointerGraphics
            .setPosition(hubX, hubY)
            .setRotation(this.pointerRotation);
        this.drawDominancePointer(crownColorForPressure(left));
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
            this.drawArc(g, this.x, this.y, radius, segment.startAngle, segment.endAngle, arcThickness + 8, 0x060b12, 0.96);
        }
        // Each segment is split at the exact pressure boundary. This preserves the
        // requested angular ratio even when the boundary falls through a segment.
        for (const segment of segments) {
            const span = segment.endAngle - segment.startAngle;
            const orangeEnd = segment.startAngle + span * segment.orangePortion;
            const cyanStart = orangeEnd;
            if (segment.orangePortion > 0) {
                this.drawGlassPanel(g, this.x, this.y, radius, segment.startAngle, orangeEnd, arcThickness, ARENA_COLORS.left, 0xffe6b0);
            }
            if (segment.cyanPortion > 0) {
                this.drawGlassPanel(g, this.x, this.y, radius, cyanStart, segment.endAngle, arcThickness, ARENA_COLORS.right, 0xd0fffd);
            }
        }
    }
    drawGlassPanel(g, cx, cy, radius, startAngle, endAngle, thickness, color, highlightColor) {
        if (endAngle - startAngle <= 0.0001) {
            return;
        }
        const edgeColor = color === ARENA_COLORS.left ? 0x5b2d08 : 0x0b4b4d;
        const span = endAngle - startAngle;
        const outerRadius = radius + thickness * 0.5;
        const innerRadius = Math.max(1, radius - thickness * 0.5);
        // Rear emission, recessed edge, translucent body, internal light, and
        // bevel highlights make each large wedge read as a thick glass module.
        this.drawArc(g, cx, cy, radius + 4, startAngle, endAngle, thickness + 12, color, 0.16);
        this.drawWedge(g, cx, cy, outerRadius + 3, innerRadius - 3, startAngle, endAngle, edgeColor, 0.92);
        this.drawWedge(g, cx, cy, outerRadius, innerRadius, startAngle, endAngle, color, 0.8);
        this.drawWedge(g, cx, cy, outerRadius - thickness * 0.08, innerRadius + thickness * 0.16, startAngle, endAngle, color, 0.5);
        this.drawArc(g, cx, cy, radius - thickness * 0.24, startAngle, endAngle, thickness * 0.16, highlightColor, 0.82);
        this.drawArc(g, cx, cy, outerRadius - 1, startAngle, endAngle, 1.6, 0xffffff, 0.28);
        this.drawArc(g, cx, cy, innerRadius + 1, startAngle, endAngle, 1.4, highlightColor, 0.46);
        // A short specular reflection sits on the front face instead of filling
        // the entire segment with a flat neon stroke.
        const reflectionStart = startAngle + span * 0.16;
        const reflectionEnd = startAngle + span * 0.48;
        this.drawArc(g, cx, cy, radius + thickness * 0.08, reflectionStart, reflectionEnd, thickness * 0.075, 0xffffff, 0.26);
    }
    drawDominancePointer(color) {
        const g = this.pointerGraphics;
        const length = this.size * 0.225;
        const shaftStart = this.size * 0.035;
        const shaftEnd = length * 0.74;
        const shaftWidth = Math.max(4, this.size * 0.024);
        const headWidth = Math.max(10, this.size * 0.075);
        g.clear();
        g.lineStyle(shaftWidth + 8, color, 0.12);
        g.beginPath();
        g.moveTo(shaftStart, 0);
        g.lineTo(shaftEnd, 0);
        g.strokePath();
        g.lineStyle(shaftWidth + 3, 0x160f13, 0.95);
        g.beginPath();
        g.moveTo(shaftStart, 0);
        g.lineTo(shaftEnd, 0);
        g.strokePath();
        g.lineStyle(shaftWidth, color, 0.96);
        g.beginPath();
        g.moveTo(shaftStart, 0);
        g.lineTo(shaftEnd, 0);
        g.strokePath();
        g.fillStyle(0x160f13, 0.96);
        g.beginPath();
        g.moveTo(shaftEnd - headWidth * 0.16, -headWidth * 0.62);
        g.lineTo(length + headWidth * 0.28, 0);
        g.lineTo(shaftEnd - headWidth * 0.16, headWidth * 0.62);
        g.lineTo(shaftEnd + headWidth * 0.1, 0);
        g.closePath();
        g.fillPath();
        g.fillStyle(color, 0.98);
        g.beginPath();
        g.moveTo(shaftEnd - headWidth * 0.16, -headWidth * 0.43);
        g.lineTo(length + headWidth * 0.2, 0);
        g.lineTo(shaftEnd - headWidth * 0.16, headWidth * 0.43);
        g.lineTo(shaftEnd + headWidth * 0.08, 0);
        g.closePath();
        g.fillPath();
        g.lineStyle(1.5, 0xffffff, 0.44);
        g.beginPath();
        g.moveTo(shaftEnd - headWidth * 0.04, -headWidth * 0.3);
        g.lineTo(length + headWidth * 0.13, 0);
        g.strokePath();
    }
    drawWedge(g, cx, cy, outerRadius, innerRadius, startAngle, endAngle, color, alpha) {
        const steps = Math.max(4, Math.ceil((endAngle - startAngle) / (TAU / 48)));
        g.fillStyle(color, alpha);
        g.beginPath();
        for (let index = 0; index <= steps; index++) {
            const angle = startAngle + (endAngle - startAngle) * index / steps;
            const x = cx + Math.cos(angle) * outerRadius;
            const y = cy + Math.sin(angle) * outerRadius;
            if (index === 0)
                g.moveTo(x, y);
            else
                g.lineTo(x, y);
        }
        for (let index = steps; index >= 0; index--) {
            const angle = startAngle + (endAngle - startAngle) * index / steps;
            g.lineTo(cx + Math.cos(angle) * innerRadius, cy + Math.sin(angle) * innerRadius);
        }
        g.closePath();
        g.fillPath();
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
        this.pointerGraphics.destroy();
        this.crownSprite.destroy();
    }
}
