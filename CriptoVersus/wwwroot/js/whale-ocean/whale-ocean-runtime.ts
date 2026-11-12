import { acquireBabylon, releaseBabylon } from "../futurebol/futurebol-babylon-loader.js";
import { createOceanEnvironment, type OceanEnvironment } from "./ocean-environment.js";
import { flowStatusForConnection, guardWhaleOceanFlowStatus, type WhaleOceanFlowStatus } from "./whale-ocean-flow-state.js";
import {
    cssPixelToRenderPixel,
    getTeamHorizontalBounds as calculateTeamHorizontalBounds,
    getTransitPath as calculateTransitPath,
    type WhaleOceanTeamBounds,
    type WhaleOceanTransitPath,
    type WhaleOceanVisibleBounds
} from "./whale-ocean-geometry.js";
import {
    computePressure,
    formatCompactVolume,
    normalizeActivity,
    visualProfile,
    visualDensity,
    VolumeEventDetector,
    WHALE_OCEAN_SPECIES,
    WHALE_OCEAN_SIZE_CATEGORIES,
    DEFAULT_WHALE_OCEAN_VISUAL_BUDGET,
    animalKindForFinancialVolume,
    animalKindForEvent,
    isLargeAnimalKind,
    sizeCategoryForKind,
    quoteCurrencyForSymbol,
    swimDirectionForSide,
    type WhaleOceanBatch,
    type WhaleOceanAnimalKind,
    type WhaleOceanFlowAnimalKind,
    type WhaleOceanEvent,
    type WhaleOceanSide,
    type WhaleOceanVisualBudget,
    type WhaleOceanSizeCategory
} from "./whale-ocean-model.js";
import type { ArcRotateCamera, Engine, Mesh, Scene, Sprite, SpriteManager, StandardMaterial, Vector3 } from "babylonjs";

type BabylonApi = typeof import("babylonjs");
type Quality = "Low" | "Medium" | "High";
type SpriteKind = WhaleOceanAnimalKind;
type FlowOrigin = "LIVE" | "REPLAY" | "DEMO";

interface SpriteAtlas {
    manager: SpriteManager;
    fps: number;
    kind: SpriteKind;
    territory: "left" | "right";
    visualWidthRatio: number;
    visualHeightRatio: number;
    visualMinXRatio: number;
    visualMaxXRatio: number;
}

export interface WhaleOceanRuntimeOptions {
    canvas: HTMLCanvasElement;
    matchId: number;
    leftSymbol: string;
    rightSymbol: string;
    leftPrice: number | null;
    rightPrice: number | null;
    leftChange: number;
    rightChange: number;
    leftColor: string;
    rightColor: string;
    quality?: Quality;
    labels?: Record<string, string>;
    diagnostic?: "sprites" | "showcase";
    developmentDiagnostics?: boolean;
    debugWhaleOcean?: boolean;
    matchFinished?: boolean;
    officialStatus?: string;
    officialRawStatus?: string | null;
    officialStartTimeUtc?: string | null;
    officialEndTimeUtc?: string | null;
    visualBudget?: Partial<WhaleOceanVisualBudget>;
}

interface FishAgent {
    position: Vector3;
    velocity: Vector3;
    phase: number;
    seed: number;
    sprite: Sprite;
    kind: SpriteKind;
    allocatedNotional: number;
    label: HTMLElement | null;
    labelText: string;
    debugId: string;
}

interface FishGroup {
    side: WhaleOceanSide;
    symbol: string;
    territory: "left" | "right";
    agents: FishAgent[];
    targetCount: number;
    baseline: number;
    activity: number;
    flowBias: number;
    lastActiveAt: number;
    recentLots: Array<{ at: number; quote: number; tradeCount: number; origin: FlowOrigin; kind: WhaleOceanFlowAnimalKind }>;
    schoolKind: WhaleOceanFlowAnimalKind;
    visibleCount: number;
    lastLiveAt: number;
    lastOrigin: FlowOrigin | null;
}

interface Bubble {
    mesh: Mesh;
    speed: number;
    phase: number;
    baseX: number;
}

interface FlowActor {
    id: string;
    sprite: Sprite;
    label: HTMLElement | null;
    labelText: string;
    startedAt: number;
    duration: number;
    fromX: number;
    toX: number;
    side: WhaleOceanSide;
    territory: "left" | "right";
    kind: WhaleOceanAnimalKind;
    size: number;
    intensity: number;
    phase: number;
    notional: number;
    quoteCurrency: string | null;
    labelWidthPx: number;
    labelHeightPx: number;
}

interface PendingFlow {
    symbol: string;
    side: WhaleOceanSide;
    totalNotional: number;
    peakNotional: number;
    baseline: number;
    firstReceivedAt: number;
    lastReceivedAt: number;
    batchCount: number;
}

type VisibleHorizontalBounds = WhaleOceanVisibleBounds;
type TeamHorizontalBounds = WhaleOceanTeamBounds;
type TransitPath = WhaleOceanTransitPath;

/** Per-animal visual diagnostics row used by spawn logs, size warnings and tests. */
export interface WhaleOceanVisualDiagnosticRow {
    id: string;
    symbol: string;
    kind: WhaleOceanAnimalKind;
    category: WhaleOceanSizeCategory;
    finalScaleWidth: number;
    finalScaleHeight: number;
    worldPositionX: number;
    worldPositionY: number;
    worldPositionZ: number;
    cameraDistance: number;
    projectedBodyCssWidth: number;
    projectedBodyCssHeight: number;
    opacity: number;
    visible: boolean;
    inViewport: boolean;
    minBodyCssWidth: number;
    maxBodyCssWidth: number;
    labelState: "none" | "hidden" | "visible";
    labelCssX: number;
    labelCssY: number;
    labelText: string;
}

export interface WhaleOceanGeometryDiagnostic {
    viewportCss: { width: number; height: number };
    renderViewport: { width: number; height: number };
    cameraCenterWorldX: number;
    visibleWorld: VisibleHorizontalBounds;
    territories: {
        left: { world: { minX: number; maxX: number }; screen: { minX: number; maxX: number } };
        right: { world: { minX: number; maxX: number }; screen: { minX: number; maxX: number } };
    };
    animals: Array<{ id: string; territory: "left" | "right"; worldX: number; screenX: number | null }>;
}

interface LiveSymbolState {
    buyQuote: number;
    sellQuote: number;
    volume: number;
    price: number | null;
    quoteCurrency: string | null;
    updatedAt: number;
    recent: Array<{ at: number; buy: number; sell: number }>;
    baseline: number;
    lastActorAt: Record<WhaleOceanSide, number>;
}

const QUALITY_FPS: Record<Quality, number> = { Low: 30, Medium: 45, High: 60 };
const QUALITY_FLOW_ACTORS: Record<Quality, number> = { Low: 2, Medium: 3, High: 4 };
const SPRITE_ASSET_VERSION = "20261112-whale-ocean-territory-v8";
const CAMERA_FOV = 0.8;
const CAMERA_RADIUS = 27;
const REFERENCE_CSS_PIXELS_PER_WORLD_UNIT = 700 / (2 * CAMERA_RADIUS * Math.tan(CAMERA_FOV / 2));
const SCHOOL_TRANSIT_RESERVE = 4;
const SCHOOL_OCCUPANCY_SHARE = 0.55;
const MINIMUM_SIZE_WARNING_INTERVAL_MS = 5_000;
export class WhaleOceanRuntime {
    private readonly canvas: HTMLCanvasElement;
    private readonly options: WhaleOceanRuntimeOptions;
    private readonly budget: WhaleOceanVisualBudget;
    private readonly root: HTMLElement | null;
    private readonly detector = new VolumeEventDetector();
    private readonly symbols = new Map<string, LiveSymbolState>();
    private readonly fishGroups: FishGroup[] = [];
    private readonly spriteAtlases = new Map<string, SpriteAtlas>();
    private readonly spriteManagers: SpriteManager[] = [];
    private readonly bubbles: Bubble[] = [];
    private readonly flowActors: FlowActor[] = [];
    private readonly pendingFlows = new Map<string, PendingFlow>();
    private readonly whales: Array<{ sprite: Sprite; label: HTMLElement | null; labelText: string; startedAt: number; duration: number; fromX: number; toX: number; size: number; territory: "left" | "right"; kind: WhaleOceanAnimalKind; side: WhaleOceanSide; notional: number; quoteCurrency: string | null; eventId: string }> = [];
    private readonly pendingEvents: WhaleOceanEvent[] = [];
    private readonly lastBatchSequence = new Map<string, number>();
    private readonly seenEventIds = new Set<string>();
    private B: BabylonApi | null = null;
    private engine: Engine | null = null;
    private scene: Scene | null = null;
    private camera: ArcRotateCamera | null = null;
    private environment: OceanEnvironment | null = null;
    private renderObserver: unknown = null;
    private resizeHandler: (() => void) | null = null;
    private visibilityHandler: (() => void) | null = null;
    private paused = false;
    private connected = false;
    private matchFinished: boolean;
    private flowStatus: WhaleOceanFlowStatus;
    private officialStatus: string;
    private officialRawStatus: string | null;
    private officialStartTimeUtc: string | null;
    private officialEndTimeUtc: string | null;
    private replaying = false;
    private replayComplete = false;
    private disposed = false;
    private quality: Quality;
    private labels: Record<string, string>;
    private lastFrame = 0;
    private frameAccumulator = 0;
    private alertCount = 0;
    private randomState = 0x51f15e;
    private lastDiagnosticsAt = 0;
    private lastDebugSummaryAt = 0;
    private lastReceiveAt = 0;
    private lastNoEventWarningAt = 0;
    private nextFlowId = 1;
    private labelLayer: HTMLElement | null = null;
    private labelLayerOwned = false;
    private readonly undersizedWarnedIds = new Set<string>();
    private lastSizeWarningAt = 0;
    private geometryDebugOverlay: HTMLElement | null = null;

    public constructor(options: WhaleOceanRuntimeOptions) {
        this.options = options;
        const requestedBudget = options.visualBudget ?? {};
        this.budget = {
            ...DEFAULT_WHALE_OCEAN_VISUAL_BUDGET,
            ...requestedBudget,
            maxVisibleAnimals: Math.max(4, Math.min(24, Math.round(requestedBudget.maxVisibleAnimals ?? DEFAULT_WHALE_OCEAN_VISUAL_BUDGET.maxVisibleAnimals))),
            maxLargeHighlightsPerTerritory: Math.max(1, Math.min(2, Math.round(requestedBudget.maxLargeHighlightsPerTerritory ?? DEFAULT_WHALE_OCEAN_VISUAL_BUDGET.maxLargeHighlightsPerTerritory))),
            maxSchoolAnimalsPerGroup: Math.max(1, Math.min(6, Math.round(requestedBudget.maxSchoolAnimalsPerGroup ?? DEFAULT_WHALE_OCEAN_VISUAL_BUDGET.maxSchoolAnimalsPerGroup))),
            maxOccupancyPerTerritory: Math.max(6, Math.min(14, requestedBudget.maxOccupancyPerTerritory ?? DEFAULT_WHALE_OCEAN_VISUAL_BUDGET.maxOccupancyPerTerritory)),
            windowMs: Math.max(5_000, Math.min(120_000, Math.round(requestedBudget.windowMs ?? DEFAULT_WHALE_OCEAN_VISUAL_BUDGET.windowMs)))
        };
        this.canvas = options.canvas;
        this.root = this.canvas.closest<HTMLElement>(".whale-ocean");
        this.quality = options.quality ?? "Medium";
        this.labels = options.labels ?? {};
        this.matchFinished = options.matchFinished ?? false;
        this.flowStatus = this.matchFinished ? "FINALIZED" : "BOOTSTRAP_PENDING";
        this.officialStatus = options.officialStatus ?? (this.matchFinished ? "FINALIZED" : "LIVE");
        this.officialRawStatus = options.officialRawStatus ?? null;
        this.officialStartTimeUtc = options.officialStartTimeUtc ?? null;
        this.officialEndTimeUtc = options.officialEndTimeUtc ?? null;
        this.symbols.set(options.leftSymbol, { buyQuote: 0, sellQuote: 0, volume: 0, price: options.leftPrice, quoteCurrency: quoteCurrencyForSymbol(options.leftSymbol), updatedAt: 0, recent: [], baseline: 0, lastActorAt: { buy: 0, sell: 0 } });
        this.symbols.set(options.rightSymbol, { buyQuote: 0, sellQuote: 0, volume: 0, price: options.rightPrice, quoteCurrency: quoteCurrencyForSymbol(options.rightSymbol), updatedAt: 0, recent: [], baseline: 0, lastActorAt: { buy: 0, sell: 0 } });
    }

