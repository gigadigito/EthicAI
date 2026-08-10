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
        this.reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        this.teams = createFuturebolTeamVisualConfiguration(options);
        this.state = new FuturebolMatchState(options.seed);
        this.renderer = new FuturebolRenderer(B, canvas, this.teams, options.development, options.quality, this.reducedMotion);
        this.marketSource = createFuturebolMarketSource(options);
        this.renderFrame = () => this.render();
        this.resizeHandler = () => this.renderer.resize();
    }
    async initialize() {
        this.loadingOverlay = new FuturebolLoadingOverlay(this.canvas);
        try {
            this.loadingOverlay.update("Preparando campo", 8);
            await this.renderer.initializePlayers(this.state.players, this.options.playerVisual, this.options.simulatePlayerAssetFailure, stage => {
                setText("futurebol-player-loading-status", stage);
                this.loadingOverlay?.update(stage, loadingProgress(stage));
            });
            this.loadingOverlay.update("Conectando mercado", 88);
            this.unsubscribeMarket =
                this.marketSource.subscribe(snapshot => this.onSnapshot(snapshot));
            await this.marketSource.connect();
            window.addEventListener("resize", this.resizeHandler, { passive: true });
            this.lastFrameMs = performance.now();
            this.lastTelemetryMs = this.lastFrameMs;
            this.lastDebugMs = 0;
            this.renderer.engine.runRenderLoop(this.renderFrame);
            this.updateMatchHud();
            this.loadingOverlay.update("Pronto", 100);
            this.loadingOverlay.complete();
            this.loadingOverlay = null;
            this.log("inicialização concluída", {
                dataMode: this.options.dataMode,
                seed: this.options.seed,
                players: this.state.players.length,
                quality: this.options.quality,
                reducedMotion: this.reducedMotion
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
        this.unsubscribeMarket?.();
        this.unsubscribeMarket = null;
        await this.marketSource.disconnect();
        this.loadingOverlay?.dispose();
        this.loadingOverlay = null;
        this.renderer.dispose();
        this.log("disposal concluído");
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
            this.collectTelemetry(now);
        }
        catch (error) {
            this.reportFatal(error);
        }
    }
    onSnapshot(snapshot) {
        if (!this.paused)
            this.state.applyMarket(snapshot, this.pressureOverride);
        this.updateHud(snapshot);
    }
    updateHud(snapshot) {
        setText("futurebol-home-momentum", Math.round(snapshot.home.momentum).toString());
        setText("futurebol-away-momentum", Math.round(snapshot.away.momentum).toString());
        setWidth("futurebol-home-momentum-bar", snapshot.home.momentum);
        setWidth("futurebol-away-momentum-bar", snapshot.away.momentum);
        if (snapshot.sequence % 10 === 0) {
            const state = this.paused ? "pausada" : "em execução";
            setText("futurebol-a11y-status", `Simulação ${state}. Momentum ${snapshot.home.symbol} ${Math.round(snapshot.home.momentum)} e ${snapshot.away.symbol} ${Math.round(snapshot.away.momentum)}.`);
        }
    }
    updateClock() {
        const totalSeconds = Math.floor(this.state.elapsedSeconds);
        const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, "0");
        const seconds = (totalSeconds % 60).toString().padStart(2, "0");
        setText("futurebol-clock", `${minutes}:${seconds}`);
    }
    collectTelemetry(now) {
        if (now - this.lastDebugMs >= 250) {
            this.updateMatchHud();
            this.lastDebugMs = now;
        }
        if (now - this.lastTelemetryMs < 1000)
            return;
        const fps = Math.round(this.renderer.engine.getFps());
        setText("futurebol-fps", fps.toString());
        this.updateClock();
        this.fpsTotal += fps;
        this.fpsSamples += 1;
        this.lastTelemetryMs = now;
        if (this.options.development && this.fpsSamples % 15 === 0)
            console.info(`[Futurebol] FPS médio: ${Math.round(this.fpsTotal / this.fpsSamples)}`);
    }
    updateMatchHud() {
        setText("futurebol-home-score", this.state.homeScore.toString());
        setText("futurebol-away-score", this.state.awayScore.toString());
        setText("futurebol-debug-phase", this.state.currentPlayPhase);
        setText("futurebol-debug-owner", displayPlayer(this.state.currentBallOwnerId, this.teams.home.symbol, this.teams.away.symbol));
        setText("futurebol-debug-receiver", displayPlayer(this.state.intendedReceiverId, this.teams.home.symbol, this.teams.away.symbol));
        setText("futurebol-debug-ball", this.state.ballState);
        setText("futurebol-debug-cooldown", `${Math.ceil(this.state.cooldownRemainingSeconds)}s`);
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
        setText("futurebol-debug-visual", visual.kind);
        setText("futurebol-debug-asset", visual.assetLoaded ? "sim" : "não");
        setText("futurebol-debug-skeletons", visual.skeletonCount.toString());
        setText("futurebol-debug-animation-current", visual.currentAnimation ?? "—");
        setText("futurebol-debug-animation-requested", visual.requestedAnimation ?? "—");
        setText("futurebol-debug-fallback", visual.fallbackActive ? "ativo" : "não");
        setText("futurebol-debug-load-time", visual.loadTimeMs ? `${Math.round(visual.loadTimeMs)} ms` : "—");
        setText('futurebol-debug-home-symbol', this.teams.home.symbol);
        setText('futurebol-debug-away-symbol', this.teams.away.symbol);
        setText('futurebol-debug-home-logo-url', this.teams.home.logoUrl ?? '—');
        setText('futurebol-debug-away-logo-url', this.teams.away.logoUrl ?? '—');
        setText('futurebol-debug-home-logo-loaded', visual.logos.home.loaded ? 'sim' : 'não');
        setText('futurebol-debug-away-logo-loaded', visual.logos.away.loaded ? 'sim' : 'não');
        setText('futurebol-debug-home-logo-fallback', visual.logos.home.fallbackActive ? 'sim' : 'não');
        setText('futurebol-debug-away-logo-fallback', visual.logos.away.fallbackActive ? 'sim' : 'não');
        const logoFallback = visual.logos.home.fallbackActive || visual.logos.away.fallbackActive;
        setText('futurebol-debug-logo-fallback', logoFallback ? 'ativo' : 'não');
        const market = this.marketSource.getDiagnostics();
        setText('futurebol-debug-data-source', market.mode);
        setText('futurebol-debug-last-update', market.lastUpdatedAt ?? '—');
        setText('futurebol-debug-integration-error', visual.logos.home.error
            ?? visual.logos.away.error
            ?? market.error
            ?? this.options.dataError
            ?? '—');
        const warning = document.getElementById("futurebol-player-visual-warning");
        if (warning instanceof HTMLElement) {
            warning.hidden = !visual.warning;
            warning.textContent = visual.warning ?? "";
        }
    }
    updatePauseStatus(paused) {
        setText("futurebol-a11y-status", paused ? "Simulação pausada." : "Simulação retomada.");
    }
    reportFatal(error) {
        if (this.fatalReported)
            return;
        this.fatalReported = true;
        this.paused = true;
        const message = error instanceof Error ? error.message : "Erro não tratado no módulo 3D.";
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
function setText(id, value) {
    const element = document.getElementById(id);
    if (element)
        element.textContent = value;
}
function setWidth(id, value) {
    const element = document.getElementById(id);
    if (element instanceof HTMLElement)
        element.style.width = `${Math.min(100, Math.max(0, value))}%`;
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
