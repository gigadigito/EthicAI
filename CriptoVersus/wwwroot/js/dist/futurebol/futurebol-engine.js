import { FuturebolMatchState } from "./futurebol-match-state.js";
import { FuturebolRenderer } from "./futurebol-renderer.js";
import { createFuturebolTeamVisualConfiguration } from './futurebol-team-configuration.js';
import { ApiMarketSource } from './market/api-market-source.js';
import { createFuturebolMarketSource } from './market/futurebol-market-source-factory.js';
import { MockMarketSource } from "./market/mock-market-source.js";
export class FuturebolEngine {
    constructor(B, canvas, options, dotNetReference) {
        this.canvas = canvas;
        this.options = options;
        this.dotNetReference = dotNetReference;
        this.resizeObserver = null;
        this.unsubscribeMarket = null;
        this.pressureOverride = null;
        this.lastFrameMs = 0;
        this.lastTelemetryMs = 0;
        this.lastDebugMs = 0;
        this.fpsSamples = 0;
        this.fpsTotal = 0;
        this.paused = false;
        this.disposed = false;
        this.fatalReported = false;
        this.loadingOverlay = null;
        this.firstFrameResolve = null;
        this.firstFrameReject = null;
        this.reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        this.hudRoot = options.presentationMode === "lab" && options.hudRootId
            ? document.getElementById(options.hudRootId)
            : null;
        this.presentationState = options.initialPresentationState;
        this.teams = createFuturebolTeamVisualConfiguration(options);
        const officialMode = options.dataMode.trim().toLowerCase() === "api";
        this.state = new FuturebolMatchState(options.seed, officialMode);
        const initialOfficialState = options.initialPresentationState?.official ?? options.initialOfficialState;
        if (officialMode && initialOfficialState)
            this.state.applyOfficialMatchState(initialOfficialState, false);
        this.renderer = new FuturebolRenderer(B, canvas, this.teams, options.development, options.quality, this.reducedMotion);
        this.marketSource = createFuturebolMarketSource(options);
        this.renderFrame = () => this.render();
        this.resizeHandler = () => this.renderer.resize();
    }
    async initialize() {
        const initializeStarted = performance.now();
        this.loadingOverlay = this.options.presentationMode === "lab"
            ? new FuturebolLoadingOverlay(this.canvas)
            : null;
        try {
            this.loadingOverlay?.update("Preparando campo", 8);
            this.attachResizeHandling();
            await this.settleInitialSize();
            await this.renderer.initializePlayers(this.state.players, this.options.playerVisual, this.options.simulatePlayerAssetFailure, stage => {
                this.setText("futurebol-player-loading-status", stage);
                this.loadingOverlay?.update(stage, loadingProgress(stage));
            });
            this.loadingOverlay?.update("Conectando mercado", 88);
            this.unsubscribeMarket =
                this.marketSource.subscribe((snapshot) => this.onSnapshot(snapshot));
            await this.marketSource.connect();
            console.info(`[FUTUREBOL] market/match data ready: ${Math.round(performance.now() - initializeStarted)} ms`);
            this.lastFrameMs = performance.now();
            this.lastTelemetryMs = this.lastFrameMs;
            this.lastDebugMs = 0;
            const firstFrame = new Promise((resolve, reject) => {
                this.firstFrameResolve = resolve;
                this.firstFrameReject = reject;
            });
            this.renderer.engine.runRenderLoop(this.renderFrame);
            this.updateMatchHud();
            await firstFrame;
            this.loadingOverlay?.update("Pronto", 100);
            this.loadingOverlay?.complete();
            this.loadingOverlay = null;
            console.info("[FUTUREBOL-TV][SIZE]", this.getSizeDiagnostics());
            console.info(`[FUTUREBOL] first frame: ${Math.round(performance.now() - initializeStarted)} ms`);
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
        }
        catch (error) {
            const message = error instanceof Error
                ? error.message
                : "Falha desconhecida ao preparar o Futurebol.";
            this.loadingOverlay?.fail(message);
            throw error;
        }
    }
    pause() {
        this.paused = true;
        this.updatePauseStatus(true);
    }
    resume() {
        this.paused = false;
        this.lastFrameMs = performance.now();
        this.updatePauseStatus(false);
    }
    reset() {
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
    setPressure(pressure) {
        this.pressureOverride = pressure;
        const snapshot = this.state.latestSnapshot ?? this.marketSource.getSnapshot();
        this.state.applyMarket(snapshot, pressure);
        this.updateHud(snapshot);
    }
    setFixedCamera(value) {
        this.renderer.setFixedCamera(value);
    }
    async setQuality(quality) {
        this.options.quality = quality;
        await this.renderer.setVisualConfiguration(this.state.players, quality, this.options.playerVisual);
        this.log("preset gráfico alterado", { quality });
    }
    async setPlayerVisual(preference) {
        this.options.playerVisual = preference;
        await this.renderer.setVisualConfiguration(this.state.players, this.options.quality, preference);
        this.updateMatchHud();
        this.log("visual dos jogadores alterado", { preference });
    }
    forcePass(team) {
        this.state.forcePass(team);
        this.updateMatchHud();
    }
    forceShot(team) {
        this.state.forceShot(team);
        this.updateMatchHud();
    }
    forceOutcome(outcome) {
        this.state.forceOutcome(outcome);
        this.updateMatchHud();
    }
    resetPlay() {
        this.state.resetPlay();
        this.updateMatchHud();
    }
    pushMarketSnapshot(snapshot) {
        if (this.marketSource instanceof ApiMarketSource)
            this.marketSource.push(snapshot);
    }
    pushOfficialMatchState(state) {
        this.state.applyOfficialMatchState(state, true);
        this.updateClock();
        this.updateMatchHud();
    }
    async applyPresentationState(state) {
        if (state.matchId !== this.options.matchId) {
            await this.changeMatch(state);
            return;
        }
        this.presentationState = state;
        this.pushOfficialMatchState(state.official);
        this.pushMarketSnapshot(state.market);
    }
    async changeMatch(presentation) {
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
        await this.renderer.reconfigureTeams(teams);
        this.state = new FuturebolMatchState(this.options.seed, true);
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
    reportMarketError(message) {
        if (this.marketSource instanceof ApiMarketSource)
            this.marketSource.reportError(message);
    }
    async dispose() {
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
    getSizeDiagnostics() {
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
    render() {
        if (this.disposed)
            return;
        try {
            const now = performance.now();
            const deltaSeconds = Math.min((now - this.lastFrameMs) / 1000, 0.1);
            this.lastFrameMs = now;
            if (!this.paused)
                this.state.update(deltaSeconds);
            this.renderer.update(this.state.players, this.state.ballPosition, this.state.pressure, this.state.currentPlayPhase, this.state.activeTeam, this.state.currentBallOwnerId, this.state.lastPlayOutcome, this.paused ? 0 : deltaSeconds);
            this.renderer.scene.render();
            if (this.firstFrameResolve) {
                const resolve = this.firstFrameResolve;
                this.firstFrameResolve = null;
                this.firstFrameReject = null;
                resolve();
            }
            this.collectTelemetry(now);
        }
        catch (error) {
            const reject = this.firstFrameReject;
            this.firstFrameResolve = null;
            this.firstFrameReject = null;
            reject?.(error);
            this.reportFatal(error);
        }
    }
    attachResizeHandling() {
        window.addEventListener("resize", this.resizeHandler, { passive: true });
        const host = this.canvas.parentElement;
        if (typeof ResizeObserver === "undefined" || !(host instanceof HTMLElement))
            return;
        this.resizeObserver = new ResizeObserver(() => this.renderer.resize());
        this.resizeObserver.observe(host);
    }
    async settleInitialSize() {
        this.renderer.resize();
        await nextAnimationFrame();
        this.renderer.resize();
    }
    onSnapshot(snapshot) {
        if (!this.paused)
            this.state.applyMarket(snapshot, this.pressureOverride);
        this.updateHud(snapshot);
    }
    updateHud(snapshot) {
        this.setText("futurebol-home-momentum", Math.round(snapshot.home.momentum).toString());
        this.setText("futurebol-away-momentum", Math.round(snapshot.away.momentum).toString());
        this.setWidth("futurebol-home-momentum-bar", snapshot.home.momentum);
        this.setWidth("futurebol-away-momentum-bar", snapshot.away.momentum);
        if (snapshot.sequence % 10 === 0) {
            const state = this.paused ? "pausada" : "em execução";
            this.setText("futurebol-a11y-status", `Simulação ${state}. Momentum ${snapshot.home.symbol} ${Math.round(snapshot.home.momentum)} e ${snapshot.away.symbol} ${Math.round(snapshot.away.momentum)}.`);
        }
    }
    updateClock() {
        const totalSeconds = Math.floor(this.state.displayElapsedSeconds);
        const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, "0");
        const seconds = (totalSeconds % 60).toString().padStart(2, "0");
        this.setText("futurebol-clock", `${minutes}:${seconds}`);
    }
    collectTelemetry(now) {
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
    updateMatchHud() {
        this.setText("futurebol-home-score", this.state.homeScore.toString());
        this.setText("futurebol-away-score", this.state.awayScore.toString());
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
        this.setText('futurebol-debug-integration-error', visual.logos.home.error
            ?? visual.logos.away.error
            ?? market.error
            ?? this.options.dataError
            ?? '—');
        const warning = this.hudElement("futurebol-player-visual-warning");
        if (warning instanceof HTMLElement) {
            warning.hidden = !visual.warning;
            warning.textContent = visual.warning ?? "";
        }
    }
    updatePauseStatus(paused) {
        this.setText("futurebol-a11y-status", paused ? "Simulação pausada." : "Simulação retomada.");
    }
    reportFatal(error) {
        if (this.fatalReported)
            return;
        this.fatalReported = true;
        this.paused = true;
        const message = error instanceof Error ? error.message : "Erro não tratado no módulo 3D.";
        if (this.options.development)
            console.error("[Futurebol] erro não tratado do módulo", error);
        void this.dotNetReference.invokeMethodAsync("ReportFuturebolError", message);
    }
    log(message, details) {
        if (!this.options.development)
            return;
        if (details === undefined)
            console.info(`[Futurebol] ${message}`);
        else
            console.info(`[Futurebol] ${message}`, details);
    }
    hudElement(id) {
        return this.hudRoot?.querySelector(`#${id}`) ?? null;
    }
    setText(id, value) {
        const element = this.hudElement(id);
        if (element)
            element.textContent = value;
    }
    setWidth(id, value) {
        const element = this.hudElement(id);
        if (element)
            element.style.width = `${Math.min(100, Math.max(0, value))}%`;
    }
}
function nextAnimationFrame() {
    return new Promise(resolve => requestAnimationFrame(() => resolve()));
}
function loadingProgress(stage) {
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
    constructor(canvas) {
        this.canvas = canvas;
        this.disposed = false;
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
            background: "radial-gradient(circle at center, rgba(14, 27, 62, .93), rgba(3, 7, 20, .985))",
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
        spinner.animate([
            { transform: "rotate(0deg)" },
            { transform: "rotate(360deg)" }
        ], {
            duration: 850,
            iterations: Number.POSITIVE_INFINITY
        });
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
            background: "linear-gradient(90deg, #ff9f1a 0%, #4edcff 100%)",
            boxShadow: "0 0 12px rgba(78, 220, 255, .45)",
            transition: "width 220ms ease"
        });
        track.appendChild(this.progressBar);
        this.overlay.append(spinner, title, this.label, track);
        this.host.appendChild(this.overlay);
    }
    update(label, progress) {
        if (this.disposed)
            return;
        this.label.textContent = label;
        this.progressBar.style.width =
            `${Math.min(100, Math.max(0, progress))}%`;
    }
    complete() {
        if (this.disposed)
            return;
        this.canvas.style.opacity = "1";
        this.overlay.style.transition = "opacity 220ms ease";
        this.overlay.style.opacity = "0";
        window.setTimeout(() => this.dispose(), 240);
    }
    fail(message) {
        if (this.disposed)
            return;
        this.canvas.style.opacity = "1";
        this.label.textContent = message;
        this.label.style.color = "#ffb4b4";
        this.progressBar.style.width = "100%";
        this.progressBar.style.background = "#ff5d73";
    }
    dispose() {
        if (this.disposed)
            return;
        this.disposed = true;
        this.overlay.remove();
        this.canvas.style.opacity = "1";
        if (this.previousHostPosition)
            this.host.style.position = this.previousHostPosition;
    }
}
function displayPlayer(playerId, homeSymbol, awaySymbol) {
    if (!playerId)
        return "—";
    return playerId
        .replace("home-", `${homeSymbol} `)
        .replace("away-", `${awaySymbol} `)
        .replace("goalkeeper", "GK")
        .replace("defender", "DEF")
        .replace("attacker", "ATA");
}
