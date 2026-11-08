import { acquireBabylon, releaseBabylon } from "../futurebol/futurebol-babylon-loader.js";
import {
    clampVisualEntityCount,
    computePressure,
    formatCompactVolume,
    normalizeActivity,
    visualProfile,
    visualDensity,
    VolumeEventDetector,
    animalKindForEvent,
    animalKindForVisualTier,
    type WhaleOceanBatch,
    type WhaleOceanAnimalKind,
    type WhaleOceanEvent,
    type WhaleOceanSide
} from "./whale-ocean-model.js";
import type { ArcRotateCamera, Engine, Mesh, Scene, Sprite, SpriteManager, StandardMaterial, Vector3 } from "babylonjs";

type BabylonApi = typeof import("babylonjs");
type Quality = "Low" | "Medium" | "High";
type SpriteKind = WhaleOceanAnimalKind;

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
}

interface FishAgent {
    position: Vector3;
    velocity: Vector3;
    phase: number;
    seed: number;
    sprite: Sprite;
    kind: SpriteKind;
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
    size: number;
    intensity: number;
    phase: number;
}

interface LiveSymbolState {
    buyQuote: number;
    sellQuote: number;
    volume: number;
    price: number | null;
    updatedAt: number;
    recent: Array<{ at: number; buy: number; sell: number }>;
    baseline: number;
    lastActorAt: number;
}

const QUALITY_FPS: Record<Quality, number> = { Low: 30, Medium: 45, High: 60 };
const QUALITY_FISH: Record<Quality, number> = { Low: 45, Medium: 130, High: 275 };
const QUALITY_FLOW_ACTORS: Record<Quality, number> = { Low: 5, Medium: 10, High: 16 };
const ANIMAL_VISUAL_LENGTH: Record<SpriteKind, number> = {
    peixe_p: 1.22,
    peixe_m: 2.25,
    peixe_g: 3.85,
    tubarao: 6.7,
    baleia: 10.6
};

export class WhaleOceanRuntime {
    private readonly canvas: HTMLCanvasElement;
    private readonly options: WhaleOceanRuntimeOptions;
    private readonly root: HTMLElement | null;
    private readonly detector = new VolumeEventDetector();
    private readonly symbols = new Map<string, LiveSymbolState>();
    private readonly fishGroups: FishGroup[] = [];
    private readonly spriteAtlases = new Map<string, SpriteAtlas>();
    private readonly spriteManagers: SpriteManager[] = [];
    private readonly bubbles: Bubble[] = [];
    private readonly flowActors: FlowActor[] = [];
    private readonly whales: Array<{ sprite: Sprite; label: Mesh | null; startedAt: number; duration: number; fromX: number; toX: number; size: number }> = [];
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

    public constructor(options: WhaleOceanRuntimeOptions) {
        this.options = options;
        this.canvas = options.canvas;
        this.root = this.canvas.closest<HTMLElement>(".whale-ocean");
        this.quality = options.quality ?? "Medium";
        this.symbols.set(options.leftSymbol, { buyQuote: 0, sellQuote: 0, volume: 0, price: options.leftPrice, updatedAt: 0, recent: [], baseline: 0, lastActorAt: 0 });
        this.symbols.set(options.rightSymbol, { buyQuote: 0, sellQuote: 0, volume: 0, price: options.rightPrice, updatedAt: 0, recent: [], baseline: 0, lastActorAt: 0 });
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
        if (this.disposed || batch.matchId !== this.options.matchId) return;
        const symbol = batch.symbol.trim().toUpperCase();
        const state = this.symbols.get(symbol);
        if (!state) return;

        const buyQuote = parseNumber(batch.takerBuyQuote);
        const sellQuote = parseNumber(batch.takerSellQuote);
        const totalQuote = buyQuote + sellQuote;
        const baselineBefore = state.baseline;
        const now = Date.now();
        state.recent.push({ at: now, buy: buyQuote, sell: sellQuote });
        while (state.recent.length > 0 && state.recent[0].at < now - 30_000) state.recent.shift();
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
        this.updateGroup(symbol, "buy", buyQuote, side === "buy" ? activity : 0);
        this.updateGroup(symbol, "sell", sellQuote, side === "sell" ? activity : 0);

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
            else this.spawnFlowActor(symbol, side, totalQuote, baselineBefore, now);
        }
        this.updateHud();
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
        for (const group of this.fishGroups) {
            group.targetCount = Math.min(group.targetCount, QUALITY_FISH[quality]);
        }
        while (this.flowActors.length > QUALITY_FLOW_ACTORS[quality]) {
            const oldest = this.flowActors.shift();
            if (oldest) this.disposeFlowActor(oldest);
        }
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
        const response = await fetch("/games/whale-ocean/sprites/manifest.json", { cache: "force-cache" });
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
            const atlasUrl = `/games/whale-ocean/sprites/${definition.atlas}`;
            const bounds = await measureAtlasBounds(atlasUrl, manifest.frameWidth, manifest.frameHeight, manifest.framesPerAnimation);
            const manager = new B.SpriteManager(
                `whale-ocean-sprites-${name}`,
                atlasUrl,
                QUALITY_FISH.High * 2 + 32,
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
        this.createFishGroup(left, "left", "buy", -7);
        this.createFishGroup(left, "left", "sell", -7);
        this.createFishGroup(right, "right", "buy", 7);
        this.createFishGroup(right, "right", "sell", 7);
    }

