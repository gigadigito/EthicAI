import type PhaserTypes from 'phaser';
import {
    ArenaPressureHistoryPoint,
    ArenaPressureOptions,
    ARENA_COLORS,
    clampPercent,
    DEFAULT_LABELS,
    determineDominance,
    normalizePressure,
    resolveHistoryDuration,
    sampleHistory
} from './model.js';
import { WheelMechanism } from './wheel.js';
import { CandleTeamManager } from './candles.js';
import { RopeRenderer } from './rope.js';
import { ArenaPressureHud } from './hud.js';
import { ArenaParticleSystem } from './particles.js';

export async function create(
    host: HTMLElement,
    options: ArenaPressureOptions = {}
): Promise<ArenaPressureEngine> {
    const phaserUrl = '/games/candle-battles/vendor/phaser-3.90.0.esm.min.js';
    const Phaser: typeof PhaserTypes = await import(phaserUrl);
    const engine = new ArenaPressureEngine(host, options, Phaser);
    await engine.ready;
    return engine;
}

type EngineMode = 'live' | 'replay';

export class ArenaPressureEngine {
    public readonly ready: Promise<void>;
    private readyResolve!: () => void;
    private readyReject!: (err: Error) => void;

    private readonly host: HTMLElement;
    private readonly options: ArenaPressureOptions;
    private readonly Phaser: typeof PhaserTypes;
    private readonly reducedMotion: boolean;

    private game?: PhaserTypes.Game;
    private scene?: PhaserTypes.Scene;

    // Subsystems
    private wheel?: WheelMechanism;
    private candles?: CandleTeamManager;
    private rope?: RopeRenderer;
    private hud?: ArenaPressureHud;
    private particles?: ArenaParticleSystem;

    // Pressure state
    private targetPressure: number = 50;
    private currentPressure: number = 50;
    private previousPressureSample: number = 50;
    private leftSymbol: string = 'LSK';
    private rightSymbol: string = 'BMT';
    private isFinished: boolean = false;
    private isDisposed: boolean = false;

    // Replay state (only used in 'replay' mode)
    private readonly mode: EngineMode;
    private readonly history: ArenaPressureHistoryPoint[];
    private readonly historyDurationSeconds: number;
    private playheadSeconds: number = 0;
    private playing: boolean = true;
    private speed: number = 1;

    private visibilityHandler?: () => void;
    private autoPaused: boolean = false;

    constructor(
        host: HTMLElement,
        options: ArenaPressureOptions,
        Phaser: typeof PhaserTypes
    ) {
        this.host = host;
        this.options = options;
        this.Phaser = Phaser;
        this.reducedMotion = Boolean(options.reducedMotion);

        this.leftSymbol = options.leftSymbol || 'LSK';
        this.rightSymbol = options.rightSymbol || 'BMT';
        this.isFinished = Boolean(options.isFinished);

        this.history = Array.isArray(options.history) ? options.history : [];
        this.historyDurationSeconds = resolveHistoryDuration(this.history, options.historyDurationSeconds);
        this.mode = this.history.length > 0 ? 'replay' : 'live';

        const initial = normalizePressure(options.initialLeft, options.initialRight);
        if (this.mode === 'replay') {
            const sampled = sampleHistory(this.history, 0);
            this.playheadSeconds = 0;
            this.playing = !this.isFinished || this.historyDurationSeconds > 1;
            this.targetPressure = clampPercent(sampled ?? initial.left);
        } else {
            this.targetPressure = initial.left;
        }
        this.currentPressure = this.targetPressure;
        this.previousPressureSample = this.targetPressure;

        this.ready = new Promise<void>((resolve, reject) => {
            this.readyResolve = resolve;
            this.readyReject = reject;
        });

        this.initPhaser();
    }

