import { acquireBabylon, releaseBabylon } from "../futurebol/futurebol-babylon-loader.js";
import {
    clampVisualEntityCount,
    computePressure,
    formatCompactVolume,
    normalizeActivity,
    visualProfile,
    visualDensity,
    VolumeEventDetector,
    type WhaleOceanBatch,
    type WhaleOceanEvent,
    type WhaleOceanSide
} from "./whale-ocean-model.js";
import type { ArcRotateCamera, Engine, Matrix, Mesh, Quaternion, Scene, StandardMaterial, Vector3 } from "babylonjs";

type BabylonApi = typeof import("babylonjs");
type Quality = "Low" | "Medium" | "High";

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
}

interface FishAgent {
    position: Vector3;
    velocity: Vector3;
    phase: number;
    seed: number;
}

interface FishGroup {
    side: WhaleOceanSide;
    symbol: string;
    territory: "left" | "right";
    body: Mesh;
    tail: Mesh;
    bodyMaterial: StandardMaterial;
    agents: FishAgent[];
    matrices: Float32Array;
    targetCount: number;
    baseline: number;
    activity: number;
    flowBias: number;
}

interface Bubble {
    mesh: Mesh;
    speed: number;
    phase: number;
    baseX: number;
}

interface FlowActor {
    root: Mesh;
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

export class WhaleOceanRuntime {
    private readonly canvas: HTMLCanvasElement;
    private readonly options: WhaleOceanRuntimeOptions;
    private readonly root: HTMLElement | null;
    private readonly detector = new VolumeEventDetector();
    private readonly symbols = new Map<string, LiveSymbolState>();
    private readonly fishGroups: FishGroup[] = [];
    private readonly bubbles: Bubble[] = [];
    private readonly flowActors: FlowActor[] = [];
    private readonly whales: Array<{ root: Mesh; startedAt: number; duration: number; fromX: number; toX: number }> = [];
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
        this.buildFishGroups();
        this.buildBubbles();
        this.updateHud();

        this.renderObserver = this.scene.onBeforeRenderObservable.add(() => this.frame());
        this.engine.runRenderLoop(() => {
            if (!this.paused && this.scene) this.scene.render();
        });
        this.resizeHandler = () => this.engine?.resize();
        window.addEventListener("resize", this.resizeHandler, { passive: true });
        this.visibilityHandler = () => this.setPaused(document.hidden);
        document.addEventListener("visibilitychange", this.visibilityHandler);
        this.setStatus("BOOTSTRAP_PENDING");
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
            oldest?.root.dispose(false, true);
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
        const scene = this.scene!;
        const territoryColor = territory === "left" ? this.options.leftColor : this.options.rightColor;
        const sideColor = side === "buy" ? "#35e3ad" : "#f46551";
        const bodyMaterial = new B.StandardMaterial(`whale-ocean-fish-${territory}-${side}`, scene);
        bodyMaterial.diffuseColor = B.Color3.FromHexString(sideColor);
        bodyMaterial.emissiveColor = B.Color3.FromHexString(sideColor).scale(0.18);
        const body = B.MeshBuilder.CreateSphere(`whale-ocean-fish-body-${territory}-${side}`, { diameter: 1, segments: 6 }, scene);
        body.material = bodyMaterial;
        body.isVisible = false;
        const territoryMaterial = new B.StandardMaterial(`whale-ocean-fish-territory-${territory}-${side}`, scene);
        territoryMaterial.diffuseColor = B.Color3.FromHexString(territoryColor);
        territoryMaterial.emissiveColor = B.Color3.FromHexString(territoryColor).scale(0.16);
        const tail = B.MeshBuilder.CreateCylinder(`whale-ocean-fish-tail-${territory}-${side}`, { height: 0.55, diameterTop: 0, diameterBottom: 0.45, tessellation: 3 }, scene);
        tail.material = territoryMaterial;
        tail.isVisible = false;
        // Keep the highest-capacity pool so changing quality upward can restore
        // density without allocating during an active render loop.
        const capacity = QUALITY_FISH.High;
        const agents: FishAgent[] = [];
        for (let index = 0; index < capacity; index++) {
            const angle = this.random() * Math.PI * 2;
            agents.push({
                position: new B.Vector3(centerX + (this.random() - 0.5) * 9, (this.random() - 0.5) * 6, (this.random() - 0.5) * 2.6),
                velocity: new B.Vector3(Math.cos(angle) * 0.012, (this.random() - 0.5) * 0.01, Math.sin(angle) * 0.009),
                phase: this.random() * Math.PI * 2,
                seed: this.random()
            });
        }
        this.fishGroups.push({ side, symbol, territory, body, tail, bodyMaterial, agents, matrices: new Float32Array(capacity * 16), targetCount: 0, baseline: 0, activity: 0, flowBias: 0 });
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