    private createFishGroup(symbol: string, territory: "left" | "right", side: WhaleOceanSide, centerX: number): void {
        const B = this.B!;
        // Keep the highest-capacity pool so changing quality upward can restore
        // density without allocating during an active render loop.
        const capacity = QUALITY_FISH.High;
        const agents: FishAgent[] = [];
        for (let index = 0; index < capacity; index++) {
            const angle = this.random() * Math.PI * 2;
            const kindRoll = this.random();
            const kind: SpriteKind = kindRoll < 0.76 ? "peixe_p" : kindRoll < 0.95 ? "peixe_m" : "peixe_g";
            const sprite = this.createAnimatedSprite(kind, territory, `whale-ocean-fish-${territory}-${side}-${index}`, this.random());
            sprite.width = this.spriteWidthFor(kind, territory);
            sprite.height = sprite.width * 0.5;
            agents.push({
                position: new B.Vector3(centerX + (this.random() - 0.5) * 9, (this.random() - 0.5) * 6, (this.random() - 0.5) * 2.6),
                velocity: new B.Vector3(Math.cos(angle) * 0.012, (this.random() - 0.5) * 0.01, Math.sin(angle) * 0.009),
                phase: this.random() * Math.PI * 2,
                seed: this.random(),
                sprite,
                kind
            });
        }
        this.fishGroups.push({ side, symbol, territory, agents, targetCount: 0, baseline: 0, activity: 0, flowBias: 0, lastActiveAt: 0 });
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
        return ANIMAL_VISUAL_LENGTH[kind] / atlas.visualWidthRatio;
    }

    private buildSpriteDiagnostic(): void {
        const kinds: SpriteKind[] = ["peixe_p", "peixe_m", "peixe_g", "tubarao", "baleia"];
        for (const [row, kind] of kinds.entries()) {
            for (const [column, territory] of (["left", "right"] as const).entries()) {
                const sprite = this.createAnimatedSprite(kind, territory, `whale-ocean-diagnostic-${territory}-${kind}`, (row + column * 0.37) / 7);
                const width = this.spriteWidthFor(kind, territory) * 0.46;
                sprite.width = width;
                sprite.height = width * 0.5;
                sprite.position.set(column === 0 ? -8 : 8, 3.6 - row * 1.8, 0);
                sprite.color.a = 1;
                sprite.isVisible = true;
            }
        }
    }

