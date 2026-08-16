import type { FuturebolMatchState as FuturebolMatchStateContract } from "./futurebol-match-state.js";
// @ts-ignore Browser module queries are intentional: replay state must not come from a stale module.
import { FuturebolMatchState as FuturebolMatchStateRuntime } from "./futurebol-match-state.js?v=20260815-initial-replay-1";
import type { FuturebolRenderer as FuturebolRendererContract } from "./futurebol-renderer.js";
// @ts-ignore Browser module queries are intentional: force the real stadium renderer through stale caches.
import { FuturebolRenderer as FuturebolRendererRuntime } from "./futurebol-renderer.js?v=20260815-real-stadium-1";
import { createFuturebolTeamVisualConfiguration } from './futurebol-team-configuration.js';
import type {
    FuturebolDotNetReference,
    FuturebolMatchPresentationState,
    FuturebolMarketSnapshot,
    FuturebolOfficialMatchState,
    FuturebolPlayOutcome,
    FuturebolPlayerVisualPreference,
    FuturebolPressureOverride,
    FuturebolQuality,
    FuturebolRuntimeOptions,
    FuturebolTeam,
    FuturebolTeamVisualConfigurationMap
} from "./futurebol-types.js";
import { ApiMarketSource } from './market/api-market-source.js';
import { createFuturebolMarketSource } from './market/futurebol-market-source-factory.js';
import { MockMarketSource } from "./market/mock-market-source.js";
import type { FuturebolMarketSource } from "./market/futurebol-market-source.js";

type BabylonApi = typeof import("babylonjs");

export interface FuturebolSizeDiagnostics {
    host: { width: number; height: number };
    canvas: { width: number; height: number };
    buffer: { width: number; height: number };
    render: { width: number; height: number };
    devicePixelRatio: number;
}

export class FuturebolEngine {
    private state: FuturebolMatchStateContract;
    private readonly renderer: FuturebolRendererContract;
    private readonly marketSource: FuturebolMarketSource;
    private readonly teams: FuturebolTeamVisualConfigurationMap;
    private readonly renderFrame: () => void;
    private readonly resizeHandler: () => void;
    private readonly reducedMotion: boolean;
    private readonly hudRoot: HTMLElement | null;
    private resizeObserver: ResizeObserver | null = null;
    private presentationState: FuturebolMatchPresentationState | null;
    private unsubscribeMarket: (() => void) | null = null;
    private pressureOverride: FuturebolPressureOverride = null;
    private lastFrameMs = 0;
    private lastTelemetryMs = 0;
    private lastDebugMs = 0;
    private fpsSamples = 0;
    private fpsTotal = 0;
    private paused = false;
    private disposed = false;
    private fatalReported = false;
    private loadingOverlay: FuturebolLoadingOverlay | null = null;
    private firstFrameResolve: (() => void) | null = null;
    private firstFrameReject: ((error: unknown) => void) | null = null;
    private replayHudSignature = "";

    public constructor(
        B: BabylonApi,
        private readonly canvas: HTMLCanvasElement,
        private readonly options: FuturebolRuntimeOptions,
        private readonly dotNetReference: FuturebolDotNetReference
    ) {
        this.reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        this.hudRoot = options.presentationMode === "lab" && options.hudRootId
            ? document.getElementById(options.hudRootId)
            : null;
        this.presentationState = options.initialPresentationState;
        this.teams = createFuturebolTeamVisualConfiguration(options);
        const officialMode = options.dataMode.trim().toLowerCase() === "api";
        this.state = new FuturebolMatchStateRuntime(options.seed, officialMode) as FuturebolMatchStateContract;
        const initialOfficialState = options.initialPresentationState?.official ?? options.initialOfficialState;
        if (officialMode && initialOfficialState)
            this.state.applyOfficialMatchState(initialOfficialState, false);
        this.renderer = new FuturebolRendererRuntime(
            B,
            canvas,
            this.teams,
            options.development,
            options.quality,
            this.reducedMotion
        );
        this.marketSource = createFuturebolMarketSource(options);
        this.renderFrame = () => this.render();
        this.resizeHandler = () => this.renderer.resize();
    }