    private updateGroup(symbol: string, side: WhaleOceanSide, quote: number, activeQuote: number): void {
        const state = this.symbols.get(symbol);
        if (!state || quote <= 0) return;
        const B = this.B!;
        for (const group of this.fishGroups) {
            if (group.symbol !== symbol || group.side !== side) continue;
            group.baseline = group.baseline === 0 ? Math.max(quote, 1) : group.baseline * 0.97 + Math.max(quote, 1) * 0.03;
            group.activity = Math.max(0, Math.min(1, group.activity * 0.92 + normalizeActivity(activeQuote || quote, group.baseline) * 0.08));
            const pressure = computePressure(state.buyQuote, state.sellQuote);
            const pressureStrength = side === "buy" ? pressure.buy ?? 0 : pressure.sell ?? 0;
            group.flowBias = ((pressure.buy ?? 0) - (pressure.sell ?? 0)) * (group.territory === "left" ? 1 : -1) * 0.012;
            group.targetCount = visualDensity(quote, group.baseline, pressureStrength, this.quality);
            group.bodyMaterial.emissiveColor = B.Color3.FromHexString(group.side === "buy" ? "#35e3ad" : "#f46551").scale(0.16 + group.activity * 0.34);
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
        this.updateBubbles(seconds);
        this.updateFlowActors(now);
        this.updateWhales(now);
    }

    private updateFish(seconds: number, factor: number): void {
        const B = this.B!;
        for (const group of this.fishGroups) {
            const activeCount = Math.min(group.agents.length, Math.max(0, Math.round(group.targetCount)));
            const grid = new Map<string, number[]>();
            for (let index = 0; index < activeCount; index++) {
                const agent = group.agents[index];
                const key = `${Math.floor(agent.position.x / 2.5)}:${Math.floor(agent.position.y / 2.5)}:${Math.floor(agent.position.z / 2.5)}`;
                const cell = grid.get(key);
                if (cell) cell.push(index); else grid.set(key, [index]);
            }
            const matrix = B.Matrix.Identity();
            const scale = new B.Vector3(0, 0, 0);
            const rotation = new B.Quaternion(0, 0, 0, 1);
            for (let index = 0; index < group.agents.length; index++) {
                const agent = group.agents[index];
                if (index >= activeCount) {
                    writeMatrix(B, group.matrices, index, agent.position, 0, 0, 0, matrix, scale, rotation);
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
                agent.position.addInPlace(agent.velocity.scale(factor));
                const minX = group.territory === "left" ? -17 : 1;
                const maxX = group.territory === "left" ? -1 : 17;
                if (agent.position.x < minX) agent.position.x = maxX;
                if (agent.position.x > maxX) agent.position.x = minX;
                if (agent.position.y < -4.6 || agent.position.y > 4.5) agent.velocity.y *= -1;
                if (agent.position.z < -2.5 || agent.position.z > 2.4) agent.velocity.z *= -1;
                const yaw = Math.atan2(agent.velocity.z, agent.velocity.x);
                const pitch = -Math.atan2(agent.velocity.y, Math.max(0.001, Math.hypot(agent.velocity.x, agent.velocity.z)));
                writeMatrix(B, group.matrices, index, agent.position, yaw, pitch, 0.13 + agent.seed * 0.06 + group.activity * 0.08, matrix, scale, rotation);
            }
            group.body.thinInstanceSetBuffer("matrix", group.matrices, 16, true);
            group.tail.thinInstanceSetBuffer("matrix", group.matrices, 16, true);
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
            oldest?.root.dispose(false, true);
        }

        const B = this.B!;
        const scene = this.scene!;
        const territory = this.options.leftSymbol === symbol ? "left" : "right";
        const movingRight = territory === "left" ? side === "buy" : side === "sell";
        const direction = movingRight ? 1 : -1;
        const sideColor = side === "buy" ? "#36e7b0" : "#ff6b55";
        const territoryColor = territory === "left" ? this.options.leftColor : this.options.rightColor;
        const material = new B.StandardMaterial(`whale-ocean-flow-${symbol}-${now}`, scene);
        material.diffuseColor = B.Color3.FromHexString(sideColor);
        material.emissiveColor = B.Color3.FromHexString(sideColor).scale(0.24 + profile.intensity * 0.5);
        material.alpha = 0.78 + profile.intensity * 0.2;

        const root = B.MeshBuilder.CreateSphere(`whale-ocean-flow-fish-${symbol}-${now}`, {
            diameter: 1,
            segments: this.quality === "Low" ? 5 : 8
        }, scene);
        root.material = material;
        root.scaling.set(profile.size * 2.25, profile.size * 1.05, profile.size * 0.72);

        const tail = B.MeshBuilder.CreateCylinder(`whale-ocean-flow-tail-${symbol}-${now}`, {
            height: profile.size * 1.45,
            diameterTop: 0,
            diameterBottom: profile.size * 0.9,
            tessellation: 4
        }, scene);
        tail.material = material;
        tail.rotation.z = Math.PI / 2;
        tail.position.x = -direction * profile.size * 1.65;
        tail.parent = root;

        const fin = B.MeshBuilder.CreateCylinder(`whale-ocean-flow-fin-${symbol}-${now}`, {
            height: profile.size * 0.72,
            diameterTop: 0,
            diameterBottom: profile.size * 0.5,
            tessellation: 4
        }, scene);
        fin.material = material;
        fin.rotation.x = Math.PI / 2;
        fin.position.y = profile.size * 0.72;
        fin.parent = root;

        const trailMaterial = new B.StandardMaterial(`whale-ocean-flow-trail-${symbol}-${now}`, scene);
        trailMaterial.diffuseColor = B.Color3.FromHexString(sideColor);
        trailMaterial.emissiveColor = B.Color3.FromHexString(sideColor).scale(0.28 + profile.intensity * 0.4);
        trailMaterial.alpha = 0.08 + profile.intensity * 0.18;
        const trail = B.MeshBuilder.CreateCylinder(`whale-ocean-flow-trail-${symbol}-${now}`, {
            height: profile.trailLength,
            diameterTop: profile.size * 0.25,
            diameterBottom: profile.size * 0.6,
            tessellation: 6
        }, scene);
        trail.material = trailMaterial;
        trail.rotation.z = Math.PI / 2;
        trail.position.x = -direction * (profile.size * 2.1 + profile.trailLength * 0.45);
        trail.parent = root;

        const territoryRingMaterial = new B.StandardMaterial(`whale-ocean-flow-territory-${symbol}-${now}`, scene);
        territoryRingMaterial.diffuseColor = B.Color3.FromHexString(territoryColor);
        territoryRingMaterial.emissiveColor = B.Color3.FromHexString(territoryColor).scale(0.3);
        territoryRingMaterial.alpha = 0.38;
        const territoryRing = B.MeshBuilder.CreateTorus(`whale-ocean-flow-ring-${symbol}-${now}`, {
            diameter: profile.size * 4.1,
            thickness: Math.max(0.018, profile.size * 0.08),
            tessellation: 18
        }, scene);
        territoryRing.material = territoryRingMaterial;
        territoryRing.rotation.x = Math.PI / 2;
        territoryRing.parent = root;

        if (profile.showLabel) {
            const label = this.createVolumeLabel(`${side === "buy" ? "BUY" : "SELL"} · ${formatCompactVolume(notional)}`, sideColor, profile.size);
            label.position.y = profile.size * 2.15;
            label.parent = root;
        }

        const outer = territory === "left" ? -16.5 : 16.5;
        const inner = territory === "left" ? -1.4 : 1.4;
        const fromX = movingRight ? outer : inner;
        const toX = movingRight ? inner : outer;
        root.position.set(fromX, -0.4 + (this.random() - 0.5) * 4.8, (this.random() - 0.5) * 1.2);
        root.rotation.z = direction > 0 ? 0 : Math.PI;
        root.visibility = 0;
        this.flowActors.push({
            root,
            startedAt: now,
            duration: profile.durationMs,
            fromX,
            toX,
            side,
            size: profile.size,
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
                actor.root.dispose(false, true);
                this.flowActors.splice(index, 1);
                continue;
            }
            const progress = Math.max(0, Math.min(1, rawProgress));
            const eased = progress * progress * (3 - 2 * progress);
            const direction = actor.toX >= actor.fromX ? 1 : -1;
            actor.root.position.x = actor.fromX + (actor.toX - actor.fromX) * eased;
            actor.root.position.y += Math.sin(progress * Math.PI * 2 + actor.phase) * 0.0025;
            actor.root.position.z = Math.sin(progress * Math.PI * 3 + actor.phase) * 0.38;
            actor.root.rotation.z = direction > 0 ? 0 : Math.PI;
            const pulse = 1 + Math.sin(progress * Math.PI * 3 + actor.phase) * (0.025 + actor.intensity * 0.04);
            actor.root.scaling.y = actor.size * 1.05 * pulse;
            const fadeIn = Math.min(1, progress / 0.12);
            const fadeOut = Math.min(1, (1 - progress) / 0.16);
            actor.root.visibility = Math.min(fadeIn, fadeOut);
        }
    }

    private spawnEvent(event: WhaleOceanEvent): void {
        const B = this.B!;
        const scene = this.scene!;
        while (this.whales.length >= 6) {
            const oldest = this.whales.shift();
            oldest?.root.dispose(false, true);
        }
        const material = new B.StandardMaterial(`whale-ocean-event-${event.id}`, scene);
        const territory = this.options.leftSymbol === event.symbol ? "left" : "right";
        const baseColor = event.side === "buy"
            ? (territory === "left" ? this.options.leftColor : this.options.rightColor)
            : (territory === "left" ? "#a85e27" : "#0b8e94");
        material.diffuseColor = B.Color3.FromHexString(baseColor);
        material.emissiveColor = B.Color3.FromHexString(baseColor).scale(0.35);
        const root = B.MeshBuilder.CreateSphere(`whale-ocean-${event.kind}-${event.id}`, { diameter: event.kind === "whale" ? 2.7 : 1.35, segments: 8 }, scene);
        root.material = material;
        const movingRight = territory === "left" ? event.side === "buy" : event.side === "sell";
        const outer = territory === "left" ? -17 : 17;
        const inner = territory === "left" ? -1.5 : 1.5;
        const fromX = movingRight ? outer : inner;
        const toX = movingRight ? inner : outer;
        root.position.set(fromX, -3.2, 0.5);
        root.scaling.set(event.kind === "whale" ? 1.35 : 0.95, event.kind === "whale" ? 1.1 : 0.9, 0.55);
        root.rotation.z = movingRight ? 0 : Math.PI;
        const tail = B.MeshBuilder.CreateCylinder(`whale-ocean-event-tail-${event.id}`, { height: 0.9, diameterTop: 0, diameterBottom: 0.75, tessellation: 3 }, scene);
        tail.material = material;
        tail.rotation.z = Math.PI / 2;
        tail.position.x = -1.4;
        tail.parent = root;
        const sonar = B.MeshBuilder.CreateTorus(`whale-ocean-sonar-${event.id}`, { diameter: 3.5, thickness: 0.025, tessellation: 24 }, scene);
        sonar.material = material;
        sonar.rotation.x = Math.PI / 2;
        sonar.parent = root;
        const label = this.createVolumeLabel(`${event.side === "buy" ? "BUY" : "SELL"} · ${formatCompactVolume(event.notionalUsdt)}`, baseColor, event.kind === "whale" ? 0.8 : 0.5);
        label.position.y = event.kind === "whale" ? 2.35 : 1.45;
        label.parent = root;
        this.whales.push({ root, startedAt: performance.now(), duration: event.kind === "whale" ? 11_000 : 8_000, fromX, toX });
        this.addAlert(event);
    }

    private updateWhales(now: number): void {
        for (let index = this.whales.length - 1; index >= 0; index--) {
            const event = this.whales[index];
            const progress = (now - event.startedAt) / event.duration;
            if (progress >= 1) {
                event.root.dispose(false, true);
                this.whales.splice(index, 1);
                continue;
            }
            event.root.position.x = event.fromX + (event.toX - event.fromX) * progress;
            event.root.position.y = -3.2 + Math.sin(progress * Math.PI * 2) * 1.2;
            event.root.position.z = Math.sin(progress * Math.PI * 3) * 0.6;
            event.root.scaling.y = 0.8 + Math.sin(progress * Math.PI) * 0.12;
            event.root.scaling.x = 1 + Math.sin(progress * Math.PI) * 0.14;
            const fadeIn = Math.min(1, progress / 0.14);
            const fadeOut = Math.min(1, (1 - progress) / 0.18);
            event.root.visibility = Math.min(fadeIn, fadeOut);
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

function writeMatrix(
    B: BabylonApi,
    buffer: Float32Array,
    index: number,
    position: Vector3,
    yaw: number,
    pitch: number,
    scaleValue: number,
    matrix: Matrix,
    scale: Vector3,
    rotation: Quaternion
): void {
    scale.set(scaleValue * 1.65, scaleValue, scaleValue * 0.7);
    B.Quaternion.RotationYawPitchRollToRef(yaw, pitch, 0, rotation);
    B.Matrix.ComposeToRef(scale, rotation, position, matrix);
    matrix.copyToArray(buffer, index * 16);
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