    private buildShowcaseDiagnostic(): void {
        for (const group of this.fishGroups) {
            group.targetCount = 22;
            group.activity = 0.75;
            group.flowBias = group.territory === "left" ? 0.008 : -0.008;
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
    }

    private updateGroup(symbol: string, side: WhaleOceanSide, quote: number, activeQuote: number): void {
        const state = this.symbols.get(symbol);
        if (!state) return;
        for (const group of this.fishGroups) {
            if (group.symbol !== symbol || group.side !== side) continue;
            if (quote <= 0) {
                group.activity *= 0.86;
                group.flowBias *= 0.8;
                group.targetCount *= 0.82;
                continue;
            }
            group.baseline = group.baseline === 0 ? Math.max(quote, 1) : group.baseline * 0.97 + Math.max(quote, 1) * 0.03;
            group.activity = Math.max(0, Math.min(1, group.activity * 0.92 + normalizeActivity(activeQuote || quote, group.baseline) * 0.08));
            const pressure = computePressure(state.buyQuote, state.sellQuote);
            const pressureStrength = side === "buy" ? pressure.buy ?? 0 : pressure.sell ?? 0;
            const territoryDirection = group.territory === "left" ? 1 : -1;
            const sideDirection = group.side === "buy" ? 1 : -1;
            group.flowBias = territoryDirection * sideDirection * (0.003 + pressureStrength * 0.009);
            group.targetCount = visualDensity(quote, group.baseline, pressureStrength, this.quality);
            group.lastActiveAt = Date.now();
        }
    }

    private decayInactiveFish(now: number): void {
        for (const group of this.fishGroups) {
            if (group.lastActiveAt === 0 || now - group.lastActiveAt < 30_000) continue;
            group.activity *= 0.94;
            group.flowBias *= 0.92;
            group.targetCount *= 0.94;
        }
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
    }

    private updateFish(seconds: number, factor: number): void {
        for (const group of this.fishGroups) {
            const activeCount = Math.min(group.agents.length, Math.max(0, Math.round(group.targetCount)));
            const grid = new Map<string, number[]>();
            for (let index = 0; index < activeCount; index++) {
                const agent = group.agents[index];
                const key = `${Math.floor(agent.position.x / 2.5)}:${Math.floor(agent.position.y / 2.5)}:${Math.floor(agent.position.z / 2.5)}`;
                const cell = grid.get(key);
                if (cell) cell.push(index); else grid.set(key, [index]);
            }
            for (let index = 0; index < group.agents.length; index++) {
                const agent = group.agents[index];
                const sprite = agent.sprite;
                if (index >= activeCount) {
                    sprite.isVisible = false;
                    continue;
                }
                let separationX = 0;
                let separationY = 0;
                let separationZ = 0;
                let alignmentX = 0;
                let alignmentY = 0;
                let alignmentZ = 0;
                let cohesionX = 0;
                let cohesionY = 0;
                let cohesionZ = 0;
                let neighbors = 0;
                const cellX = Math.floor(agent.position.x / 2.5);
                const cellY = Math.floor(agent.position.y / 2.5);
                const cellZ = Math.floor(agent.position.z / 2.5);
                for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
                    const nearby = grid.get(`${cellX + dx}:${cellY + dy}:${cellZ + dz}`);
                    if (!nearby) continue;
                    for (const neighborIndex of nearby) {
                        if (neighborIndex === index) continue;
                        const other = group.agents[neighborIndex];
                        const deltaX = other.position.x - agent.position.x;
                        const deltaY = other.position.y - agent.position.y;
                        const deltaZ = other.position.z - agent.position.z;
                        const distance = Math.hypot(deltaX, deltaY, deltaZ);
                        if (distance <= 0 || distance > 3.2) continue;
                        neighbors++;
                        const inverseDistance = 1 / distance;
                        separationX -= deltaX * inverseDistance;
                        separationY -= deltaY * inverseDistance;
                        separationZ -= deltaZ * inverseDistance;
                        alignmentX += other.velocity.x;
                        alignmentY += other.velocity.y;
                        alignmentZ += other.velocity.z;
                        cohesionX += other.position.x;
                        cohesionY += other.position.y;
                        cohesionZ += other.position.z;
                    }
                }
                if (neighbors > 0) {
                    const reciprocal = 1 / neighbors;
                    alignmentX = alignmentX * reciprocal - agent.velocity.x;
                    alignmentY = alignmentY * reciprocal - agent.velocity.y;
                    alignmentZ = alignmentZ * reciprocal - agent.velocity.z;
                    cohesionX = cohesionX * reciprocal - agent.position.x;
                    cohesionY = cohesionY * reciprocal - agent.position.y;
                    cohesionZ = cohesionZ * reciprocal - agent.position.z;
                }
                const wave = Math.sin(seconds * 0.7 + agent.phase) * 0.004;
                agent.velocity.x += (separationX * 0.0007 + alignmentX * 0.012 + cohesionX * 0.0005 + group.flowBias + Math.sin(seconds * 0.3 + agent.phase) * 0.0005) * factor;
                agent.velocity.y += (separationY * 0.0007 + alignmentY * 0.012 + cohesionY * 0.0005 + wave) * factor;
                agent.velocity.z += Math.cos(seconds * 0.43 + agent.phase) * 0.0005 * factor;
                const speed = Math.max(0.006, Math.min(0.055, agent.velocity.length()));
                agent.velocity.scaleInPlace(0.996);
                agent.velocity.normalize().scaleInPlace(speed);
                agent.position.x += agent.velocity.x * factor;
                agent.position.y += agent.velocity.y * factor;
                agent.position.z += agent.velocity.z * factor;
                const minX = group.territory === "left" ? -17 : 1;
                const maxX = group.territory === "left" ? -1 : 17;
                if (agent.position.x < minX) agent.position.x = maxX;
                if (agent.position.x > maxX) agent.position.x = minX;
                if (agent.position.y < -4.6 || agent.position.y > 4.5) agent.velocity.y *= -1;
                if (agent.position.z < -2.5 || agent.position.z > 2.4) agent.velocity.z *= -1;
                sprite.position.x = agent.position.x;
                sprite.position.y = agent.position.y;
                sprite.position.z = agent.position.z;
                sprite.invertU = agent.velocity.x < 0;
                const size = this.spriteWidthFor(agent.kind, group.territory) * (1 + group.activity * 0.18 + agent.seed * 0.07);
                sprite.width = size;
                sprite.height = size * 0.5;
                sprite.color.a = Math.min(1, 0.72 + group.activity * 0.28);
                sprite.isVisible = true;
            }
        }
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
        if (profile.tier === "micro") return;

        const minimumGap = this.quality === "Low" ? 1_200 : this.quality === "Medium" ? 700 : 450;
        if (now - state.lastActorAt < minimumGap) return;
        state.lastActorAt = now;

        while (this.flowActors.length >= QUALITY_FLOW_ACTORS[this.quality]) {
            const oldest = this.flowActors.shift();
            if (oldest) this.disposeFlowActor(oldest);
        }

        const territory = this.options.leftSymbol === symbol ? "left" : "right";
        const movingRight = territory === "left" ? side === "buy" : side === "sell";
        const sideColor = side === "buy" ? "#36e7b0" : "#ff6b55";
        const kind = animalKindForVisualTier(profile.tier);
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
        sprite.position.y = -0.4 + (this.random() - 0.5) * 4.8;
        sprite.position.z = (this.random() - 0.5) * 1.2;
        sprite.color.a = 0;
        const label = profile.showLabel
            ? this.createVolumeLabel(`${side === "buy" ? "BUY" : "SELL"} · ${formatCompactVolume(notional)}`, sideColor, profile.size)
            : null;
        this.flowActors.push({
            sprite,
            label,
            startedAt: now,
            duration: profile.durationMs,
            fromX,
            toX,
            side,
            size: spriteWidth,
            intensity: profile.intensity,
            phase: this.random() * Math.PI * 2
        });
    }