    public async initialize(): Promise<void> {
        this.debugInit();
        this.B = await acquireBabylon();
        if (this.disposed) return;

        this.engine = new this.B.Engine(this.canvas, true, {
            preserveDrawingBuffer: false,
            stencil: false,
            powerPreference: "high-performance"
        });
        this.engine.setHardwareScalingLevel(this.quality === "Low" ? 1.6 : this.quality === "Medium" ? 1.25 : 1);
        this.scene = new this.B.Scene(this.engine);
        this.scene.spritesEnabled = true;
        this.scene.clearColor = this.B.Color4.FromHexString("#031525ff");
        this.scene.fogMode = this.B.Scene.FOGMODE_EXP2;
        this.scene.fogDensity = this.quality === "Low" ? 0.018 : 0.012;
        this.scene.fogColor = this.B.Color3.FromHexString("#092b42");

        this.camera = new this.B.ArcRotateCamera("whale-ocean-camera", -Math.PI / 2, Math.PI / 2, CAMERA_RADIUS, new this.B.Vector3(0, 0, 0), this.scene);
        this.camera.fov = CAMERA_FOV;
        this.camera.lowerRadiusLimit = CAMERA_RADIUS;
        this.camera.upperRadiusLimit = CAMERA_RADIUS;
        this.camera.lowerAlphaLimit = this.camera.alpha;
        this.camera.upperAlphaLimit = this.camera.alpha;
        this.camera.lowerBetaLimit = this.camera.beta;
        this.camera.upperBetaLimit = this.camera.beta;
        this.camera.detachControl();
        this.camera.minZ = 0.1;
        this.camera.maxZ = 100;

        this.environment = createOceanEnvironment({
            babylon: this.B,
            scene: this.scene,
            camera: this.camera,
            engine: this.engine
        });
        await this.buildSpriteLibrary();
        if (this.options.diagnostic === "sprites") {
            this.buildSpriteDiagnostic();
            this.setFlowStatus("DIAGNOSTIC_SPRITES", "sprite diagnostic initialized");
        } else {
            this.buildFishGroups();
            this.buildBubbles();
            this.updateHud();
            this.refreshDiagnostics(Date.now(), true);
            if (this.options.diagnostic === "showcase") {
                this.buildShowcaseDiagnostic();
                this.setFlowStatus("DIAGNOSTIC_SHOWCASE", "showcase diagnostic initialized");
            }
        }

        this.renderObserver = this.scene.onBeforeRenderObservable.add(() => this.frame());
        this.engine.runRenderLoop(() => {
            if (!this.paused && this.scene) this.scene.render();
        });
        this.resizeHandler = () => {
            this.engine?.resize();
            this.environment?.resize();
            this.resizeArena();
            this.updateTerritoryDivider();
            this.updateGeometryDebugOverlay();
        };
        window.addEventListener("resize", this.resizeHandler, { passive: true });
        this.visibilityHandler = () => this.setPaused(document.hidden);
        document.addEventListener("visibilitychange", this.visibilityHandler);
        this.updateTerritoryDivider();
        this.updateGeometryDebugOverlay();
        if (!this.options.diagnostic) this.setFlowStatus(this.matchFinished ? "FINALIZED" : "BOOTSTRAP_PENDING", "renderer initialized");
    }

    public receive(batch: WhaleOceanBatch): void {
        this.debugReceive(batch);
        if (this.disposed || this.matchFinished || batch.matchId !== this.options.matchId) return;
        const symbol = batch.symbol.trim().toUpperCase();
        const state = this.symbols.get(symbol);
        if (!state) {
            this.debugFilter(batch, "unmatched_symbol");
            return;
        }
        const lastSequence = this.lastBatchSequence.get(symbol) ?? 0;
        if (!Number.isFinite(batch.sequence)) {
            this.debugFilter(batch, "invalid_sequence");
            return;
        }
        if (batch.sequence <= lastSequence) {
            this.debugFilter(batch, batch.sequence === lastSequence ? "duplicate_sequence" : "late_sequence");
            return;
        }
        this.lastBatchSequence.set(symbol, batch.sequence);

        const buyQuote = parseNumber(batch.takerBuyQuote);
        const sellQuote = parseNumber(batch.takerSellQuote);
        const totalQuote = buyQuote + sellQuote;
        const now = Date.now();
        this.lastReceiveAt = now;
        state.recent.push({ at: now, buy: buyQuote, sell: sellQuote });
        while (state.recent.length > 0 && state.recent[0].at < now - this.budget.windowMs) state.recent.shift();
        state.buyQuote = state.recent.reduce((sum, item) => sum + item.buy, 0);
        state.sellQuote = state.recent.reduce((sum, item) => sum + item.sell, 0);
        state.volume = state.buyQuote + state.sellQuote;
        state.baseline = state.baseline === 0
            ? Math.max(totalQuote, 1)
            : state.baseline * 0.96 + Math.max(totalQuote, 1) * 0.04;
        state.price = parseNumber(batch.lastPrice) || state.price;
        state.updatedAt = now;
        const side = buyQuote >= sellQuote ? "buy" : "sell";
        const activity = buyQuote + sellQuote;
        const origin: FlowOrigin = batch.isReplay ? "REPLAY" : "LIVE";
        const tradeCount = Math.max(0, Math.round(batch.tradeCount));
        this.updateGroup(symbol, "buy", buyQuote, side === "buy" ? activity : 0, tradeCount, origin, now);
        this.updateGroup(symbol, "sell", sellQuote, side === "sell" ? activity : 0, tradeCount, origin, now);

        if (batch.isReplay) {
            if (!this.replayComplete) {
                this.replaying = true;
                this.setFlowStatus("REPLAY", "replay batch received");
            }
        } else {
            this.replaying = false;
            this.setFlowStatus("LIVE", "live batch received");
            const event = this.detector.ingest(batch);
            if (event) this.spawnEvent(event);
            else {
                if (buyQuote > 0) this.enqueueFlow(symbol, "buy", buyQuote, state.baseline, now);
                if (sellQuote > 0) this.enqueueFlow(symbol, "sell", sellQuote, state.baseline, now);
            }
        }
        this.trySpawnPendingFlows(now);
        this.rebalancePopulation();
        this.updateHud();
        this.refreshDiagnostics(now, true);
        this.debugFilter(batch, "accepted");
        this.debugSummary(now);
    }

    public setPaused(paused: boolean): void {
        this.paused = paused;
        this.setFlowStatus(paused ? "PAUSED" : this.replaying ? "REPLAY" : flowStatusForConnection(this.connected, this.hasLiveData()), paused ? "pause requested" : "pause released");
        this.write("pause", paused ? "PAUSED" : "LIVE");
    }

    public setConnectionState(connected: boolean): void {
        this.connected = connected;
        if (!this.paused && !this.replaying)
            this.setFlowStatus(flowStatusForConnection(connected, this.hasLiveData()), connected ? "SignalR connected; awaiting Money Flow data" : "SignalR disconnected");
    }

    public completeReplay(): void {
        this.replayComplete = true;
        this.replaying = false;
        if (!this.paused) this.setFlowStatus(flowStatusForConnection(this.connected, this.hasLiveData()), "replay completed");
    }

    public setMatchFinished(finished: boolean): void {
        if (this.matchFinished && !finished) {
            this.logMatchState("official finalization is sticky; reopen request ignored", "FINALIZED -> LIVE", true);
            return;
        }

        this.matchFinished = finished;
        if (finished) {
            // Preserve actors already on screen, but never release buffered input
            // into new actors after the official match end.
            this.pendingFlows.clear();
            this.pendingEvents.length = 0;
            this.setFlowStatus("FINALIZED", "official match finalized");
            return;
        }

        if (!this.paused && !this.replaying)
            this.setFlowStatus(flowStatusForConnection(this.connected, this.hasLiveData()), "official match is active");
    }

    public setOfficialMatchState(
        finished: boolean,
        rawStatus: string | null,
        startTimeUtc: string | null,
        endTimeUtc: string | null
    ): void {
        this.officialStatus = finished ? "FINALIZED" : "LIVE";
        this.officialRawStatus = rawStatus;
        this.officialStartTimeUtc = startTimeUtc;
        this.officialEndTimeUtc = endTimeUtc;
        this.setMatchFinished(finished);
    }

    public async setQuality(quality: Quality): Promise<void> {
        if (this.quality === quality || this.disposed) return;
        this.quality = quality;
        this.engine?.setHardwareScalingLevel(quality === "Low" ? 1.6 : quality === "Medium" ? 1.25 : 1);
        this.rebalancePopulation();
        this.trySpawnPendingFlows(Date.now());
        this.write("quality", quality);
    }

    public async dispose(): Promise<void> {
        if (this.disposed) return;
        this.disposed = true;
        if (this.renderObserver && this.scene) this.scene.onBeforeRenderObservable.remove(this.renderObserver as never);
        if (this.resizeHandler) window.removeEventListener("resize", this.resizeHandler);
        if (this.visibilityHandler) document.removeEventListener("visibilitychange", this.visibilityHandler);
        this.engine?.stopRenderLoop();
        this.environment?.dispose();
        this.environment = null;
        for (const manager of this.spriteManagers) manager.dispose();
        if (this.labelLayer) {
            this.labelLayer.replaceChildren();
            if (this.labelLayerOwned) this.labelLayer.remove();
            this.labelLayer = null;
        }
        this.scene?.dispose();
        this.engine?.dispose();
        this.scene = null;
        this.engine = null;
        this.camera = null;
        this.geometryDebugOverlay?.remove();
        this.geometryDebugOverlay = null;
        releaseBabylon();
    }

    private async buildSpriteLibrary(): Promise<void> {
        const B = this.B!;
        const scene = this.scene!;
        const response = await fetch(`/games/whale-ocean/sprites/manifest.json?v=${SPRITE_ASSET_VERSION}`, { cache: "no-cache" });
        if (!response.ok) throw new Error(`Whale Ocean sprite manifest returned ${response.status}.`);
        const manifest = await response.json() as {
            frameWidth: number;
            frameHeight: number;
            framesPerAnimation: number;
            atlas: { columns: number; rows: number };
            animations: Record<string, { atlas: string; fps: number; frameCount: number; kind: SpriteKind }>;
        };
        if (manifest.frameWidth !== 512 || manifest.frameHeight !== 256 || manifest.framesPerAnimation !== 12
            || manifest.atlas.columns !== 4 || manifest.atlas.rows !== 3)
            throw new Error("Whale Ocean sprite manifest has an unsupported atlas layout.");

        const atlasPromises = Object.entries(manifest.animations).map(async ([name, definition]) => {
            const territory = name.endsWith("_lima") ? "left" : "right";
            const atlasUrl = `/games/whale-ocean/sprites/${definition.atlas}?v=${SPRITE_ASSET_VERSION}`;
            const bounds = await measureAtlasBounds(atlasUrl, manifest.frameWidth, manifest.frameHeight, manifest.framesPerAnimation);
            const manager = new B.SpriteManager(
                `whale-ocean-sprites-${name}`,
                atlasUrl,
                this.budget.maxVisibleAnimals + 16,
                { width: manifest.frameWidth, height: manifest.frameHeight },
                scene,
                0.01,
                B.Texture.NEAREST_SAMPLINGMODE
            );
            manager.isPickable = false;
            manager.disableDepthWrite = true;
            manager.fogEnabled = false;
            manager.renderingGroupId = 1;
            this.spriteManagers.push(manager);
            await waitForSpriteTexture(manager.texture);
            this.spriteAtlases.set(`${definition.kind}:${territory}`, {
                manager,
                fps: definition.fps,
                kind: definition.kind,
                territory,
                visualWidthRatio: bounds.widthRatio,
                visualHeightRatio: bounds.heightRatio,
                visualMinXRatio: bounds.minXRatio,
                visualMaxXRatio: bounds.maxXRatio
            });
        });
        await Promise.all(atlasPromises);
    }

    private createAnimatedSprite(kind: SpriteKind, territory: "left" | "right", name: string, seed: number): Sprite {
        const B = this.B!;
        const atlas = this.spriteAtlases.get(`${kind}:${territory}`);
        if (!atlas) throw new Error(`Missing Whale Ocean sprite atlas for ${kind}:${territory}.`);
        const sprite = new B.Sprite(name, atlas.manager);
        sprite.cellIndex = Math.floor(seed * 12) % 12;
        sprite.invertV = false;
        sprite.invertU = false;
        sprite.color = new B.Color4(1, 1, 1, 1);
        sprite.playAnimation(0, 11, true, 1_000 / (atlas.fps * (0.9 + seed * 0.2)));
        sprite.isVisible = false;
        return sprite;
    }

    private buildFishGroups(): void {
        const left = this.options.leftSymbol;
        const right = this.options.rightSymbol;
        this.createFishGroup(left, "left", "buy");
        this.createFishGroup(left, "left", "sell");
        this.createFishGroup(right, "right", "buy");
        this.createFishGroup(right, "right", "sell");
    }