    public async initialize(reportStage: (stage: string) => void = () => undefined): Promise<void> {
        const initializeStarted = performance.now();
        this.loadingOverlay = this.options.presentationMode === "lab"
            ? new FuturebolLoadingOverlay(this.canvas)
            : null;

        try {
            reportStage("create-scene");
            this.loadingOverlay?.update("Preparando campo", 8);
            this.attachResizeHandling();
            await this.settleInitialSize();

            reportStage("create-players");
            await this.renderer.initializePlayers(
                this.state.players,
                this.options.playerVisual,
                this.options.simulatePlayerAssetFailure,
                stage => {
                    this.setText("futurebol-player-loading-status", stage);
                    this.loadingOverlay?.update(
                        stage,
                        loadingProgress(stage)
                    );
                }
            );
            console.info(
                `[FUTUREBOL] players ready: ${Math.round(performance.now() - initializeStarted)} ms`
            );

            reportStage("load-match");
            this.loadingOverlay?.update("Conectando mercado", 88);
            this.unsubscribeMarket =
                this.marketSource.subscribe((snapshot: FuturebolMarketSnapshot) => this.onSnapshot(snapshot));
            await this.marketSource.connect();
            console.info(
                `[FUTUREBOL] market/match data ready: ${Math.round(performance.now() - initializeStarted)} ms`
            );

            this.lastFrameMs = performance.now();
            this.lastTelemetryMs = this.lastFrameMs;
            this.lastDebugMs = 0;
            const firstFrame = new Promise<void>((resolve, reject) => {
                this.firstFrameResolve = resolve;
                this.firstFrameReject = reject;
            });
            reportStage("first-frame");
            this.renderer.engine.runRenderLoop(this.renderFrame);
            this.updateMatchHud();
            await firstFrame;

            this.loadingOverlay?.update("Pronto", 100);
            this.loadingOverlay?.complete();
            this.loadingOverlay = null;

            console.info("[FUTUREBOL-TV][SIZE]", this.getSizeDiagnostics());
            console.info(
                `[FUTUREBOL] first frame: ${Math.round(performance.now() - initializeStarted)} ms`
            );
            reportStage("ready");

            const playerDiagnostics = this.renderer.diagnostics(null);
            this.log("inicialização concluída", {
                matchId: this.options.matchId,
                dataMode: this.options.dataMode,
                seed: this.options.seed,
                players: this.state.players.length,
                quality: this.options.quality,
                reducedMotion: this.reducedMotion,
                engineInitialized: true,
                sceneInitialized: true,
                playerAssetLoaded: playerDiagnostics.assetLoaded,
                playerFallbackActive: playerDiagnostics.fallbackActive
            });
        } catch (error) {
            const message = error instanceof Error
                ? error.message
                : "Falha desconhecida ao preparar o Futurebol.";
            this.loadingOverlay?.fail(message);
            throw error;
        }
    }

    public pause(): void {
        this.paused = true;
        this.updatePauseStatus(true);
    }

    public resume(): void {
        this.paused = false;
        this.lastFrameMs = performance.now();
        this.updatePauseStatus(false);
    }

    public reset(): void {
        this.paused = false;
        this.pressureOverride = null;
        this.state.reset();
        this.renderer.resetPlayers();
        if (this.marketSource instanceof MockMarketSource)
            this.marketSource.reset();
        this.lastFrameMs = performance.now();
        this.updatePauseStatus(false);
        this.updateClock();
        this.updateMatchHud();
    }

    public setPressure(pressure: FuturebolPressureOverride): void {
        this.pressureOverride = pressure;
        const snapshot = this.state.latestSnapshot ?? this.marketSource.getSnapshot();
        this.state.applyMarket(snapshot, pressure);
        this.updateHud(snapshot);
    }