    private createVolumeLabel(text: string, color: string, size: number): Mesh {
        const B = this.B!;
        const scene = this.scene!;
        const texture = new B.DynamicTexture(`whale-ocean-volume-label-${this.random()}`, { width: 320, height: 88 }, scene, true);
        texture.hasAlpha = true;
        texture.drawText(text, 16, 59, "bold 34px Arial", "#f5ffff", "transparent", true);
        const material = new B.StandardMaterial(`whale-ocean-volume-label-material-${this.random()}`, scene);
        material.diffuseTexture = texture;
        material.opacityTexture = texture;
        material.emissiveColor = B.Color3.FromHexString(color).scale(0.4);
        material.backFaceCulling = false;
        material.useAlphaFromDiffuseTexture = true;
        const label = B.MeshBuilder.CreatePlane(`whale-ocean-volume-label-${this.random()}`, {
            width: 2.5 + size * 2.5,
            height: 0.68 + size * 0.4
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
    }

    private spawnEvent(event: WhaleOceanEvent): void {
        while (this.whales.length >= 6) {
            const oldest = this.whales.shift();
            if (oldest) {
                oldest.sprite.dispose();
                oldest.label?.dispose(false, true);
            }
        }
        const territory = this.options.leftSymbol === event.symbol ? "left" : "right";
        const baseColor = event.side === "buy"
            ? (territory === "left" ? this.options.leftColor : this.options.rightColor)
            : (territory === "left" ? "#a85e27" : "#0b8e94");
        const movingRight = territory === "left" ? event.side === "buy" : event.side === "sell";
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
        sprite.position.y = -3.2;
        sprite.position.z = 0.5;
        sprite.color.a = 0;
        const label = this.createVolumeLabel(`${event.side === "buy" ? "BUY" : "SELL"} · ${formatCompactVolume(event.notionalUsdt)}`, baseColor, event.kind === "whale" ? 0.8 : 0.5);
        this.whales.push({ sprite, label, startedAt: performance.now(), duration: event.kind === "whale" ? 11_000 : 8_000, fromX, toX, size });
        this.addAlert(event);
    }

    private updateWhales(now: number): void {
        for (let index = this.whales.length - 1; index >= 0; index--) {
            const event = this.whales[index];
            const progress = (now - event.startedAt) / event.duration;
            if (progress >= 1) {
                event.sprite.dispose();
                event.label?.dispose(false, true);
                this.whales.splice(index, 1);
                continue;
            }
            event.sprite.position.x = event.fromX + (event.toX - event.fromX) * progress;
            event.sprite.position.y = -3.2 + Math.sin(progress * Math.PI * 2) * 1.2;
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
        item.textContent = `${event.kind === "whale" ? "BALEIA" : "TUBARÃO"} · ${event.symbol} · ${event.side === "buy" ? "COMPRA" : "VENDA"} · ${value} USDT`;
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