    private createFishGroup(symbol: string, territory: "left" | "right", side: WhaleOceanSide): void {
        const B = this.B!;
        // Pools are deliberately small. The visible budget is shared by all four
        // symbol/direction groups and is further reduced by transient highlights.
        const capacity = this.budget.maxSchoolAnimalsPerGroup;
        const agents: FishAgent[] = [];
        for (let index = 0; index < capacity; index++) {
            const angle = this.random() * Math.PI * 2;
            const kind: WhaleOceanFlowAnimalKind = "sardine";
            const sprite = this.createAnimatedSprite(kind, territory, `whale-ocean-fish-${territory}-${side}-${index}`, this.random());
            sprite.width = this.spriteWidthFor(kind, territory);
            sprite.height = sprite.width * 0.5;
            const anchor = this.schoolAnchor(territory, side, index);
            agents.push({
                position: new B.Vector3(anchor.x + (this.random() - 0.5) * 0.55, anchor.y + (this.random() - 0.5) * 0.4, anchor.z + (this.random() - 0.5) * 0.3),
                velocity: new B.Vector3(Math.cos(angle) * 0.012, (this.random() - 0.5) * 0.01, Math.sin(angle) * 0.009),
                phase: this.random() * Math.PI * 2,
                seed: this.random(),
                sprite,
                kind,
                allocatedNotional: 0,
                label: null,
                labelText: "",
                debugId: `school-${territory}-${side}-${index}`
            });
        }
        this.fishGroups.push({
            side, symbol, territory, agents, targetCount: 0, baseline: 0, activity: 0, flowBias: 0, lastActiveAt: 0,
            recentLots: [], schoolKind: "sardine", visibleCount: 0, lastLiveAt: 0, lastOrigin: null
        });
    }

    private buildBubbles(): void {
        const B = this.B!;
        const scene = this.scene!;
        const material = new B.StandardMaterial("whale-ocean-bubbles", scene);
        material.diffuseColor = B.Color3.FromHexString("#b9f5ff");
        material.emissiveColor = B.Color3.FromHexString("#62b9d0");
        material.alpha = 0.3;
        const count = this.quality === "Low" ? 12 : this.quality === "Medium" ? 24 : 42;
        for (let index = 0; index < count; index++) {
            const mesh = B.MeshBuilder.CreateSphere(`whale-ocean-bubble-${index}`, { diameter: 0.06 + this.random() * 0.12, segments: 6 }, scene);
            mesh.material = material;
            mesh.position.set((this.random() - 0.5) * 28, -5 + this.random() * 8, (this.random() - 0.5) * 2);
            this.bubbles.push({ mesh, speed: 0.0008 + this.random() * 0.0014, phase: this.random() * 6, baseX: mesh.position.x });
        }
    }

    /**
     * CSS pixels per world unit at the z=0 stage plane. Derived from the
     * camera projection so an animal's visible body matches its CSS-pixel
     * target on any canvas size (desktop and mobile).
     */
    private cssPixelsPerWorldUnit(): number {
        const center = this.projectToCss(0, 0, 0);
        const oneWorldUnit = this.projectToCss(1, 0, 0);
        const projectedScale = center && oneWorldUnit ? Math.abs(oneWorldUnit.x - center.x) : 0;
        if (Number.isFinite(projectedScale) && projectedScale > 0) return projectedScale;
        return REFERENCE_CSS_PIXELS_PER_WORLD_UNIT;
    }

    /** Visible body length (atlas margins excluded) in world units. */
    private bodyWorldLength(kind: SpriteKind): number {
        return WHALE_OCEAN_SPECIES[kind].bodyLengthPx / this.cssPixelsPerWorldUnit();
    }

    /** The transparent atlas frame is not a territory boundary. */
    private visibleBodyHalfWidth(kind: SpriteKind, territory: "left" | "right", spriteWidth: number): number {
        const atlas = this.spriteAtlases.get(`${kind}:${territory}`);
        if (!atlas) return Math.max(0, spriteWidth / 2);
        const left = atlas.visualMinXRatio;
        const right = 1 - atlas.visualMaxXRatio;
        return Math.max(0, spriteWidth * Math.max(left, right));
    }

    private spriteHalfWidth(spriteWidth: number): number {
        return Math.max(0, spriteWidth / 2);
    }

    private spriteWidthFor(kind: SpriteKind, territory: "left" | "right"): number {
        const atlas = this.spriteAtlases.get(`${kind}:${territory}`);
        if (!atlas || atlas.visualWidthRatio <= 0)
            throw new Error(`Whale Ocean sprite metrics are unavailable for ${kind}:${territory}.`);
        return this.bodyWorldLength(kind) / atlas.visualWidthRatio;
    }

    private buildSpriteDiagnostic(): void {
        const kinds = Object.keys(WHALE_OCEAN_SPECIES) as SpriteKind[];
        for (const [index, kind] of kinds.entries()) {
            const row = Math.floor(index / 2);
            const rowColumn = index % 2;
            for (const [column, territory] of (["left", "right"] as const).entries()) {
                const sprite = this.createAnimatedSprite(kind, territory, `whale-ocean-diagnostic-${territory}-${kind}`, (index + column * 0.37) / 13);
                const width = this.spriteWidthFor(kind, territory) * 0.25;
                sprite.width = width;
                sprite.height = width * 0.5;
                sprite.position.set((column === 0 ? -13 : 4) + rowColumn * 8.5, 3.55 - row * 1.72, 0);
                sprite.color.a = 1;
                sprite.isVisible = true;
            }
        }
    }

    private buildShowcaseDiagnostic(): void {
        const now = Date.now();
        const flows: Array<{ symbol: string; side: WhaleOceanSide; quote: number; baseline: number }> = [
            { symbol: this.options.leftSymbol, side: "buy", quote: 7_500, baseline: 12_000 },
            { symbol: this.options.leftSymbol, side: "sell", quote: 10_500, baseline: 16_000 },
            { symbol: this.options.rightSymbol, side: "buy", quote: 6_250, baseline: 11_000 },
            { symbol: this.options.rightSymbol, side: "sell", quote: 9_400, baseline: 14_000 }
        ];
        for (const flow of flows) this.enqueueFlow(flow.symbol, flow.side, flow.quote, flow.baseline, now);
        this.trySpawnPendingFlows(now);
        this.spawnEvent({
            id: "diagnostic-shark",
            kind: "shark",
            symbol: this.options.leftSymbol,
            side: "buy",
            notionalUsdt: 850_000,
            ratio: 5,
            sequence: 1,
            eventTimeUtc: new Date().toISOString()
        });
        this.spawnEvent({
            id: "diagnostic-whale",
            kind: "whale",
            symbol: this.options.rightSymbol,
            side: "sell",
            notionalUsdt: 2_400_000,
            ratio: 9,
            sequence: 2,
            eventTimeUtc: new Date().toISOString()
        });
        this.rebalancePopulation();
    }

    private updateGroup(symbol: string, side: WhaleOceanSide, quote: number, activeQuote: number, tradeCount: number, origin: FlowOrigin, now: number): void {
        const state = this.symbols.get(symbol);
        if (!state) return;
        for (const group of this.fishGroups) {
            if (group.symbol !== symbol || group.side !== side) continue;
            group.recentLots = group.recentLots.filter(lot => lot.at >= now - this.budget.windowMs);
            if (quote <= 0) {
                group.activity *= 0.86;
                group.flowBias *= 0.8;
                group.targetCount *= 0.78;
                if (group.targetCount < 0.5) group.targetCount = 0;
                continue;
            }
            const kind = animalKindForFinancialVolume(quote, group.baseline, group.schoolKind);
            group.schoolKind = kind;
            group.recentLots.push({ at: now, quote, tradeCount, origin, kind });
            group.lastOrigin = origin;
            if (origin === "LIVE") group.lastLiveAt = now;
            group.baseline = group.baseline === 0 ? Math.max(quote, 1) : group.baseline * 0.97 + Math.max(quote, 1) * 0.03;
            group.activity = Math.max(0, Math.min(1, group.activity * 0.92 + normalizeActivity(activeQuote || quote, group.baseline) * 0.08));
            const pressure = computePressure(state.buyQuote, state.sellQuote);
            const pressureStrength = side === "buy" ? pressure.buy ?? 0 : pressure.sell ?? 0;
            const sideDirection = group.side === "buy" ? 1 : -1;
            group.flowBias = sideDirection * (0.003 + pressureStrength * 0.009);
            const windowQuote = group.recentLots.reduce((sum, lot) => sum + lot.quote, 0);
            group.targetCount = visualDensity(windowQuote, group.baseline, pressureStrength, this.quality);
            group.lastActiveAt = now;
        }
    }

    private decayInactiveFish(now: number): void {
        for (const group of this.fishGroups) {
            group.recentLots = group.recentLots.filter(lot => lot.at >= now - this.budget.windowMs);
            if (group.recentLots.length > 0) continue;
            group.activity *= 0.90;
            group.flowBias *= 0.88;
            group.targetCount *= 0.80;
            if (group.targetCount < 0.5) group.targetCount = 0;
        }
        this.rebalancePopulation();
    }

    /** Financial totals expire on the rolling window; in-flight animals finish independently. */
    private expireFinancialWindow(now: number): void {
        let changed = false;
        for (const state of this.symbols.values()) {
            const previousLength = state.recent.length;
            state.recent = state.recent.filter(item => item.at >= now - this.budget.windowMs);
            if (state.recent.length === previousLength) continue;
            state.buyQuote = state.recent.reduce((sum, item) => sum + item.buy, 0);
            state.sellQuote = state.recent.reduce((sum, item) => sum + item.sell, 0);
            state.volume = state.buyQuote + state.sellQuote;
            changed = true;
        }
        if (changed) {
            this.updateHud();
            this.debugSummary(now);
        }
    }

    private rebalancePopulation(): void {
        // Schools leave headroom so aggregated transit animals and large
        // events can still enter when the window is busy; nothing is created
        // just to fill the budget.
        const available = Math.max(0, this.budget.maxVisibleAnimals - SCHOOL_TRANSIT_RESERVE - this.flowActors.length - this.whales.length);
        const groups = [...this.fishGroups].sort((a, b) => b.targetCount - a.targetCount);
        for (const group of groups) group.visibleCount = 0;
        const usedByTerritory: Record<"left" | "right", number> = { left: 0, right: 0 };
        const schoolOccupancyCeiling = this.budget.maxOccupancyPerTerritory * SCHOOL_OCCUPANCY_SHARE;
        let remaining = available;
        for (const group of groups) {
            const desired = Math.min(group.agents.length, this.budget.maxSchoolAnimalsPerGroup, Math.max(0, Math.round(group.targetCount)));
            const occupancyCost = this.estimatedSchoolOccupancy(group);
            const occupancyRoom = Math.max(0, schoolOccupancyCeiling - usedByTerritory[group.territory]);
            const occupancyCount = occupancyCost > 0 ? Math.floor(occupancyRoom / occupancyCost) : desired;
            group.visibleCount = Math.min(desired, remaining, Math.max(0, occupancyCount));
            usedByTerritory[group.territory] += group.visibleCount * occupancyCost;
            remaining -= group.visibleCount;
        }
    }

    /** Occupancy cost in "small-fish units" (sardine ≈ 1), scaled by CSS-pixel body size. */
    private estimatedSchoolOccupancy(group: FishGroup): number {
        const bodyPx = WHALE_OCEAN_SPECIES[group.schoolKind].bodyLengthPx;
        return Math.max(0.8, Math.min(4.4, bodyPx / 50 * 0.7 + 0.35));
    }

    private schoolAnchor(territory: "left" | "right", side: WhaleOceanSide, index: number): { x: number; y: number; z: number } {
        const visible = this.getVisibleHorizontalBounds(0);
        const teamLeft = territory === "left" ? visible.left : visible.center;
        const teamRight = territory === "left" ? visible.center : visible.right;
        const centerX = (teamLeft + teamRight) / 2;
        const centerY = side === "buy" ? 2.15 : -2.15;
        const angle = index * 2.399963;
        const widthScale = Math.max(0.75, Math.min(1.8, Math.abs(teamRight - teamLeft) / 8.3));
        const radius = (0.35 + Math.sqrt(index + 0.5) * 0.72) * widthScale;
        return {
            x: centerX + Math.cos(angle) * radius * 1.25,
            y: centerY + Math.sin(angle) * radius * 0.55,
            z: Math.sin(angle * 0.7) * 0.45
        };
    }

    private frame(): void {
        if (this.paused || this.disposed || !this.scene) return;
        const now = performance.now();
        const elapsed = Math.min(80, now - this.lastFrame || 16);
        this.lastFrame = now;
        this.environment?.update(elapsed / 1_000);
        this.frameAccumulator += elapsed;
        if (this.frameAccumulator < 1_000 / QUALITY_FPS[this.quality]) return;
        this.frameAccumulator = 0;
        const seconds = now / 1_000;
        const wallClockNow = Date.now();
        if (!this.options.diagnostic) {
            this.expireFinancialWindow(wallClockNow);
            this.decayInactiveFish(wallClockNow);
        }
        this.updateBubbles(seconds);
        this.updateFish(seconds, elapsed / 16.67);
        this.updateFlowActors(now);
        this.updateWhales(now);
        this.updateGeometryDebugOverlay();
        this.promotePendingEvents();
        this.trySpawnPendingFlows(wallClockNow);
        this.refreshDiagnostics(wallClockNow);
        this.debugNoEventWarning(wallClockNow);
        this.debugSizeWarnings(wallClockNow);
    }

