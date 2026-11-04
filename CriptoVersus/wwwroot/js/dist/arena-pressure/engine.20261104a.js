import { ARENA_COLORS, DEFAULT_LABELS, determineDominance, normalizePressure } from './model.20261104a.js';
import { WheelMechanism } from './wheel.20261104a.js';
import { CandleTeamManager } from './candles.20261104a.js';
import { RopeRenderer } from './rope.20261104a.js';
import { ArenaPressureHud } from './hud.20261104a.js';
import { ArenaParticleSystem } from './particles.20261104a.js';
export async function create(host, options = {}) {
    const phaserUrl = '/games/candle-battles/vendor/phaser-3.90.0.esm.min.js';
    const Phaser = await import(phaserUrl);
    const engine = new ArenaPressureEngine(host, options, Phaser);
    await engine.ready;
    return engine;
}
export class ArenaPressureEngine {
    constructor(host, options, Phaser) {
        // State tracking
        this.targetPressure = 50;
        this.currentPressure = 50;
        this.leftSymbol = 'LSK';
        this.rightSymbol = 'BMT';
        this.isFinished = false;
        this.isDisposed = false;
        this.host = host;
        this.options = options;
        this.Phaser = Phaser;
        this.leftSymbol = options.leftSymbol || 'LSK';
        this.rightSymbol = options.rightSymbol || 'BMT';
        this.isFinished = Boolean(options.isFinished);
        const initial = normalizePressure(options.initialLeft, options.initialRight);
        this.targetPressure = initial.left;
        this.currentPressure = initial.left;
        this.ready = new Promise((resolve, reject) => {
            this.readyResolve = resolve;
            this.readyReject = reject;
        });
        this.initPhaser();
    }
    initPhaser() {
        const baseUrl = this.options.baseUrl || '/games/arena-pressure/assets/';
        const self = this;
        this.game = new this.Phaser.Game({
            type: this.Phaser.AUTO,
            parent: this.host,
            width: 960,
            height: 540,
            transparent: false,
            backgroundColor: ARENA_COLORS.backgroundHex,
            scale: {
                mode: this.Phaser.Scale.FIT,
                autoCenter: this.Phaser.Scale.CENTER_BOTH
            },
            render: {
                pixelArt: false,
                roundPixels: false,
                antialias: true
            },
            scene: {
                preload() {
                    this.load.image('arena-bg', baseUrl + 'arena-background.webp');
                    this.load.spritesheet('orange', baseUrl + 'orange-pull-sheet.png', {
                        frameWidth: 112,
                        frameHeight: 160
                    });
                    this.load.spritesheet('cyan', baseUrl + 'cyan-pull-sheet.png', {
                        frameWidth: 112,
                        frameHeight: 160
                    });
                    const images = [
                        'wheel-base',
                        'wheel-disc',
                        'wheel-hub',
                        'arrow-orange',
                        'arrow-cyan',
                        'hud-crown',
                        'effect-sparks',
                        'effect-smoke'
                    ];
                    for (const img of images) {
                        this.load.image(img, baseUrl + img + '.png');
                    }
                },
                create() {
                    try {
                        self.scene = this;
                        // Background
                        this.add.image(480, 270, 'arena-bg').setDisplaySize(960, 540);
                        // Instantiate subsystems
                        self.wheel = new WheelMechanism(this, 480, 277, 320);
                        self.candles = new CandleTeamManager(this);
                        self.rope = new RopeRenderer(this, 9);
                        self.particles = new ArenaParticleSystem(this);
                        self.hud = new ArenaPressureHud(this, self.options.labels || DEFAULT_LABELS, self.leftSymbol, self.rightSymbol);
                        self.readyResolve();
                    }
                    catch (err) {
                        self.readyReject(err instanceof Error ? err : new Error(String(err)));
                    }
                },
                update(time, delta) {
                    if (self.isDisposed || !self.wheel || !self.candles || !self.rope || !self.hud) {
                        return;
                    }
                    // 1. Smooth interpolation towards target pressure
                    // Responsive easing: 0.16 per frame creates silky smooth motion without lag
                    self.currentPressure += (self.targetPressure - self.currentPressure) * 0.16;
                    const dominance = determineDominance(self.currentPressure, 100 - self.currentPressure);
                    // 2. Update Central Mechanism (fixed position, rotating turbine, dynamic LED arc)
                    self.wheel.update(self.currentPressure, self.targetPressure, delta);
                    // 3. Update Character Pull Teams
                    self.candles.update(time, self.currentPressure, 100 - self.currentPressure, self.isFinished);
                    // 4. Update Connecting Dynamic Ropes
                    const leftGrips = self.candles.getRopeGripPoints('left');
                    const rightGrips = self.candles.getRopeGripPoints('right');
                    self.rope.render(time, { x: self.wheel.x, y: self.wheel.y }, 140, // attachment offset from wheel center
                    leftGrips, rightGrips, self.currentPressure, 100 - self.currentPressure);
                    // 5. Update HUD (Values, Dominance, Proportion gauge)
                    self.hud.update(self.currentPressure, dominance, self.leftSymbol, self.rightSymbol);
                    // 6. Particle Strain Effects
                    if (self.particles) {
                        if (self.currentPressure >= 68) {
                            // Cyan team enduring severe strain
                            self.particles.emitStrainSparks(time, rightGrips, ARENA_COLORS.right);
                        }
                        else if (self.currentPressure <= 32) {
                            // Orange team enduring severe strain
                            self.particles.emitStrainSparks(time, leftGrips, ARENA_COLORS.left);
                        }
                        if (Math.abs(self.currentPressure - 50) > 25 && Math.random() < 0.05) {
                            self.particles.emitWheelSmoke(self.wheel.x, self.wheel.y);
                        }
                    }
                }
            }
        });
    }
    /**
     * Updates the target pressure from real Match Arena data.
     */
    updatePressure(leftPercent, isFinished = false) {
        if (this.isDisposed)
            return;
        const normalized = normalizePressure(leftPercent, 100 - leftPercent);
        this.targetPressure = normalized.left;
        this.isFinished = isFinished;
    }
    /**
     * Sets dynamic team symbols.
     */
    setSymbols(left, right) {
        this.leftSymbol = left || 'LSK';
        this.rightSymbol = right || 'BMT';
    }
    /**
     * Updates localized labels.
     */
    setLabels(labels) {
        this.hud?.setLabels(labels);
    }
    /**
     * Handles dev or external commands (pause, seek, reset).
     */
    command(action, value) {
        if (this.isDisposed || !this.scene)
            return;
        switch (action) {
            case 'setPressure':
                if (typeof value === 'number') {
                    this.updatePressure(value);
                }
                break;
            case 'pause':
                this.scene.scene.pause();
                break;
            case 'resume':
                this.scene.scene.resume();
                break;
        }
    }
    /**
     * Destroys Phaser instance and cleans up all memory.
     */
    dispose() {
        if (this.isDisposed)
            return;
        this.isDisposed = true;
        this.particles?.destroy();
        this.hud?.destroy();
        this.rope?.destroy();
        this.candles?.destroy();
        this.wheel?.destroy();
        if (this.game) {
            this.game.destroy(true);
            this.game = undefined;
        }
    }
}