    public setFixedCamera(value: boolean): void {
        this.renderer.setFixedCamera(value);
    }

    public async setQuality(quality: FuturebolQuality): Promise<void> {
        this.options.quality = quality;
        await this.renderer.setVisualConfiguration(this.state.players, quality, this.options.playerVisual);
        this.log("preset gráfico alterado", { quality });
    }

    public async setPlayerVisual(preference: FuturebolPlayerVisualPreference): Promise<void> {
        this.options.playerVisual = preference;
        await this.renderer.setVisualConfiguration(this.state.players, this.options.quality, preference);
        this.updateMatchHud();
        this.log("visual dos jogadores alterado", { preference });
    }

    public forcePass(team: FuturebolTeam): void {
        this.state.forcePass(team);
        this.updateMatchHud();
    }

    public forceShot(team: FuturebolTeam): void {
        this.state.forceShot(team);
        this.updateMatchHud();
    }

    public forceOutcome(outcome: FuturebolPlayOutcome): void {
        this.state.forceOutcome(outcome);
        this.updateMatchHud();
    }

    public resetPlay(): void {
        this.state.resetPlay();
        this.updateMatchHud();
    }

    public pushMarketSnapshot(snapshot: FuturebolMarketSnapshot): void {
        if (this.marketSource instanceof ApiMarketSource)
            this.marketSource.push(snapshot);
    }

    public pushOfficialMatchState(state: FuturebolOfficialMatchState): void {
        this.state.applyOfficialMatchState(state, true);
        this.updateClock();
        this.updateMatchHud();
    }

    public async applyPresentationState(state: FuturebolMatchPresentationState): Promise<void> {
        if (state.matchId !== this.options.matchId) {
            this.changeMatch(state);
            return;
        }

        this.presentationState = state;
        this.options.homeSymbol = state.homeTeam.symbol;
        this.options.awaySymbol = state.awayTeam.symbol;
        this.options.homeLogoUrl = state.homeTeam.logoUrl;
        this.options.awayLogoUrl = state.awayTeam.logoUrl;
        this.renderer.reconfigureTeams(
            createFuturebolTeamVisualConfiguration(this.options)
        );
        this.pushOfficialMatchState(state.official);
        this.pushMarketSnapshot(state.market);
    }

    private changeMatch(presentation: FuturebolMatchPresentationState): void {
        const previousMatchId = this.options.matchId;
        this.presentationState = presentation;
        this.options.matchId = presentation.matchId;
        this.options.homeSymbol = presentation.homeTeam.symbol;
        this.options.awaySymbol = presentation.awayTeam.symbol;
        this.options.homeLogoUrl = presentation.homeTeam.logoUrl;
        this.options.awayLogoUrl = presentation.awayTeam.logoUrl;
        this.options.seed = `futurebol-match-${presentation.matchId}`;
        this.options.initialMarketSnapshot = presentation.market;
        this.options.initialOfficialState = presentation.official;
        this.options.initialPresentationState = presentation;

        const teams = createFuturebolTeamVisualConfiguration(this.options);
        this.renderer.reconfigureTeams(teams);
        this.state = new FuturebolMatchStateRuntime(this.options.seed, true) as FuturebolMatchStateContract;
        this.state.applyOfficialMatchState(presentation.official, false);
        this.state.applyMarket(presentation.market, null);
        this.pressureOverride = null;
        this.paused = false;
        this.renderer.resetPlayers();
        if (this.marketSource instanceof ApiMarketSource)
            this.marketSource.push(presentation.market);
        this.lastFrameMs = performance.now();
        this.updateClock();
        this.updateMatchHud();
        this.log("partida alterada sem recriar engine/scene", {
            previousMatchId,
            matchId: presentation.matchId,
            home: presentation.homeTeam.symbol,
            away: presentation.awayTeam.symbol,
            quality: this.options.quality
        });
    }

    public reportMarketError(message: string): void {
        if (this.marketSource instanceof ApiMarketSource)
            this.marketSource.reportError(message);
    }

