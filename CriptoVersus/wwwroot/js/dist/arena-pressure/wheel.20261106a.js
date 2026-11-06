import { ARENA_COLORS } from './model.20261106a.js';
const SOURCE_SIZE = 1254;
const SOURCE_CENTER_X = 626;
const SOURCE_CENTER_Y = 599;
const SOURCE_IMAGE_CENTER = SOURCE_SIZE / 2;
const LEFT_ROPE_ANCHOR = { x: 70, y: 606 };
const RIGHT_ROPE_ANCHOR = { x: 1184, y: 606 };
const MAX_WOBBLE_DEGREES = 6;
const FULL_RING_SEGMENT_COUNT = 18;
function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}
export function crownColorForPressure(leftPressure) {
    if (leftPressure > 50)
        return ARENA_COLORS.left;
    if (leftPressure < 50)
        return ARENA_COLORS.right;
    return ARENA_COLORS.gold;
}
export function hubColorForPressure(leftPressure) {
    if (leftPressure > 50)
        return 'orange';
    if (leftPressure < 50)
        return 'cyan';
    return 'neutral';
}
/** The atlas uses negative angles for the left/orange side and positive for cyan. */
export function hubAngleForPressure(leftPressure) {
    return Math.round(clamp((50 - clamp(leftPressure, 0, 100)) * 0.6, -30, 30));
}
/**
 * Maps the normalized pressure pair to a complete 18-sector ring. The sum of the
 * orange and cyan portions is exactly 18, so no sector is lost when the boundary is
 * fractional (37/63 produces 6.66/11.34 sectors).
 */
export function buildFullRingCoverage(leftPressure, rightPressure) {
    const left = Math.max(0, Number.isFinite(leftPressure) ? leftPressure : 0);
    const right = Math.max(0, Number.isFinite(rightPressure) ? rightPressure : 0);
    const total = left + right;
    const orangeBoundary = (total > 0 ? left / total : 0.5) * FULL_RING_SEGMENT_COUNT;
    return Array.from({ length: FULL_RING_SEGMENT_COUNT }, (_, index) => ({
        index,
        orangePortion: clamp(orangeBoundary - index, 0, 1),
        cyanPortion: clamp(index + 1 - orangeBoundary, 0, 1)
    }));
}
/**
 * Wobble is a small mechanical oscillation, not a winner pointer. The pressure bias
 * is deliberately tiny; the two incommensurate waves let the wheel briefly answer
 * in either direction even when one side dominates.
 */
