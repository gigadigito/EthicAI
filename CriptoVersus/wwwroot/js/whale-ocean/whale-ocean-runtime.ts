import { acquireBabylon, releaseBabylon } from "../futurebol/futurebol-babylon-loader.js";
import {
    computePressure,
    formatCompactVolume,
    normalizeActivity,
    visualProfile,
    visualDensity,
    VolumeEventDetector,
    WHALE_OCEAN_SPECIES,
    DEFAULT_WHALE_OCEAN_VISUAL_BUDGET,
    animalKindForFinancialVolume,
    animalKindForEvent,
    isLargeAnimalKind,
    isHighlightAnimalKind,
    WHALE_OCEAN_VISUAL_SIZE_LIMITS,
    quoteCurrencyForSymbol,
    swimDirectionForSide,
    type WhaleOceanBatch,
    type WhaleOceanAnimalKind,
    type WhaleOceanFlowAnimalKind,
    type WhaleOceanEvent,
    type WhaleOceanSide,
    type WhaleOceanVisualBudget
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
    diagnostic?: "sprites" | "showcase";
    developmentDiagnostics?: boolean;
    debugWhaleOcean?: boolean;
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
    label: Mesh | null;
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
    sprite: Sprite;
    label: Mesh | null;
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
const QUALITY_FLOW_ACTORS: Record<Quality, number> = { Low: 2, Medium: 4, High: 6 };
const SPRITE_ASSET_VERSION = "20261110-whale-ocean-direction-debug-v5";
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
    private readonly whales: Array<{ sprite: Sprite; label: Mesh | null; startedAt: number; duration: number; fromX: number; toX: number; size: number; territory: "left" | "right"; kind: WhaleOceanAnimalKind; side: WhaleOceanSide; notional: number; quoteCurrency: string | null; eventId: string }> = [];
    private readonly pendingEvents: WhaleOceanEvent[] = [];
    private readonly lastBatchSequence = new Map<string, number>();
    private readonly seenEventIds = new Set<string>();
    private B: BabylonApi | null = null;
    private engine: Engine | null = null;
    private scene: Scene | null = null;
    private camera: ArcRotateCamera | null = null;
    private renderObserver: unknown = null;
    private resizeHandler: (() => void) | null = null;
    private visibilityHandler: (() => void) | null = null;
    private paused = false;
    private connected = false;
    private replaying = false;
    private replayComplete = false;
    private disposed = false;
    private quality: Quality;
    private lastFrame = 0;
    private frameAccumulator = 0;
    private alertCount = 0;
    private randomState = 0x51f15e;
    private lastDiagnosticsAt = 0;
    private lastDebugSummaryAt = 0;

    public constructor(options: WhaleOceanRuntimeOptions) {
        this.options = options;
        const requestedBudget = options.visualBudget ?? {};
        this.budget = {
            ...DEFAULT_WHALE_OCEAN_VISUAL_BUDGET,
            ...requestedBudget,
            maxVisibleAnimals: Math.max(8, Math.min(48, Math.round(requestedBudget.maxVisibleAnimals ?? DEFAULT_WHALE_OCEAN_VISUAL_BUDGET.maxVisibleAnimals))),
            maxLargeHighlightsPerTerritory: Math.max(1, Math.min(2, Math.round(requestedBudget.maxLargeHighlightsPerTerritory ?? DEFAULT_WHALE_OCEAN_VISUAL_BUDGET.maxLargeHighlightsPerTerritory))),
            maxSchoolAnimalsPerGroup: Math.max(2, Math.min(16, Math.round(requestedBudget.maxSchoolAnimalsPerGroup ?? DEFAULT_WHALE_OCEAN_VISUAL_BUDGET.maxSchoolAnimalsPerGroup))),
            maxOccupancyPerTerritory: Math.max(12, Math.min(40, requestedBudget.maxOccupancyPerTerritory ?? DEFAULT_WHALE_OCEAN_VISUAL_BUDGET.maxOccupancyPerTerritory)),
            windowMs: Math.max(5_000, Math.min(120_000, Math.round(requestedBudget.windowMs ?? DEFAULT_WHALE_OCEAN_VISUAL_BUDGET.windowMs)))
        };
        this.canvas = options.canvas;
        this.root = this.canvas.closest<HTMLElement>(".whale-ocean");
        this.quality = options.quality ?? "Medium";
        this.symbols.set(options.leftSymbol, { buyQuote: 0, sellQuote: 0, volume: 0, price: options.leftPrice, quoteCurrency: quoteCurrencyForSymbol(options.leftSymbol), updatedAt: 0, recent: [], baseline: 0, lastActorAt: { buy: 0, sell: 0 } });
        this.symbols.set(options.rightSymbol, { buyQuote: 0, sellQuote: 0, volume: 0, price: options.rightPrice, quoteCurrency: quoteCurrencyForSymbol(options.rightSymbol), updatedAt: 0, recent: [], baseline: 0, lastActorAt: { buy: 0, sell: 0 } });
    }

    public async initialize(): Promise<void> {
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

        this.camera = new this.B.ArcRotateCamera("whale-ocean-camera", -Math.PI / 2, Math.PI / 2, 27, new this.B.Vector3(0, 0, 0), this.scene);
        this.camera.lowerRadiusLimit = 27;
        this.camera.upperRadiusLimit = 27;
        this.camera.lowerAlphaLimit = this.camera.alpha;
        this.camera.upperAlphaLimit = this.camera.alpha;
        this.camera.lowerBetaLimit = this.camera.beta;
        this.camera.upperBetaLimit = this.camera.beta;
        this.camera.detachControl();
        this.camera.minZ = 0.1;
        this.camera.maxZ = 100;

        this.buildEnvironment();
        await this.buildSpriteLibrary();
        if (this.options.diagnostic === "sprites") {
            this.buildSpriteDiagnostic();
            this.setStatus("DIAGNOSTIC_SPRITES");
        } else {
            this.buildFishGroups();
            this.buildBubbles();
            this.updateHud();
            this.refreshDiagnostics(Date.now(), true);
            if (this.options.diagnostic === "showcase") {
                this.buildShowcaseDiagnostic();
                this.setStatus("DIAGNOSTIC_SHOWCASE");
            }
        }

        this.renderObserver = this.scene.onBeforeRenderObservable.add(() => this.frame());
        this.engine.runRenderLoop(() => {
            if (!this.paused && this.scene) this.scene.render();
        });
        this.resizeHandler = () => this.engine?.resize();
        window.addEventListener("resize", this.resizeHandler, { passive: true });
        this.visibilityHandler = () => this.setPaused(document.hidden);
        document.addEventListener("visibilitychange", this.visibilityHandler);
        if (!this.options.diagnostic) this.setStatus("BOOTSTRAP_PENDING");
    }

    public receive(batch: WhaleOceanBatch): void {
        this.debugReceive(batch);
        if (this.disposed || batch.matchId !== this.options.matchId) return;
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
        const baselineBefore = state.baseline;
        const now = Date.now();
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
                this.setStatus("REPLAY");
            }
        } else {
            this.replaying = false;
            this.setStatus("LIVE");
            const event = this.detector.ingest(batch);
            if (event) this.spawnEvent(event);
            else {
                if (buyQuote > 0) this.spawnFlowActor(symbol, "buy", buyQuote, baselineBefore, now);
                if (sellQuote > 0) this.spawnFlowActor(symbol, "sell", sellQuote, baselineBefore, now);
            }
        }
        this.rebalancePopulation();
        this.updateHud();
        this.refreshDiagnostics(now, true);
        this.debugFilter(batch, "accepted");
        this.debugSummary(now, true);
    }

    public setPaused(paused: boolean): void {
        this.paused = paused;
        this.setStatus(paused ? "PAUSED" : this.replaying ? "REPLAY" : this.connected ? "LIVE" : "BOOTSTRAP_PENDING");
        this.write("pause", paused ? "PAUSED" : "LIVE");
    }

    public setConnectionState(connected: boolean): void {
        this.connected = connected;
        if (!connected) this.setStatus("BOOTSTRAP_PENDING");
        else if (!this.paused && !this.replaying) this.setStatus("LIVE");
    }

    public completeReplay(): void {
        this.replayComplete = true;
        this.replaying = false;
        if (!this.paused) this.setStatus(this.connected ? "LIVE" : "BOOTSTRAP_PENDING");
    }

    public async setQuality(quality: Quality): Promise<void> {
        if (this.quality === quality || this.disposed) return;
        this.quality = quality;
        this.engine?.setHardwareScalingLevel(quality === "Low" ? 1.6 : quality === "Medium" ? 1.25 : 1);
        while (this.flowActors.length > QUALITY_FLOW_ACTORS[quality]) {
            const oldest = this.flowActors.shift();
            if (oldest) this.disposeFlowActor(oldest);
        }
        this.rebalancePopulation();
        this.write("quality", quality);
    }

    public async dispose(): Promise<void> {
        if (this.disposed) return;
        this.disposed = true;
        if (this.renderObserver && this.scene) this.scene.onBeforeRenderObservable.remove(this.renderObserver as never);
        if (this.resizeHandler) window.removeEventListener("resize", this.resizeHandler);
        if (this.visibilityHandler) document.removeEventListener("visibilitychange", this.visibilityHandler);
        this.engine?.stopRenderLoop();
        for (const manager of this.spriteManagers) manager.dispose();
        this.scene?.dispose();
        this.engine?.dispose();
        this.scene = null;
        this.engine = null;
        this.camera = null;
        releaseBabylon();
    }

    private buildEnvironment(): void {
        const B = this.B!;
        const scene = this.scene!;
        const water = new B.StandardMaterial("whale-ocean-water", scene);
        water.diffuseColor = B.Color3.FromHexString("#082a43");
        water.emissiveColor = B.Color3.FromHexString("#03111e");
        water.alpha = 0.88;
        const background = B.MeshBuilder.CreatePlane("whale-ocean-background", { width: 38, height: 18 }, scene);
        background.position.z = 4.5;
        background.material = water;
        water.backFaceCulling = false;
        background.isPickable = false;

        const floorMaterial = new B.StandardMaterial("whale-ocean-floor", scene);
        floorMaterial.diffuseColor = B.Color3.FromHexString("#061521");
        floorMaterial.emissiveColor = B.Color3.FromHexString("#020911");
        const floor = B.MeshBuilder.CreateGround("whale-ocean-floor", { width: 38, height: 15 }, scene);
        floor.position.y = -5.5;
        floor.position.z = 1;
        floor.material = floorMaterial;

        const rayMaterial = new B.StandardMaterial("whale-ocean-rays", scene);
        rayMaterial.diffuseColor = B.Color3.FromHexString("#78e7ff");
        rayMaterial.emissiveColor = B.Color3.FromHexString("#245b75");
        rayMaterial.alpha = this.quality === "Low" ? 0.025 : 0.055;
        for (let index = 0; index < (this.quality === "Low" ? 3 : 6); index++) {
            const ray = B.MeshBuilder.CreatePlane(`whale-ocean-ray-${index}`, { width: 2.5, height: 15 }, scene);
            ray.position.set(-11 + index * 4.5, 4, 2 + index * 0.2);
            ray.rotation.z = -0.12 + index * 0.045;
            ray.material = rayMaterial;
        }

        const dividerMaterial = new B.StandardMaterial("whale-ocean-divider", scene);
        dividerMaterial.diffuseColor = B.Color3.FromHexString("#24cbd3");
        dividerMaterial.emissiveColor = B.Color3.FromHexString("#0e5961");
        dividerMaterial.alpha = 0.12;
        const divider = B.MeshBuilder.CreatePlane("whale-ocean-natural-divider", { width: 0.12, height: 9 }, scene);
        divider.position.set(0, -0.2, 0.8);
        divider.material = dividerMaterial;

        this.addReef("left", -12, this.options.leftColor);
        this.addReef("right", 12, this.options.rightColor);
        this.addReef("left", -5, "#266e79");
        this.addReef("right", 5, "#266e79");
    }

    private addReef(territory: "left" | "right", x: number, color: string): void {
        const B = this.B!;
        const scene = this.scene!;
        const material = new B.StandardMaterial(`whale-ocean-reef-${x}`, scene);
        material.diffuseColor = B.Color3.FromHexString(color);
        material.emissiveColor = B.Color3.FromHexString(color).scale(0.18);
        const rock = B.MeshBuilder.CreateSphere(`whale-ocean-rock-${x}`, { diameter: 2.6, segments: 5 }, scene);
        rock.scaling.set(1.7, 0.7, 0.75);
        rock.position.set(x, -4.5, 1.4);
        rock.material = material;
        for (let index = 0; index < 5; index++) {
            const weed = B.MeshBuilder.CreateCylinder(`whale-ocean-weed-${territory}-${x}-${index}`, { height: 2 + index * 0.25, diameter: 0.1, tessellation: 5 }, scene);
            weed.position.set(x - 1.4 + index * 0.7, -3.4 + index * 0.08, 0.8 + index * 0.15);
            weed.rotation.z = (index % 2 === 0 ? 1 : -1) * 0.12;
            weed.material = material;
        }
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
                visualHeightRatio: bounds.heightRatio
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

    private spriteWidthFor(kind: SpriteKind, territory: "left" | "right"): number {
        const atlas = this.spriteAtlases.get(`${kind}:${territory}`);
        if (!atlas || atlas.visualWidthRatio <= 0)
            throw new Error(`Whale Ocean sprite metrics are unavailable for ${kind}:${territory}.`);
        const limits = isHighlightAnimalKind(kind) ? WHALE_OCEAN_VISUAL_SIZE_LIMITS.highlight : WHALE_OCEAN_VISUAL_SIZE_LIMITS.school;
        const length = Math.max(limits.minLength, Math.min(limits.maxLength, WHALE_OCEAN_SPECIES[kind].visualLength));
        return length / atlas.visualWidthRatio;
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
        const showcaseSpecies: WhaleOceanFlowAnimalKind[] = ["sardine", "grouper", "tuna", "swordfish"];
        const now = Date.now();
        for (const [index, group] of this.fishGroups.entries()) {
            group.targetCount = 6;
            group.activity = 0.75;
            group.flowBias = group.side === "buy" ? 0.008 : -0.008;
            group.schoolKind = showcaseSpecies[index];
            group.baseline = 25_000 + index * 12_000;
            group.recentLots = [{ at: now, quote: group.baseline * 2.4, tradeCount: 6, origin: "DEMO", kind: showcaseSpecies[index] }];
        }
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

    private rebalancePopulation(): void {
        const available = Math.max(0, this.budget.maxVisibleAnimals - this.flowActors.length - this.whales.length);
        const groups = [...this.fishGroups].sort((a, b) => b.targetCount - a.targetCount);
        for (const group of groups) group.visibleCount = 0;
        const usedByTerritory: Record<"left" | "right", number> = { left: 0, right: 0 };
        let remaining = available;
        for (const group of groups) {
            const desired = Math.min(group.agents.length, this.budget.maxSchoolAnimalsPerGroup, Math.max(0, Math.round(group.targetCount)));
            const occupancyCost = this.estimatedSchoolOccupancy(group);
            const occupancyRoom = Math.max(0, this.budget.maxOccupancyPerTerritory - usedByTerritory[group.territory]);
            const occupancyCount = occupancyCost > 0 ? Math.floor(occupancyRoom / occupancyCost) : desired;
            group.visibleCount = Math.min(desired, remaining, Math.max(0, occupancyCount));
            usedByTerritory[group.territory] += group.visibleCount * occupancyCost;
            remaining -= group.visibleCount;
        }
    }

    private estimatedSchoolOccupancy(group: FishGroup): number {
        const length = WHALE_OCEAN_SPECIES[group.schoolKind].visualLength;
        return Math.max(0.8, Math.min(4.4, length * 0.7 + 0.35));
    }

    private schoolAnchor(territory: "left" | "right", side: WhaleOceanSide, index: number): { x: number; y: number; z: number } {
        const centerX = territory === "left" ? -8.3 : 8.3;
        const centerY = side === "buy" ? 2.15 : -2.15;
        const angle = index * 2.399963;
        const radius = 0.35 + Math.sqrt(index + 0.5) * 0.72;
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
        this.frameAccumulator += elapsed;
        if (this.frameAccumulator < 1_000 / QUALITY_FPS[this.quality]) return;
        this.frameAccumulator = 0;
        const seconds = now / 1_000;
        this.updateFish(seconds, elapsed / 16.67);
        if (!this.options.diagnostic) this.decayInactiveFish(Date.now());
        this.updateBubbles(seconds);
        this.updateFlowActors(now);
        this.updateWhales(now);
        this.promotePendingEvents();
        this.refreshDiagnostics(Date.now());
    }

    private updateFish(seconds: number, factor: number): void {
        this.rebalancePopulation();
        const activeAgents: Array<{ agent: FishAgent; group: FishGroup; index: number }> = [];
        const largeByTerritory: Record<"left" | "right", number> = { left: 0, right: 0 };
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
                inactive.label?.dispose(false, true);
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
            const edgePadding = Math.max(0.6, size * 0.45);
            const minX = group.territory === "left" ? -16.1 + edgePadding : 1.1 + edgePadding;
            const maxX = group.territory === "left" ? -1.1 - edgePadding : 16.1 - edgePadding;
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
            const labelText = `${group.side === "buy" ? "BUY →" : "SELL ←"} ${formatCompactVolume(agent.allocatedNotional)} ${currency ?? "QUOTE"}`;
            this.ensureFishLabel(agent, labelText, group.side === "buy" ? "#36e7b0" : "#ff6b55", size);
            if (agent.label) {
                const labelOffset = index % 2 === 0 ? size * 0.55 : -size * 0.55;
                agent.label.position.set(agent.position.x, agent.position.y + labelOffset, agent.position.z - 0.04);
                agent.label.visibility = sprite.color.a;
            }
        }
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
        if (previousKind !== kind || previousNotional !== notionalUsdt)
            this.debugRender(previousKind === kind ? "updated" : "created", {
                animalId: agent.debugId,
                symbol,
                side,
                volume: notionalUsdt,
                direction: swimDirectionForSide(side),
                kind,
                source: "money_flow_aggregate_allocation"
            });
    }

    private ensureFishLabel(agent: FishAgent, text: string, color: string, size: number): void {
        if (agent.label && agent.labelText === text) return;
        agent.label?.dispose(false, true);
        agent.label = this.createVolumeLabel(text, color, size, true);
        agent.labelText = text;
    }

    private debugReceive(batch: WhaleOceanBatch): void {
        if (!this.options.debugWhaleOcean) return;
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
        console.log("payload", this.safeDebugPayload(batch));
        console.groupEnd();
    }

    private debugFilter(batch: WhaleOceanBatch, reason: string): void {
        if (!this.options.debugWhaleOcean) return;
        const symbol = batch.symbol.trim().toUpperCase();
        console.groupCollapsed(`[WhaleOcean][FILTER] ${reason} ${symbol}`);
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

    private debugRender(action: "created" | "updated" | "removed" | "aggregated", data: Record<string, unknown>): void {
        if (!this.options.debugWhaleOcean) return;
        console.groupCollapsed(`[WhaleOcean][RENDER] ${action}`);
        console.table([data]);
        console.groupEnd();
    }

    private debugSummary(now: number, force = false): void {
        if (!this.options.debugWhaleOcean || (!force && now - this.lastDebugSummaryAt < 500)) return;
        this.lastDebugSummaryAt = now;
        const groups = this.fishGroups.map(group => ({
            symbol: group.symbol,
            territory: group.territory,
            side: group.side,
            visible: group.visibleCount,
            windowVolume: group.recentLots.reduce((sum, lot) => sum + lot.quote, 0),
            representedVolume: group.agents.slice(0, group.visibleCount).reduce((sum, agent) => sum + agent.allocatedNotional, 0)
        }));
        const financial = [...this.symbols.entries()].map(([symbol, state]) => ({
            symbol,
            quoteCurrency: state.quoteCurrency,
            buy: state.buyQuote,
            sell: state.sellQuote,
            windowTotal: state.volume
        }));
        const visible = groups.reduce((sum, group) => sum + group.visible, 0) + this.flowActors.length + this.whales.length;
        const represented = groups.reduce((sum, group) => sum + group.representedVolume, 0)
            + this.flowActors.reduce((sum, actor) => sum + actor.notional, 0)
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
            visuallyRepresentedTotal: represented,
            financialMinusRepresented: financialTotal - represented,
            pendingEvents: this.pendingEvents.length
        }]);
        console.table(financial);
        console.groupEnd();
    }

    private territoryOccupancy(territory: "left" | "right"): number {
        const schools = this.fishGroups
            .filter(group => group.territory === territory)
            .reduce((sum, group) => sum + group.visibleCount * this.estimatedSchoolOccupancy(group), 0);
        const transient = this.flowActors.filter(actor => actor.territory === territory)
            .reduce((sum, actor) => sum + Math.max(1, actor.size * 0.7), 0);
        const highlights = this.whales.filter(event => event.territory === territory)
            .reduce((sum, event) => sum + Math.max(1, event.size * 0.7), 0);
        return Number((schools + transient + highlights).toFixed(2));
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

    private spawnFlowActor(symbol: string, side: WhaleOceanSide, notional: number, baseline: number, now: number): void {
        if (baseline <= 0 || notional <= 0) return;
        const state = this.symbols.get(symbol);
        if (!state) return;
        const profile = visualProfile(notional, baseline);
        if (profile.tier === "micro" || profile.tier === "small") return;

        const territory = this.options.leftSymbol === symbol ? "left" : "right";
        const kind = profile.kind;
        if (isLargeAnimalKind(kind) && !this.canUseHighlight(territory)) return;

        const minimumGap = this.quality === "Low" ? 1_200 : this.quality === "Medium" ? 700 : 450;
        if (now - state.lastActorAt[side] < minimumGap) return;
        state.lastActorAt[side] = now;

        while (this.flowActors.length >= QUALITY_FLOW_ACTORS[this.quality]) {
            const oldest = this.flowActors.shift();
            if (oldest) this.disposeFlowActor(oldest);
        }

        const movingRight = side === "buy";
        const sideColor = side === "buy" ? "#36e7b0" : "#ff6b55";
        const sprite = this.createAnimatedSprite(kind, territory, `whale-ocean-flow-${symbol}-${now}`, this.random());
        const spriteWidth = this.spriteWidthFor(kind, territory) * (1 + profile.intensity * 0.12);
        sprite.width = spriteWidth;
        sprite.height = spriteWidth * 0.5;
        sprite.invertU = !movingRight;

        const outer = territory === "left" ? -16.5 : 16.5;
        const inner = territory === "left" ? -1.4 : 1.4;
        const fromX = movingRight ? outer : inner;
        const toX = movingRight ? inner : outer;
        sprite.position.x = fromX;
        sprite.position.y = side === "buy" ? 2.7 + (this.random() - 0.5) * 0.6 : -2.7 + (this.random() - 0.5) * 0.6;
        sprite.position.z = (this.random() - 0.5) * 1.2;
        sprite.color.a = 0;
        const quoteCurrency = state.quoteCurrency ?? quoteCurrencyForSymbol(symbol);
        const label = profile.showLabel
            ? this.createVolumeLabel(`${side === "buy" ? "BUY →" : "SELL ←"} ${formatCompactVolume(notional)} ${quoteCurrency ?? "QUOTE"}`, sideColor, profile.size)
            : null;
        this.flowActors.push({
            sprite,
            label,
            startedAt: now,
            duration: profile.durationMs,
            fromX,
            toX,
            side,
            territory,
            kind,
            size: spriteWidth,
            intensity: profile.intensity,
            phase: this.random() * Math.PI * 2,
            notional,
            quoteCurrency
        });
        this.debugRender("created", {
            animalId: sprite.name,
            symbol,
            side,
            volume: notional,
            direction: swimDirectionForSide(side),
            kind,
            source: "money_flow_batch"
        });
        this.rebalancePopulation();
    }

    private canUseHighlight(territory: "left" | "right"): boolean {
        const active = this.whales.filter(event => event.territory === territory).length
            + this.flowActors.filter(actor => actor.territory === territory && isHighlightAnimalKind(actor.kind)).length;
        return active < this.budget.maxLargeHighlightsPerTerritory;
    }

    private createVolumeLabel(text: string, color: string, size: number, compact = false): Mesh {
        const B = this.B!;
        const scene = this.scene!;
        const texture = new B.DynamicTexture(`whale-ocean-volume-label-${this.random()}`, compact ? { width: 256, height: 56 } : { width: 320, height: 88 }, scene, true);
        texture.hasAlpha = true;
        texture.drawText(text, compact ? 8 : 16, compact ? 38 : 59, compact ? "bold 22px Arial" : "bold 34px Arial", "#f5ffff", "transparent", true);
        const material = new B.StandardMaterial(`whale-ocean-volume-label-material-${this.random()}`, scene);
        material.diffuseTexture = texture;
        material.opacityTexture = texture;
        material.emissiveColor = B.Color3.FromHexString(color).scale(0.4);
        material.backFaceCulling = false;
        material.useAlphaFromDiffuseTexture = true;
        const label = B.MeshBuilder.CreatePlane(`whale-ocean-volume-label-${this.random()}`, {
            width: compact ? Math.max(1.0, Math.min(2.3, 1.0 + size * 0.14)) : 2.2 + size * 1.7,
            height: compact ? 0.3 : 0.58 + size * 0.32
        }, scene);
        label.material = material;
        label.billboardMode = B.Mesh.BILLBOARDMODE_ALL;
        return label;
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
            const direction = actor.toX >= actor.fromX ? 1 : -1;
            actor.sprite.position.x = actor.fromX + (actor.toX - actor.fromX) * eased;
            actor.sprite.position.y += Math.sin(progress * Math.PI * 2 + actor.phase) * 0.0025;
            actor.sprite.position.z = Math.sin(progress * Math.PI * 3 + actor.phase) * 0.38;
            actor.sprite.invertU = direction < 0;
            const pulse = 1 + Math.sin(progress * Math.PI * 3 + actor.phase) * (0.025 + actor.intensity * 0.04);
            actor.sprite.width = actor.size * pulse;
            actor.sprite.height = actor.size * 0.5 * pulse;
            const fadeIn = Math.min(1, progress / 0.12);
            const fadeOut = Math.min(1, (1 - progress) / 0.16);
            actor.sprite.color.a = Math.min(fadeIn, fadeOut);
            if (actor.label) {
                actor.label.position.set(actor.sprite.position.x, actor.sprite.position.y + actor.size * 0.62, actor.sprite.position.z - 0.04);
                actor.label.visibility = actor.sprite.color.a;
            }
        }
    }

    private disposeFlowActor(actor: FlowActor): void {
        actor.sprite.dispose();
        actor.label?.dispose(false, true);
        this.debugRender("removed", {
            animalId: actor.sprite.name,
            symbol: actor.territory === "left" ? this.options.leftSymbol : this.options.rightSymbol,
            side: actor.side,
            volume: actor.notional,
            direction: swimDirectionForSide(actor.side),
            kind: actor.kind,
            source: "money_flow_batch"
        });
    }

    private spawnEvent(event: WhaleOceanEvent, allowPreviouslySeen = false): void {
        const alreadySeen = this.seenEventIds.has(event.id);
        if (alreadySeen && !allowPreviouslySeen) return;
        if (!alreadySeen) this.seenEventIds.add(event.id);
        const territory = this.options.leftSymbol === event.symbol ? "left" : "right";
        if (!alreadySeen) this.addAlert(event);
        if (this.flowActors.length + this.whales.length >= this.budget.maxVisibleAnimals || !this.canUseHighlight(territory)) {
            this.pendingEvents.push(event);
            while (this.pendingEvents.length > 8) this.pendingEvents.shift();
            return;
        }
        const baseColor = event.side === "buy"
            ? (territory === "left" ? this.options.leftColor : this.options.rightColor)
            : (territory === "left" ? "#a85e27" : "#0b8e94");
        const movingRight = event.side === "buy";
        const outer = territory === "left" ? -17 : 17;
        const inner = territory === "left" ? -1.5 : 1.5;
        const fromX = movingRight ? outer : inner;
        const toX = movingRight ? inner : outer;
        const kind = animalKindForEvent(event.kind);
        const size = this.spriteWidthFor(kind, territory);
        const sprite = this.createAnimatedSprite(kind, territory, `whale-ocean-${event.kind}-${event.id}`, this.random());
        sprite.width = size;
        sprite.height = size * 0.5;
        sprite.invertU = !movingRight;
        sprite.position.x = fromX;
        sprite.position.y = event.side === "buy" ? 3.15 : -3.15;
        sprite.position.z = 0.5;
        sprite.color.a = 0;
        const quoteCurrency = this.symbols.get(event.symbol)?.quoteCurrency ?? quoteCurrencyForSymbol(event.symbol);
        const label = this.createVolumeLabel(`${event.side === "buy" ? "BUY →" : "SELL ←"} ${formatCompactVolume(event.notionalUsdt)} ${quoteCurrency ?? "QUOTE"}`, baseColor, event.kind === "whale" ? 0.8 : 0.5);
        this.whales.push({ sprite, label, startedAt: performance.now(), duration: event.kind === "whale" ? 11_000 : 8_000, fromX, toX, size, territory, kind, side: event.side, notional: event.notionalUsdt, quoteCurrency, eventId: event.id });
        this.debugRender("created", { animalId: event.id, symbol: event.symbol, side: event.side, volume: event.notionalUsdt, direction: swimDirectionForSide(event.side), kind, source: "classified_event" });
        this.rebalancePopulation();
    }

    private promotePendingEvents(): void {
        if (this.pendingEvents.length === 0) return;
        for (let index = 0; index < this.pendingEvents.length;) {
            const event = this.pendingEvents[index];
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
                event.label?.dispose(false, true);
                this.debugRender("removed", { animalId: event.eventId, symbol: event.territory === "left" ? this.options.leftSymbol : this.options.rightSymbol, side: event.side, volume: event.notional, direction: swimDirectionForSide(event.side), kind: event.kind, source: "classified_event" });
                this.whales.splice(index, 1);
                continue;
            }
            event.sprite.position.x = event.fromX + (event.toX - event.fromX) * progress;
            const lane = event.side === "buy" ? 3.15 : -3.15;
            event.sprite.position.y = lane + Math.sin(progress * Math.PI * 2) * 0.55;
            event.sprite.position.z = Math.sin(progress * Math.PI * 3) * 0.6;
            event.sprite.invertU = event.toX < event.fromX;
            const pulse = 1 + Math.sin(progress * Math.PI) * 0.12;
            event.sprite.width = event.size * pulse;
            event.sprite.height = event.size * 0.5 * pulse;
            const fadeIn = Math.min(1, progress / 0.14);
            const fadeOut = Math.min(1, (1 - progress) / 0.18);
            event.sprite.color.a = Math.min(fadeIn, fadeOut);
            event.label?.position.set(event.sprite.position.x, event.sprite.position.y + event.size * 0.56, event.sprite.position.z - 0.05);
            if (event.label) event.label.visibility = event.sprite.color.a;
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
        item.textContent = `${event.kind === "whale" ? "BALEIA" : "TUBARÃO"} · ${event.symbol} · ${event.side === "buy" ? "COMPRA" : "VENDA"} · ${value} ${currency}`;
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

    private setStatus(status: string): void {
        this.write("status", status);
        this.root?.setAttribute("data-ocean-state", status);
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
            heightRatio: (maxY - minY + 1) / frameHeight
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