    public async dispose(): Promise<void> {
        if (this.disposed)
            return;
        this.disposed = true;

        this.renderer.engine.stopRenderLoop(this.renderFrame);
        window.removeEventListener("resize", this.resizeHandler);
        this.resizeObserver?.disconnect();
        this.resizeObserver = null;
        this.unsubscribeMarket?.();
        this.unsubscribeMarket = null;
        await this.marketSource.disconnect();
        this.loadingOverlay?.dispose();
        this.loadingOverlay = null;
        this.renderer.dispose();
        this.log("disposal concluído", { matchId: this.options.matchId });
    }

    public getSizeDiagnostics(): FuturebolSizeDiagnostics {
        const hostRect = this.canvas.parentElement?.getBoundingClientRect();
        const canvasRect = this.canvas.getBoundingClientRect();
        return {
            host: {
                width: Math.round(hostRect?.width ?? 0),
                height: Math.round(hostRect?.height ?? 0)
            },
            canvas: {
                width: Math.round(canvasRect.width),
                height: Math.round(canvasRect.height)
            },
            buffer: {
                width: this.canvas.width,
                height: this.canvas.height
            },
            render: {
                width: this.renderer.engine.getRenderWidth(),
                height: this.renderer.engine.getRenderHeight()
            },
            devicePixelRatio: window.devicePixelRatio || 1
        };
    }

    private render(): void {
        if (this.disposed)
            return;

        try {
            const now = performance.now();
            const deltaSeconds = Math.min((now - this.lastFrameMs) / 1000, 0.1);
            this.lastFrameMs = now;

            if (!this.paused)
                this.state.update(deltaSeconds);

            this.renderer.update(
                this.state.players,
                this.state.ballPosition,
                this.state.pressure,
                this.state.currentPlayPhase,
                this.state.activeTeam,
                this.state.currentBallOwnerId,
                this.state.lastPlayOutcome,
                this.paused ? 0 : deltaSeconds
            );
            this.renderer.scene.render();
            if (this.firstFrameResolve) {
                const resolve = this.firstFrameResolve;
                this.firstFrameResolve = null;
                this.firstFrameReject = null;
                resolve();
            }
            this.collectTelemetry(now);
        } catch (error) {
            const reject = this.firstFrameReject;
            this.firstFrameResolve = null;
            this.firstFrameReject = null;
            reject?.(error);
            this.reportFatal(error);
        }
    }

    private attachResizeHandling(): void {
        window.addEventListener("resize", this.resizeHandler, { passive: true });
        const host = this.canvas.parentElement;
        if (typeof ResizeObserver === "undefined" || !(host instanceof HTMLElement))
            return;

        this.resizeObserver = new ResizeObserver(() => this.renderer.resize());
        this.resizeObserver.observe(host);
    }

    private async settleInitialSize(): Promise<void> {
        this.renderer.resize();
        await nextAnimationFrame();
        this.renderer.resize();
    }

    private onSnapshot(snapshot: FuturebolMarketSnapshot): void {
        if (!this.paused)
            this.state.applyMarket(snapshot, this.pressureOverride);
        this.updateHud(snapshot);
    }

    private updateHud(snapshot: FuturebolMarketSnapshot): void {
        this.setText("futurebol-home-momentum", Math.round(snapshot.home.momentum).toString());
        this.setText("futurebol-away-momentum", Math.round(snapshot.away.momentum).toString());
        this.setWidth("futurebol-home-momentum-bar", snapshot.home.momentum);
        this.setWidth("futurebol-away-momentum-bar", snapshot.away.momentum);

        if (snapshot.sequence % 10 === 0) {
            const state = this.paused ? "pausada" : "em execução";
            this.setText(
                "futurebol-a11y-status",
                `Simulação ${state}. Momentum ${snapshot.home.symbol} ${Math.round(snapshot.home.momentum)} e ${snapshot.away.symbol} ${Math.round(snapshot.away.momentum)}.`
            );
        }
    }