export function wheelWobbleAngleDegrees(clockSeconds, leftPressure, reducedMotion = false) {
    const bias = clamp((leftPressure - 50) / 50, -1, 1) * 0.35;
    const wave = Math.sin(clockSeconds * 0.78) * 4.2
        + Math.sin(clockSeconds * 2.17 + 0.9) * 1.15
        + bias;
    return clamp(wave * (reducedMotion ? 0.35 : 1), -MAX_WOBBLE_DEGREES, MAX_WOBBLE_DEGREES);
}
/** Keeps restrained mechanical state independent from central hub orientation. */
export function stepWheelMechanicalTension(state, leftPressure, deltaMs, motionActive = true) {
    const deltaSeconds = Math.min(64, Math.max(0, deltaMs)) / 1000;
    if (!motionActive || deltaSeconds <= 0)
        return state;
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
function signedAngleName(angle) {
    const rounded = Math.round(clamp(angle, -30, 30));
    return `${rounded >= 0 ? '+' : '-'}${String(Math.abs(rounded)).padStart(2, '0')}`;
}
function wobbleName(angle) {
    const rounded = Math.round(clamp(angle, -MAX_WOBBLE_DEGREES, MAX_WOBBLE_DEGREES));
    return `${rounded >= 0 ? '+' : '-'}${String(Math.abs(rounded)).padStart(2, '0')}`;
}
export class WheelMechanism {
    constructor(scene, x = 480, y = 277, size = 410, assetRoot = '/games/arena-pressure/sprites/', reducedMotion = false) {
        this.images = new Map();
        this.imageLoads = new Map();
        this.failedImages = new Set();
        this.destroyed = false;
        this.currentHubAngle = 0;
        this.hubColor = 'neutral';
        this.lastReadyHubPath = 'hub/frames/neutral/angulo_+00.png';
        this.lastPressure = 50;
        this.currentRingOrangeShare = 0.5;
        this.mechanicalState = {
            clock: 0,
            offsetX: 0,
            offsetY: 0,
            angle: 0
        };
        this.scene = scene;
        this.x = x;
        this.y = y;
        this.size = size;
        this.assetRoot = assetRoot.replace(/\/?$/, '/');
        this.reducedMotion = reducedMotion;
        this.canvas = document.createElement('canvas');
        this.canvas.width = SOURCE_SIZE;
        this.canvas.height = SOURCE_SIZE;
        const context = this.canvas.getContext('2d');
        if (!context)
            throw new Error('arena_pressure_canvas_context_unavailable');
        this.context = context;
        this.context.imageSmoothingEnabled = true;
        this.textureKey = `arena-pressure-sprite-wheel-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        this.texture = scene.sys.textures.addCanvas(this.textureKey, this.canvas) ?? undefined;
        if (!this.texture)
            throw new Error('arena_pressure_canvas_texture_unavailable');
        const imageY = y + (SOURCE_IMAGE_CENTER - SOURCE_CENTER_Y) * (size / SOURCE_SIZE);
        this.sprite = scene.add.image(x, imageY, this.textureKey)
            .setDisplaySize(size, size)
            .setDepth(6);
        this.ready = this.initialize();
    }
    async initialize() {
        const response = await fetch(`${this.assetRoot}manifest.json`, { cache: 'force-cache' });
        if (!response.ok)
            throw new Error(`arena_pressure_manifest_${response.status}`);
        this.manifest = await response.json();
        if (this.manifest.source_size[0] !== SOURCE_SIZE || this.manifest.source_size[1] !== SOURCE_SIZE) {
            throw new Error('arena_pressure_manifest_source_size_mismatch');
        }
        const fullRing = this.manifest.full_ring_v2;
        if (!fullRing || fullRing.segments.length !== FULL_RING_SEGMENT_COUNT) {
            throw new Error('arena_pressure_full_ring_manifest_unavailable');
        }
        const wobblePaths = Array.from({ length: 13 }, (_, index) => {
            const angle = index - MAX_WOBBLE_DEGREES;
            return `wheel/wobble/inclinacao_${wobbleName(angle)}.png`;
        });
        const staticPaths = [
            'base/suporte_fixo.png',
            'base/cordas_extremidades.png',
            'lights/special/left_raios_internos.png',
            'lights/special/right_raios_internos.png',
            'lights/special/left_suporte.png',
            'lights/special/right_suporte.png',
            'hub/frames/neutral/angulo_+00.png',
            ...wobblePaths,
            ...fullRing.segments.flatMap(segment => [segment.orange, segment.cyan])
        ];
        const loaded = await Promise.all(staticPaths.map(path => this.loadImage(path)));
        if (loaded.some(image => image === null)) {
            throw new Error('arena_pressure_required_sprite_load_failed');
        }
        this.render(50);
    }
    loadImage(path) {
        const existing = this.imageLoads.get(path);
        if (existing)
            return existing;
        if (this.images.has(path))
            return Promise.resolve(this.images.get(path) ?? null);
        if (this.failedImages.has(path))
            return Promise.resolve(null);
        const promise = new Promise(resolve => {
            const image = new Image();
            image.decoding = 'async';
            image.onload = () => {
                if (!this.destroyed) {
                    this.images.set(path, image);
                    this.render(this.lastPressure);
                }
                resolve(image);
            };
            image.onerror = () => {
                this.failedImages.add(path);
                resolve(null);
            };
            image.src = `${this.assetRoot}${path}`;
        });
        this.imageLoads.set(path, promise);
        return promise;
    }
    ensureHubFrame(path) {
        if (this.images.has(path) || this.failedImages.has(path))
            return;
        void this.loadImage(path);
    }
    drawSprite(path, alpha = 1) {
        if (alpha <= 0 || !this.manifest)
            return;
        const image = this.images.get(path);
        const sprite = this.manifest.sprites[path];
        if (!image || !sprite)
            return;
        this.context.save();
        this.context.globalAlpha = clamp(alpha, 0, 1);
        this.context.drawImage(image, sprite.x, sprite.y, sprite.width, sprite.height);
        this.context.restore();
    }
    drawFullRingSprite(path, sectorStart, sectorEnd, sectorIndex) {
        if (!this.manifest || sectorEnd <= sectorStart)
            return;
        const image = this.images.get(path);
        const sprite = this.manifest.sprites[path];
        if (!image || !sprite)
            return;
        const pivot = this.manifest.full_ring_v2?.wheel_pivot ?? [SOURCE_CENTER_X, SOURCE_CENTER_Y];
        this.context.save();
        // Full-sector sprites retain their hand-cut silhouette. Only the sector that
        // contains the pressure boundary receives an angular clip.
        if (sectorStart > sectorIndex + 0.0001 || sectorEnd < sectorIndex + 1 - 0.0001) {
            const startAngle = Math.PI / 2 + (sectorStart / FULL_RING_SEGMENT_COUNT) * Math.PI * 2;
            const endAngle = Math.PI / 2 + (sectorEnd / FULL_RING_SEGMENT_COUNT) * Math.PI * 2;
            this.context.beginPath();
            this.context.moveTo(pivot[0], pivot[1]);
            this.context.arc(pivot[0], pivot[1], 1600, startAngle, endAngle, false);
            this.context.closePath();
            this.context.clip();
        }
        this.context.drawImage(image, sprite.x, sprite.y, sprite.width, sprite.height);
        this.context.restore();
    }
    drawFullRingLights(wobbleDegrees) {
        const fullRing = this.manifest?.full_ring_v2;
        if (!fullRing)
            return;
        const boundary = clamp(this.currentRingOrangeShare, 0, 1) * FULL_RING_SEGMENT_COUNT;
        const pivot = fullRing.wheel_pivot;
        this.context.save();
        this.context.translate(pivot[0], pivot[1]);
        this.context.rotate(wobbleDegrees * Math.PI / 180);
        this.context.translate(-pivot[0], -pivot[1]);
        fullRing.segments.forEach((segment, index) => {
            this.drawFullRingSprite(segment.orange, index, Math.min(index + 1, boundary), index);
            this.drawFullRingSprite(segment.cyan, Math.max(index, boundary), index + 1, index);
        });
        this.context.restore();
    }
    updateHubColor(targetColor) {
        if (targetColor === 'neutral') {
            this.hubColor = 'neutral';
            return;
        }
        if (this.hubColor === targetColor)
            return;
        if (this.hubColor === 'neutral') {
            if (Math.abs(this.currentHubAngle) >= 2) {
                this.hubColor = this.currentHubAngle < 0 ? 'orange' : 'cyan';
            }
            return;
        }
        // Leadership changes cross the neutral atlas instead of recolouring a frame
        // while it is still visibly leaning toward the previous side.
        const crossing = this.hubColor === 'orange'
            ? this.currentHubAngle >= -1
            : this.currentHubAngle <= 1;
        if (crossing)
            this.hubColor = 'neutral';
    }
    render(leftPressure) {
        if (this.destroyed || !this.manifest || !this.texture)
            return;
        const wobble = wheelWobbleAngleDegrees(this.mechanicalState.clock, leftPressure, this.reducedMotion);
        const wobblePath = `wheel/wobble/inclinacao_${wobbleName(wobble)}.png`;
        const targetHubPath = `hub/frames/${this.hubColor}/angulo_${signedAngleName(this.currentHubAngle)}.png`;
        this.ensureHubFrame(targetHubPath);
        this.context.clearRect(0, 0, SOURCE_SIZE, SOURCE_SIZE);
        this.drawSprite('base/suporte_fixo.png');
        this.drawSprite(wobblePath);
        // Full-ring vitral layers use the same manifest pivot as the shell wobble.
        // Only the exact orange/cyan boundary is clipped; complete sectors keep the
        // supplied hand-cut silhouette and metallic reflections intact.
        this.drawFullRingLights(wobble);
        // Internal rays follow the same external wobble; support LEDs remain fixed.
        const pivot = this.manifest.full_ring_v2?.wheel_pivot ?? this.manifest.center_pivot_px;
        this.context.save();
        this.context.translate(pivot[0], pivot[1]);
        this.context.rotate(wobble * Math.PI / 180);
        this.context.translate(-pivot[0], -pivot[1]);
        this.drawSprite('lights/special/left_raios_internos.png', 0.08 + leftPressure / 100 * 0.84);
        this.drawSprite('lights/special/right_raios_internos.png', 0.08 + (100 - leftPressure) / 100 * 0.84);
        this.context.restore();
        // Support LEDs stay fixed with the pedestal, unlike ring lights.
        this.drawSprite('lights/special/left_suporte.png', leftPressure / 100);
        this.drawSprite('lights/special/right_suporte.png', (100 - leftPressure) / 100);
        // Each hub frame already contains its crown. Never layer a second crown.
        if (this.images.has(targetHubPath))
            this.lastReadyHubPath = targetHubPath;
        this.drawSprite(this.lastReadyHubPath);
        // Rope end caps remain fixed to the original source coordinates.
        this.drawSprite('base/cordas_extremidades.png');
        this.texture.refresh();
    }
    update(currentPressure, _targetPressure, delta, _pressureDelta = 0, motionActive = true) {
        const left = clamp(currentPressure, 0, 100);
        this.lastPressure = left;
        this.mechanicalState = stepWheelMechanicalTension(this.mechanicalState, left, delta, motionActive);
        const targetHubAngle = hubAngleForPressure(left);
        const hubResponse = 1 - Math.exp(-Math.min(64, Math.max(0, delta)) / 1000 * 7);
        this.currentHubAngle += (targetHubAngle - this.currentHubAngle) * hubResponse;
        this.updateHubColor(hubColorForPressure(left));
        const targetRingOrangeShare = clamp(left / 100, 0, 1);
        const lightResponse = 1 - Math.exp(-Math.min(64, Math.max(0, delta)) / 1000 * 8);
        this.currentRingOrangeShare += (targetRingOrangeShare - this.currentRingOrangeShare) * lightResponse;
        this.render(left);
    }
    /** Clears the mechanical clock response after a replay seek. */
    resetMotion() {
        this.mechanicalState = {
            ...this.mechanicalState,
            offsetX: 0,
            offsetY: 0,
            angle: 0
        };
    }
    getLeftAnchor() {
        const scale = this.size / SOURCE_SIZE;
        const imageY = this.y + (SOURCE_IMAGE_CENTER - SOURCE_CENTER_Y) * scale;
        return {
            x: this.x + (LEFT_ROPE_ANCHOR.x - SOURCE_IMAGE_CENTER) * scale,
            y: imageY + (LEFT_ROPE_ANCHOR.y - SOURCE_IMAGE_CENTER) * scale
        };
    }
    getRightAnchor() {
        const scale = this.size / SOURCE_SIZE;
        const imageY = this.y + (SOURCE_IMAGE_CENTER - SOURCE_CENTER_Y) * scale;
        return {
            x: this.x + (RIGHT_ROPE_ANCHOR.x - SOURCE_IMAGE_CENTER) * scale,
            y: imageY + (RIGHT_ROPE_ANCHOR.y - SOURCE_IMAGE_CENTER) * scale
        };
    }
    destroy() {
        if (this.destroyed)
            return;
        this.destroyed = true;
        this.sprite.destroy();
        this.scene.sys.textures.remove(this.textureKey);
        this.texture = undefined;
        this.images.clear();
        this.imageLoads.clear();
        this.failedImages.clear();
    }
}
