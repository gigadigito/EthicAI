import type PhaserTypes from 'phaser';
import {
    ArenaPressureHistoryPoint,
    ArenaPressureOptions,
    ArenaPressureResult,
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
import { PressureArt } from './pressure-art.js';
import { PRESSURE_SPRITE_KEYS } from './pressure-visual.js';
import { RopeRenderer } from './rope.js';
import { ArenaPressureHud } from './hud.js';
import { ArenaParticleSystem } from './particles.js';
import { TeamLogoRenderer } from './logos.js';

export async function create(
    host: HTMLElement,
    options: ArenaPressureOptions = {}
): Promise<ArenaPressureEngine> {
    const phaserUrl = '/games/candle-battles/vendor/phaser-3.90.0.esm.min.js';
    const Phaser: typeof PhaserTypes = await import(phaserUrl);
    const engine = new ArenaPressureEngine(host, options, Phaser);
    await engine.ready;
    if (options.videoCapture) {
        engine.installVideoCaptureControl();
    }
    return engine;
}

type CaptureStatus = 'ready' | 'recording' | 'completed' | 'error';

interface ArenaPressureCaptureControl {
    readonly version: 1;
    start(): boolean;
    getState(): ReturnType<ArenaPressureEngine['getCaptureState']>;
}

declare global {
    interface Window {
        __arenaPressureCapture?: ArenaPressureCaptureControl;
    }
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
    private pressureArt?: PressureArt;
    private rope?: RopeRenderer;
    private logos?: TeamLogoRenderer;
    private hud?: ArenaPressureHud;
    private particles?: ArenaParticleSystem;

    // Pressure state
    private targetPressure: number = 50;
    private currentPressure: number = 50;
    private previousPressureSample: number = 50;
    private leftSymbol: string = 'LSK';
    private rightSymbol: string = 'BMT';
    private isFinished: boolean = false;
    private officialResult: ArenaPressureResult = null;
    private isDisposed: boolean = false;

    // Replay state (only used in 'replay' mode)
    private readonly mode: EngineMode;
    private readonly history: ArenaPressureHistoryPoint[];
    private readonly historyDurationSeconds: number;
    private playheadSeconds: number = 0;
    private playing: boolean = true;
    private speed: number = 1;
    private captureStatus: CaptureStatus = 'ready';
    private captureCompletedAt: number | null = null;
    private captureControl?: ArenaPressureCaptureControl;

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
        const prefersReducedMotion = typeof window !== 'undefined'
            && typeof window.matchMedia === 'function'
            && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        this.reducedMotion = Boolean(options.reducedMotion) || prefersReducedMotion;

        this.leftSymbol = options.leftSymbol || 'LSK';
        this.rightSymbol = options.rightSymbol || 'BMT';
        this.isFinished = Boolean(options.isFinished);
        this.officialResult = options.officialResult ?? null;

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
        if (options.videoCapture) {
            this.playing = false;
            this.speed = 4;
        }

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
                        if (!file?.key?.startsWith('buy_state_') && !file?.key?.startsWith('sell_state_'))
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
                    for (const key of PRESSURE_SPRITE_KEYS) {
                        this.load.image(key, baseUrl + 'pressure-states/runtime/' + key + '.png');
                    }

                    // Only the Phaser layers the scene actually draws. The replacement
                    // wheel loads its transparent PNG pack into a CanvasTexture so the
                    // pedestal, shell, LEDs, hub and rope caps can move independently.
                    const images = [
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
                         self.wheel = new WheelMechanism(
                             this,
                             480,
                             277,
                             410,
                             self.options.spriteBaseUrl || '/games/arena-pressure/sprites/',
                             self.reducedMotion
                         );
                        self.candles = new CandleTeamManager(this, self.reducedMotion);
                        self.pressureArt = new PressureArt(this, self.candles, self.reducedMotion, self.currentPressure);
                        self.rope = new RopeRenderer(this, 9);
                        self.logos = new TeamLogoRenderer(this, self.leftSymbol, self.rightSymbol);
                        self.particles = new ArenaParticleSystem(this, self.reducedMotion);
                        self.hud = new ArenaPressureHud(
                            this,
                            self.options.labels || DEFAULT_LABELS,
                            self.leftSymbol,
                            self.rightSymbol
                        );

                        self.installVisibilityGuard();
                         void self.wheel.ready.then(
                             () => self.readyResolve(),
                             error => self.readyReject(error instanceof Error ? error : new Error(String(error)))
                         );
                    } catch (err) {
                        self.readyReject(err instanceof Error ? err : new Error(String(err)));
                    }
                },
                update(this: PhaserTypes.Scene, time: number, delta: number) {
                    if (self.isDisposed || !self.wheel || !self.candles || !self.rope || !self.logos || !self.hud || !self.particles) {
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
                    self.pressureArt?.update(time, self.currentPressure, 100 - self.currentPressure);
                    if (self.options.diagnostics && Math.floor(time / 250) !== Math.floor((time - safeDelta) / 250)) {
                        const grips = self.pressureArt?.getRopeGripPoints('buy');
                        self.host.dataset.arenaCharacterScale = String(self.pressureArt?.getCharacterScale('buy') ?? 1);
                        self.host.dataset.arenaHandY = String(grips?.[0]?.y ?? 0);
                        self.host.dataset.arenaRopeY = '350';
                    }
                    self.logos.setSymbols(self.leftSymbol, self.rightSymbol);
                    self.logos.update(
                        time,
                        self.candles.getTeamBadgeAnchor('left'),
                        self.candles.getTeamBadgeAnchor('right')
                    );

                    // 4. Ropes anchored to the fixed wheel cleats and to the moving hands
                    const leftAnchor = self.wheel.getLeftAnchor();
                    const rightAnchor = self.wheel.getRightAnchor();
                    const leftGrips = self.pressureArt?.getRopeGripPoints('buy') ?? self.candles.getRopeGripPoints('left');
                    const rightGrips = self.pressureArt?.getRopeGripPoints('sell') ?? self.candles.getRopeGripPoints('right');
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
                        self.isFinished,
                        self.officialResult
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
            this.playing = false;
            if (this.captureStatus === 'recording' && this.captureCompletedAt === null) {
                this.captureCompletedAt = performance.now();
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
     * Once the match is finished the gauge freezes at its last valid state; late
     * updates can only refine the confirmed official result, never move the pressure
     * or replace a confirmed winner with an older state.
     */
    public updatePressure(leftPercent: number, isFinished: boolean = false, officialResult: ArenaPressureResult = null): void {
        if (this.isDisposed) {
            return;
        }
        if (this.isFinished) {
            if (isFinished && officialResult !== null) {
                this.officialResult = officialResult;
            }
            return;
        }
        const normalized = normalizePressure(leftPercent, 100 - leftPercent);
        this.targetPressure = normalized.left;
        this.isFinished = isFinished;
        this.officialResult = officialResult;
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
                    this.updatePressure(value, this.isFinished, this.officialResult);
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

    public installVideoCaptureControl(): void {
        if (typeof window === 'undefined' || !this.options.videoCapture || this.captureControl) {
            return;
        }

        const control: ArenaPressureCaptureControl = {
            version: 1,
            start: () => {
                if (this.captureStatus !== 'ready' || this.mode !== 'replay' || this.history.length === 0) {
                    return false;
                }
                this.command('pause');
                this.command('seek', 0);
                this.command('speed', 4);
                this.captureCompletedAt = null;
                this.captureStatus = 'recording';
                this.command('play');
                return true;
            },
            getState: () => this.getCaptureState()
        };
        this.captureControl = control;
        window.__arenaPressureCapture = control;
        this.host.dataset.captureState = 'ready';
    }

    public getCaptureState(): {
        status: CaptureStatus;
        playheadSeconds: number;
        durationSeconds: number;
        speed: number;
        historyPoints: number;
        isFinished: boolean;
        finalFrameStable: boolean;
    } {
        const holdMs = Math.max(250, this.options.captureFinalHoldMs ?? 2000);
        const finalFrameStable = this.captureCompletedAt !== null
            && performance.now() - this.captureCompletedAt >= holdMs;
        if (this.captureStatus === 'recording' && finalFrameStable) {
            this.captureStatus = 'completed';
            this.host.dataset.captureState = 'completed';
        } else if (this.captureStatus === 'recording') {
            this.host.dataset.captureState = 'recording';
        }
        return {
            status: this.captureStatus,
            playheadSeconds: this.playheadSeconds,
            durationSeconds: this.historyDurationSeconds,
            speed: this.speed,
            historyPoints: this.history.length,
            isFinished: this.isFinished,
            finalFrameStable
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

        if (typeof window !== 'undefined' && window.__arenaPressureCapture === this.captureControl) {
            delete window.__arenaPressureCapture;
        }
        this.captureControl = undefined;


        if (this.visibilityHandler && typeof document !== 'undefined') {
            document.removeEventListener('visibilitychange', this.visibilityHandler);
        }
        this.visibilityHandler = undefined;

        this.particles?.destroy();
        this.hud?.destroy();
        this.logos?.destroy();
        this.rope?.destroy();
        this.candles?.destroy();
        this.pressureArt?.destroy();
        this.wheel?.destroy();
        this.particles = undefined;
        this.hud = undefined;
        this.logos = undefined;
        this.rope = undefined;
        this.candles = undefined;
        this.pressureArt = undefined;
        this.wheel = undefined;
        this.scene = undefined;

        if (this.game) {
            this.game.destroy(true);
            this.game = undefined;
        }
    }
}