    private updateClock(): void {
        const totalSeconds = Math.floor(this.state.displayElapsedSeconds);
        const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, "0");
        const seconds = (totalSeconds % 60).toString().padStart(2, "0");
        this.setText("futurebol-clock", `${minutes}:${seconds}`);
    }

    private collectTelemetry(now: number): void {
        if (now - this.lastDebugMs >= 250) {
            this.updateMatchHud();
            this.lastDebugMs = now;
        }

        if (now - this.lastTelemetryMs < 1000)
            return;

        const fps = Math.round(this.renderer.engine.getFps());
        this.setText("futurebol-fps", fps.toString());
        this.updateClock();
        this.fpsTotal += fps;
        this.fpsSamples += 1;
        this.lastTelemetryMs = now;

        if (this.options.development && this.fpsSamples % 15 === 0)
            console.info(`[Futurebol] FPS médio: ${Math.round(this.fpsTotal / this.fpsSamples)}`);
    }

    private updateMatchHud(): void {
        this.setText("futurebol-home-score", this.state.displayHomeScore.toString());
        this.setText("futurebol-away-score", this.state.displayAwayScore.toString());
        this.notifyReplayHudState();
        this.setText("futurebol-debug-phase", this.state.currentPlayPhase);
        this.setText("futurebol-debug-owner", displayPlayer(this.state.currentBallOwnerId, this.teams.home.symbol, this.teams.away.symbol));
        this.setText("futurebol-debug-receiver", displayPlayer(this.state.intendedReceiverId, this.teams.home.symbol, this.teams.away.symbol));
        this.setText("futurebol-debug-ball", this.state.ballState);
        this.setText("futurebol-debug-cooldown", `${Math.ceil(this.state.cooldownRemainingSeconds)}s`);
        let diagnosticPlayerId = this.state.currentBallOwnerId;
        if (!diagnosticPlayerId && this.state.activeTeam) {
            const goalkeeperActive = this.state.currentPlayPhase === "Shooting" || this.state.currentPlayPhase === "Outcome";
            const team = goalkeeperActive
                ? (this.state.activeTeam === "home" ? "away" : "home")
                : this.state.activeTeam;
            const role = goalkeeperActive ? "goalkeeper" : "attacker";
            diagnosticPlayerId = `${team}-${role}`;
        }
        const visual = this.renderer.diagnostics(diagnosticPlayerId);
        this.setText("futurebol-debug-visual", visual.kind);
        this.setText("futurebol-debug-asset", visual.assetLoaded ? "sim" : "não");
        this.setText("futurebol-debug-skeletons", visual.skeletonCount.toString());
        this.setText("futurebol-debug-animation-current", visual.currentAnimation ?? "—");
        this.setText("futurebol-debug-animation-requested", visual.requestedAnimation ?? "—");
        this.setText("futurebol-debug-fallback", visual.fallbackActive ? "ativo" : "não");
        this.setText("futurebol-debug-load-time", visual.loadTimeMs ? `${Math.round(visual.loadTimeMs)} ms` : "—");
        this.setText('futurebol-debug-home-symbol', this.teams.home.symbol);
        this.setText('futurebol-debug-away-symbol', this.teams.away.symbol);
        this.setText('futurebol-debug-home-logo-url', this.teams.home.logoUrl ?? '—');
        this.setText('futurebol-debug-away-logo-url', this.teams.away.logoUrl ?? '—');
        this.setText('futurebol-debug-home-logo-loaded', visual.logos.home.loaded ? 'sim' : 'não');
        this.setText('futurebol-debug-away-logo-loaded', visual.logos.away.loaded ? 'sim' : 'não');
        this.setText('futurebol-debug-home-logo-fallback', visual.logos.home.fallbackActive ? 'sim' : 'não');
        this.setText('futurebol-debug-away-logo-fallback', visual.logos.away.fallbackActive ? 'sim' : 'não');
        const logoFallback = visual.logos.home.fallbackActive || visual.logos.away.fallbackActive;
        this.setText('futurebol-debug-logo-fallback', logoFallback ? 'ativo' : 'não');
        const market = this.marketSource.getDiagnostics();
        this.setText('futurebol-debug-data-source', market.mode);
        this.setText('futurebol-debug-last-update', market.lastUpdatedAt ?? '—');
        this.setText(
            'futurebol-debug-integration-error',
            visual.logos.home.error
                ?? visual.logos.away.error
                ?? market.error
                ?? this.options.dataError
                ?? '—'
        );
        const warning = this.hudElement("futurebol-player-visual-warning");
        if (warning instanceof HTMLElement) {
            warning.hidden = !visual.warning;
            warning.textContent = visual.warning ?? "";
        }
    }

    private notifyReplayHudState(): void {
        const active = this.state.isSynchronizationReplay;
        const homeScore = this.state.displayHomeScore;
        const awayScore = this.state.displayAwayScore;
        const targetHomeScore = this.state.synchronizationReplayTargetHomeScore;
        const targetAwayScore = this.state.synchronizationReplayTargetAwayScore;
        const signature = [
            active ? "replay" : "live",
            homeScore,
            awayScore,
            targetHomeScore,
            targetAwayScore
        ].join("|");
        if (signature === this.replayHudSignature)
            return;

        this.replayHudSignature = signature;
        void this.dotNetReference.invokeMethodAsync(
            "ReportFuturebolReplayState",
            active,
            homeScore,
            awayScore,
            targetHomeScore,
            targetAwayScore
        ).catch(error => console.warn(
            "[Futurebol][Replay] HUD state report failed",
            error
        ));
    }

    private updatePauseStatus(paused: boolean): void {
        this.setText("futurebol-a11y-status", paused ? "Simulação pausada." : "Simulação retomada.");
    }

    private reportFatal(error: unknown): void {
        if (this.fatalReported)
            return;
        this.fatalReported = true;
        this.paused = true;
        const message = error instanceof Error ? error.message : "Erro não tratado no módulo 3D.";
        console.error("[FUTUREBOL][FATAL]", {
            stage: "render-loop",
            error,
            message,
            stack: error instanceof Error ? error.stack : undefined
        });
        void this.dotNetReference.invokeMethodAsync("ReportFuturebolError", message)
            .catch(reportError => console.warn(
                "[FUTUREBOL][WARN] runtime fatal error report failed",
                reportError
            ));
    }

    private log(message: string, details?: unknown): void {
        if (!this.options.development)
            return;
        if (details === undefined)
            console.info(`[Futurebol] ${message}`);
        else
            console.info(`[Futurebol] ${message}`, details);
    }

    private hudElement(id: string): HTMLElement | null {
        return this.hudRoot?.querySelector<HTMLElement>(`#${id}`) ?? null;
    }

    private setText(id: string, value: string): void {
        const element = this.hudElement(id);
        if (element)
            element.textContent = value;
    }

    private setWidth(id: string, value: number): void {
        const element = this.hudElement(id);
        if (element)
            element.style.width = `${Math.min(100, Math.max(0, value))}%`;
    }
}