    private updateFish(seconds: number, factor: number): void {
        this.rebalancePopulation();
        const activeAgents: Array<{ agent: FishAgent; group: FishGroup; index: number }> = [];
        // The two-large-animals-per-territory cap covers schools, transits and
        // events together, so big bodies never stack in one territory.
        const largeByTerritory: Record<"left" | "right", number> = {
            left: this.transientLargeCount("left"),
            right: this.transientLargeCount("right")
        };
        for (const group of this.fishGroups) {
            const activeCount = Math.min(group.agents.length, Math.max(0, group.visibleCount));
            const allocations = this.allocateSchoolVolume(group, activeCount);
            for (let index = 0; index < activeCount; index++) {
                const agent = group.agents[index];
                const allocation = allocations[index] ?? { kind: group.schoolKind, notionalUsdt: 0 };
                let visualKind = allocation.kind;
                if (isLargeAnimalKind(visualKind)) {
                    if (largeByTerritory[group.territory] >= this.budget.maxLargeHighlightsPerTerritory)
                        visualKind = visualKind === "swordfish" ? "barracuda" : "grouper";
                    else largeByTerritory[group.territory]++;
                }
                this.assignAgentSpecies(agent, visualKind, group.territory, group.symbol, group.side, allocation.notionalUsdt);
                activeAgents.push({ agent, group, index });
            }
            for (let index = activeCount; index < group.agents.length; index++) {
                const inactive = group.agents[index];
                inactive.sprite.isVisible = false;
                this.removeLabel(inactive.label);
                inactive.label = null;
                inactive.labelText = "";
            }
        }

        const grid = new Map<string, Array<{ agent: FishAgent; group: FishGroup }>>();
        for (const item of activeAgents) {
            const { agent } = item;
            const key = `${Math.floor(agent.position.x / 2.1)}:${Math.floor(agent.position.y / 1.8)}:${Math.floor(agent.position.z / 2.2)}`;
            const cell = grid.get(key);
            if (cell) cell.push(item); else grid.set(key, [item]);
        }
        for (const { agent, group, index } of activeAgents) {
            const sprite = agent.sprite;
            let separationX = 0;
            let separationY = 0;
            let separationZ = 0;
            let alignmentX = 0;
            let alignmentY = 0;
            let alignmentZ = 0;
            let neighbors = 0;
            const cellX = Math.floor(agent.position.x / 2.1);
            const cellY = Math.floor(agent.position.y / 1.8);
            const cellZ = Math.floor(agent.position.z / 2.2);
            for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
                const nearby = grid.get(`${cellX + dx}:${cellY + dy}:${cellZ + dz}`);
                if (!nearby) continue;
                for (const otherItem of nearby) {
                    const other = otherItem.agent;
                    if (other === agent) continue;
                    const deltaX = other.position.x - agent.position.x;
                    const deltaY = other.position.y - agent.position.y;
                    const deltaZ = other.position.z - agent.position.z;
                    const distance = Math.hypot(deltaX, deltaY, deltaZ);
                    const minimumDistance = (this.spriteWidthFor(agent.kind, group.territory) + this.spriteWidthFor(other.kind, otherItem.group.territory)) * 0.24 + 0.32;
                    if (distance <= 0 || distance > Math.max(3.5, minimumDistance * 1.6)) continue;
                    neighbors++;
                    const inverseDistance = 1 / distance;
                    const separation = Math.max(0, minimumDistance - distance) * inverseDistance;
                    separationX -= deltaX * (inverseDistance + separation * 2.2);
                    separationY -= deltaY * (inverseDistance + separation * 2.2);
                    separationZ -= deltaZ * (inverseDistance + separation * 2.2);
                    alignmentX += other.velocity.x;
                    alignmentY += other.velocity.y;
                    alignmentZ += other.velocity.z;
                }
            }
            if (neighbors > 0) {
                const reciprocal = 1 / neighbors;
                alignmentX = alignmentX * reciprocal - agent.velocity.x;
                alignmentY = alignmentY * reciprocal - agent.velocity.y;
                alignmentZ = alignmentZ * reciprocal - agent.velocity.z;
            }
            const anchor = this.schoolAnchor(group.territory, group.side, index);
            const wave = Math.sin(seconds * 0.7 + agent.phase) * 0.003;
            agent.velocity.x += (separationX * 0.0009 + alignmentX * 0.012 + (anchor.x - agent.position.x) * 0.0009 + group.flowBias + Math.sin(seconds * 0.3 + agent.phase) * 0.0005) * factor;
            agent.velocity.y += (separationY * 0.0009 + alignmentY * 0.012 + (anchor.y - agent.position.y) * 0.0012 + wave) * factor;
            agent.velocity.z += (separationZ * 0.0006 + alignmentZ * 0.01 + (anchor.z - agent.position.z) * 0.001) * factor;
            const speed = Math.max(0.006, Math.min(0.055, agent.velocity.length()));
            agent.velocity.scaleInPlace(0.996);
            agent.velocity.normalize().scaleInPlace(speed);
            const horizontalSign = group.side === "buy" ? 1 : -1;
            agent.velocity.x = horizontalSign * Math.max(0.01, Math.abs(agent.velocity.x));
            agent.position.x += agent.velocity.x * factor;
            agent.position.y += agent.velocity.y * factor;
            agent.position.z += agent.velocity.z * factor;
            const size = this.spriteWidthFor(agent.kind, group.territory) * (1 + group.activity * 0.12 + agent.seed * 0.05);
            const edgePadding = this.visibleBodyHalfWidth(agent.kind, group.territory, size);
            const teamBounds = this.getTeamHorizontalBounds(group.territory, agent.position.z, edgePadding);
            const minX = teamBounds.minX;
            const maxX = teamBounds.maxX;
            if (group.side === "buy" && agent.position.x > maxX) agent.position.x = minX;
            if (group.side === "sell" && agent.position.x < minX) agent.position.x = maxX;
            if (group.side === "buy" && agent.position.x < minX) agent.position.x = minX;
            if (group.side === "sell" && agent.position.x > maxX) agent.position.x = maxX;
            if (agent.position.y < -4.15 + edgePadding * 0.35) { agent.position.y = -4.15 + edgePadding * 0.35; agent.velocity.y = Math.abs(agent.velocity.y); }
            if (agent.position.y > 4.15 - edgePadding * 0.35) { agent.position.y = 4.15 - edgePadding * 0.35; agent.velocity.y = -Math.abs(agent.velocity.y); }
            if (agent.position.z < -2.1) { agent.position.z = -2.1; agent.velocity.z = Math.abs(agent.velocity.z); }
            if (agent.position.z > 2.1) { agent.position.z = 2.1; agent.velocity.z = -Math.abs(agent.velocity.z); }
            sprite.position.x = agent.position.x;
            sprite.position.y = agent.position.y;
            sprite.position.z = agent.position.z;
            sprite.invertU = horizontalSign < 0;
            sprite.width = size;
            sprite.height = size * 0.5;
            const exitDistance = group.side === "buy" ? maxX - agent.position.x : agent.position.x - minX;
            const entryDistance = group.side === "buy" ? agent.position.x - minX : maxX - agent.position.x;
            const fadeDistance = Math.max(1.15, size * 1.2);
            const edgeFade = Math.min(1, Math.max(0, exitDistance / fadeDistance), Math.max(0, entryDistance / fadeDistance));
            sprite.color.a = Math.min(1, 0.74 + group.activity * 0.26) * Math.max(0.18, edgeFade);
            sprite.isVisible = true;
            const currency = this.symbols.get(group.symbol)?.quoteCurrency ?? quoteCurrencyForSymbol(group.symbol);
            const labelText = `${group.side === "buy" ? `${this.text("buy", "BUY")} →` : `${this.text("sell", "SELL")} ←`} ${formatCompactVolume(agent.allocatedNotional)} ${currency ?? "QUOTE"}`;
            this.ensureFishLabel(agent, labelText, group.side === "buy" ? "#36e7b0" : "#ff6b55");
            if (agent.label) {
                const below = index % 2 !== 0;
                const labelOffset = below ? -size * 0.42 : size * 0.42;
                this.placeScreenLabel(agent.label, agent.position.x, agent.position.y + labelOffset, agent.position.z, sprite.color.a, below);
            }
        }
    }

    private getVisibleHorizontalBounds(depth: number): VisibleHorizontalBounds {
        const B = this.B;
        const engine = this.engine;
        const camera = this.camera;
        const scene = this.scene;
        const fallback = (): VisibleHorizontalBounds => {
            if (!camera || !this.canvas.clientWidth || !this.canvas.clientHeight)
                return { left: 0, center: 0, right: 0 };
            const aspect = this.canvas.clientWidth / this.canvas.clientHeight;
            const distance = Math.max(1, Math.abs(depth - camera.globalPosition.z));
            const halfWidth = distance * Math.tan((camera.fov || CAMERA_FOV) / 2) * aspect;
            const center = camera.target.x;
            return { left: center - halfWidth, center, right: center + halfWidth };
        };
        if (!B || !engine || !camera || !scene) return fallback();

        const renderWidth = engine.getRenderWidth();
        const renderHeight = engine.getRenderHeight();
        const clientWidth = this.canvas.clientWidth;
        const clientHeight = this.canvas.clientHeight;
        if (renderWidth <= 0 || renderHeight <= 0 || clientWidth <= 0 || clientHeight <= 0) return fallback();

        // Babylon consumes render pixels. The divider and the canvas layout use
        // CSS pixels, so convert both through the same viewport dimensions.
        const rayXAtDepth = (screenCssX: number): number | null => {
            const screenX = cssPixelToRenderPixel(screenCssX, clientWidth, renderWidth);
            const screenY = cssPixelToRenderPixel(clientHeight / 2, clientHeight, renderHeight);
            const ray = scene.createPickingRay(screenX, screenY, B.Matrix.Identity(), camera, false);
            if (Math.abs(ray.direction.z) < 0.0001) return null;
            const distance = (depth - ray.origin.z) / ray.direction.z;
            if (!Number.isFinite(distance) || distance < 0) return null;
            const x = ray.origin.x + ray.direction.x * distance;
            return Number.isFinite(x) ? x : null;
        };

        const left = rayXAtDepth(0);
        const center = rayXAtDepth(clientWidth / 2);
        const right = rayXAtDepth(clientWidth);
        if (left !== null && center !== null && right !== null && left < center && center < right)
            return { left, center, right };
        return fallback();
    }

    private getTeamHorizontalBounds(territory: "left" | "right", depth: number, padding: number): TeamHorizontalBounds {
        const visible = this.getVisibleHorizontalBounds(depth);
        return calculateTeamHorizontalBounds(visible, territory, padding);
    }

    private getTransitPath(territory: "left" | "right", side: WhaleOceanSide, depth: number, outerPadding: number, spritePadding: number): TransitPath {
        const visible = this.getVisibleHorizontalBounds(depth);
        return calculateTransitPath(visible, territory, side, outerPadding, spritePadding);
    }

    private flowOuterPadding(actor: FlowActor): number {
        return this.spriteHalfWidth(actor.size);
    }

    private resizeArena(): void {
        if (this.disposed) return;
        const now = performance.now();
        for (const group of this.fishGroups) {
            for (const agent of group.agents) {
                const size = agent.sprite.width || this.spriteWidthFor(agent.kind, group.territory);
                const padding = this.visibleBodyHalfWidth(agent.kind, group.territory, size);
                const bounds = this.getTeamHorizontalBounds(group.territory, agent.position.z, padding);
                agent.position.x = Math.max(bounds.minX, Math.min(bounds.maxX, agent.position.x));
                agent.sprite.position.x = agent.position.x;
            }
        }
        for (const actor of this.flowActors) {
            const progress = Math.max(0, Math.min(1, (now - actor.startedAt) / actor.duration));
            const bodyHalfWidth = this.visibleBodyHalfWidth(actor.kind, actor.territory, actor.size);
            const path = this.getTransitPath(actor.territory, actor.side, actor.sprite.position.z, this.flowOuterPadding(actor), bodyHalfWidth);
            actor.fromX = path.fromX;
            actor.toX = path.toX;
            const eased = progress * progress * (3 - 2 * progress);
            actor.sprite.position.x = actor.fromX + (actor.toX - actor.fromX) * eased;
        }
        for (const event of this.whales) {
            const progress = Math.max(0, Math.min(1, (now - event.startedAt) / event.duration));
            const bodyHalfWidth = this.visibleBodyHalfWidth(event.kind, event.territory, event.size);
            const path = this.getTransitPath(event.territory, event.side, event.sprite.position.z, this.spriteHalfWidth(event.size), bodyHalfWidth);
            event.fromX = path.fromX;
            event.toX = path.toX;
            event.sprite.position.x = event.fromX + (event.toX - event.fromX) * progress;
        }
        this.debugArenaResize();
    }

    private debugArenaResize(): void {
        if (this.options.debugWhaleOcean === false || !this.engine) return;
        const width = this.engine.getRenderWidth();
        const height = this.engine.getRenderHeight();
        const visible = this.getVisibleHorizontalBounds(0);
        const geometry = this.geometryDiagnostics();
        console.groupCollapsed("[WhaleOcean][RESIZE] arena recalculated");
        console.table([{
            viewportCssWidth: geometry.viewportCss.width,
            viewportCssHeight: geometry.viewportCss.height,
            renderWidth: width,
            renderHeight: height,
            aspectRatio: Number((width / Math.max(1, height)).toFixed(3)),
            cameraCenterWorldX: geometry.cameraCenterWorldX,
            leftEdge: Number(visible.left.toFixed(3)),
            center: Number(visible.center.toFixed(3)),
            rightEdge: Number(visible.right.toFixed(3))
        }]);
        console.table([
            { territory: "left", worldMin: geometry.territories.left.world.minX, worldMax: geometry.territories.left.world.maxX, screenMinPx: geometry.territories.left.screen.minX, screenMaxPx: geometry.territories.left.screen.maxX },
            { territory: "right", worldMin: geometry.territories.right.world.minX, worldMax: geometry.territories.right.world.maxX, screenMinPx: geometry.territories.right.screen.minX, screenMaxPx: geometry.territories.right.screen.maxX }
        ]);
        console.table(([
            ["left", "left", "buy"],
            ["left", "left", "sell"],
            ["right", "right", "buy"],
            ["right", "right", "sell"]
        ] as const).map(([symbol, territory, side]) => {
            const path = this.getTransitPath(territory, side, 0, 0, 0);
            return {
                symbol,
                territory,
                side,
                spawnWorldX: Number(path.fromX.toFixed(3)),
                despawnWorldX: Number(path.toX.toFixed(3)),
                spawnScreenPx: this.projectToCss(path.fromX, 0, 0)?.x ?? null,
                despawnScreenPx: this.projectToCss(path.toX, 0, 0)?.x ?? null,
                direction: side === "buy" ? "right" : "left"
            };
        }));
        console.groupEnd();
    }

    private debugArenaPath(action: "spawn" | "despawn", symbol: string, territory: "left" | "right", side: WhaleOceanSide, depth: number, path: TransitPath): void {
        if (this.options.debugWhaleOcean === false) return;
        console.info(`[WhaleOcean][ARENA] ${action}`, {
            symbol,
            territory,
            side,
            direction: side === "buy" ? "right" : "left",
            depth: Number(depth.toFixed(3)),
            spawnX: Number(path.fromX.toFixed(3)),
            despawnX: Number(path.toX.toFixed(3)),
            spawnScreenPx: this.projectToCss(path.fromX, 0, depth)?.x ?? null,
            despawnScreenPx: this.projectToCss(path.toX, 0, depth)?.x ?? null
        });
    }

    /** Distributes each 30-second aggregate exactly once among visible school fish. */
    private allocateSchoolVolume(group: FishGroup, count: number): Array<{ kind: WhaleOceanFlowAnimalKind; notionalUsdt: number }> {
        if (count <= 0) return [];
        const volumeByKind = new Map<WhaleOceanFlowAnimalKind, number>();
        for (const lot of group.recentLots) volumeByKind.set(lot.kind, (volumeByKind.get(lot.kind) ?? 0) + lot.quote);
        const total = [...volumeByKind.values()].reduce((sum, value) => sum + value, 0);
        if (total <= 0) return Array.from({ length: count }, () => ({ kind: group.schoolKind, notionalUsdt: 0 }));

        const provisional = [...volumeByKind.entries()].map(([kind, volume]) => {
            const exact = count * volume / total;
            return { kind, volume, count: Math.floor(exact), remainder: exact - Math.floor(exact) };
        });
        let assigned = provisional.reduce((sum, item) => sum + item.count, 0);
        for (const item of [...provisional].sort((a, b) => b.remainder - a.remainder || b.volume - a.volume)) {
            if (assigned >= count) break;
            item.count++;
            assigned++;
        }
        const represented = provisional.filter(item => item.count > 0);
        for (const item of provisional) {
            if (item.count > 0) continue;
            const recipient = represented.reduce((closest, candidate) =>
                Math.abs(WHALE_OCEAN_SPECIES[candidate.kind].financialLevel - WHALE_OCEAN_SPECIES[item.kind].financialLevel)
                    < Math.abs(WHALE_OCEAN_SPECIES[closest.kind].financialLevel - WHALE_OCEAN_SPECIES[item.kind].financialLevel)
                    ? candidate
                    : closest);
            recipient.volume += item.volume;
        }
        const allocations: Array<{ kind: WhaleOceanFlowAnimalKind; notionalUsdt: number }> = [];
        for (const item of represented) {
            if (item.count <= 0) continue;
            const perFish = item.volume / item.count;
            for (let index = 0; index < item.count; index++) allocations.push({ kind: item.kind, notionalUsdt: perFish });
        }
        return allocations;
    }

    private assignAgentSpecies(agent: FishAgent, kind: WhaleOceanFlowAnimalKind, territory: "left" | "right", symbol: string, side: WhaleOceanSide, notionalUsdt: number): void {
        const previousKind = agent.kind;
        const previousNotional = agent.allocatedNotional;
        if (agent.kind !== kind) {
            agent.sprite.dispose();
            agent.sprite = this.createAnimatedSprite(kind, territory, `whale-ocean-fish-${territory}-${side}-${kind}-${this.random()}`, agent.seed);
            agent.kind = kind;
        }
        agent.allocatedNotional = notionalUsdt;
        (agent.sprite as Sprite & { metadata?: Record<string, unknown> }).metadata = {
            symbol,
            side,
            notionalUsdt,
            kind,
            source: "money_flow_aggregate_allocation"
        };
        void previousKind;
        void previousNotional;
    }

    private text(key: string, fallback: string): string {
        return this.labels[key] ?? fallback;
    }

    public setLabels(labels: Record<string, string>): void {
        this.labels = { ...labels };
    }

    private ensureFishLabel(agent: FishAgent, text: string, color: string): void {
        if (agent.label && agent.labelText === text) return;
        this.removeLabel(agent.label);
        agent.label = this.createVolumeLabel(text, color);
        agent.labelText = text;
    }

    private debugInit(): void {
        if (this.options.debugWhaleOcean === false) return;
        console.groupCollapsed("[WhaleOcean][INIT]");
        console.info("Whale Ocean diagnostics enabled.");
        console.table([{
            bundleVersion: SPRITE_ASSET_VERSION,
            leftSymbol: this.options.leftSymbol,
            rightSymbol: this.options.rightSymbol,
            connectionState: this.connected ? "connected" : "bootstrap_pending",
            diagnosticsEnabled: true,
            maxVisibleAnimals: this.budget.maxVisibleAnimals,
            maxLargePerTerritory: this.budget.maxLargeHighlightsPerTerritory,
            maxOccupancyPerTerritory: this.budget.maxOccupancyPerTerritory,
            windowMs: this.budget.windowMs
        }]);
        console.groupEnd();
    }

    private debugReceive(batch: WhaleOceanBatch): void {
        if (this.options.debugWhaleOcean === false) return;
        const symbol = batch.symbol.trim().toUpperCase();
        const territory = symbol === this.options.leftSymbol ? "left" : symbol === this.options.rightSymbol ? "right" : null;
        const quoteCurrency = quoteCurrencyForSymbol(symbol);
        console.groupCollapsed(`[WhaleOcean][RECEIVE] money_flow_batch ${symbol || "(sem símbolo)"}`);
        console.table([{
            receivedAtUtc: new Date().toISOString(),
            eventType: "money_flow_batch",
            symbol: symbol || null,
            territory,
            batchId: null,
            sequence: batch.sequence,
            originalTimestamp: batch.eventTimeUtc || null,
            buyQuote: batch.takerBuyQuote,
            sellQuote: batch.takerSellQuote,
            quoteCurrency,
            quoteCurrencySource: quoteCurrency ? "symbol_suffix" : "unavailable",
            isPartial: batch.isPartial,
            isReplay: batch.isReplay ?? false,
            missingContractFields: ["batchId", "quoteCurrency"]
        }]);
        console.info("payload", this.safeDebugPayload(batch));
        console.groupEnd();
    }

    private debugFilter(batch: WhaleOceanBatch, reason: string): void {
        if (this.options.debugWhaleOcean === false) return;
        const symbol = batch.symbol.trim().toUpperCase();
        console.groupCollapsed(`[WhaleOcean][FILTER] ${reason} ${symbol}`);
        if (reason !== "accepted") console.warn(`Money-flow batch ${reason}.`);
        else console.info("Money-flow batch accepted.");
        console.table([{
            symbol,
            sequence: batch.sequence,
            reason,
            partial: batch.isPartial,
            replay: batch.isReplay ?? false,
            buyQuote: batch.takerBuyQuote,
            sellQuote: batch.takerSellQuote
        }]);
        console.groupEnd();
    }

    /** Live per-animal visual diagnostics: spawn table, size warnings and tests. */
    public visualDiagnostics(): WhaleOceanVisualDiagnosticRow[] {
        const rows: WhaleOceanVisualDiagnosticRow[] = [];
        for (const group of this.fishGroups) {
            for (const agent of group.agents) {
                if (!agent.sprite.isVisible) continue;
                rows.push(this.buildDiagnosticRow(agent.debugId, group.symbol, agent.kind, group.territory, agent.sprite, agent.label, agent.labelText));
            }
        }
        for (const actor of this.flowActors)
            rows.push(this.buildDiagnosticRow(actor.id, actor.territory === "left" ? this.options.leftSymbol : this.options.rightSymbol, actor.kind, actor.territory, actor.sprite, actor.label, actor.labelText));
        for (const event of this.whales)
            rows.push(this.buildDiagnosticRow(event.eventId, event.territory === "left" ? this.options.leftSymbol : this.options.rightSymbol, event.kind, event.territory, event.sprite, event.label, event.labelText));
        return rows;
    }

    /** Uses the same frustum and territory calculations as the renderer. */
    public geometryDiagnostics(): WhaleOceanGeometryDiagnostic {
        const width = this.canvas.clientWidth;
        const height = this.canvas.clientHeight;
        const visible = this.getVisibleHorizontalBounds(0);
        const left = this.getTeamHorizontalBounds("left", 0, 0);
        const right = this.getTeamHorizontalBounds("right", 0, 0);
        const screenX = (worldX: number): number | null => this.projectToCss(worldX, 0, 0)?.x ?? null;
        return {
            viewportCss: { width, height },
            renderViewport: { width: this.engine?.getRenderWidth() ?? 0, height: this.engine?.getRenderHeight() ?? 0 },
            cameraCenterWorldX: round2(this.camera?.target.x ?? visible.center),
            visibleWorld: { left: round2(visible.left), center: round2(visible.center), right: round2(visible.right) },
            territories: {
                left: { world: { minX: round2(left.minX), maxX: round2(left.maxX) }, screen: { minX: 0, maxX: round2(width / 2) } },
                right: { world: { minX: round2(right.minX), maxX: round2(right.maxX) }, screen: { minX: round2(width / 2), maxX: round2(width) } }
            },
            animals: this.visualDiagnostics().map(row => ({
                id: row.id,
                territory: this.options.leftSymbol === row.symbol ? "left" : "right",
                worldX: row.worldPositionX,
                screenX: screenX(row.worldPositionX)
            }))
        };
    }

    private buildDiagnosticRow(id: string, symbol: string, kind: SpriteKind, territory: "left" | "right", sprite: Sprite, label: HTMLElement | null, labelText: string): WhaleOceanVisualDiagnosticRow {
        const atlas = this.spriteAtlases.get(`${kind}:${territory}`);
        const bodyWidthWorld = sprite.width * (atlas?.visualWidthRatio ?? 1);
        const bodyHeightWorld = sprite.height * (atlas?.visualHeightRatio ?? 0.5);
        const cssPerWorldAtDepth = this.cssPixelsPerWorldUnit() * CAMERA_RADIUS / Math.max(0.1, CAMERA_RADIUS + sprite.position.z);
        const cameraPosition = this.camera?.position;
        const cameraDistance = cameraPosition
            ? Math.hypot(sprite.position.x - cameraPosition.x, sprite.position.y - cameraPosition.y, sprite.position.z - cameraPosition.z)
            : CAMERA_RADIUS;
        const projected = this.projectToCss(sprite.position.x, sprite.position.y, sprite.position.z);
        const band = WHALE_OCEAN_SIZE_CATEGORIES[sizeCategoryForKind(kind)];
        return {
            id,
            symbol,
            kind,
            category: sizeCategoryForKind(kind),
            finalScaleWidth: round2(sprite.width),
            finalScaleHeight: round2(sprite.height),
            worldPositionX: round2(sprite.position.x),
            worldPositionY: round2(sprite.position.y),
            worldPositionZ: round2(sprite.position.z),
            cameraDistance: round2(cameraDistance),
            projectedBodyCssWidth: round2(bodyWidthWorld * cssPerWorldAtDepth),
            projectedBodyCssHeight: round2(bodyHeightWorld * cssPerWorldAtDepth),
            opacity: round2(sprite.color.a),
            visible: sprite.isVisible && sprite.color.a > 0.01,
            inViewport: projected !== null,
            minBodyCssWidth: band.minPx,
            maxBodyCssWidth: band.maxPx,
            labelState: !label ? "none" : projected && sprite.color.a >= 0.05 ? "visible" : "hidden",
            labelCssX: projected ? round2(projected.x) : -1,
            labelCssY: projected ? round2(projected.y) : -1,
            labelText
        };
    }

    private projectToCss(worldX: number, worldY: number, worldZ: number): { x: number; y: number } | null {
        const B = this.B;
        const engine = this.engine;
        const camera = this.camera;
        const scene = this.scene;
        if (!B || !engine || !camera || !scene) return null;
        const renderWidth = engine.getRenderWidth();
        const renderHeight = engine.getRenderHeight();
        const clientWidth = this.canvas.clientWidth;
        const clientHeight = this.canvas.clientHeight;
        if (renderWidth <= 0 || renderHeight <= 0 || clientWidth <= 0 || clientHeight <= 0) return null;
        const projected = B.Vector3.Project(
            new B.Vector3(worldX, worldY, worldZ),
            B.Matrix.Identity(),
            scene.getTransformMatrix(),
            camera.viewport.toGlobal(renderWidth, renderHeight)
        );
        if (!(projected.z > 0 && projected.z < 1)) return null;
        const cssX = projected.x * (clientWidth / renderWidth);
        const cssY = projected.y * (clientHeight / renderHeight);
        if (cssX < -120 || cssX > clientWidth + 120 || cssY < -60 || cssY > clientHeight + 60) return null;
        return { x: cssX, y: cssY };
    }

    /** Warns (rate-limited, once per animal) when a visible animal renders below its category minimum. */
    private debugSizeWarnings(now: number): void {
        if (this.options.debugWhaleOcean === false || now - this.lastSizeWarningAt < MINIMUM_SIZE_WARNING_INTERVAL_MS) return;
        this.lastSizeWarningAt = now;
        const fresh = this.visualDiagnostics().filter(row =>
            row.visible && row.inViewport && row.opacity >= 0.6
            && row.projectedBodyCssWidth > 0 && row.projectedBodyCssWidth < row.minBodyCssWidth
            && !this.undersizedWarnedIds.has(row.id));
        if (fresh.length === 0) return;
        for (const row of fresh) this.undersizedWarnedIds.add(row.id);
        console.warn("[WhaleOcean][WARN] animal abaixo do tamanho mínimo esperado", fresh);
    }

    private debugSpawn(action: "created" | "aggregated", pending: PendingFlow, animalId: string | null, kind?: WhaleOceanAnimalKind, source = "money_flow_batch"): void {
        if (this.options.debugWhaleOcean === false) return;
        console.groupCollapsed(`[WhaleOcean][SPAWN] ${action}`);
        console.info(action === "created" ? "Transit animal created." : "Pending compatible flow aggregated.");
        console.table([{
            animalId,
            symbol: pending.symbol,
            territory: this.options.leftSymbol === pending.symbol ? "left" : "right",
            side: pending.side,
            direction: swimDirectionForSide(pending.side),
            volume: pending.totalNotional,
            category: kind ?? visualProfile(pending.peakNotional, pending.baseline).kind,
            batchCount: pending.batchCount,
            source
        }]);
        if (animalId) {
            const rows = this.visualDiagnostics().filter(row => row.id === animalId);
            if (rows.length > 0) {
                console.info("Criação · escala, projeção e rótulo:");
                console.table(rows);
            }
        }
        console.groupEnd();
    }

    private debugExit(data: Record<string, unknown>): void {
        if (this.options.debugWhaleOcean === false) return;
        console.groupCollapsed("[WhaleOcean][EXIT] transit completed");
        console.info("Animal and label left the territory before disposal.");
        console.table([data]);
        console.groupEnd();
    }

    private debugSummary(now: number): void {
        if (this.options.debugWhaleOcean === false || now - this.lastDebugSummaryAt < 5_000) return;
        this.lastDebugSummaryAt = now;
        const groups = ([this.options.leftSymbol, this.options.rightSymbol] as const).flatMap(symbol => {
            const state = this.symbols.get(symbol);
            return (["buy", "sell"] as const).map(side => ({
                symbol,
                territory: symbol === this.options.leftSymbol ? "left" : "right",
                side,
                visible: this.flowActors.filter(actor => actor.territory === (symbol === this.options.leftSymbol ? "left" : "right") && actor.side === side).length,
                windowVolume: side === "buy" ? state?.buyQuote ?? 0 : state?.sellQuote ?? 0,
                visuallyInTransit: this.flowActors.filter(actor => actor.territory === (symbol === this.options.leftSymbol ? "left" : "right") && actor.side === side).reduce((sum, actor) => sum + actor.notional, 0)
            }));
        });
        const financial = [...this.symbols.entries()].map(([symbol, state]) => ({
            symbol,
            quoteCurrency: state.quoteCurrency,
            buy: state.buyQuote,
            sell: state.sellQuote,
            windowTotal: state.volume
        }));
        const visible = this.flowActors.length + this.whales.length;
        const represented = this.flowActors.reduce((sum, actor) => sum + actor.notional, 0)
            + this.whales.reduce((sum, event) => sum + event.notional, 0);
        const financialTotal = financial.reduce((sum, state) => sum + state.windowTotal, 0);
        console.groupCollapsed("[WhaleOcean][SUMMARY] janela móvel e orçamento visual");
        console.table(groups);
        console.table([{
            visibleAnimals: visible,
            maxVisibleAnimals: this.budget.maxVisibleAnimals,
            occupancyLeft: this.territoryOccupancy("left"),
            occupancyRight: this.territoryOccupancy("right"),
            maxOccupancyPerTerritory: this.budget.maxOccupancyPerTerritory,
            financialWindowTotal: financialTotal,
            visuallyInTransit: represented,
            financialMinusVisualTransit: financialTotal - represented,
            pendingEvents: this.pendingEvents.length,
            pendingFlows: this.pendingFlows.size
        }]);
        console.table(financial);
        console.info("Visão visual por animal:");
        console.table(this.visualDiagnostics());
        console.groupEnd();
    }

    private territoryOccupancy(territory: "left" | "right"): number {
        const schools = this.fishGroups
            .filter(group => group.territory === territory)
            .reduce((sum, group) => sum + group.visibleCount * this.estimatedSchoolOccupancy(group), 0);
        const transient = this.flowActors.filter(actor => actor.territory === territory)
            .reduce((sum, actor) => sum + Math.max(1.2, WHALE_OCEAN_SPECIES[actor.kind].bodyLengthPx / 50 * 0.62 + actor.labelWidthPx / 50 * 0.36 + actor.labelHeightPx / 50), 0);
        const highlights = this.whales.filter(event => event.territory === territory)
            .reduce((sum, event) => sum + Math.max(1, WHALE_OCEAN_SPECIES[event.kind].bodyLengthPx / 50 * 0.7), 0);
        return Number((schools + transient + highlights).toFixed(2));
    }

    private debugNoEventWarning(now: number): void {
        if (this.options.debugWhaleOcean === false || now - this.lastNoEventWarningAt < 30_000) return;
        const sinceLastReceive = this.lastReceiveAt === 0 ? null : now - this.lastReceiveAt;
        if (sinceLastReceive !== null && sinceLastReceive < 30_000) return;
        this.lastNoEventWarningAt = now;
        console.warn("[WhaleOcean][SUMMARY] No money_flow_batch received yet or during the last 30s.", {
            connectionState: this.connected ? "connected" : "disconnected",
            lastReceiveAtUtc: this.lastReceiveAt === 0 ? null : new Date(this.lastReceiveAt).toISOString(),
            millisecondsSinceLastReceive: sinceLastReceive
        });
    }

    private safeDebugPayload(batch: WhaleOceanBatch): Record<string, unknown> {
        return {
            matchId: batch.matchId,
            symbol: batch.symbol,
            sequence: batch.sequence,
            eventTimeUtc: batch.eventTimeUtc,
            tradeCount: batch.tradeCount,
            takerBuyQuote: batch.takerBuyQuote,
            takerSellQuote: batch.takerSellQuote,
            lastPrice: batch.lastPrice,
            isPartial: batch.isPartial,
            isReplay: batch.isReplay ?? false
        };
    }

    private refreshDiagnostics(now: number, force = false): void {
        if (!this.options.developmentDiagnostics || (!force && now - this.lastDiagnosticsAt < 500)) return;
        const panel = this.root?.querySelector<HTMLElement>('[data-whale-ocean="flow-diagnostics"]');
        if (!panel) return;
        this.lastDiagnosticsAt = now;

        const heading = document.createElement("strong");
        heading.textContent = `DEV · MONEY FLOW (janela móvel de ${Math.round(this.budget.windowMs / 1_000)} s)`;
        const note = document.createElement("small");
        note.textContent = `Recebido pelo cliente; teto ${this.budget.maxVisibleAnimals} animais · sem DEMO.`;
        const rows = this.fishGroups.map(group => {
            group.recentLots = group.recentLots.filter(lot => lot.at >= now - this.budget.windowMs);
            const liveLots = group.recentLots.filter(lot => lot.origin === "LIVE");
            const replayLots = group.recentLots.filter(lot => lot.origin === "REPLAY");
            const volume = group.recentLots.reduce((sum, lot) => sum + lot.quote, 0);
            const tradeCount = group.recentLots.reduce((sum, lot) => sum + lot.tradeCount, 0);
            const row = document.createElement("div");
            row.className = "whale-ocean__diagnostic-row";
            row.dataset.origin = group.lastOrigin ?? "IDLE";

            const symbol = document.createElement("span");
            symbol.textContent = `${group.territory === "left" ? "A" : "B"} · ${group.symbol} · ${group.side.toUpperCase()}`;
            const received = document.createElement("span");
            received.textContent = `${Math.round(this.budget.windowMs / 1_000)}s ${formatCompactVolume(volume)} · lotes L${liveLots.length}/R${replayLots.length} · trades ${tradeCount}`;
            const population = document.createElement("span");
            population.textContent = `alvo ${Math.round(group.targetCount)} · visíveis ${group.visibleCount}`;
            const latest = document.createElement("span");
            latest.textContent = `LIVE ${group.lastLiveAt ? new Date(group.lastLiveAt).toLocaleTimeString("pt-BR", { hour12: false }) : "—"}`;
            const source = document.createElement("b");
            source.textContent = `${group.lastOrigin ?? "—"} · DEMO OFF`;
            row.append(symbol, received, population, latest, source);
            return row;
        });
        panel.replaceChildren(heading, note, ...rows);
    }

    private updateBubbles(seconds: number): void {
        for (const bubble of this.bubbles) {
            bubble.mesh.position.y += bubble.speed * 16;
            bubble.mesh.position.x = bubble.baseX + Math.sin(seconds * 0.6 + bubble.phase) * 0.35;
            if (bubble.mesh.position.y > 5.5) bubble.mesh.position.y = -5.5;
        }
    }

    private enqueueFlow(symbol: string, side: WhaleOceanSide, notional: number, baseline: number, now: number): void {
        if (notional <= 0 || !Number.isFinite(notional)) return;
        const key = `${symbol}:${side}`;
        const pending = this.pendingFlows.get(key);
        if (pending) {
            pending.totalNotional += notional;
            pending.peakNotional = Math.max(pending.peakNotional, notional);
            pending.baseline = Math.max(pending.baseline, baseline, 1);
            pending.lastReceivedAt = now;
            pending.batchCount++;
            this.debugSpawn("aggregated", pending, null);
            return;
        }
        this.pendingFlows.set(key, { symbol, side, totalNotional: notional, peakNotional: notional, baseline: Math.max(baseline, 1), firstReceivedAt: now, lastReceivedAt: now, batchCount: 1 });
    }

    private trySpawnPendingFlows(now: number): void {
        for (const [key, pending] of this.pendingFlows) {
            if (pending.lastReceivedAt < now - this.budget.windowMs) {
                this.pendingFlows.delete(key);
                this.debugFilter({ matchId: this.options.matchId, symbol: pending.symbol, sequence: Number.NaN, eventTimeUtc: new Date(pending.lastReceivedAt).toISOString(), tradeCount: pending.batchCount, takerBuyQuote: pending.side === "buy" ? String(pending.totalNotional) : "0", takerSellQuote: pending.side === "sell" ? String(pending.totalNotional) : "0", lastPrice: "0", isPartial: false }, "pending_flow_expired");
                continue;
            }
            if (!this.canSpawnTransit(pending)) continue;
            this.pendingFlows.delete(key);
            this.spawnFlowActor(pending, now);
        }
    }

    private canSpawnTransit(pending: PendingFlow): boolean {
        const territory = this.options.leftSymbol === pending.symbol ? "left" : "right";
        const profile = visualProfile(pending.peakNotional, pending.baseline);
        const kind = profile.kind;
        if (this.flowActors.length + this.whales.length >= this.budget.maxVisibleAnimals) return false;
        if (isLargeAnimalKind(kind) && !this.canUseHighlight(territory)) return false;
        const territoryActors = this.flowActors.filter(actor => actor.territory === territory).length + this.whales.filter(event => event.territory === territory).length;
        const territoryLimit = this.budget.maxVisibleAnimals <= 12 ? 2 : QUALITY_FLOW_ACTORS[this.quality];
        if (territoryActors >= territoryLimit) return false;
        const occupancy = this.territoryOccupancy(territory);
        const projected = Math.max(1.4, WHALE_OCEAN_SPECIES[kind].bodyLengthPx / 50 * 0.7 + 0.9);
        return occupancy + projected <= this.budget.maxOccupancyPerTerritory;
    }

    private spawnFlowActor(pending: PendingFlow, now: number): void {
        const state = this.symbols.get(pending.symbol);
        if (!state) return;
        const territory = this.options.leftSymbol === pending.symbol ? "left" : "right";
        const profile = visualProfile(pending.peakNotional, pending.baseline);
        const kind = profile.kind;
        const movingRight = pending.side === "buy";
        const sideColor = pending.side === "buy" ? "#36e7b0" : "#ff6b55";
        const sprite = this.createAnimatedSprite(kind, territory, `whale-ocean-flow-${pending.symbol}-${this.nextFlowId}`, this.random());
        const spriteWidth = this.spriteWidthFor(kind, territory) * (1 + profile.intensity * 0.08);
        const quoteCurrency = state.quoteCurrency ?? quoteCurrencyForSymbol(pending.symbol);
        const text = `${formatCompactVolume(pending.totalNotional)} ${quoteCurrency ?? "QUOTE"}`;
        const labelWidthPx = Math.min(230, 30 + text.length * 8.6);
        const labelHeightPx = 24;
        const lane = pending.side === "buy" ? 1.65 : -1.65;
        const depth = (this.random() - 0.5) * 1.2;
        const path = this.getTransitPath(
            territory,
            pending.side,
            depth,
            this.spriteHalfWidth(spriteWidth),
            this.visibleBodyHalfWidth(kind, territory, spriteWidth)
        );
        sprite.width = spriteWidth;
        sprite.height = spriteWidth * 0.5;
        sprite.invertU = !movingRight;
        sprite.position.set(path.fromX, lane + (this.random() - 0.5) * 1.15, depth);
        sprite.color.a = 0;
        sprite.isVisible = true;
        const label = this.createVolumeLabel(text, sideColor);
        const id = `flow-${this.nextFlowId++}`;
        this.flowActors.push({ id, sprite, label, labelText: text, startedAt: performance.now(), duration: Math.max(9_000, Math.min(15_000, 8_000 + Math.abs(path.toX - path.fromX) * 420)), fromX: path.fromX, toX: path.toX, side: pending.side, territory, kind, size: spriteWidth, intensity: profile.intensity, phase: this.random() * Math.PI * 2, notional: pending.totalNotional, quoteCurrency, labelWidthPx, labelHeightPx });
        this.debugArenaPath("spawn", pending.symbol, territory, pending.side, depth, path);
        this.debugSpawn("created", pending, id);
    }

    private transientLargeCount(territory: "left" | "right"): number {
        return this.flowActors.filter(actor => actor.territory === territory && isLargeAnimalKind(actor.kind)).length
            + this.whales.filter(event => event.territory === territory).length;
    }

    private largeAnimalsInTerritory(territory: "left" | "right"): number {
        const schools = this.fishGroups
            .filter(group => group.territory === territory)
            .reduce((sum, group) => {
                let count = 0;
                for (let index = 0; index < group.visibleCount && index < group.agents.length; index++)
                    if (isLargeAnimalKind(group.agents[index].kind)) count++;
                return sum + count;
            }, 0);
        return this.transientLargeCount(territory) + schools;
    }

    private canUseHighlight(territory: "left" | "right"): boolean {
        return this.largeAnimalsInTerritory(territory) < this.budget.maxLargeHighlightsPerTerritory;
    }

    private ensureLabelLayer(): HTMLElement {
        if (this.labelLayer && this.labelLayer.isConnected) return this.labelLayer;
        const existing = this.root?.querySelector<HTMLElement>('[data-whale-ocean="labels"]');
        if (existing) {
            this.labelLayer = existing;
            this.labelLayerOwned = false;
            return existing;
        }
        const layer = document.createElement("div");
        layer.className = "whale-ocean__labels";
        layer.dataset.whaleOcean = "labels";
        layer.setAttribute("aria-hidden", "true");
        (this.canvas.parentElement ?? this.root ?? document.body).append(layer);
        this.labelLayer = layer;
        this.labelLayerOwned = true;
        return layer;
    }

    /**
     * Volume labels are fixed-size screen chips (15 CSS px) projected from the
     * animal position, so camera distance, fog and fish materials can never
     * darken or shrink the text.
     */
    private createVolumeLabel(text: string, color: string): HTMLElement {
        const label = document.createElement("span");
        label.className = "whale-ocean__volume-label";
        label.textContent = text;
        label.style.setProperty("--whale-ocean-label-accent", color);
        this.ensureLabelLayer().append(label);
        label.dataset.halfWidth = String(Math.ceil(label.offsetWidth / 2) || 60);
        return label;
    }

    private placeScreenLabel(label: HTMLElement, worldX: number, worldY: number, worldZ: number, alpha: number, below = false): void {
        const B = this.B!;
        const engine = this.engine;
        const camera = this.camera;
        const scene = this.scene;
        if (!engine || !camera || !scene) return;
        const renderWidth = engine.getRenderWidth();
        const renderHeight = engine.getRenderHeight();
        const clientWidth = this.canvas.clientWidth;
        const clientHeight = this.canvas.clientHeight;
        if (renderWidth <= 0 || renderHeight <= 0 || clientWidth <= 0 || clientHeight <= 0) return;
        const projected = B.Vector3.Project(
            new B.Vector3(worldX, worldY, worldZ),
            B.Matrix.Identity(),
            scene.getTransformMatrix(),
            camera.viewport.toGlobal(renderWidth, renderHeight)
        );
        const cssX = projected.x * (clientWidth / renderWidth);
        const cssY = projected.y * (clientHeight / renderHeight);
        const inViewport = projected.z > 0 && projected.z < 1
            && cssX > -120 && cssX < clientWidth + 120 && cssY > -60 && cssY < clientHeight + 60;
        if (!inViewport || alpha < 0.05) {
            label.style.display = "none";
            return;
        }
        const halfWidth = Number(label.dataset.halfWidth ?? "60");
        const clampedX = Math.max(halfWidth + 4, Math.min(clientWidth - halfWidth - 4, cssX));
        const clampedY = below
            ? Math.max(28, Math.min(clientHeight - 30, cssY))
            : Math.max(30, Math.min(clientHeight - 28, cssY));
        label.style.display = "";
        label.style.opacity = "1";
        label.style.transform = `translate(${clampedX.toFixed(1)}px, ${clampedY.toFixed(1)}px) translate(-50%, ${below ? "0" : "-100%"})`;
    }

    private removeLabel(label: HTMLElement | null): void {
        label?.remove();
    }

    private updateFlowActors(now: number): void {
        for (let index = this.flowActors.length - 1; index >= 0; index--) {
            const actor = this.flowActors[index];
            const rawProgress = (now - actor.startedAt) / actor.duration;
            if (rawProgress >= 1) {
                this.disposeFlowActor(actor);
                this.flowActors.splice(index, 1);
                continue;
            }
            const progress = Math.max(0, Math.min(1, rawProgress));
            const eased = progress * progress * (3 - 2 * progress);
            actor.sprite.position.y += Math.sin(progress * Math.PI * 2 + actor.phase) * 0.0025;
            actor.sprite.position.z = Math.sin(progress * Math.PI * 3 + actor.phase) * 0.38;
            const pulse = 1 + Math.sin(progress * Math.PI * 3 + actor.phase) * (0.025 + actor.intensity * 0.04);
            const path = this.getTransitPath(actor.territory, actor.side, actor.sprite.position.z, this.spriteHalfWidth(actor.size * pulse), this.visibleBodyHalfWidth(actor.kind, actor.territory, actor.size * pulse));
            actor.fromX = path.fromX;
            actor.toX = path.toX;
            const direction = actor.toX >= actor.fromX ? 1 : -1;
            actor.sprite.position.x = actor.fromX + (actor.toX - actor.fromX) * eased;
            actor.sprite.invertU = direction < 0;
            actor.sprite.width = actor.size * pulse;
            actor.sprite.height = actor.size * 0.5 * pulse;
            const fadeIn = Math.min(1, progress / 0.12);
            const fadeOut = Math.min(1, (1 - progress) / 0.16);
            actor.sprite.color.a = Math.min(fadeIn, fadeOut);
            if (actor.label) {
                this.placeScreenLabel(actor.label, actor.sprite.position.x, actor.sprite.position.y + actor.size * 0.62, actor.sprite.position.z, actor.sprite.color.a);
            }
        }
    }

    private disposeFlowActor(actor: FlowActor): void {
        actor.sprite.dispose();
        this.removeLabel(actor.label);
        actor.label = null;
        this.debugArenaPath("despawn", actor.territory === "left" ? this.options.leftSymbol : this.options.rightSymbol, actor.territory, actor.side, actor.sprite.position.z, { fromX: actor.fromX, toX: actor.toX });
        this.debugExit({
            animalId: actor.id,
            symbol: actor.territory === "left" ? this.options.leftSymbol : this.options.rightSymbol,
            side: actor.side,
            volume: actor.notional,
            direction: swimDirectionForSide(actor.side),
            kind: actor.kind,
            source: "money_flow_batch",
            exitX: actor.toX,
            removalReason: "completed_full_transit"
        });
    }

    private spawnEvent(event: WhaleOceanEvent, allowPreviouslySeen = false): void {
        const alreadySeen = this.seenEventIds.has(event.id);
        if (alreadySeen && !allowPreviouslySeen) return;
        if (!alreadySeen) this.seenEventIds.add(event.id);
        const territory = this.options.leftSymbol === event.symbol ? "left" : "right";
        if (!alreadySeen) this.addAlert(event);
        if (this.flowActors.length + this.whales.length >= this.budget.maxVisibleAnimals || !this.canUseHighlight(territory) || this.territoryOccupancy(territory) >= this.budget.maxOccupancyPerTerritory) {
            this.pendingEvents.push(event);
            while (this.pendingEvents.length > 8) this.pendingEvents.shift();
            return;
        }
        const baseColor = event.side === "buy"
            ? (territory === "left" ? this.options.leftColor : this.options.rightColor)
            : (territory === "left" ? "#a85e27" : "#0b8e94");
        const movingRight = event.side === "buy";
        const kind = animalKindForEvent(event.kind);
        const size = this.spriteWidthFor(kind, territory);
        const depth = 0.5;
        const path = this.getTransitPath(
            territory,
            event.side,
            depth,
            this.spriteHalfWidth(size),
            this.visibleBodyHalfWidth(kind, territory, size)
        );
        const sprite = this.createAnimatedSprite(kind, territory, `whale-ocean-${event.kind}-${event.id}`, this.random());
        sprite.width = size;
        sprite.height = size * 0.5;
        sprite.invertU = !movingRight;
        sprite.position.x = path.fromX;
        sprite.position.y = event.side === "buy" ? 2.9 + (this.random() - 0.5) * 0.55 : -2.9 + (this.random() - 0.5) * 0.55;
        sprite.position.z = depth;
        sprite.color.a = 0;
        sprite.isVisible = true;
        const quoteCurrency = this.symbols.get(event.symbol)?.quoteCurrency ?? quoteCurrencyForSymbol(event.symbol);
        const labelText = `${formatCompactVolume(event.notionalUsdt)} ${quoteCurrency ?? "QUOTE"}`;
        const label = this.createVolumeLabel(labelText, baseColor);
        this.whales.push({ sprite, label, labelText, startedAt: performance.now(), duration: 13_000, fromX: path.fromX, toX: path.toX, size, territory, kind, side: event.side, notional: event.notionalUsdt, quoteCurrency, eventId: event.id });
        this.debugArenaPath("spawn", event.symbol, territory, event.side, depth, path);
        this.debugSpawn("created", { symbol: event.symbol, side: event.side, totalNotional: event.notionalUsdt, peakNotional: event.notionalUsdt, baseline: 0, firstReceivedAt: Date.now(), lastReceivedAt: Date.now(), batchCount: 1 }, event.id, kind, "classified_event");
        this.rebalancePopulation();
    }

    private promotePendingEvents(): void {
        if (this.pendingEvents.length === 0) return;
        for (let index = 0; index < this.pendingEvents.length;) {
            const event = this.pendingEvents[index];
            if (Date.parse(event.eventTimeUtc) < Date.now() - this.budget.windowMs) {
                this.pendingEvents.splice(index, 1);
                this.debugFilter({ matchId: this.options.matchId, symbol: event.symbol, sequence: event.sequence, eventTimeUtc: event.eventTimeUtc, tradeCount: 0, takerBuyQuote: event.side === "buy" ? String(event.notionalUsdt) : "0", takerSellQuote: event.side === "sell" ? String(event.notionalUsdt) : "0", lastPrice: "0", isPartial: false }, "pending_event_expired");
                continue;
            }
            const territory = this.options.leftSymbol === event.symbol ? "left" : "right";
            if (this.flowActors.length + this.whales.length >= this.budget.maxVisibleAnimals || !this.canUseHighlight(territory)) {
                index++;
                continue;
            }
            this.pendingEvents.splice(index, 1);
            this.spawnEvent(event, true);
        }
    }

    private updateWhales(now: number): void {
        for (let index = this.whales.length - 1; index >= 0; index--) {
            const event = this.whales[index];
            const progress = (now - event.startedAt) / event.duration;
            if (progress >= 1) {
                event.sprite.dispose();
                this.removeLabel(event.label);
                event.label = null;
                this.debugArenaPath("despawn", event.territory === "left" ? this.options.leftSymbol : this.options.rightSymbol, event.territory, event.side, event.sprite.position.z, { fromX: event.fromX, toX: event.toX });
                this.debugExit({ animalId: event.eventId, symbol: event.territory === "left" ? this.options.leftSymbol : this.options.rightSymbol, side: event.side, volume: event.notional, direction: swimDirectionForSide(event.side), kind: event.kind, source: "classified_event", exitX: event.toX, removalReason: "completed_full_transit" });
                this.whales.splice(index, 1);
                continue;
            }
            const lane = event.side === "buy" ? 3.15 : -3.15;
            event.sprite.position.y = lane + Math.sin(progress * Math.PI * 2) * 0.55;
            event.sprite.position.z = Math.sin(progress * Math.PI * 3) * 0.6;
            const pulse = 1 + Math.sin(progress * Math.PI) * 0.12;
            const path = this.getTransitPath(event.territory, event.side, event.sprite.position.z, this.spriteHalfWidth(event.size * pulse), this.visibleBodyHalfWidth(event.kind, event.territory, event.size * pulse));
            event.fromX = path.fromX;
            event.toX = path.toX;
            event.sprite.position.x = event.fromX + (event.toX - event.fromX) * progress;
            event.sprite.invertU = event.toX < event.fromX;
            event.sprite.width = event.size * pulse;
            event.sprite.height = event.size * 0.5 * pulse;
            const fadeIn = Math.min(1, progress / 0.14);
            const fadeOut = Math.min(1, (1 - progress) / 0.18);
            event.sprite.color.a = Math.min(fadeIn, fadeOut);
            if (event.label) this.placeScreenLabel(event.label, event.sprite.position.x, event.sprite.position.y + event.size * 0.56, event.sprite.position.z, event.sprite.color.a);
        }
    }

    private addAlert(event: WhaleOceanEvent): void {
        const list = this.root?.querySelector<HTMLElement>('[data-whale-ocean="alerts"]');
        if (!list) return;
        this.alertCount++;
        const item = document.createElement("div");
        item.className = `whale-ocean-alert whale-ocean-alert--${event.kind}`;
        const value = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(event.notionalUsdt);
        const currency = this.symbols.get(event.symbol)?.quoteCurrency ?? quoteCurrencyForSymbol(event.symbol) ?? "QUOTE";
        item.textContent = `${event.kind === "whale" ? this.text("alertWhale", "WHALE") : this.text("alertShark", "SHARK")} · ${event.symbol} · ${event.side === "buy" ? this.text("buy", "BUY") : this.text("sell", "SELL")} · ${value} ${currency}`;
        list.prepend(item);
        while (list.children.length > 5) list.lastElementChild?.remove();
        this.write("events", String(this.alertCount));
    }

    private updateHud(): void {
        const left = this.symbols.get(this.options.leftSymbol);
        const right = this.symbols.get(this.options.rightSymbol);
        this.write("left-price", formatPrice(left?.price));
        this.write("right-price", formatPrice(right?.price));
        this.write("left-change", formatPercent(this.options.leftChange));
        this.write("right-change", formatPercent(this.options.rightChange));
        const leftPressure = computePressure(left?.buyQuote ?? 0, left?.sellQuote ?? 0);
        const rightPressure = computePressure(right?.buyQuote ?? 0, right?.sellQuote ?? 0);
        this.write("left-buy", formatPressure(leftPressure.buy));
        this.write("left-sell", formatPressure(leftPressure.sell));
        this.write("right-buy", formatPressure(rightPressure.buy));
        this.write("right-sell", formatPressure(rightPressure.sell));
        this.write("left-volume", formatVolume(left?.volume ?? 0));
        this.write("right-volume", formatVolume(right?.volume ?? 0));
        this.write("left-currency", left?.quoteCurrency ?? "QUOTE");
        this.write("right-currency", right?.quoteCurrency ?? "QUOTE");
    }

    private hasLiveData(): boolean {
        return [...this.symbols.values()].some(state => state.updatedAt > 0);
    }

    // Territory divider is presentation-only: it must never affect actors or fish.
    /** Development-only overlay; it is not constructed unless explicitly enabled. */
    private updateGeometryDebugOverlay(): void {
        if (!this.options.debugWhaleOcean) return;
        const stage = this.canvas.parentElement;
        if (!stage) return;
        if (!this.geometryDebugOverlay) {
            const overlay = document.createElement("div");
            overlay.className = "whale-ocean__geometry-debug";
            overlay.dataset.whaleOcean = "geometry-debug";
            stage.append(overlay);
            this.geometryDebugOverlay = overlay;
        }
        const canvasRect = this.canvas.getBoundingClientRect();
        const stageRect = stage.getBoundingClientRect();
        const overlay = this.geometryDebugOverlay;
        overlay.style.left = `${canvasRect.left - stageRect.left}px`;
        overlay.style.top = `${canvasRect.top - stageRect.top}px`;
        overlay.style.width = `${canvasRect.width}px`;
        overlay.style.height = `${canvasRect.height}px`;
        overlay.replaceChildren();
        const geometry = this.geometryDiagnostics();
        const markers = [
            ["camera", geometry.viewportCss.width / 2, `camera ${geometry.cameraCenterWorldX}`],
            ["divider", geometry.viewportCss.width / 2, "divider 50%"],
            ["boundary", 0, `L ${geometry.visibleWorld.left}`],
            ["boundary", geometry.viewportCss.width, `R ${geometry.visibleWorld.right}`],
            ["exit", geometry.viewportCss.width / 2, `territory edge ${geometry.visibleWorld.center}`]
        ] as const;
        for (const [kind, x, label] of markers) {
            const marker = document.createElement("div");
            marker.className = `whale-ocean__geometry-marker whale-ocean__geometry-marker--${kind}`;
            marker.style.left = `${x}px`;
            marker.innerHTML = `<span>${label}</span>`;
            overlay.append(marker);
        }
        for (const animal of geometry.animals) {
            if (animal.screenX === null) continue;
            const fish = document.createElement("i");
            fish.className = `whale-ocean__geometry-fish whale-ocean__geometry-fish--${animal.territory}`;
            fish.title = `${animal.id} · world X ${animal.worldX}`;
            fish.style.left = `${animal.screenX}px`;
            overlay.append(fish);
        }
    }

    private updateTerritoryDivider(): void {
        const divider = this.root?.querySelector<HTMLElement>('[data-whale-ocean="territory-divider"]');
        if (!divider) return;
        const stage = divider.parentElement;
        const reference = stage ?? this.canvas;
        const canvasRect = this.canvas.getBoundingClientRect();
        const referenceRect = reference.getBoundingClientRect();
        const centerX = canvasRect.left - referenceRect.left + canvasRect.width / 2;
        divider.style.setProperty("--whale-ocean-divider-x", `${Math.round(centerX * 100) / 100}px`);
    }

    private setFlowStatus(status: WhaleOceanFlowStatus, reason: string): void {
        const decision = guardWhaleOceanFlowStatus(this.matchFinished, this.flowStatus, status);
        if (!decision.accepted) {
            this.logMatchState(`blocked flow transition: ${reason}`, `${this.flowStatus} -> ${status}`, true);
            return;
        }

        const previous = this.flowStatus;
        this.flowStatus = decision.status;
        this.write("renderer-status", decision.status);
        this.root?.setAttribute("data-flow-state", decision.status);
        if (previous !== decision.status)
            this.logMatchState(reason, `${previous} -> ${decision.status}`);
    }

    private logMatchState(reason: string, transition: string | null = null, warning = false): void {
        (warning ? console.warn : console.info)("[WhaleOcean:MatchState]", {
            matchId: this.options.matchId,
            rawStatus: this.officialRawStatus,
            normalizedStatus: this.officialStatus,
            startTimeUtc: this.officialStartTimeUtc,
            endTimeUtc: this.officialEndTimeUtc,
            flowStatus: this.flowStatus,
            transition,
            reason
        });
    }

    private write(key: string, value: string): void {
        const element = this.root?.querySelector<HTMLElement>(`[data-whale-ocean="${key}"]`);
        if (element) element.textContent = value;
    }

    private random(): number {
        this.randomState = (this.randomState * 1664525 + 1013904223) >>> 0;
        return this.randomState / 0x1_0000_0000;
    }
}

