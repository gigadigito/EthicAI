import { acquireBabylon, releaseBabylon } from "../futurebol/futurebol-babylon-loader.js";
import {
    clampVisualEntityCount,
    computePressure,
    normalizeActivity,
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

interface LiveSymbolState {
    buyQuote: number;
    sellQuote: number;
    volume: number;
    price: number | null;
    updatedAt: number;
    recent: Array<{ at: number; buy: number; sell: number }>;
}

const QUALITY_FPS: Record<Quality, number> = { Low: 30, Medium: 45, High: 60 };
const QUALITY_FISH: Record<Quality, number> = { Low: 45, Medium: 130, High: 275 };

export class WhaleOceanRuntime {
    private readonly canvas: HTMLCanvasElement;
    private readonly options: WhaleOceanRuntimeOptions;
    private readonly root: HTMLElement | null;
    private readonly detector = new VolumeEventDetector();
    private readonly symbols = new Map<string, LiveSymbolState>();
    private readonly fishGroups: FishGroup[] = [];
    private readonly bubbles: Bubble[] = [];
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
        this.symbols.set(options.leftSymbol, { buyQuote: 0, sellQuote: 0, volume: 0, price: options.leftPrice, updatedAt: 0, recent: [] });
        this.symbols.set(options.rightSymbol, { buyQuote: 0, sellQuote: 0, volume: 0, price: options.rightPrice, updatedAt: 0, recent: [] });
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
        const now = Date.now();
        state.recent.push({ at: now, buy: buyQuote, sell: sellQuote });
        while (state.recent.length > 0 && state.recent[0].at < now - 30_000) state.recent.shift();
        state.buyQuote = state.recent.reduce((sum, item) => sum + item.buy, 0);
        state.sellQuote = state.recent.reduce((sum, item) => sum + item.sell, 0);
        state.volume = state.buyQuote + state.sellQuote;
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
        const identityColor = side === "buy"
            ? territoryColor
            : (territory === "left" ? "#a85e27" : "#0b8e94");
        const material = new B.StandardMaterial(`whale-ocean-fish-${territory}-${side}`, scene);
        material.diffuseColor = B.Color3.FromHexString(identityColor);
        material.emissiveColor = B.Color3.FromHexString(identityColor).scale(0.22);
        const body = B.MeshBuilder.CreateSphere(`whale-ocean-fish-body-${territory}-${side}`, { diameter: 1, segments: 6 }, scene);
        body.material = material;
        body.isVisible = false;
        const tail = B.MeshBuilder.CreateCylinder(`whale-ocean-fish-tail-${territory}-${side}`, { height: 0.55, diameterTop: 0, diameterBottom: 0.45, tessellation: 3 }, scene);
        tail.material = material;
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
        this.fishGroups.push({ side, symbol, territory, body, tail, agents, matrices: new Float32Array(capacity * 16), targetCount: 0, baseline: 0, activity: 0, flowBias: 0 });
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
        for (const group of this.fishGroups) {
            if (group.symbol !== symbol || group.side !== side) continue;
            group.baseline = group.baseline === 0 ? Math.max(quote, 1) : group.baseline * 0.97 + Math.max(quote, 1) * 0.03;
            group.activity = Math.max(0, Math.min(1, group.activity * 0.92 + normalizeActivity(activeQuote || quote, group.baseline) * 0.08));
            const pressure = computePressure(state.buyQuote, state.sellQuote);
            const pressureStrength = side === "buy" ? pressure.buy ?? 0 : pressure.sell ?? 0;
            group.flowBias = ((pressure.buy ?? 0) - (pressure.sell ?? 0)) * (group.territory === "left" ? 1 : -1) * 0.012;
            group.targetCount = visualDensity(quote, group.baseline, pressureStrength, this.quality);
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
                writeMatrix(B, group.matrices, index, agent.position, yaw, pitch, 0.16 + agent.seed * 0.1, matrix, scale, rotation);
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
        const fromX = territory === "left" ? -17 : 17;
        const toX = territory === "left" ? -1.5 : 1.5;
        root.position.set(fromX, -3.2, 0.5);
        root.scaling.z = 0.55;
        const tail = B.MeshBuilder.CreateCylinder(`whale-ocean-event-tail-${event.id}`, { height: 0.9, diameterTop: 0, diameterBottom: 0.75, tessellation: 3 }, scene);
        tail.material = material;
        tail.rotation.z = Math.PI / 2;
        tail.position.x = -1.4;
        tail.parent = root;
        const sonar = B.MeshBuilder.CreateTorus(`whale-ocean-sonar-${event.id}`, { diameter: 3.5, thickness: 0.025, tessellation: 24 }, scene);
        sonar.material = material;
        sonar.rotation.x = Math.PI / 2;
        sonar.parent = root;
        this.whales.push({ root, startedAt: performance.now(), duration: event.kind === "whale" ? 8_500 : 5_000, fromX, toX });
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
            event.root.visibility = Math.min(1, progress * 8, (1 - progress) * 8);
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