function nextAnimationFrame(): Promise<void> {
    return new Promise(resolve => requestAnimationFrame(() => resolve()));
}

function loadingProgress(stage: string): number {
    switch (stage) {
        case "Carregando modelo":
            return 24;
        case "Preparando skeleton":
            return 54;
        case "Criando jogadores":
            return 74;
        case "Pronto":
            return 86;
        default:
            return 15;
    }
}

class FuturebolLoadingOverlay {
    private readonly host: HTMLElement;
    private readonly overlay: HTMLDivElement;
    private readonly label: HTMLDivElement;
    private readonly progressBar: HTMLDivElement;
    private readonly previousHostPosition: string;
    private disposed = false;

    public constructor(private readonly canvas: HTMLCanvasElement) {
        const parent = canvas.parentElement;
        if (!(parent instanceof HTMLElement))
            throw new Error("Contêiner do canvas Futurebol não foi encontrado.");

        this.host = parent;
        this.previousHostPosition = parent.style.position;

        if (getComputedStyle(parent).position === "static")
            parent.style.position = "relative";

        canvas.style.transition = "opacity 220ms ease";
        canvas.style.opacity = "0";

        this.overlay = document.createElement("div");
        this.overlay.dataset.futurebolLoading = "true";
        Object.assign(this.overlay.style, {
            position: "absolute",
            inset: "0",
            zIndex: "30",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "14px",
            background:
                "radial-gradient(circle at center, rgba(14, 27, 62, .93), rgba(3, 7, 20, .985))",
            color: "#eef6ff",
            fontFamily: "inherit",
            letterSpacing: ".04em"
        });

        const spinner = document.createElement("div");
        Object.assign(spinner.style, {
            width: "42px",
            height: "42px",
            borderRadius: "50%",
            border: "3px solid rgba(78, 220, 255, .2)",
            borderTopColor: "#4edcff",
            borderRightColor: "#ff9f1a",
            boxShadow: "0 0 24px rgba(78, 220, 255, .24)"
        });
        spinner.animate(
            [
                { transform: "rotate(0deg)" },
                { transform: "rotate(360deg)" }
            ],
            {
                duration: 850,
                iterations: Number.POSITIVE_INFINITY
            }
        );

        const title = document.createElement("div");
        title.textContent = "FUTUREBOL 3D";
        Object.assign(title.style, {
            fontSize: "13px",
            fontWeight: "800",
            color: "#4edcff"
        });

        this.label = document.createElement("div");
        this.label.textContent = "Preparando campo";
        Object.assign(this.label.style, {
            fontSize: "12px",
            color: "rgba(238, 246, 255, .82)"
        });

        const track = document.createElement("div");
        Object.assign(track.style, {
            width: "min(280px, 58%)",
            height: "4px",
            overflow: "hidden",
            borderRadius: "999px",
            background: "rgba(255, 255, 255, .12)"
        });

        this.progressBar = document.createElement("div");
        Object.assign(this.progressBar.style, {
            width: "0%",
            height: "100%",
            borderRadius: "inherit",
            background:
                "linear-gradient(90deg, #ff9f1a 0%, #4edcff 100%)",
            boxShadow: "0 0 12px rgba(78, 220, 255, .45)",
            transition: "width 220ms ease"
        });

        track.appendChild(this.progressBar);
        this.overlay.append(
            spinner,
            title,
            this.label,
            track
        );
        this.host.appendChild(this.overlay);
    }