interface MeasuredAtlasBounds {
    widthRatio: number;
    heightRatio: number;
    minXRatio: number;
    maxXRatio: number;
}

async function measureAtlasBounds(url: string, frameWidth: number, frameHeight: number, frameCount: number): Promise<MeasuredAtlasBounds> {
    const response = await fetch(url, { cache: "force-cache" });
    if (!response.ok) throw new Error(`Whale Ocean sprite atlas returned ${response.status}: ${url}`);
    const bitmap = await createImageBitmap(await response.blob());
    try {
        const canvas = document.createElement("canvas");
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) throw new Error(`Unable to inspect alpha bounds for ${url}.`);
        context.drawImage(bitmap, 0, 0);
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
        if (canvas.width !== frameWidth * 4 || canvas.height !== frameHeight * 3)
            throw new Error(`Whale Ocean atlas dimensions are invalid for ${url}.`);

        let minX = frameWidth;
        let minY = frameHeight;
        let maxX = -1;
        let maxY = -1;
        for (let frame = 0; frame < frameCount; frame++) {
            const column = frame % 4;
            const row = Math.floor(frame / 4);
            let framePixels = 0;
            for (let y = 0; y < frameHeight; y++) for (let x = 0; x < frameWidth; x++) {
                const alpha = pixels[((row * frameHeight + y) * canvas.width + column * frameWidth + x) * 4 + 3];
                if (alpha <= 8) continue;
                framePixels++;
                minX = Math.min(minX, x);
                minY = Math.min(minY, y);
                maxX = Math.max(maxX, x);
                maxY = Math.max(maxY, y);
            }
            if (framePixels === 0) throw new Error(`Whale Ocean atlas has an empty animation frame: ${url} frame ${frame}.`);
        }
        if (maxX < minX || maxY < minY) throw new Error(`Whale Ocean atlas has no visible pixels: ${url}.`);
        return {
            widthRatio: (maxX - minX + 1) / frameWidth,
            heightRatio: (maxY - minY + 1) / frameHeight,
            minXRatio: minX / frameWidth,
            maxXRatio: (maxX + 1) / frameWidth
        };
    } finally {
        bitmap.close();
    }
}

async function waitForSpriteTexture(texture: { isReady(): boolean }): Promise<void> {
    const deadline = performance.now() + 8_000;
    while (!texture.isReady()) {
        if (performance.now() >= deadline) throw new Error("Timed out loading Whale Ocean sprite atlas.");
        await new Promise(resolve => setTimeout(resolve, 16));
    }
}

function parseNumber(value: string): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

function round2(value: number): number {
    return Math.round(value * 100) / 100;
}

function formatPrice(value: number | null | undefined): string {
    if (value === null || value === undefined || !Number.isFinite(value) || value <= 0) return "—";
    return new Intl.NumberFormat(undefined, { maximumSignificantDigits: 8 }).format(value);
}

function formatPercent(value: number): string {
    return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function formatPressure(value: number | null): string {
    return value === null ? "—" : `${(value * 100).toFixed(1)}%`;
}

function formatVolume(value: number): string {
    if (!Number.isFinite(value) || value <= 0) return "—";
    return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(value);
}