    private initPhaser(): void {
        const baseUrl = this.options.baseUrl || '/games/arena-pressure/assets/';
        const self = this;
        let loadFailure: Error | null = null;

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
                preload(this: PhaserTypes.Scene) {
                    this.load.on('loaderror', (file: PhaserTypes.Loader.File) => {
                        loadFailure = new Error(`arena_pressure_asset_load_failed:${file?.key ?? 'unknown'}`);
                    });

                    this.load.image('arena-bg', baseUrl + 'arena-background.webp');
                    this.load.spritesheet('orange', baseUrl + 'orange-pull-sheet.png', {
                        frameWidth: 112,
                        frameHeight: 160
                    });
                    this.load.spritesheet('cyan', baseUrl + 'cyan-pull-sheet.png', {
                        frameWidth: 112,
                        frameHeight: 160
                    });

                    // Only the layers the scene actually draws: the base art already carries
                    // the rope cleats and the direction chevrons, so no extra overlays load.
                    const images = [
                        'wheel-base',
                        'wheel-disc',
                        'wheel-hub',
                        'wheel-crown',
                        'hud-crown',
                        'effect-sparks',
                        'effect-smoke'
                    ];
                    for (const img of images) {
                        this.load.image(img, baseUrl + img + '.png');
                    }
                },
                create(this: PhaserTypes.Scene) {
                    if (loadFailure) {
                        self.readyReject(loadFailure);
                        return;
                    }

                    try {
                        self.scene = this;

                        // Background
                        this.add.image(480, 270, 'arena-bg').setDisplaySize(960, 540);

                        // Fixed mechanism + teams + ropes + effects + HUD
                        self.wheel = new WheelMechanism(this, 480, 277, 320);
                        self.candles = new CandleTeamManager(this, self.reducedMotion);
                        self.rope = new RopeRenderer(this, 9);
                        self.particles = new ArenaParticleSystem(this, self.reducedMotion);
                        self.hud = new ArenaPressureHud(
                            this,
                            self.options.labels || DEFAULT_LABELS,
                            self.leftSymbol,
                            self.rightSymbol
                        );

                        self.installVisibilityGuard();
                        self.readyResolve();
                    } catch (err) {
                        self.readyReject(err instanceof Error ? err : new Error(String(err)));
                    }
                },
                update(this: PhaserTypes.Scene, time: number, delta: number) {
                    if (self.isDisposed || !self.wheel || !self.candles || !self.rope || !self.hud || !self.particles) {
                        return;
                    }

                    const safeDelta = Math.min(64, Math.max(0, delta));

                    // 1. Resolve the pressure for this frame.
                    if (self.mode === 'replay') {
                        self.advanceReplay(safeDelta);
                    }
                    // Responsive easing towards the target, frame-rate independent.
                    const ease = 1 - Math.pow(0.84, safeDelta / 16.6);
                    self.currentPressure += (self.targetPressure - self.currentPressure) * ease;

                    const dominance = determineDominance(self.currentPressure, 100 - self.currentPressure);

                    // 2. Central mechanism stays fixed; only the inner disc and LEDs react.
                    // The wheel receives the change in the real pressure sample, not the
                    // current dominance. Stable 70/30 pressure therefore coasts to rest.
                    const pressureDelta = self.consumePressureSampleDelta();
                    self.wheel.update(
                        self.currentPressure,
                        self.targetPressure,
                        safeDelta,
                        pressureDelta,
                        self.playing
                    );

                    // 3. Character pull teams
                    self.candles.update(
                        time,
                        self.currentPressure,
                        100 - self.currentPressure,
                        self.isFinished
                    );

                    // 4. Ropes anchored to the fixed wheel cleats and to the moving hands
                    const leftAnchor = self.wheel.getLeftAnchor();
                    const rightAnchor = self.wheel.getRightAnchor();
                    const leftGrips = self.candles.getRopeGripPoints('left');
                    const rightGrips = self.candles.getRopeGripPoints('right');
                    self.rope.render(
                        time,
                        leftAnchor,
                        rightAnchor,
                        leftGrips,
                        rightGrips,
                        self.currentPressure,
                        100 - self.currentPressure
                    );

                    // 5. HUD (values, dominance, proportion gauge)
                    self.hud.update(
                        self.currentPressure,
                        dominance,
                        self.leftSymbol,
                        self.rightSymbol,
                        self.isFinished
                    );

                    // 6. Pooled strain effects
                    self.particles.update(safeDelta);
                    if (self.currentPressure >= 68) {
                        self.particles.emitStrainSparks(time, rightGrips, ARENA_COLORS.right);
                    } else if (self.currentPressure <= 32) {
                        self.particles.emitStrainSparks(time, leftGrips, ARENA_COLORS.left);
                    }

                    if (Math.abs(self.currentPressure - 50) > 25 && Math.random() < 0.05) {
                        self.particles.emitWheelSmoke(self.wheel.x, self.wheel.y);
                    }
                }
            }
        });
    }

    /**
     * Replays the real pressure history on a clock. Sampling is stateless, so pausing,
     * resuming or seeking can never duplicate or skip pressure events.
     */
    private advanceReplay(deltaMs: number): void {
        if (!this.playing) {
            return;
        }

        this.playheadSeconds += (deltaMs / 1000) * this.speed;
        if (this.playheadSeconds >= this.historyDurationSeconds) {
            this.playheadSeconds = this.historyDurationSeconds;
            if (this.isFinished) {
                this.playing = false;
            }
        }

        const sampled = sampleHistory(this.history, this.playheadSeconds);
        if (sampled !== null) {
            this.targetPressure = sampled;
        }
    }

    private consumePressureSampleDelta(): number {
        const current = this.targetPressure;
        const delta = Number.isFinite(current) && Number.isFinite(this.previousPressureSample)
            ? current - this.previousPressureSample
            : 0;
        this.previousPressureSample = current;
        return delta;
    }

    /**
     * Stops rendering when the tab is hidden and resumes afterwards. The browser
     * already throttles timers, but skipping scene work avoids background CPU use.
     */
    private installVisibilityGuard(): void {
        if (typeof document === 'undefined') {
            return;
        }

        this.visibilityHandler = () => {
            if (this.isDisposed || !this.scene) {
                return;
            }

            if (document.hidden) {
                this.autoPaused = true;
                this.scene.scene.pause();
            } else if (this.autoPaused) {
                this.autoPaused = false;
                this.scene.scene.resume();
            }
        };

        document.addEventListener('visibilitychange', this.visibilityHandler);
    }

    /**
     * Updates the target pressure from real Match Arena data. Never re-creates the game.
     */
    public updatePressure(leftPercent: number, isFinished: boolean = false): void {
        if (this.isDisposed) {
            return;
        }
        const normalized = normalizePressure(leftPercent, 100 - leftPercent);
        this.targetPressure = normalized.left;
        this.isFinished = isFinished;
    }

    /**
     * Sets dynamic team symbols.
     */
    public setSymbols(left: string, right: string): void {
        this.leftSymbol = left || 'LSK';
        this.rightSymbol = right || 'BMT';
    }

    /**
     * Updates localized labels.
     */
    public setLabels(labels: Record<string, string>): void {
        this.hud?.setLabels(labels);
    }

    /**
     * External control surface: live pressure, replay transport and scene pause.
     */
    public command(action: string, value?: number): void {
        if (this.isDisposed) {
            return;
        }

        switch (action) {
            case 'setPressure':
                if (typeof value === 'number') {
                    this.updatePressure(value, this.isFinished);
                }
                break;
            case 'play':
                this.playing = true;
                if (this.mode === 'replay' && this.playheadSeconds >= this.historyDurationSeconds) {
                    this.playheadSeconds = 0;
                    const sampled = sampleHistory(this.history, 0);
                    if (sampled !== null) {
                        this.targetPressure = sampled;
                        this.currentPressure = sampled;
                        this.previousPressureSample = sampled;
                        this.wheel?.resetMotion();
                    }
                }
                if (this.scene && this.autoPaused) {
                    this.autoPaused = false;
                    this.scene.scene.resume();
                }
                break;
            case 'pause':
                this.playing = false;
                break;
            case 'seek':
                if (typeof value === 'number' && Number.isFinite(value)) {
                    this.playheadSeconds = Math.max(0, Math.min(this.historyDurationSeconds, value));
                    const sampled = sampleHistory(this.history, this.playheadSeconds);
                    if (sampled !== null) {
                        this.targetPressure = sampled;
                        this.currentPressure = sampled;
                        this.previousPressureSample = sampled;
                        this.wheel?.resetMotion();
                    }
                }
                break;
            case 'speed':
                if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
                    this.speed = Math.max(0.1, Math.min(16, value));
                }
                break;
            case 'pauseScene':
                this.scene?.scene.pause();
                break;
            case 'resume':
                this.playing = true;
                this.scene?.scene.resume();
                break;
        }
    }

    /**
     * Engine state for the host controls (replay transport).
     */
    public getState(): {
        mode: EngineMode;
        playing: boolean;
        playheadSeconds: number;
        durationSeconds: number;
        speed: number;
        leftPercent: number;
    } {
        return {
            mode: this.mode,
            playing: this.playing,
            playheadSeconds: this.playheadSeconds,
            durationSeconds: this.historyDurationSeconds,
            speed: this.speed,
            leftPercent: Math.round(this.currentPressure)
        };
    }

    /**
     * Destroys the Phaser instance and releases every resource.
     */
    public dispose(): void {
        if (this.isDisposed) {
            return;
        }
        this.isDisposed = true;

        if (this.visibilityHandler && typeof document !== 'undefined') {
            document.removeEventListener('visibilitychange', this.visibilityHandler);
        }
        this.visibilityHandler = undefined;

        this.particles?.destroy();
        this.hud?.destroy();
        this.rope?.destroy();
        this.candles?.destroy();
        this.wheel?.destroy();
        this.particles = undefined;
        this.hud = undefined;
        this.rope = undefined;
        this.candles = undefined;
        this.wheel = undefined;
        this.scene = undefined;

        if (this.game) {
            this.game.destroy(true);
            this.game = undefined;
        }
    }
}