    public update(label: string, progress: number): void {
        if (this.disposed)
            return;

        this.label.textContent = label;
        this.progressBar.style.width =
            `${Math.min(100, Math.max(0, progress))}%`;
    }

    public complete(): void {
        if (this.disposed)
            return;

        this.canvas.style.opacity = "1";
        this.overlay.style.transition = "opacity 220ms ease";
        this.overlay.style.opacity = "0";

        window.setTimeout(() => this.dispose(), 240);
    }

    public fail(message: string): void {
        if (this.disposed)
            return;

        this.canvas.style.opacity = "1";
        this.label.textContent = message;
        this.label.style.color = "#ffb4b4";
        this.progressBar.style.width = "100%";
        this.progressBar.style.background = "#ff5d73";
    }

    public dispose(): void {
        if (this.disposed)
            return;

        this.disposed = true;
        this.overlay.remove();
        this.canvas.style.opacity = "1";

        if (this.previousHostPosition)
            this.host.style.position = this.previousHostPosition;
    }
}

function displayPlayer(
    playerId: string | null,
    homeSymbol: string,
    awaySymbol: string
): string {
    if (!playerId)
        return "—";
    return playerId
        .replace("home-", `${homeSymbol} `)
        .replace("away-", `${awaySymbol} `)
        .replace("goalkeeper", "GK")
        .replace("defender", "DEF")
        .replace("attacker", "ATA");
}
