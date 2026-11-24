import type PhaserTypes from 'phaser';
import {
    ArenaPressureCapturePrepareResult,
    ArenaPressureCaptureStartOptions,
    ArenaPressureHistoryPoint,
    ArenaPressureOptions,
    ArenaPressureResult,
    ARENA_COLORS,
    clampCaptureSpeed,
    clampPercent,
    DEFAULT_LABELS,
    determineDominance,
    normalizePressure,
    resolveHistoryDuration,
    resolveCapturePlayhead,
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

export interface ArenaPressurePerfMetrics {
    renderer: 'WEBGL' | 'CANVAS' | 'UNKNOWN';
    glRenderer: string;
    webglContextLost: number;
    updateFrames: number;
    updateFps: number;
    renderFrames: number;
    renderFps: number;
    avgFrameMs: number;
    p50FrameMs: number;
    p95FrameMs: number;
    maxFrameMs: number;
    avgUpdateMs: number;
    p95UpdateMs: number;
    avgRenderMs: number;
    p95RenderMs: number;
    avgWheelMs: number;
    avgGapMs: number;
    p50GapMs: number;
    p95GapMs: number;
    maxGapMs: number;
    avgDeltaMs: number;
    maxDeltaMs: number;
    overBudgetFrames: number;
    longTasks: number;
    longTaskTotalMs: number;
}

interface ArenaPressureCaptureControl {
    readonly version: 1;
    readonly capabilities: readonly string[];
    start(options?: ArenaPressureCaptureStartOptions): boolean;
    seek(seconds: number, videoStartSeconds?: number): boolean;
    prepareSegment(options?: ArenaPressureCaptureStartOptions): Promise<ArenaPressureCapturePrepareResult>;
    getState(): ReturnType<ArenaPressureEngine['getCaptureState']>;
    getPerfMetrics?(): ArenaPressurePerfMetrics;
}

interface PerfCollectorState {
    webglContextLost: number;
    updateFrames: number;
    firstUpdateMs: number | null;
    lastUpdateMs: number | null;
    renderFrames: number;
    firstRenderMs: number | null;
    lastRenderMs: number | null;
    renderStartMs: number;
    pendingUpdateMs: number;
    pendingGapMs: number;
    updateWorkMs: number[];
    renderWorkMs: number[];
    frameWorkMs: number[];
    wheelWorkMs: number[];
    gapsMs: number[];
    deltasMs: number[];
    overBudgetFrames: number;
    longTasks: number;
    longTaskTotalMs: number;
}

function createPerfCollectorState(): PerfCollectorState {
    return {
        webglContextLost: 0,
        updateFrames: 0,
        firstUpdateMs: null,
        lastUpdateMs: null,
        renderFrames: 0,
        firstRenderMs: null,
        lastRenderMs: null,
        renderStartMs: 0,
        pendingUpdateMs: 0,
        pendingGapMs: 0,
        updateWorkMs: [],
        renderWorkMs: [],
        frameWorkMs: [],
        wheelWorkMs: [],
        gapsMs: [],
        deltasMs: [],
        overBudgetFrames: 0,
        longTasks: 0,
        longTaskTotalMs: 0
    };
}

function summarizeValues(values: number[]): { avg: number; p50: number; p95: number; max: number } {
    if (values.length === 0) return { avg: 0, p50: 0, p95: 0, max: 0 };
    const sorted = values.slice().sort((left, right) => left - right);
    const sum = sorted.reduce((acc, value) => acc + value, 0);
    const pick = (ratio: number): number => {
        const index = Math.min(sorted.length - 1, Math.floor(ratio * (sorted.length - 1)));
        return sorted[index];
    };
    return {
        avg: sum / sorted.length,
        p50: pick(0.5),
        p95: pick(0.95),
        max: sorted[sorted.length - 1]
    };
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
    private readonly historySpanSeconds: number;
    private playheadSeconds: number = 0;
    private playing: boolean = true;
    private speed: number = 1;
    private captureStatus: CaptureStatus = 'ready';
    private captureCompletedAt: number | null = null;
    private captureClockStartedAt: number | null = null;
    private captureClockStartPlayhead: number = 0;
    private captureVisualBaseMs: number = 0;
    private capturePrepared: boolean = false;
    private captureControl?: ArenaPressureCaptureControl;

    private visibilityHandler?: () => void;
    private autoPaused: boolean = false;
    private perfCollector: PerfCollectorState = createPerfCollectorState();
    private preRenderHandler?: () => void;
    private postRenderHandler?: () => void;
    private contextLostTarget?: HTMLCanvasElement;
    private contextLostHandler?: () => void;
    private longTaskObserver?: PerformanceObserver;

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
        this.historySpanSeconds = this.history.length >= 2
            ? Math.max(0, this.history[this.history.length - 1].t)
            : 0;
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
        const requestedRenderer = this.options.renderer ?? (this.options.videoCapture ? 'canvas' : 'auto');
        const phaserType = requestedRenderer === 'canvas'
            ? this.Phaser.CANVAS
            : requestedRenderer === 'webgl'
                ? this.Phaser.WEBGL
                : this.Phaser.AUTO;

        this.game = new this.Phaser.Game({
            type: phaserType,
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
                        const wheelCanvasScale = self.options.videoCapture ? 0.5 : 1;
                         self.wheel = new WheelMechanism(
                             this,
                             480,
                             277,
                             410,
                             self.options.spriteBaseUrl || '/games/arena-pressure/sprites/',
                             self.reducedMotion,
                             wheelCanvasScale
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

                    const collectPerf = Boolean(self.options.videoCapture && self.captureStatus === 'recording');
                    const updateStartedAt = collectPerf ? performance.now() : 0;
                    let gapMs = 0;
                    if (collectPerf) {
                        const perf = self.perfCollector;
                        if (perf.lastUpdateMs !== null) {
                            gapMs = Math.max(0, updateStartedAt - perf.lastUpdateMs);
                            perf.gapsMs.push(gapMs);
                        } else {
                            perf.firstUpdateMs = updateStartedAt;
                        }
                        perf.lastUpdateMs = updateStartedAt;
                        perf.updateFrames += 1;
                        perf.deltasMs.push(delta);
                    }

                    const safeDelta = Math.min(64, Math.max(0, delta));
                    const visualTime = self.resolveVisualTimeMs(time);

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
                    const wheelStartedAt = collectPerf ? performance.now() : 0;
                    self.wheel.update(
                        self.currentPressure,
                        self.targetPressure,
                        safeDelta,
                        pressureDelta,
                        self.playing
                    );
                    if (collectPerf) {
                        self.perfCollector.wheelWorkMs.push(Math.max(0, performance.now() - wheelStartedAt));
                    }

                    // 3. Character pull teams
                    self.candles.update(
                        visualTime,
                        self.currentPressure,
                        100 - self.currentPressure,
                        self.isFinished
                    );
                    self.pressureArt?.update(visualTime, self.currentPressure, 100 - self.currentPressure);
                    if (self.options.diagnostics && Math.floor(time / 250) !== Math.floor((time - safeDelta) / 250)) {
                        const grips = self.pressureArt?.getRopeGripPoints('buy');
                        self.host.dataset.arenaCharacterScale = String(self.pressureArt?.getCharacterScale('buy') ?? 1);
                        self.host.dataset.arenaHandY = String(grips?.[0]?.y ?? 0);
                        self.host.dataset.arenaRopeY = '350';
                    }
                    self.logos.setSymbols(self.leftSymbol, self.rightSymbol);
                    self.logos.update(
                        visualTime,
                        self.candles.getTeamBadgeAnchor('left'),
                        self.candles.getTeamBadgeAnchor('right')
                    );

                    // 4. Ropes anchored to the fixed wheel cleats and to the moving hands
                    const leftAnchor = self.wheel.getLeftAnchor();
                    const rightAnchor = self.wheel.getRightAnchor();
                    const leftGrips = self.pressureArt?.getRopeGripPoints('buy') ?? self.candles.getRopeGripPoints('left');
                    const rightGrips = self.pressureArt?.getRopeGripPoints('sell') ?? self.candles.getRopeGripPoints('right');
                    self.rope.render(
                        visualTime,
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
                        self.particles.emitStrainSparks(visualTime, rightGrips, ARENA_COLORS.right);
                    } else if (self.currentPressure <= 32) {
                        self.particles.emitStrainSparks(visualTime, leftGrips, ARENA_COLORS.left);
                    }

                    if (Math.abs(self.currentPressure - 50) > 25 && Math.random() < 0.05) {
                        self.particles.emitWheelSmoke(self.wheel.x, self.wheel.y);
                    }

                    if (collectPerf) {
                        const updateWork = Math.max(0, performance.now() - updateStartedAt);
                        self.perfCollector.updateWorkMs.push(updateWork);
                        self.perfCollector.pendingUpdateMs = updateWork;
                        self.perfCollector.pendingGapMs = gapMs;
                    }
                }
            }
        });

        if (this.options.videoCapture) {
            this.installPerfCollector();
        }
    }

    /**
     * Replays the real pressure history on a clock. Sampling is stateless, so pausing,
     * resuming or seeking can never duplicate or skip pressure events.
     */
    private advanceReplay(deltaMs: number): void {
        if (!this.playing) {
            return;
        }

        if (this.captureStatus === 'recording' && this.captureClockStartedAt !== null) {
            this.playheadSeconds = resolveCapturePlayhead(
                this.captureClockStartPlayhead,
                this.captureClockStartedAt,
                performance.now(),
                this.speed,
                this.historyDurationSeconds
            );
        } else {
            this.playheadSeconds += (deltaMs / 1000) * this.speed;
        }
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

    private installPerfCollector(): void {
        const game = this.game;
        if (!game) return;

        this.preRenderHandler = () => {
            if (this.captureStatus !== 'recording') return;
            this.perfCollector.renderStartMs = performance.now();
        };
        this.postRenderHandler = () => {
            if (this.captureStatus !== 'recording') return;
            const now = performance.now();
            const perf = this.perfCollector;
            const renderMs = perf.renderStartMs > 0 ? Math.max(0, now - perf.renderStartMs) : 0;
            perf.renderStartMs = 0;
            perf.renderFrames += 1;
            if (perf.firstRenderMs === null) {
                perf.firstRenderMs = now;
            }
            perf.lastRenderMs = now;
            perf.renderWorkMs.push(renderMs);
            const totalFrameMs = perf.pendingUpdateMs + renderMs;
            perf.frameWorkMs.push(totalFrameMs);
            if (perf.pendingGapMs > 33.33 || totalFrameMs > 33.33) {
                perf.overBudgetFrames += 1;
            }
            perf.pendingUpdateMs = 0;
            perf.pendingGapMs = 0;
        };

        game.events.on('prerender', this.preRenderHandler);
        game.events.on('postrender', this.postRenderHandler);

        if (game.canvas) {
            this.contextLostTarget = game.canvas;
            this.contextLostHandler = () => {
                this.perfCollector.webglContextLost += 1;
            };
            game.canvas.addEventListener('webglcontextlost', this.contextLostHandler);
        }

        if (typeof PerformanceObserver !== 'undefined') {
            try {
                const supported = PerformanceObserver.supportedEntryTypes ?? [];
                if (supported.includes('longtask')) {
                    this.longTaskObserver = new PerformanceObserver(list => {
                        if (this.captureStatus !== 'recording') return;
                        for (const entry of list.getEntries()) {
                            this.perfCollector.longTasks += 1;
                            this.perfCollector.longTaskTotalMs += Math.max(0, entry.duration);
                        }
                    });
                    this.longTaskObserver.observe({ entryTypes: ['longtask'] });
                }
            } catch {
                this.longTaskObserver = undefined;
            }
        }
    }

    private resolveRendererInfo(): { renderer: 'WEBGL' | 'CANVAS' | 'UNKNOWN'; glRenderer: string } {
        const rendererType = this.game?.renderer?.type;
        if (rendererType === this.Phaser.CANVAS) {
            return { renderer: 'CANVAS', glRenderer: 'canvas-2d' };
        }
        if (rendererType !== this.Phaser.WEBGL) {
            return { renderer: 'UNKNOWN', glRenderer: 'unknown' };
        }
        let glRenderer = 'webgl';
        try {
            const rendererObj = this.game?.renderer as { gl?: WebGLRenderingContext } | undefined;
            const gl = rendererObj?.gl
                ?? (this.game?.canvas?.getContext('webgl') as WebGLRenderingContext | null)
                ?? (this.game?.canvas?.getContext('webgl2') as WebGLRenderingContext | null);
            if (gl) {
                const ext = gl.getExtension('WEBGL_debug_renderer_info');
                const value = ext
                    ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)
                    : gl.getParameter(gl.RENDERER);
                if (typeof value === 'string' && value.trim()) {
                    glRenderer = value.trim();
                }
            }
        } catch {
            // Keep generic webgl label if renderer debug info is blocked.
        }
        return { renderer: 'WEBGL', glRenderer };
    }

    public getPerfMetrics(): ArenaPressurePerfMetrics {
        const perf = this.perfCollector;
        const { renderer, glRenderer } = this.resolveRendererInfo();
        const updateSpanSeconds = perf.updateFrames > 1 && perf.firstUpdateMs !== null && perf.lastUpdateMs !== null
            ? Math.max(0, (perf.lastUpdateMs - perf.firstUpdateMs) / 1000)
            : 0;
        const renderSpanSeconds = perf.renderFrames > 1 && perf.firstRenderMs !== null && perf.lastRenderMs !== null
            ? Math.max(0, (perf.lastRenderMs - perf.firstRenderMs) / 1000)
            : 0;
        const frameWork = summarizeValues(perf.frameWorkMs);
        const updateWork = summarizeValues(perf.updateWorkMs);
        const renderWork = summarizeValues(perf.renderWorkMs);
        const wheelWork = summarizeValues(perf.wheelWorkMs);
        const gaps = summarizeValues(perf.gapsMs);
        const deltas = summarizeValues(perf.deltasMs);

        return {
            renderer,
            glRenderer,
            webglContextLost: perf.webglContextLost,
            updateFrames: perf.updateFrames,
            updateFps: updateSpanSeconds > 0 ? (perf.updateFrames - 1) / updateSpanSeconds : 0,
            renderFrames: perf.renderFrames,
            renderFps: renderSpanSeconds > 0 ? (perf.renderFrames - 1) / renderSpanSeconds : 0,
            avgFrameMs: frameWork.avg,
            p50FrameMs: frameWork.p50,
            p95FrameMs: frameWork.p95,
            maxFrameMs: frameWork.max,
            avgUpdateMs: updateWork.avg,
            p95UpdateMs: updateWork.p95,
            avgRenderMs: renderWork.avg,
            p95RenderMs: renderWork.p95,
            avgWheelMs: wheelWork.avg,
            avgGapMs: gaps.avg,
            p50GapMs: gaps.p50,
            p95GapMs: gaps.p95,
            maxGapMs: gaps.max,
            avgDeltaMs: deltas.avg,
            maxDeltaMs: deltas.max,
            overBudgetFrames: perf.overBudgetFrames,
            longTasks: perf.longTasks,
            longTaskTotalMs: perf.longTaskTotalMs
        };
    }

    private resolveVisualTimeMs(phaserTime: number): number {
        if (!this.options.videoCapture) {
            return phaserTime;
        }
        if (this.captureStatus === 'recording' && this.captureClockStartedAt !== null) {
            return this.captureVisualBaseMs + Math.max(0, performance.now() - this.captureClockStartedAt);
        }
        return this.captureVisualBaseMs;
    }

    private applyCaptureSeekState(seconds: number, videoStartSeconds?: number): number {
        const clampedSeconds = Math.max(0, Math.min(this.historyDurationSeconds, seconds));
        const visualBaseMs = videoStartSeconds !== undefined && Number.isFinite(videoStartSeconds) && videoStartSeconds >= 0
            ? videoStartSeconds * 1000
            : 0;
        this.playheadSeconds = clampedSeconds;
        this.captureVisualBaseMs = visualBaseMs;

        const sampled = sampleHistory(this.history, clampedSeconds);
        const resolvedPressure = sampled !== null ? clampPercent(sampled) : this.currentPressure;
        this.targetPressure = resolvedPressure;
        this.currentPressure = resolvedPressure;
        this.previousPressureSample = resolvedPressure;

        this.particles?.clear();
        this.pressureArt?.snapToPressure(resolvedPressure, 100 - resolvedPressure, visualBaseMs);
        this.candles?.syncToPressure(resolvedPressure, 100 - resolvedPressure, this.isFinished, visualBaseMs);
        this.hud?.update(
            resolvedPressure,
            determineDominance(resolvedPressure, 100 - resolvedPressure),
            this.leftSymbol,
            this.rightSymbol,
            this.isFinished,
            this.officialResult
        );
        return resolvedPressure;
    }

    public installVideoCaptureControl(): void {
        if (typeof window === 'undefined' || !this.options.videoCapture || this.captureControl) {
            return;
        }

        const control: ArenaPressureCaptureControl = {
            version: 1,
            capabilities: ['seek', 'dynamicSpeed', 'prepareSegment'],
            seek: (seconds: number, videoStartSeconds: number = 0): boolean => {
                if (this.captureStatus !== 'ready' || this.mode !== 'replay' || this.history.length < 2) {
                    return false;
                }
                if (!Number.isFinite(seconds) || seconds < 0) {
                    return false;
                }
                if (!Number.isFinite(videoStartSeconds) || videoStartSeconds < 0) {
                    return false;
                }
                this.playing = false;
                const pressure = this.applyCaptureSeekState(seconds, videoStartSeconds);
                if (this.wheel) {
                    void this.wheel.syncToPressure(pressure, videoStartSeconds);
                }
                this.capturePrepared = true;
                return true;
            },
            prepareSegment: async (segmentOptions?: ArenaPressureCaptureStartOptions): Promise<ArenaPressureCapturePrepareResult> => {
                if (this.captureStatus !== 'ready' || this.mode !== 'replay' || this.history.length < 2) {
                    return {
                        ok: false,
                        playheadSeconds: this.playheadSeconds,
                        durationSeconds: this.historyDurationSeconds,
                        historySpanSeconds: this.historySpanSeconds,
                        speed: this.speed,
                        leftPercent: Math.round(this.currentPressure),
                        videoStartSeconds: this.captureVisualBaseMs / 1000
                    };
                }

                const requestedStart = segmentOptions?.startSeconds ?? 0;
                const requestedSpeed = segmentOptions?.speed ?? 4;
                const requestedVideoStart = segmentOptions?.videoStartSeconds ?? 0;
                if (!Number.isFinite(requestedStart) || requestedStart < 0) {
                    throw new Error('Invalid segment startSeconds.');
                }
                const clampedSpeed = clampCaptureSpeed(requestedSpeed);
                if (clampedSpeed === null) {
                    throw new Error('Invalid segment replay speed.');
                }
                if (!Number.isFinite(requestedVideoStart) || requestedVideoStart < 0) {
                    throw new Error('Invalid segment videoStartSeconds.');
                }

                this.playing = false;
                this.speed = clampedSpeed;
                const pressure = this.applyCaptureSeekState(requestedStart, requestedVideoStart);
                if (this.wheel) {
                    await this.wheel.syncToPressure(pressure, requestedVideoStart);
                }
                this.capturePrepared = true;

                return {
                    ok: true,
                    playheadSeconds: this.playheadSeconds,
                    durationSeconds: this.historyDurationSeconds,
                    historySpanSeconds: this.historySpanSeconds,
                    speed: this.speed,
                    leftPercent: Math.round(this.currentPressure),
                    videoStartSeconds: requestedVideoStart
                };
            },
            start: (segmentOptions?: ArenaPressureCaptureStartOptions): boolean => {
                if (this.captureStatus !== 'ready' || this.mode !== 'replay' || this.history.length === 0) {
                    return false;
                }

                this.playing = false;
                if (!segmentOptions) {
                    this.speed = 4;
                    this.applyCaptureSeekState(0, 0);
                    this.wheel?.resetMotion();
                    if (this.wheel) {
                        void this.wheel.syncToPressure(this.currentPressure, 0);
                    }
                } else {
                    const startSeconds = segmentOptions.startSeconds ?? this.playheadSeconds;
                    const requestedSpeed = segmentOptions.speed ?? this.speed;
                    const videoStartSeconds = segmentOptions.videoStartSeconds ?? (this.captureVisualBaseMs / 1000);
                    const clampedSpeed = clampCaptureSpeed(requestedSpeed);
                    if (!Number.isFinite(startSeconds) || startSeconds < 0
                        || clampedSpeed === null
                        || !Number.isFinite(videoStartSeconds) || videoStartSeconds < 0) {
                        return false;
                    }
                    const clampedStart = Math.max(0, Math.min(this.historyDurationSeconds, startSeconds));
                    this.speed = clampedSpeed;
                    const needsSnap = !this.capturePrepared
                        || Math.abs(this.playheadSeconds - clampedStart) > 1e-4
                        || Math.abs(this.captureVisualBaseMs - videoStartSeconds * 1000) > 1;
                    if (needsSnap) {
                        const pressure = this.applyCaptureSeekState(clampedStart, videoStartSeconds);
                        if (this.wheel) {
                            void this.wheel.syncToPressure(pressure, videoStartSeconds);
                        }
                    }
                }

                this.perfCollector = createPerfCollectorState();
                this.captureCompletedAt = null;
                this.captureClockStartPlayhead = this.playheadSeconds;
                this.captureClockStartedAt = performance.now();
                this.captureStatus = 'recording';
                this.playing = true;
                if (this.scene && this.autoPaused) {
                    this.autoPaused = false;
                    this.scene.scene.resume();
                }
                return true;
            },
            getState: () => this.getCaptureState(),
            getPerfMetrics: () => this.getPerfMetrics()
        };
        this.captureControl = control;
        window.__arenaPressureCapture = control;
        this.host.dataset.captureState = 'ready';
    }

    public getCaptureState(): {
        status: CaptureStatus;
        playheadSeconds: number;
        durationSeconds: number;
        historySpanSeconds: number;
        speed: number;
        historyPoints: number;
        isFinished: boolean;
        finalFrameStable: boolean;
        officialResult: ArenaPressureResult;
        leftSymbol: string;
        rightSymbol: string;
        leftPercent: number;
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
            historySpanSeconds: this.historySpanSeconds,
            speed: this.speed,
            historyPoints: this.history.length,
            isFinished: this.isFinished,
            finalFrameStable,
            officialResult: this.officialResult,
            leftSymbol: this.leftSymbol,
            rightSymbol: this.rightSymbol,
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

        if (typeof window !== 'undefined' && window.__arenaPressureCapture === this.captureControl) {
            delete window.__arenaPressureCapture;
        }
        this.captureControl = undefined;


        if (this.visibilityHandler && typeof document !== 'undefined') {
            document.removeEventListener('visibilitychange', this.visibilityHandler);
        }
        this.visibilityHandler = undefined;

        if (this.game && this.preRenderHandler) {
            this.game.events.off('prerender', this.preRenderHandler);
        }
        if (this.game && this.postRenderHandler) {
            this.game.events.off('postrender', this.postRenderHandler);
        }
        this.preRenderHandler = undefined;
        this.postRenderHandler = undefined;

        if (this.contextLostTarget && this.contextLostHandler) {
            this.contextLostTarget.removeEventListener('webglcontextlost', this.contextLostHandler);
        }
        this.contextLostTarget = undefined;
        this.contextLostHandler = undefined;

        if (this.longTaskObserver) {
            this.longTaskObserver.disconnect();
            this.longTaskObserver = undefined;
        }

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
