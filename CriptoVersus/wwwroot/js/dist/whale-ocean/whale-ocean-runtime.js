import { acquireBabylon, releaseBabylon } from "../futurebol/futurebol-babylon-loader.js";
import { createOceanEnvironment } from "./ocean-environment.js";
import { flowStatusForConnection, guardWhaleOceanFlowStatus } from "./whale-ocean-flow-state.js";
import { cssPixelToRenderPixel, getTeamHorizontalBounds as calculateTeamHorizontalBounds, getTransitPath as calculateTransitPath, getDirectionalTransitPath as calculateDirectionalTransitPath, positionOnTransitPath, preserveTransitProgress, getUsefulOceanVerticalViewport, getWhaleOceanVerticalBands } from "./whale-ocean-geometry.js";
import { computePressure, formatCompactVolume, normalizeActivity, visualProfile, visualDensity, VolumeEventDetector, WHALE_OCEAN_SPECIES, WHALE_OCEAN_SIZE_CATEGORIES, DEFAULT_WHALE_OCEAN_VISUAL_BUDGET, adaptiveVisualBudgetForViewport, animalKindForFinancialVolume, animalKindForEvent, depthBandForKind, depthBandIndexForKind, isLargeAnimalKind, sizeCategoryForKind, quoteCurrencyForSymbol, swimDirectionForSide } from "./whale-ocean-model.js";
import { addCreatureCounts, cloneCreatureCounts, creaturePoints, creatureTradeCount, emptyCreatureCounts, oceanControl, sidePoints } from "./whale-ocean-scoreboard.js";
const QUALITY_FPS = { Low: 30, Medium: 45, High: 60 };
const QUALITY_FLOW_ACTORS = { Low: 2, Medium: 4, High: 5 };
const SPRITE_ASSET_VERSION = "20261113-whale-ocean-depth-bands-v14";
const MAX_VISIBLE_VOLUME_LABELS_DESKTOP = 10;
const MAX_VISIBLE_VOLUME_LABELS_MOBILE = 6;
const CAMERA_FOV = 0.8;
const CAMERA_RADIUS = 27;
const REFERENCE_CSS_PIXELS_PER_WORLD_UNIT = 700 / (2 * CAMERA_RADIUS * Math.tan(CAMERA_FOV / 2));
const SCHOOL_TRANSIT_RESERVE = 4;
const SCHOOL_OCCUPANCY_SHARE = 0.55;
const MINIMUM_SIZE_WARNING_INTERVAL_MS = 5000;
const DEPTH_WORLD_SPREAD = 2.2;
const LABEL_COLLISION_GAP_PX = 5;
const SPRITE_COLLISION_GAP_PX = 8;
const MAX_PENDING_EVENT_QUEUE_DIAGNOSTIC = 32;
export class WhaleOceanRuntime {
    constructor(options) {
        this.detector = new VolumeEventDetector();
        this.symbols = new Map();
        this.fishGroups = [];
        this.spriteAtlases = new Map();
        this.spriteManagers = [];
        this.bubbles = [];
        this.flowActors = [];
        this.pendingFlows = new Map();
        this.whales = [];
        this.pendingEvents = [];
        this.lastBatchSequence = new Map();
        this.scoreStates = new Map();
        this.seenEventIds = new Set();
        this.B = null;
        this.engine = null;
        this.scene = null;
        this.camera = null;
        this.environment = null;
        this.renderObserver = null;
        this.resizeHandler = null;
        this.visibilityHandler = null;
        this.paused = false;
        this.connected = false;
        this.replaying = false;
        this.replayComplete = false;
        this.disposed = false;
        this.lastFrame = 0;
        this.frameAccumulator = 0;
        this.alertCount = 0;
        this.randomState = 0x51f15e;
        this.lastDiagnosticsAt = 0;
        this.lastDebugSummaryAt = 0;
        this.lastReceiveAt = 0;
        this.lastNoEventWarningAt = 0;
        this.nextFlowId = 1;
        this.labelLayer = null;
        this.labelLayerOwned = false;
        this.labelPlacements = [];
        this.undersizedWarnedIds = new Set();
        this.lastSizeWarningAt = 0;
        this.geometryDebugOverlay = null;
        this.options = options;
        const requestedBudget = options.visualBudget ?? {};
        this.requestedBudget = requestedBudget;
        this.budget = {
            ...DEFAULT_WHALE_OCEAN_VISUAL_BUDGET,
            ...requestedBudget,
            maxVisibleAnimals: Math.max(4, Math.min(24, Math.round(requestedBudget.maxVisibleAnimals ?? DEFAULT_WHALE_OCEAN_VISUAL_BUDGET.maxVisibleAnimals))),
            maxLargeHighlightsPerTerritory: Math.max(1, Math.min(2, Math.round(requestedBudget.maxLargeHighlightsPerTerritory ?? DEFAULT_WHALE_OCEAN_VISUAL_BUDGET.maxLargeHighlightsPerTerritory))),
            maxSchoolAnimalsPerGroup: Math.max(1, Math.min(6, Math.round(requestedBudget.maxSchoolAnimalsPerGroup ?? DEFAULT_WHALE_OCEAN_VISUAL_BUDGET.maxSchoolAnimalsPerGroup))),
            maxOccupancyPerTerritory: Math.max(6, Math.min(14, requestedBudget.maxOccupancyPerTerritory ?? DEFAULT_WHALE_OCEAN_VISUAL_BUDGET.maxOccupancyPerTerritory)),
            windowMs: Math.max(5000, Math.min(120000, Math.round(requestedBudget.windowMs ?? DEFAULT_WHALE_OCEAN_VISUAL_BUDGET.windowMs)))
        };
        this.canvas = options.canvas;
        this.root = this.canvas.closest(".whale-ocean");
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
        this.seedScoreState(options.leftSymbol, options.scoreboard?.teamA);
        this.seedScoreState(options.rightSymbol, options.scoreboard?.teamB);
    }
    async initialize() {
        this.debugInit();
        this.B = await acquireBabylon();
        if (this.disposed)
            return;
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
        this.adaptBudgetToViewport();
        this.environment = createOceanEnvironment({
            babylon: this.B,
            scene: this.scene,
            camera: this.camera,
            engine: this.engine
        });
        await this.buildSpriteLibrary();
        if (this.disposed)
            return;
        const babylon = this.B;
        const scene = this.scene;
        if (!babylon || !this.engine || !scene)
            throw new Error("Whale Ocean Babylon initialization completed without a live scene.");
        if (this.options.diagnostic === "sprites") {
            this.buildSpriteDiagnostic();
            this.setFlowStatus("DIAGNOSTIC_SPRITES", "sprite diagnostic initialized");
        }
        else {
            this.buildFishGroups();
            this.buildBubbles(babylon, scene);
            this.updateHud();
            this.refreshDiagnostics(Date.now(), true);
            if (this.options.diagnostic === "showcase") {
                this.buildShowcaseDiagnostic();
                this.setFlowStatus("DIAGNOSTIC_SHOWCASE", "showcase diagnostic initialized");
            }
        }
        this.renderObserver = this.scene.onBeforeRenderObservable.add(() => this.frame());
        this.engine.runRenderLoop(() => {
            if (!this.paused && this.scene)
                this.scene.render();
        });
        this.resizeHandler = () => {
            this.engine?.resize();
            this.environment?.resize();
            this.adaptBudgetToViewport();
            this.resizeArena();
            this.updateTerritoryDivider();
            this.updateGeometryDebugOverlay();
        };
        window.addEventListener("resize", this.resizeHandler, { passive: true });
        this.visibilityHandler = () => this.setPaused(document.hidden);
        document.addEventListener("visibilitychange", this.visibilityHandler);
        this.updateTerritoryDivider();
        this.updateGeometryDebugOverlay();
        if (!this.options.diagnostic)
            this.setFlowStatus(this.matchFinished ? "FINALIZED" : "BOOTSTRAP_PENDING", "renderer initialized");
    }
    receive(batch) {
        this.debugReceive(batch);
        if (this.disposed || this.matchFinished || batch.matchId !== this.options.matchId)
            return;
        const symbol = batch.symbol.trim().toUpperCase();
        const state = this.symbols.get(symbol);
        if (!state) {
            this.debugFilter(batch, "unmatched_symbol");
            return;
        }
        const sequenceKey = this.sequenceKey(batch.sourceId, symbol);
        const lastSequence = this.lastBatchSequence.get(sequenceKey) ?? 0;
        if (!Number.isFinite(batch.sequence)) {
            this.debugFilter(batch, "invalid_sequence");
            return;
        }
        if (batch.sequence <= lastSequence) {
            this.debugFilter(batch, batch.sequence === lastSequence ? "duplicate_sequence" : "late_sequence");
            return;
        }
        this.lastBatchSequence.set(sequenceKey, batch.sequence);
        this.acceptScoreBatch(symbol, batch);
        const buyQuote = parseNumber(batch.takerBuyQuote);
        const sellQuote = parseNumber(batch.takerSellQuote);
        const totalQuote = buyQuote + sellQuote;
        const now = Date.now();
        this.lastReceiveAt = now;
        state.recent.push({ at: now, buy: buyQuote, sell: sellQuote });
        while (state.recent.length > 0 && state.recent[0].at < now - this.budget.windowMs)
            state.recent.shift();
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
        const origin = batch.isReplay ? "REPLAY" : "LIVE";
        const tradeCount = Math.max(0, Math.round(batch.tradeCount));
        this.updateGroup(symbol, "buy", buyQuote, side === "buy" ? activity : 0, tradeCount, origin, now);
        this.updateGroup(symbol, "sell", sellQuote, side === "sell" ? activity : 0, tradeCount, origin, now);
        if (batch.isReplay) {
            if (!this.replayComplete) {
                this.replaying = true;
                this.setFlowStatus("REPLAY", "replay batch received");
            }
        }
        else {
            this.replaying = false;
            this.setFlowStatus("LIVE", "live batch received");
            const event = this.detector.ingest(batch);
            if (event)
                this.spawnEvent(event);
            else {
                if (buyQuote > 0)
                    this.enqueueFlow(symbol, "buy", buyQuote, state.baseline, now);
                if (sellQuote > 0)
                    this.enqueueFlow(symbol, "sell", sellQuote, state.baseline, now);
            }
        }
        this.trySpawnPendingFlows(now);
        this.rebalancePopulation();
        this.updateHud();
        this.refreshDiagnostics(now, true);
        this.debugFilter(batch, "accepted");
        this.debugSummary(now);
    }
    setPaused(paused) {
        this.paused = paused;
        this.setFlowStatus(paused ? "PAUSED" : this.replaying ? "REPLAY" : flowStatusForConnection(this.connected, this.hasLiveData()), paused ? "pause requested" : "pause released");
        this.write("pause", paused ? "PAUSED" : "LIVE");
    }
    setConnectionState(connected) {
        this.connected = connected;
        if (!this.paused && !this.replaying)
            this.setFlowStatus(flowStatusForConnection(connected, this.hasLiveData()), connected ? "SignalR connected; awaiting Money Flow data" : "SignalR disconnected");
    }
    completeReplay() {
        this.replayComplete = true;
        this.replaying = false;
        if (!this.paused)
            this.setFlowStatus(flowStatusForConnection(this.connected, this.hasLiveData()), "replay completed");
    }
    setScoreboard(scoreboard) {
        if (!scoreboard || scoreboard.matchId !== this.options.matchId)
            return;
        this.options.scoreboard = scoreboard;
        this.seedScoreState(this.options.leftSymbol, scoreboard.teamA);
        this.seedScoreState(this.options.rightSymbol, scoreboard.teamB);
        this.updateScoreboardHud();
    }
    setMatchFinished(finished) {
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
    setOfficialMatchState(finished, rawStatus, startTimeUtc, endTimeUtc) {
        this.officialStatus = finished ? "FINALIZED" : "LIVE";
        this.officialRawStatus = rawStatus;
        this.officialStartTimeUtc = startTimeUtc;
        this.officialEndTimeUtc = endTimeUtc;
        this.setMatchFinished(finished);
    }
    async setQuality(quality) {
        if (this.quality === quality || this.disposed)
            return;
        this.quality = quality;
        this.engine?.setHardwareScalingLevel(quality === "Low" ? 1.6 : quality === "Medium" ? 1.25 : 1);
        this.adaptBudgetToViewport();
        this.rebalancePopulation();
        this.trySpawnPendingFlows(Date.now());
        this.write("quality", quality);
    }
    adaptBudgetToViewport() {
        const next = adaptiveVisualBudgetForViewport(this.canvas.clientWidth, this.canvas.clientHeight, this.quality, this.requestedBudget);
        const changed = next.maxVisibleAnimals !== this.budget.maxVisibleAnimals
            || next.maxSchoolAnimalsPerGroup !== this.budget.maxSchoolAnimalsPerGroup
            || next.maxOccupancyPerTerritory !== this.budget.maxOccupancyPerTerritory;
        Object.assign(this.budget, next);
        if (changed && this.options.debugWhaleOcean !== false) {
            console.info("[WhaleOcean][BUDGET] adaptive viewport budget", {
                viewportCss: { width: this.canvas.clientWidth, height: this.canvas.clientHeight },
                quality: this.quality,
                maxVisibleAnimals: this.budget.maxVisibleAnimals,
                maxSchoolAnimalsPerGroup: this.budget.maxSchoolAnimalsPerGroup,
                maxOccupancyPerTerritory: this.budget.maxOccupancyPerTerritory
            });
        }
    }
    async dispose() {
        if (this.disposed)
            return;
        this.disposed = true;
        if (this.renderObserver && this.scene)
            this.scene.onBeforeRenderObservable.remove(this.renderObserver);
        if (this.resizeHandler)
            window.removeEventListener("resize", this.resizeHandler);
        if (this.visibilityHandler)
            document.removeEventListener("visibilitychange", this.visibilityHandler);
        this.engine?.stopRenderLoop();
        this.environment?.dispose();
        this.environment = null;
        for (const manager of this.spriteManagers)
            manager.dispose();
        if (this.labelLayer) {
            this.labelLayer.replaceChildren();
            if (this.labelLayerOwned)
                this.labelLayer.remove();
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
    async buildSpriteLibrary() {
        const B = this.B;
        const scene = this.scene;
        const response = await fetch(`/games/whale-ocean/sprites/manifest.json?v=${SPRITE_ASSET_VERSION}`, { cache: "no-cache" });
        if (!response.ok)
            throw new Error(`Whale Ocean sprite manifest returned ${response.status}.`);
        const manifest = await response.json();
        if (manifest.frameWidth !== 512 || manifest.frameHeight !== 256 || manifest.framesPerAnimation !== 12
            || manifest.atlas.columns !== 4 || manifest.atlas.rows !== 3)
            throw new Error("Whale Ocean sprite manifest has an unsupported atlas layout.");
        const atlasPromises = Object.entries(manifest.animations).map(async ([name, definition]) => {
            const territory = name.endsWith("_lima") ? "left" : "right";
            const atlasUrl = `/games/whale-ocean/sprites/${definition.atlas}?v=${SPRITE_ASSET_VERSION}`;
            const bounds = definition.bounds;
            if (!bounds || ![bounds.widthRatio, bounds.heightRatio, bounds.minXRatio, bounds.maxXRatio].every(Number.isFinite))
                throw new Error(`Whale Ocean sprite manifest is missing precomputed visual bounds for ${name}.`);
            const manager = new B.SpriteManager(`whale-ocean-sprites-${name}`, atlasUrl, Math.max(this.budget.maxVisibleAnimals, 24) + 16, { width: manifest.frameWidth, height: manifest.frameHeight }, scene, 0.01, B.Texture.NEAREST_SAMPLINGMODE);
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
    createAnimatedSprite(kind, territory, name, seed) {
        const B = this.B;
        const atlas = this.spriteAtlases.get(`${kind}:${territory}`);
        if (!atlas)
            throw new Error(`Missing Whale Ocean sprite atlas for ${kind}:${territory}.`);
        const sprite = new B.Sprite(name, atlas.manager);
        sprite.cellIndex = Math.floor(seed * 12) % 12;
        sprite.invertV = false;
        sprite.invertU = false;
        sprite.color = new B.Color4(1, 1, 1, 1);
        sprite.playAnimation(0, 11, true, 1000 / (atlas.fps * (0.9 + seed * 0.2)));
        sprite.isVisible = false;
        return sprite;
    }
    buildFishGroups() {
        const left = this.options.leftSymbol;
        const right = this.options.rightSymbol;
        this.createFishGroup(left, "left", "buy");
        this.createFishGroup(left, "left", "sell");
        this.createFishGroup(right, "right", "buy");
        this.createFishGroup(right, "right", "sell");
    }
    createFishGroup(symbol, territory, side) {
        const B = this.B;
        // Pools are deliberately small. The visible budget is shared by all four
        // symbol/direction groups and is further reduced by transient highlights.
        const capacity = this.budget.maxSchoolAnimalsPerGroup;
        const agents = [];
        for (let index = 0; index < capacity; index++) {
            const angle = this.random() * Math.PI * 2;
            const kind = "sardine";
            const sprite = this.createAnimatedSprite(kind, territory, `whale-ocean-fish-${territory}-${side}-${index}`, this.random());
            sprite.width = this.spriteWidthFor(kind, territory);
            sprite.height = sprite.width * 0.5;
            const anchor = this.schoolAnchor(territory, side, index);
            const agent = {
                position: new B.Vector3(0, anchor.y, anchor.z),
                velocity: new B.Vector3(Math.cos(angle) * 0.012, (this.random() - 0.5) * 0.01, Math.sin(angle) * 0.009),
                phase: this.random() * Math.PI * 2,
                seed: this.random(),
                sprite,
                kind,
                allocatedNotional: 0,
                label: null,
                labelText: "",
                debugId: `school-${territory}-${side}-${index}`,
                active: false,
                startX: 0,
                targetX: 0,
                direction: side === "buy" ? 1 : -1,
                territory,
                progress: 0,
                speedWorldPerSecond: 0,
                lastUpdatedAt: 0,
                completed: false,
                pathDepth: this.depthWorldForKind(kind),
                bandIndex: depthBandIndexForKind(kind),
                verticalOffsetPx: 0
            };
            this.configureFishPath(agent, territory, side, false, 0);
            agents.push(agent);
        }
        this.fishGroups.push({
            side, symbol, territory, agents, targetCount: 0, baseline: 0, activity: 0, flowBias: 0, lastActiveAt: 0,
            recentLots: [], schoolKind: "sardine", visibleCount: 0, lastLiveAt: 0, lastOrigin: null
        });
    }
    buildBubbles(B, scene) {
        if (this.disposed)
            return;
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
    cssPixelsPerWorldUnit() {
        const center = this.projectToCss(0, 0, 0);
        const oneWorldUnit = this.projectToCss(1, 0, 0);
        const projectedScale = center && oneWorldUnit ? Math.abs(oneWorldUnit.x - center.x) : 0;
        if (Number.isFinite(projectedScale) && projectedScale > 0)
            return projectedScale;
        return REFERENCE_CSS_PIXELS_PER_WORLD_UNIT;
    }
    depthWorldForBandIndex(index) {
        const camera = this.camera;
        const targetZ = camera?.target.z ?? 0;
        const cameraSide = Math.sign((camera?.position.z ?? -CAMERA_RADIUS) - targetZ) || -1;
        const normalized = 1 - Math.max(0, Math.min(4, index)) / 4;
        const offset = (normalized * 2 - 1) * DEPTH_WORLD_SPREAD;
        // The surface is farther from the front-facing camera and the bottom
        // is closer, while keeping the camera, alpha and beta unchanged.
        return targetZ - cameraSide * offset;
    }
    depthWorldForKind(kind) {
        return this.depthWorldForBandIndex(depthBandIndexForKind(kind));
    }
    worldYAtScreen(depth, screenCssY) {
        const B = this.B;
        const engine = this.engine;
        const camera = this.camera;
        const scene = this.scene;
        const clientWidth = this.canvas.clientWidth;
        const clientHeight = this.canvas.clientHeight;
        if (!B || !engine || !camera || !scene || clientWidth <= 0 || clientHeight <= 0)
            return null;
        const renderWidth = engine.getRenderWidth();
        const renderHeight = engine.getRenderHeight();
        if (renderWidth <= 0 || renderHeight <= 0)
            return null;
        const ray = scene.createPickingRay(cssPixelToRenderPixel(clientWidth / 2, clientWidth, renderWidth), cssPixelToRenderPixel(screenCssY, clientHeight, renderHeight), B.Matrix.Identity(), camera, false);
        if (Math.abs(ray.direction.z) < 0.0001)
            return null;
        const distance = (depth - ray.origin.z) / ray.direction.z;
        if (!Number.isFinite(distance) || distance < 0)
            return null;
        const y = ray.origin.y + ray.direction.y * distance;
        return Number.isFinite(y) ? y : null;
    }
    verticalBandLayout() {
        const height = this.canvas.clientHeight;
        const screenBands = getWhaleOceanVerticalBands(height, this.canvas.clientWidth);
        return screenBands.map(band => {
            const depth = this.depthWorldForBandIndex(band.index);
            const topWorld = this.worldYAtScreen(depth, band.top) ?? (this.camera?.target.y ?? 0);
            const bottomWorld = this.worldYAtScreen(depth, band.bottom) ?? (this.camera?.target.y ?? 0);
            const centerWorld = this.worldYAtScreen(depth, band.center) ?? (topWorld + bottomWorld) / 2;
            return { ...band, depth, topWorld, bottomWorld, centerWorld };
        });
    }
    verticalBandForKind(kind) {
        return this.verticalBandForIndex(depthBandIndexForKind(kind), kind);
    }
    verticalBandForIndex(index, fallbackKind) {
        const safeIndex = Math.max(0, Math.min(4, Math.round(index)));
        return this.verticalBandLayout()[safeIndex] ?? {
            name: getWhaleOceanVerticalBands(this.canvas.clientHeight, this.canvas.clientWidth)[safeIndex]?.name ?? depthBandForKind(fallbackKind),
            index: safeIndex,
            top: 0,
            bottom: this.canvas.clientHeight,
            center: this.canvas.clientHeight / 2,
            depth: this.depthWorldForBandIndex(safeIndex),
            topWorld: this.camera?.target.y ?? 0,
            bottomWorld: this.camera?.target.y ?? 0,
            centerWorld: this.camera?.target.y ?? 0
        };
    }
    worldPositionInVerticalBand(kind, territory, sprite, phase, seed, progress, bandIndex = depthBandIndexForKind(kind), verticalOffsetPx = 0) {
        const band = this.verticalBandForIndex(bandIndex, kind);
        const atlas = this.spriteAtlases.get(`${kind}:${territory}`);
        const bodyHeightRatio = atlas?.visualHeightRatio ?? 0.5;
        const bodyHalfCss = sprite.height * bodyHeightRatio * this.cssPixelsPerWorldUnitAtDepth(band.depth) / 2;
        const minCenter = band.top + bodyHalfCss + 4;
        const maxCenter = band.bottom - bodyHalfCss - 4;
        const center = maxCenter >= minCenter ? Math.max(minCenter, Math.min(maxCenter, band.center)) : band.center;
        const variation = maxCenter >= minCenter ? Math.min((maxCenter - minCenter) / 2, (band.bottom - band.top) * 0.28) : 0;
        // Keep the outer corridors visually anchored to the useful viewport
        // edges. The bias is soft and still leaves the sinusoidal swim motion
        // intact, but prevents random phase from collapsing the whole school
        // toward the middle of the ocean.
        const edgeBias = band.index === 0 ? -variation * 0.55 : band.index === 4 ? variation * 0.55 : 0;
        const requestedScreenY = center
            + Math.sin(phase + progress * Math.PI * 2 + seed * Math.PI * 0.7) * variation
            + edgeBias
            + verticalOffsetPx;
        const screenY = maxCenter >= minCenter
            ? Math.max(minCenter, Math.min(maxCenter, requestedScreenY))
            : center;
        return {
            y: this.worldYAtScreen(band.depth, screenY) ?? band.centerWorld,
            z: band.depth
        };
    }
    depthPreference(kind, bandIndex) {
        const category = sizeCategoryForKind(kind);
        const preferred = category === "small" ? 0.7
            : category === "medium" ? 1.6
                : category === "large" ? 2.4
                    : category === "shark" ? 3.1
                        : 4;
        const distance = Math.abs(bandIndex - preferred);
        let penalty = distance * 0.22 + distance * distance * 0.08;
        const hasWhale = this.whales.some(event => event.kind === "whale")
            || this.pendingEvents.some(event => event.kind === "whale");
        const hasShark = this.whales.some(event => event.kind === "shark")
            || this.pendingEvents.some(event => event.kind === "shark");
        // These are soft reserves, never exclusions. When a highlight is not
        // present, the lower bands deliberately become attractive to ordinary
        // fish so the ocean does not collapse into the surface.
        if (bandIndex === 4 && kind !== "whale")
            penalty += hasWhale ? 1.6 : -1.05;
        if (bandIndex === 3 && kind !== "shark")
            penalty += hasShark ? 0.9 : -0.45;
        return penalty;
    }
    activeOccupancyVisuals() {
        const visuals = [];
        for (const group of this.fishGroups) {
            for (const agent of group.agents) {
                if (!agent.active || !agent.sprite.isVisible)
                    continue;
                visuals.push({
                    id: agent.debugId,
                    territory: group.territory,
                    kind: agent.kind,
                    bandIndex: agent.bandIndex,
                    sprite: agent.sprite,
                    labelWidthPx: agent.label?.offsetWidth ?? 0,
                    labelHeightPx: agent.label?.offsetHeight ?? 0
                });
            }
        }
        for (const actor of this.flowActors)
            visuals.push({ id: actor.id, territory: actor.territory, kind: actor.kind, bandIndex: actor.bandIndex, sprite: actor.sprite, labelWidthPx: actor.labelWidthPx, labelHeightPx: actor.labelHeightPx });
        for (const event of this.whales)
            visuals.push({ id: event.eventId, territory: event.territory, kind: event.kind, bandIndex: event.bandIndex, sprite: event.sprite, labelWidthPx: event.label?.offsetWidth ?? 0, labelHeightPx: event.label?.offsetHeight ?? 24 });
        return visuals;
    }
    projectedBodyRect(kind, territory, sprite) {
        const projected = this.projectToCss(sprite.position.x, sprite.position.y, sprite.position.z);
        if (!projected)
            return null;
        const atlas = this.spriteAtlases.get(`${kind}:${territory}`);
        const width = sprite.width * (atlas?.visualWidthRatio ?? 1) * this.cssPixelsPerWorldUnitAtDepth(sprite.position.z);
        const height = sprite.height * (atlas?.visualHeightRatio ?? 0.5) * this.cssPixelsPerWorldUnitAtDepth(sprite.position.z);
        return { left: projected.x - width / 2, right: projected.x + width / 2, top: projected.y - height / 2, bottom: projected.y + height / 2 };
    }
    projectedLabelRect(projected, width, height, below) {
        return this.labelRect(projected.x, projected.y + (below ? 12 : -12), Math.max(24, width || 0), Math.max(18, height || 24), below, this.canvas.clientHeight);
    }
    rectArea(rect) {
        return Math.max(0, rect.right - rect.left) * Math.max(0, rect.bottom - rect.top);
    }
    rectanglesOverlapWithGap(a, b, gap) {
        return a.left < b.right + gap && a.right + gap > b.left && a.top < b.bottom + gap && a.bottom + gap > b.top;
    }
    projectedOccupancyScore(territory, bandIndex, candidate = []) {
        const band = this.verticalBandForIndex(bandIndex, "sardine");
        const bandArea = Math.max(1, this.canvas.clientWidth * Math.max(1, band.bottom - band.top));
        const territoryVisuals = this.activeOccupancyVisuals().filter(item => item.territory === territory);
        const existing = territoryVisuals.filter(item => item.bandIndex === bandIndex);
        let score = existing.reduce((sum, item) => {
            const body = this.projectedBodyRect(item.kind, item.territory, item.sprite);
            if (!body)
                return sum;
            const label = this.projectToCss(item.sprite.position.x, item.sprite.position.y, item.sprite.position.z);
            const labelRect = label && item.labelWidthPx > 0
                ? this.projectedLabelRect(label, item.labelWidthPx, item.labelHeightPx, this.labelBelowForKind(item.kind))
                : null;
            return sum + 0.2 + this.rectArea(body) / bandArea + (labelRect ? this.rectArea(labelRect) / bandArea : 0);
        }, 0);
        // A band is a preference, not a corridor. Once there are enough
        // animals, empty bands must beat a slightly better species preference
        // so the projected population covers the useful ocean vertically.
        // Existing animals are never reassigned here; this only affects a new
        // spawn/activation and therefore cannot make a live animal jump.
        const bandCounts = this.verticalBandLayout().map(candidateBand => territoryVisuals.filter(item => item.bandIndex === candidateBand.index).length);
        const leastOccupiedBand = Math.min(...bandCounts);
        const occupancyDeficit = Math.max(0, bandCounts[bandIndex] - leastOccupiedBand);
        score += occupancyDeficit * 0.82 + existing.length * 0.18;
        for (const candidateRect of candidate) {
            score += this.rectArea(candidateRect) / bandArea;
            for (const item of territoryVisuals) {
                const body = this.projectedBodyRect(item.kind, item.territory, item.sprite);
                if (body && this.rectanglesOverlapWithGap(body, candidateRect, SPRITE_COLLISION_GAP_PX))
                    score += 12;
            }
        }
        return score;
    }
    chooseBandIndex(kind, territory, side, spriteWidth, labelWidthPx, labelHeightPx, phase, seed) {
        const safeHeight = spriteWidth * 0.5;
        const candidates = this.verticalBandLayout().map(band => {
            const safeSpriteWidth = spriteWidth * 1.12;
            const path = this.getTransitPath(territory, side, band.depth, this.spriteHalfWidth(safeSpriteWidth), 0, this.visibleBodyExtents(kind, territory, safeSpriteWidth));
            const progress = 0.42;
            const x = positionOnTransitPath(path, progress);
            const vertical = this.worldPositionInVerticalBand(kind, territory, { width: safeSpriteWidth, height: safeHeight }, phase, seed, progress, band.index);
            const projected = this.projectToCss(x, vertical.y, vertical.z);
            if (!projected)
                return { index: band.index, score: Number.POSITIVE_INFINITY };
            const bodyWidth = spriteWidth * (this.spriteAtlases.get(`${kind}:${territory}`)?.visualWidthRatio ?? 1) * this.cssPixelsPerWorldUnitAtDepth(band.depth);
            const bodyHeight = safeHeight * (this.spriteAtlases.get(`${kind}:${territory}`)?.visualHeightRatio ?? 0.5) * this.cssPixelsPerWorldUnitAtDepth(band.depth);
            const body = { left: projected.x - bodyWidth / 2, right: projected.x + bodyWidth / 2, top: projected.y - bodyHeight / 2, bottom: projected.y + bodyHeight / 2 };
            const label = this.projectedLabelRect(projected, labelWidthPx, labelHeightPx, this.labelBelowForKind(kind));
            return {
                index: band.index,
                score: this.projectedOccupancyScore(territory, band.index, [body, label]) + this.depthPreference(kind, band.index)
            };
        });
        return candidates.sort((a, b) => a.score - b.score || a.index - b.index)[0]?.index ?? depthBandIndexForKind(kind);
    }
    cssPixelsPerWorldUnitAtDepth(depth) {
        const targetZ = this.camera?.target.z ?? 0;
        return this.cssPixelsPerWorldUnit() * CAMERA_RADIUS / Math.max(0.1, CAMERA_RADIUS + depth - targetZ);
    }
    labelBelowForKind(kind, alternate = false) {
        const index = depthBandIndexForKind(kind);
        return index < 2 || (index === 2 && alternate);
    }
    /** Visible body length (atlas margins excluded) in world units. */
    bodyWorldLength(kind) {
        return WHALE_OCEAN_SPECIES[kind].bodyLengthPx / this.cssPixelsPerWorldUnit();
    }
    /** The transparent atlas frame is not a territory boundary. */
    visibleBodyHalfWidth(kind, territory, spriteWidth) {
        const extents = this.visibleBodyExtents(kind, territory, spriteWidth);
        return Math.max(extents.left, extents.right);
    }
    visibleBodyExtents(kind, territory, spriteWidth) {
        const atlas = this.spriteAtlases.get(`${kind}:${territory}`);
        if (!atlas)
            return { left: Math.max(0, spriteWidth / 2), right: Math.max(0, spriteWidth / 2) };
        return {
            left: Math.max(0, spriteWidth * (0.5 - atlas.visualMinXRatio)),
            right: Math.max(0, spriteWidth * (atlas.visualMaxXRatio - 0.5))
        };
    }
    spriteHalfWidth(spriteWidth) {
        return Math.max(0, spriteWidth / 2);
    }
    spriteWidthFor(kind, territory) {
        const atlas = this.spriteAtlases.get(`${kind}:${territory}`);
        if (!atlas || atlas.visualWidthRatio <= 0)
            throw new Error(`Whale Ocean sprite metrics are unavailable for ${kind}:${territory}.`);
        return this.bodyWorldLength(kind) / atlas.visualWidthRatio;
    }
    buildSpriteDiagnostic() {
        const kinds = Object.keys(WHALE_OCEAN_SPECIES);
        for (const [index, kind] of kinds.entries()) {
            const row = Math.floor(index / 2);
            const rowColumn = index % 2;
            for (const [column, territory] of ["left", "right"].entries()) {
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
    buildShowcaseDiagnostic() {
        const now = Date.now();
        const flows = [
            { symbol: this.options.leftSymbol, side: "buy", quote: 7500, baseline: 12000 },
            { symbol: this.options.leftSymbol, side: "sell", quote: 10500, baseline: 16000 },
            { symbol: this.options.rightSymbol, side: "buy", quote: 6250, baseline: 11000 },
            { symbol: this.options.rightSymbol, side: "sell", quote: 9400, baseline: 14000 }
        ];
        for (const flow of flows)
            this.enqueueFlow(flow.symbol, flow.side, flow.quote, flow.baseline, now);
        this.trySpawnPendingFlows(now);
        this.spawnEvent({
            id: "diagnostic-shark",
            kind: "shark",
            symbol: this.options.leftSymbol,
            side: "buy",
            notionalUsdt: 850000,
            ratio: 5,
            sequence: 1,
            eventTimeUtc: new Date().toISOString()
        });
        this.spawnEvent({
            id: "diagnostic-whale",
            kind: "whale",
            symbol: this.options.rightSymbol,
            side: "sell",
            notionalUsdt: 2400000,
            ratio: 9,
            sequence: 2,
            eventTimeUtc: new Date().toISOString()
        });
        this.rebalancePopulation();
    }
    updateGroup(symbol, side, quote, activeQuote, tradeCount, origin, now) {
        const state = this.symbols.get(symbol);
        if (!state)
            return;
        for (const group of this.fishGroups) {
            if (group.symbol !== symbol || group.side !== side)
                continue;
            group.recentLots = group.recentLots.filter(lot => lot.at >= now - this.budget.windowMs);
            if (quote <= 0) {
                group.activity *= 0.86;
                group.flowBias *= 0.8;
                group.targetCount *= 0.78;
                if (group.targetCount < 0.5)
                    group.targetCount = 0;
                continue;
            }
            const kind = animalKindForFinancialVolume(quote, group.baseline, group.schoolKind);
            group.schoolKind = kind;
            group.recentLots.push({ at: now, quote, tradeCount, origin, kind });
            group.lastOrigin = origin;
            if (origin === "LIVE")
                group.lastLiveAt = now;
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
    decayInactiveFish(now) {
        for (const group of this.fishGroups) {
            group.recentLots = group.recentLots.filter(lot => lot.at >= now - this.budget.windowMs);
            if (group.recentLots.length > 0)
                continue;
            group.activity *= 0.90;
            group.flowBias *= 0.88;
            group.targetCount *= 0.80;
            if (group.targetCount < 0.5)
                group.targetCount = 0;
        }
        this.rebalancePopulation();
    }
    /** Financial totals expire on the rolling window; in-flight animals finish independently. */
    expireFinancialWindow(now) {
        let changed = false;
        for (const state of this.symbols.values()) {
            const previousLength = state.recent.length;
            state.recent = state.recent.filter(item => item.at >= now - this.budget.windowMs);
            if (state.recent.length === previousLength)
                continue;
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
    rebalancePopulation() {
        // Schools leave headroom so aggregated transit animals and large
        // events can still enter when the window is busy; nothing is created
        // just to fill the budget.
        const available = Math.max(0, this.budget.maxVisibleAnimals - SCHOOL_TRANSIT_RESERVE - this.flowActors.length - this.whales.length);
        const groups = [...this.fishGroups].sort((a, b) => b.targetCount - a.targetCount);
        for (const group of groups)
            group.visibleCount = 0;
        const usedByTerritory = { left: 0, right: 0 };
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
    estimatedSchoolOccupancy(group) {
        const bodyPx = WHALE_OCEAN_SPECIES[group.schoolKind].bodyLengthPx;
        return Math.max(0.8, Math.min(4.4, bodyPx / 50 * 0.7 + 0.35));
    }
    schoolAnchor(territory, side, index) {
        const visible = this.getVisibleHorizontalBounds(0);
        const teamLeft = territory === "left" ? visible.left : visible.center;
        const teamRight = territory === "left" ? visible.center : visible.right;
        const centerX = (teamLeft + teamRight) / 2;
        const surfaceBand = this.verticalBandForKind("sardine");
        const angle = index * 2.399963;
        const widthScale = Math.max(0.75, Math.min(1.8, Math.abs(teamRight - teamLeft) / 8.3));
        const radius = (0.35 + Math.sqrt(index + 0.5) * 0.72) * widthScale;
        return {
            x: centerX + Math.cos(angle) * radius * 1.25,
            y: surfaceBand.centerWorld,
            z: surfaceBand.depth
        };
    }
    configureFishPath(agent, territory, side, preserveProgress, now) {
        const previousPath = { fromX: agent.startX, toX: agent.targetX };
        const safeWidth = Math.max(0.01, (agent.sprite.width || this.spriteWidthFor(agent.kind, territory)) * 1.12);
        const verticalBand = this.verticalBandForIndex(agent.bandIndex, agent.kind);
        agent.pathDepth = verticalBand.depth;
        const path = this.getTransitPath(territory, side, agent.pathDepth, this.spriteHalfWidth(safeWidth), 0, this.visibleBodyExtents(agent.kind, territory, safeWidth));
        agent.progress = preserveProgress && agent.active
            ? preserveTransitProgress(previousPath, agent.position.x, path)
            : 0;
        agent.startX = path.fromX;
        agent.targetX = path.toX;
        agent.direction = path.toX >= path.fromX ? 1 : -1;
        agent.speedWorldPerSecond = Math.max(0.01, Math.abs(path.toX - path.fromX) / (9 + Math.min(7, Math.abs(path.toX - path.fromX) * 0.3)));
        agent.lastUpdatedAt = now;
        agent.position.x = positionOnTransitPath(path, agent.progress);
        const vertical = this.worldPositionInVerticalBand(agent.kind, territory, agent.sprite, agent.phase, agent.seed, agent.progress, agent.bandIndex, agent.verticalOffsetPx);
        agent.position.y = vertical.y;
        agent.position.z = vertical.z;
        agent.sprite.position.copyFrom(agent.position);
    }
    frame() {
        if (this.paused || this.disposed || !this.scene)
            return;
        const now = performance.now();
        const elapsed = Math.min(80, now - this.lastFrame || 16);
        this.lastFrame = now;
        this.environment?.update(elapsed / 1000);
        this.frameAccumulator += elapsed;
        if (this.frameAccumulator < 1000 / QUALITY_FPS[this.quality])
            return;
        this.frameAccumulator = 0;
        const seconds = now / 1000;
        const wallClockNow = Date.now();
        this.labelPlacements = [];
        if (!this.options.diagnostic) {
            this.expireFinancialWindow(wallClockNow);
            this.decayInactiveFish(wallClockNow);
        }
        this.updateBubbles(seconds);
        this.updateFish(seconds, elapsed / 16.67);
        this.updateFlowActors(now);
        this.updateWhales(now);
        this.resolveProjectedSpriteSeparation();
        this.resolveScreenLabels();
        this.updateGeometryDebugOverlay();
        this.promotePendingEvents();
        this.trySpawnPendingFlows(wallClockNow);
        this.refreshDiagnostics(wallClockNow);
        this.debugNoEventWarning(wallClockNow);
        this.debugSizeWarnings(wallClockNow);
    }
    updateFish(seconds, _factor) {
        this.rebalancePopulation();
        const now = performance.now();
        const largeByTerritory = {
            left: this.transientLargeCount("left"),
            right: this.transientLargeCount("right")
        };
        for (const group of this.fishGroups) {
            const desiredCount = Math.min(group.agents.length, Math.max(0, group.visibleCount));
            const allocations = this.allocateSchoolVolume(group, desiredCount);
            for (let index = 0; index < group.agents.length; index++) {
                const agent = group.agents[index];
                const wasInactive = !agent.active;
                if (!agent.active && index < desiredCount) {
                    agent.active = true;
                    agent.completed = false;
                }
                if (!agent.active) {
                    agent.sprite.isVisible = false;
                    this.removeLabel(agent.label);
                    agent.label = null;
                    agent.labelText = "";
                    continue;
                }
                const allocation = allocations[index];
                let visualKind = allocation?.kind ?? agent.kind;
                if (isLargeAnimalKind(visualKind)) {
                    if (largeByTerritory[group.territory] >= this.budget.maxLargeHighlightsPerTerritory)
                        visualKind = visualKind === "swordfish" ? "barracuda" : "grouper";
                    else
                        largeByTerritory[group.territory]++;
                }
                const speciesChanged = agent.kind !== visualKind;
                this.assignAgentSpecies(agent, visualKind, group.territory, group.symbol, group.side, allocation?.notionalUsdt ?? agent.allocatedNotional);
                const size = this.spriteWidthFor(agent.kind, group.territory) * (1 + group.activity * 0.12 + agent.seed * 0.05);
                agent.sprite.width = size;
                agent.sprite.height = size * 0.5;
                if (wasInactive || speciesChanged) {
                    agent.bandIndex = this.chooseBandIndex(agent.kind, group.territory, group.side, size, agent.label?.offsetWidth ?? 0, agent.label?.offsetHeight ?? 0, agent.phase, agent.seed);
                    agent.verticalOffsetPx = (agent.seed - 0.5) * 10;
                    this.configureFishPath(agent, group.territory, group.side, !wasInactive, now);
                }
                const elapsedMs = agent.lastUpdatedAt > 0 ? Math.min(80, Math.max(0, now - agent.lastUpdatedAt)) : 0;
                agent.lastUpdatedAt = now;
                const distance = Math.abs(agent.targetX - agent.startX);
                agent.progress = distance > Number.EPSILON
                    ? Math.min(1, agent.progress + agent.speedWorldPerSecond * elapsedMs / 1000 / distance)
                    : 1;
                agent.position.x = positionOnTransitPath({ fromX: agent.startX, toX: agent.targetX }, agent.progress);
                const vertical = this.worldPositionInVerticalBand(agent.kind, group.territory, agent.sprite, agent.phase + seconds * 0.7, agent.seed, agent.progress, agent.bandIndex, agent.verticalOffsetPx);
                agent.position.y = vertical.y;
                agent.position.z = vertical.z;
                agent.sprite.position.copyFrom(agent.position);
                agent.sprite.invertU = agent.direction < 0;
                agent.sprite.color.a = Math.min(1, 0.72 + group.activity * 0.28) * Math.min(1, agent.progress / 0.08);
                agent.sprite.isVisible = true;
                if (agent.progress >= 1) {
                    agent.completed = true;
                    agent.active = false;
                    agent.sprite.isVisible = false;
                    this.removeLabel(agent.label);
                    agent.label = null;
                    agent.labelText = "";
                    continue;
                }
                this.ensureFishLabel(agent, this.fishLabelText(group, agent), group.side === "buy" ? "#36e7b0" : "#ff6b55");
                if (agent.label) {
                    const below = this.labelBelowForKind(agent.kind, index % 2 !== 0);
                    this.placeScreenLabel(agent.label, agent.position.x, agent.position.y + (below ? -size * 0.42 : size * 0.42), agent.position.z, agent.sprite.color.a, below, this.volumeLabelPriority(agent.kind, agent.allocatedNotional, 0), [this.projectedBodyRect(agent.kind, agent.territory, agent.sprite)].filter((rect) => rect !== null));
                }
            }
        }
    }
    getVisibleHorizontalBounds(depth) {
        const B = this.B;
        const engine = this.engine;
        const camera = this.camera;
        const scene = this.scene;
        const fallback = () => {
            if (!camera || !this.canvas.clientWidth || !this.canvas.clientHeight)
                return { left: 0, center: 0, right: 0 };
            const aspect = this.canvas.clientWidth / this.canvas.clientHeight;
            const distance = Math.max(1, Math.abs(depth - camera.globalPosition.z));
            const halfWidth = distance * Math.tan((camera.fov || CAMERA_FOV) / 2) * aspect;
            const center = camera.target.x;
            return { left: center - halfWidth, center, right: center + halfWidth };
        };
        if (!B || !engine || !camera || !scene)
            return fallback();
        const renderWidth = engine.getRenderWidth();
        const renderHeight = engine.getRenderHeight();
        const clientWidth = this.canvas.clientWidth;
        const clientHeight = this.canvas.clientHeight;
        if (renderWidth <= 0 || renderHeight <= 0 || clientWidth <= 0 || clientHeight <= 0)
            return fallback();
        // Babylon consumes render pixels. The divider and the canvas layout use
        // CSS pixels, so convert both through the same viewport dimensions.
        const rayXAtDepth = (screenCssX) => {
            const screenX = cssPixelToRenderPixel(screenCssX, clientWidth, renderWidth);
            const screenY = cssPixelToRenderPixel(clientHeight / 2, clientHeight, renderHeight);
            const ray = scene.createPickingRay(screenX, screenY, B.Matrix.Identity(), camera, false);
            if (Math.abs(ray.direction.z) < 0.0001)
                return null;
            const distance = (depth - ray.origin.z) / ray.direction.z;
            if (!Number.isFinite(distance) || distance < 0)
                return null;
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
    getTeamHorizontalBounds(territory, depth, padding) {
        const visible = this.getVisibleHorizontalBounds(depth);
        return calculateTeamHorizontalBounds(visible, territory, padding);
    }
    getTransitPath(territory, side, depth, outerPadding, spritePadding, bodyExtents) {
        const visible = this.getVisibleHorizontalBounds(depth);
        return bodyExtents
            ? calculateDirectionalTransitPath(visible, territory, side, outerPadding, bodyExtents)
            : calculateTransitPath(visible, territory, side, outerPadding, spritePadding);
    }
    resizeArena() {
        if (this.disposed)
            return;
        const now = performance.now();
        for (const group of this.fishGroups) {
            for (const agent of group.agents) {
                if (agent.active)
                    this.configureFishPath(agent, group.territory, group.side, true, now);
            }
        }
        for (const actor of this.flowActors) {
            const previousPath = { fromX: actor.startX, toX: actor.targetX };
            const safeSize = actor.size * 1.12;
            actor.pathDepth = this.verticalBandForIndex(actor.bandIndex, actor.kind).depth;
            const path = this.getTransitPath(actor.territory, actor.side, actor.pathDepth, this.spriteHalfWidth(safeSize), 0, this.visibleBodyExtents(actor.kind, actor.territory, safeSize));
            actor.progress = preserveTransitProgress(previousPath, actor.sprite.position.x, path);
            actor.startX = path.fromX;
            actor.targetX = path.toX;
            actor.direction = path.toX >= path.fromX ? 1 : -1;
            actor.sprite.position.x = positionOnTransitPath(path, actor.progress);
            actor.sprite.position.z = actor.pathDepth;
            actor.lastUpdatedAt = now;
        }
        for (const event of this.whales) {
            const previousPath = { fromX: event.startX, toX: event.targetX };
            const safeSize = event.size * 1.12;
            event.pathDepth = this.verticalBandForIndex(event.bandIndex, event.kind).depth;
            const path = this.getTransitPath(event.territory, event.side, event.pathDepth, this.spriteHalfWidth(safeSize), 0, this.visibleBodyExtents(event.kind, event.territory, safeSize));
            event.progress = preserveTransitProgress(previousPath, event.sprite.position.x, path);
            event.startX = path.fromX;
            event.targetX = path.toX;
            event.direction = path.toX >= path.fromX ? 1 : -1;
            event.sprite.position.x = positionOnTransitPath(path, event.progress);
            event.sprite.position.z = event.pathDepth;
            event.lastUpdatedAt = now;
        }
        this.debugArenaResize();
    }
    debugArenaResize() {
        if (this.options.debugWhaleOcean === false || !this.engine)
            return;
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
        console.table([
            ["left", "left", "buy"],
            ["left", "left", "sell"],
            ["right", "right", "buy"],
            ["right", "right", "sell"]
        ].map(([symbol, territory, side]) => {
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
    debugArenaPath(action, symbol, territory, side, depth, path) {
        if (this.options.debugWhaleOcean === false)
            return;
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
    allocateSchoolVolume(group, count) {
        if (count <= 0)
            return [];
        const volumeByKind = new Map();
        for (const lot of group.recentLots)
            volumeByKind.set(lot.kind, (volumeByKind.get(lot.kind) ?? 0) + lot.quote);
        const total = [...volumeByKind.values()].reduce((sum, value) => sum + value, 0);
        if (total <= 0)
            return Array.from({ length: count }, () => ({ kind: group.schoolKind, notionalUsdt: 0 }));
        const provisional = [...volumeByKind.entries()].map(([kind, volume]) => {
            const exact = count * volume / total;
            return { kind, volume, count: Math.floor(exact), remainder: exact - Math.floor(exact) };
        });
        let assigned = provisional.reduce((sum, item) => sum + item.count, 0);
        for (const item of [...provisional].sort((a, b) => b.remainder - a.remainder || b.volume - a.volume)) {
            if (assigned >= count)
                break;
            item.count++;
            assigned++;
        }
        const represented = provisional.filter(item => item.count > 0);
        for (const item of provisional) {
            if (item.count > 0)
                continue;
            const recipient = represented.reduce((closest, candidate) => Math.abs(WHALE_OCEAN_SPECIES[candidate.kind].financialLevel - WHALE_OCEAN_SPECIES[item.kind].financialLevel)
                < Math.abs(WHALE_OCEAN_SPECIES[closest.kind].financialLevel - WHALE_OCEAN_SPECIES[item.kind].financialLevel)
                ? candidate
                : closest);
            recipient.volume += item.volume;
        }
        const allocations = [];
        for (const item of represented) {
            if (item.count <= 0)
                continue;
            const perFish = item.volume / item.count;
            for (let index = 0; index < item.count; index++)
                allocations.push({ kind: item.kind, notionalUsdt: perFish });
        }
        return allocations;
    }
    assignAgentSpecies(agent, kind, territory, symbol, side, notionalUsdt) {
        const previousKind = agent.kind;
        const previousNotional = agent.allocatedNotional;
        if (agent.kind !== kind) {
            agent.sprite.dispose();
            agent.sprite = this.createAnimatedSprite(kind, territory, `whale-ocean-fish-${territory}-${side}-${kind}-${this.random()}`, agent.seed);
            agent.kind = kind;
        }
        agent.allocatedNotional = notionalUsdt;
        agent.sprite.metadata = {
            symbol,
            side,
            notionalUsdt,
            kind,
            source: "money_flow_aggregate_allocation"
        };
        void previousKind;
        void previousNotional;
    }
    text(key, fallback) {
        return this.labels[key] ?? fallback;
    }
    setLabels(labels) {
        this.labels = { ...labels };
        this.refreshFishLabels();
    }
    refreshFishLabels() {
        for (const group of this.fishGroups) {
            for (const agent of group.agents) {
                if (!agent.label)
                    continue;
                this.ensureFishLabel(agent, this.fishLabelText(group, agent), group.side === "buy" ? "#36e7b0" : "#ff6b55");
            }
        }
    }
    fishLabelText(group, agent) {
        const currency = this.symbols.get(group.symbol)?.quoteCurrency ?? quoteCurrencyForSymbol(group.symbol);
        return `${group.side === "buy" ? `${this.text("buy", "BUY")} →` : `${this.text("sell", "SELL")} ←`} ${formatCompactVolume(agent.allocatedNotional)} ${currency ?? "QUOTE"}`;
    }
    ensureFishLabel(agent, text, color) {
        if (agent.label && agent.labelText === text)
            return;
        if (agent.label) {
            agent.label.textContent = text;
            agent.label.style.setProperty("--whale-ocean-label-accent", color);
            agent.label.dataset.halfWidth = String(Math.ceil(agent.label.offsetWidth / 2) || 60);
        }
        else {
            agent.label = this.createVolumeLabel(text, color);
        }
        agent.labelText = text;
    }
    debugInit() {
        if (this.options.debugWhaleOcean === false)
            return;
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
    debugReceive(batch) {
        if (this.options.debugWhaleOcean === false)
            return;
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
    debugFilter(batch, reason) {
        if (this.options.debugWhaleOcean === false)
            return;
        const symbol = batch.symbol.trim().toUpperCase();
        console.groupCollapsed(`[WhaleOcean][FILTER] ${reason} ${symbol}`);
        if (reason !== "accepted")
            console.warn(`Money-flow batch ${reason}.`);
        else
            console.info("Money-flow batch accepted.");
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
    visualDiagnostics() {
        const rows = [];
        for (const group of this.fishGroups) {
            for (const agent of group.agents) {
                if (!agent.sprite.isVisible)
                    continue;
                rows.push(this.buildDiagnosticRow(agent.debugId, group.symbol, agent.kind, group.territory, agent.sprite, agent.label, agent.labelText, agent.bandIndex));
            }
        }
        for (const actor of this.flowActors)
            rows.push(this.buildDiagnosticRow(actor.id, actor.territory === "left" ? this.options.leftSymbol : this.options.rightSymbol, actor.kind, actor.territory, actor.sprite, actor.label, actor.labelText, actor.bandIndex));
        for (const event of this.whales)
            rows.push(this.buildDiagnosticRow(event.eventId, event.territory === "left" ? this.options.leftSymbol : this.options.rightSymbol, event.kind, event.territory, event.sprite, event.label, event.labelText, event.bandIndex));
        return rows;
    }
    /** Uses the same frustum and territory calculations as the renderer. */
    geometryDiagnostics() {
        const width = this.canvas.clientWidth;
        const height = this.canvas.clientHeight;
        const visible = this.getVisibleHorizontalBounds(0);
        const left = this.getTeamHorizontalBounds("left", 0, 0);
        const right = this.getTeamHorizontalBounds("right", 0, 0);
        const screenX = (worldX) => this.projectToCss(worldX, 0, 0)?.x ?? null;
        const depthBands = this.verticalBandLayout();
        const usefulViewport = getUsefulOceanVerticalViewport(height, width);
        const usefulTop = usefulViewport.top;
        const usefulBottom = usefulViewport.bottom;
        const usefulHeight = Math.max(0, usefulBottom - usefulTop);
        const rows = this.visualDiagnostics();
        const visibleRows = rows.filter(row => row.visible && row.inViewport && row.opacity >= 0.55 && row.projectedBodyRect);
        const occupiedTop = visibleRows.length > 0
            ? Math.max(usefulTop, Math.min(...visibleRows.map(row => Math.max(usefulTop, row.projectedBodyRect.top))))
            : null;
        const occupiedBottom = visibleRows.length > 0
            ? Math.min(usefulBottom, Math.max(...visibleRows.map(row => Math.min(usefulBottom, row.projectedBodyRect.bottom))))
            : null;
        const occupiedHeight = occupiedTop !== null && occupiedBottom !== null
            ? Math.max(0, occupiedBottom - occupiedTop)
            : 0;
        const bandCounts = depthBands.map(band => visibleRows.filter(row => row.bandIndex === band.index).length);
        return {
            viewportCss: { width, height },
            renderViewport: { width: this.engine?.getRenderWidth() ?? 0, height: this.engine?.getRenderHeight() ?? 0 },
            usefulVerticalViewport: { top: round2(usefulTop), bottom: round2(usefulBottom), height: round2(usefulHeight) },
            verticalOccupancy: {
                top: occupiedTop === null ? null : round2(occupiedTop),
                bottom: occupiedBottom === null ? null : round2(occupiedBottom),
                height: round2(occupiedHeight),
                coverageRatio: usefulHeight > 0 ? round2(Math.min(1, occupiedHeight / usefulHeight)) : 0,
                coveragePercent: usefulHeight > 0 ? round2(Math.min(100, occupiedHeight / usefulHeight * 100)) : 0,
                animalCount: visibleRows.length,
                labelsVisible: rows.filter(row => row.labelState === "visible").length,
                bandCounts
            },
            cameraCenterWorldX: round2(this.camera?.target.x ?? visible.center),
            visibleWorld: { left: round2(visible.left), center: round2(visible.center), right: round2(visible.right) },
            territories: {
                left: { world: { minX: round2(left.minX), maxX: round2(left.maxX) }, screen: { minX: 0, maxX: round2(width / 2) } },
                right: { world: { minX: round2(right.minX), maxX: round2(right.maxX) }, screen: { minX: round2(width / 2), maxX: round2(width) } }
            },
            depthBands: depthBands.map(band => ({
                name: band.name,
                index: band.index,
                depth: round2(band.depth),
                screen: { top: round2(band.top), bottom: round2(band.bottom), center: round2(band.center) },
                world: { top: round2(band.topWorld), bottom: round2(band.bottomWorld), center: round2(band.centerWorld) }
            })),
            animals: this.visualDiagnostics().map(row => ({
                id: row.id,
                territory: this.options.leftSymbol === row.symbol ? "left" : "right",
                worldX: row.worldPositionX,
                screenX: screenX(row.worldPositionX)
            }))
        };
    }
    buildDiagnosticRow(id, symbol, kind, territory, sprite, label, labelText, bandIndex = depthBandIndexForKind(kind)) {
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
        const depthBand = this.verticalBandForIndex(bandIndex, kind);
        const projectedBodyRect = this.projectedBodyRect(kind, territory, sprite);
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
            depthBand: depthBand.name,
            depthBandTopCss: round2(depthBand.top),
            depthBandBottomCss: round2(depthBand.bottom),
            cameraDistance: round2(cameraDistance),
            projectedBodyCssWidth: round2(bodyWidthWorld * cssPerWorldAtDepth),
            projectedBodyCssHeight: round2(bodyHeightWorld * cssPerWorldAtDepth),
            projectedBodyRect,
            bandIndex,
            opacity: round2(sprite.color.a),
            visible: sprite.isVisible && sprite.color.a > 0.01,
            inViewport: projected !== null,
            minBodyCssWidth: band.minPx,
            maxBodyCssWidth: band.maxPx,
            labelState: !label ? "none" : projected && sprite.color.a >= 0.05 ? "visible" : "hidden",
            labelCssX: projected ? round2(projected.x) : -1,
            labelCssY: projected ? round2(projected.y) : -1,
            projectedCssX: projected ? round2(projected.x) : -1,
            projectedCssY: projected ? round2(projected.y) : -1,
            labelText
        };
    }
    projectToCss(worldX, worldY, worldZ) {
        const B = this.B;
        const engine = this.engine;
        const camera = this.camera;
        const scene = this.scene;
        if (!B || !engine || !camera || !scene)
            return null;
        const renderWidth = engine.getRenderWidth();
        const renderHeight = engine.getRenderHeight();
        const clientWidth = this.canvas.clientWidth;
        const clientHeight = this.canvas.clientHeight;
        if (renderWidth <= 0 || renderHeight <= 0 || clientWidth <= 0 || clientHeight <= 0)
            return null;
        const projected = B.Vector3.Project(new B.Vector3(worldX, worldY, worldZ), B.Matrix.Identity(), scene.getTransformMatrix(), camera.viewport.toGlobal(renderWidth, renderHeight));
        if (!(projected.z > 0 && projected.z < 1))
            return null;
        const cssX = projected.x * (clientWidth / renderWidth);
        const cssY = projected.y * (clientHeight / renderHeight);
        if (cssX < -120 || cssX > clientWidth + 120 || cssY < -60 || cssY > clientHeight + 60)
            return null;
        return { x: cssX, y: cssY };
    }
    /** Warns (rate-limited, once per animal) when a visible animal renders below its category minimum. */
    debugSizeWarnings(now) {
        if (this.options.debugWhaleOcean === false || now - this.lastSizeWarningAt < MINIMUM_SIZE_WARNING_INTERVAL_MS)
            return;
        this.lastSizeWarningAt = now;
        const fresh = this.visualDiagnostics().filter(row => row.visible && row.inViewport && row.opacity >= 0.6
            && row.projectedBodyCssWidth > 0 && row.projectedBodyCssWidth < row.minBodyCssWidth
            && !this.undersizedWarnedIds.has(row.id));
        if (fresh.length === 0)
            return;
        for (const row of fresh)
            this.undersizedWarnedIds.add(row.id);
        console.warn("[WhaleOcean][WARN] animal abaixo do tamanho mínimo esperado", fresh);
    }
    debugSpawn(action, pending, animalId, kind, source = "money_flow_batch") {
        if (this.options.debugWhaleOcean === false)
            return;
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
        console.table(this.bandOccupancyDiagnostics());
        console.groupEnd();
    }
    debugExit(data) {
        if (this.options.debugWhaleOcean === false)
            return;
        console.groupCollapsed("[WhaleOcean][EXIT] transit completed");
        console.info("Animal and label left the territory before disposal.");
        console.table([data]);
        console.groupEnd();
    }
    debugSummary(now) {
        if (this.options.debugWhaleOcean === false || now - this.lastDebugSummaryAt < 5000)
            return;
        this.lastDebugSummaryAt = now;
        const groups = [this.options.leftSymbol, this.options.rightSymbol].flatMap(symbol => {
            const state = this.symbols.get(symbol);
            return ["buy", "sell"].map(side => ({
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
        console.info("Ocupação projetada por faixa:");
        console.table(this.bandOccupancyDiagnostics());
        console.table(financial);
        console.info("Visão visual por animal:");
        console.table(this.visualDiagnostics());
        console.groupEnd();
    }
    territoryOccupancy(territory) {
        const schools = this.fishGroups
            .filter(group => group.territory === territory)
            .reduce((sum, group) => sum + group.visibleCount * this.estimatedSchoolOccupancy(group), 0);
        const transient = this.flowActors.filter(actor => actor.territory === territory)
            .reduce((sum, actor) => sum + Math.max(1.2, WHALE_OCEAN_SPECIES[actor.kind].bodyLengthPx / 50 * 0.62 + actor.labelWidthPx / 50 * 0.36 + actor.labelHeightPx / 50), 0);
        const highlights = this.whales.filter(event => event.territory === territory)
            .reduce((sum, event) => sum + Math.max(1, WHALE_OCEAN_SPECIES[event.kind].bodyLengthPx / 50 * 0.7), 0);
        return Number((schools + transient + highlights).toFixed(2));
    }
    bandOccupancyDiagnostics() {
        const visuals = this.activeOccupancyVisuals();
        return ["left", "right"].flatMap(territory => this.verticalBandLayout().map(band => {
            const entries = visuals.filter(item => item.territory === territory && item.bandIndex === band.index);
            const projectedBodies = entries
                .map(item => this.projectedBodyRect(item.kind, item.territory, item.sprite))
                .filter((rect) => rect !== null);
            return {
                territory,
                band: band.name,
                bandIndex: band.index,
                entities: entries.length,
                projectedBodyPx: Number(projectedBodies.reduce((sum, rect) => sum + this.rectArea(rect), 0).toFixed(1)),
                projectedCentersPx: entries.map(item => {
                    const point = this.projectToCss(item.sprite.position.x, item.sprite.position.y, item.sprite.position.z);
                    return point ? `${point.x.toFixed(0)},${point.y.toFixed(0)}` : "offscreen";
                }).join(" | ")
            };
        }));
    }
    debugNoEventWarning(now) {
        if (this.options.debugWhaleOcean === false || now - this.lastNoEventWarningAt < 30000)
            return;
        const sinceLastReceive = this.lastReceiveAt === 0 ? null : now - this.lastReceiveAt;
        if (sinceLastReceive !== null && sinceLastReceive < 30000)
            return;
        this.lastNoEventWarningAt = now;
        console.warn("[WhaleOcean][SUMMARY] No money_flow_batch received yet or during the last 30s.", {
            connectionState: this.connected ? "connected" : "disconnected",
            lastReceiveAtUtc: this.lastReceiveAt === 0 ? null : new Date(this.lastReceiveAt).toISOString(),
            millisecondsSinceLastReceive: sinceLastReceive
        });
    }
    safeDebugPayload(batch) {
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
    refreshDiagnostics(now, force = false) {
        if (!this.options.developmentDiagnostics || (!force && now - this.lastDiagnosticsAt < 500))
            return;
        const panel = this.root?.querySelector('[data-whale-ocean="flow-diagnostics"]');
        if (!panel)
            return;
        this.lastDiagnosticsAt = now;
        const heading = document.createElement("strong");
        heading.textContent = `DEV · MONEY FLOW (janela móvel de ${Math.round(this.budget.windowMs / 1000)} s)`;
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
            received.textContent = `${Math.round(this.budget.windowMs / 1000)}s ${formatCompactVolume(volume)} · lotes L${liveLots.length}/R${replayLots.length} · trades ${tradeCount}`;
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
    updateBubbles(seconds) {
        for (const bubble of this.bubbles) {
            bubble.mesh.position.y += bubble.speed * 16;
            bubble.mesh.position.x = bubble.baseX + Math.sin(seconds * 0.6 + bubble.phase) * 0.35;
            if (bubble.mesh.position.y > 5.5)
                bubble.mesh.position.y = -5.5;
        }
    }
    enqueueFlow(symbol, side, notional, baseline, now) {
        if (notional <= 0 || !Number.isFinite(notional))
            return;
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
    trySpawnPendingFlows(now) {
        for (const [key, pending] of this.pendingFlows) {
            if (pending.lastReceivedAt < now - this.budget.windowMs) {
                this.pendingFlows.delete(key);
                this.debugFilter({ matchId: this.options.matchId, symbol: pending.symbol, sequence: Number.NaN, eventTimeUtc: new Date(pending.lastReceivedAt).toISOString(), tradeCount: pending.batchCount, takerBuyQuote: pending.side === "buy" ? String(pending.totalNotional) : "0", takerSellQuote: pending.side === "sell" ? String(pending.totalNotional) : "0", lastPrice: "0", isPartial: false }, "pending_flow_expired");
                continue;
            }
            if (!this.canSpawnTransit(pending)) {
                if (this.options.debugWhaleOcean !== false)
                    console.info("[WhaleOcean][QUEUE] flow deferred", {
                        symbol: pending.symbol,
                        side: pending.side,
                        batchCount: pending.batchCount,
                        totalNotional: pending.totalNotional,
                        pendingFlows: this.pendingFlows.size,
                        reason: this.flowActors.length + this.whales.length >= this.budget.maxVisibleAnimals
                            ? "global_entity_budget"
                            : "territory_or_projected_occupancy"
                    });
                continue;
            }
            this.pendingFlows.delete(key);
            this.spawnFlowActor(pending, now);
        }
    }
    canSpawnTransit(pending) {
        const territory = this.options.leftSymbol === pending.symbol ? "left" : "right";
        const profile = visualProfile(pending.peakNotional, pending.baseline);
        const kind = profile.kind;
        if (this.flowActors.length + this.whales.length >= this.budget.maxVisibleAnimals)
            return false;
        if (isLargeAnimalKind(kind) && !this.canUseHighlight(territory))
            return false;
        const territoryActors = this.flowActors.filter(actor => actor.territory === territory).length + this.whales.filter(event => event.territory === territory).length;
        const territoryLimit = this.budget.maxVisibleAnimals <= 12 ? 2 : QUALITY_FLOW_ACTORS[this.quality];
        if (territoryActors >= territoryLimit)
            return false;
        const occupancy = this.territoryOccupancy(territory);
        const projected = Math.max(1.4, WHALE_OCEAN_SPECIES[kind].bodyLengthPx / 50 * 0.7 + 0.9);
        return occupancy + projected <= this.budget.maxOccupancyPerTerritory;
    }
    spawnFlowActor(pending, now) {
        const state = this.symbols.get(pending.symbol);
        if (!state)
            return;
        const territory = this.options.leftSymbol === pending.symbol ? "left" : "right";
        const profile = visualProfile(pending.peakNotional, pending.baseline);
        const kind = profile.kind;
        const movingRight = pending.side === "buy";
        const sideColor = pending.side === "buy" ? "#36e7b0" : "#ff6b55";
        const spriteWidth = this.spriteWidthFor(kind, territory) * (1 + profile.intensity * 0.08);
        const quoteCurrency = state.quoteCurrency ?? quoteCurrencyForSymbol(pending.symbol);
        const text = `${formatCompactVolume(pending.totalNotional)} ${quoteCurrency ?? "QUOTE"}`;
        const labelWidthPx = Math.min(230, 30 + text.length * 8.6);
        const labelHeightPx = 24;
        const phase = this.random() * Math.PI * 2;
        const seed = this.random();
        const bandIndex = this.chooseBandIndex(kind, territory, pending.side, spriteWidth, labelWidthPx, labelHeightPx, phase, seed);
        const depth = this.verticalBandForIndex(bandIndex, kind).depth;
        const safeSpriteWidth = spriteWidth * 1.12;
        const path = this.getTransitPath(territory, pending.side, depth, this.spriteHalfWidth(safeSpriteWidth), 0, this.visibleBodyExtents(kind, territory, safeSpriteWidth));
        const sprite = this.createAnimatedSprite(kind, territory, `whale-ocean-flow-${pending.symbol}-${this.nextFlowId}`, seed);
        sprite.width = spriteWidth;
        sprite.height = spriteWidth * 0.5;
        sprite.invertU = !movingRight;
        const verticalOffsetPx = (seed - 0.5) * 10;
        const vertical = this.worldPositionInVerticalBand(kind, territory, sprite, phase, seed, 0, bandIndex, verticalOffsetPx);
        sprite.position.set(path.fromX, vertical.y, vertical.z);
        sprite.color.a = 0;
        sprite.isVisible = true;
        const label = this.createVolumeLabel(text, sideColor);
        const id = `flow-${this.nextFlowId++}`;
        const distance = Math.abs(path.toX - path.fromX);
        const nowPerformance = performance.now();
        this.flowActors.push({
            id,
            sprite,
            label,
            labelText: text,
            startedAt: nowPerformance,
            startX: path.fromX,
            targetX: path.toX,
            direction: path.toX >= path.fromX ? 1 : -1,
            progress: 0,
            speedWorldPerSecond: Math.max(0.01, distance / Math.max(9, Math.min(15, 8 + distance * 0.42))),
            lastUpdatedAt: nowPerformance,
            completed: false,
            pathDepth: depth,
            side: pending.side,
            territory,
            kind,
            size: spriteWidth,
            intensity: profile.intensity,
            phase,
            notional: pending.totalNotional,
            quoteCurrency,
            labelWidthPx,
            labelHeightPx,
            bandIndex,
            verticalOffsetPx
        });
        this.debugArenaPath("spawn", pending.symbol, territory, pending.side, depth, path);
        this.debugSpawn("created", pending, id);
    }
    transientLargeCount(territory) {
        return this.flowActors.filter(actor => actor.territory === territory && isLargeAnimalKind(actor.kind)).length
            + this.whales.filter(event => event.territory === territory).length;
    }
    largeAnimalsInTerritory(territory) {
        const schools = this.fishGroups
            .filter(group => group.territory === territory)
            .reduce((sum, group) => {
            let count = 0;
            for (let index = 0; index < group.visibleCount && index < group.agents.length; index++)
                if (isLargeAnimalKind(group.agents[index].kind))
                    count++;
            return sum + count;
        }, 0);
        return this.transientLargeCount(territory) + schools;
    }
    canUseHighlight(territory) {
        return this.largeAnimalsInTerritory(territory) < this.budget.maxLargeHighlightsPerTerritory;
    }
    ensureLabelLayer() {
        if (this.labelLayer && this.labelLayer.isConnected)
            return this.labelLayer;
        const existing = this.root?.querySelector('[data-whale-ocean="labels"]');
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
    createVolumeLabel(text, color) {
        const label = document.createElement("span");
        label.className = "whale-ocean__volume-label";
        label.textContent = text;
        label.style.setProperty("--whale-ocean-label-accent", color);
        this.ensureLabelLayer().append(label);
        label.dataset.halfWidth = String(Math.ceil(label.offsetWidth / 2) || 60);
        return label;
    }
    placeScreenLabel(label, worldX, worldY, worldZ, alpha, below = false, priority = 0, avoid = []) {
        const B = this.B;
        const engine = this.engine;
        const camera = this.camera;
        const scene = this.scene;
        if (!engine || !camera || !scene)
            return;
        const renderWidth = engine.getRenderWidth();
        const renderHeight = engine.getRenderHeight();
        const clientWidth = this.canvas.clientWidth;
        const clientHeight = this.canvas.clientHeight;
        if (renderWidth <= 0 || renderHeight <= 0 || clientWidth <= 0 || clientHeight <= 0)
            return;
        const projected = B.Vector3.Project(new B.Vector3(worldX, worldY, worldZ), B.Matrix.Identity(), scene.getTransformMatrix(), camera.viewport.toGlobal(renderWidth, renderHeight));
        const cssX = projected.x * (clientWidth / renderWidth);
        const cssY = projected.y * (clientHeight / renderHeight);
        const inViewport = projected.z > 0 && projected.z < 1
            && cssX > -120 && cssX < clientWidth + 120 && cssY > -60 && cssY < clientHeight + 60;
        if (!inViewport || alpha < 0.05) {
            label.style.display = "none";
            return;
        }
        this.labelPlacements.push({ label, anchorX: cssX, anchorY: cssY, below, alpha, priority, avoid });
    }
    resolveScreenLabels() {
        if (this.labelPlacements.length === 0)
            return;
        const width = this.canvas.clientWidth;
        const height = this.canvas.clientHeight;
        const placed = this.activeOccupancyVisuals()
            .map(item => this.projectedBodyRect(item.kind, item.territory, item.sprite))
            .filter((rect) => rect !== null);
        const maxVisibleLabels = width <= 700 ? MAX_VISIBLE_VOLUME_LABELS_MOBILE : MAX_VISIBLE_VOLUME_LABELS_DESKTOP;
        const ordered = [...this.labelPlacements].sort((a, b) => b.priority - a.priority || a.anchorY - b.anchorY);
        for (const [index, placement] of ordered.entries()) {
            const label = placement.label;
            if (index >= maxVisibleLabels) {
                label.style.display = "none";
                continue;
            }
            const labelWidth = Math.max(24, label.offsetWidth || Number(label.dataset.halfWidth ?? "60") * 2);
            const labelHeight = Math.max(18, label.offsetHeight || 24);
            const halfWidth = labelWidth / 2;
            const x = Math.max(halfWidth + 4, Math.min(width - halfWidth - 4, placement.anchorX));
            const offsets = [0, -(labelHeight + LABEL_COLLISION_GAP_PX), labelHeight + LABEL_COLLISION_GAP_PX, -(labelHeight * 2 + LABEL_COLLISION_GAP_PX * 2), labelHeight * 2 + LABEL_COLLISION_GAP_PX * 2];
            let chosenY = placement.anchorY;
            let chosenRect = this.labelRect(x, chosenY, labelWidth, labelHeight, placement.below, height);
            let found = false;
            for (const offset of offsets) {
                const candidateY = placement.anchorY + offset;
                const candidateRect = this.labelRect(x, candidateY, labelWidth, labelHeight, placement.below, height);
                if (!placement.avoid.some(existing => this.rectanglesOverlapWithGap(existing, candidateRect, LABEL_COLLISION_GAP_PX))
                    && !placed.some(existing => this.rectanglesOverlapWithGap(existing, candidateRect, LABEL_COLLISION_GAP_PX))) {
                    chosenY = placement.below ? candidateRect.top : candidateRect.bottom;
                    chosenRect = candidateRect;
                    found = true;
                    break;
                }
            }
            if (!found) {
                label.style.display = "none";
                continue;
            }
            label.style.display = "";
            label.style.opacity = "1";
            label.style.transform = `translate(${x.toFixed(1)}px, ${chosenY.toFixed(1)}px) translate(-50%, ${placement.below ? "0" : "-100%"})`;
            placed.push(chosenRect);
        }
    }
    volumeLabelPriority(kind, notional, channel) {
        const speciesPriority = WHALE_OCEAN_SPECIES[kind].financialLevel * 1000;
        const volumePriority = Math.min(999, Math.log10(Math.max(1, notional)) * 100);
        return channel * 100000 + speciesPriority + volumePriority;
    }
    /** Keeps visible body bounds apart in CSS pixels, including across depth planes. */
    resolveProjectedSpriteSeparation() {
        const visuals = this.activeOccupancyVisuals()
            .sort((a, b) => this.rectArea(this.projectedBodyRect(b.kind, b.territory, b.sprite) ?? { left: 0, right: 0, top: 0, bottom: 0 })
            - this.rectArea(this.projectedBodyRect(a.kind, a.territory, a.sprite) ?? { left: 0, right: 0, top: 0, bottom: 0 }));
        for (let pass = 0; pass < 3; pass++) {
            let changed = false;
            for (let firstIndex = 0; firstIndex < visuals.length; firstIndex++) {
                const first = visuals[firstIndex];
                const firstRect = this.projectedBodyRect(first.kind, first.territory, first.sprite);
                if (!firstRect)
                    continue;
                for (let secondIndex = firstIndex + 1; secondIndex < visuals.length; secondIndex++) {
                    const second = visuals[secondIndex];
                    if (first.territory !== second.territory)
                        continue;
                    const secondRect = this.projectedBodyRect(second.kind, second.territory, second.sprite);
                    if (!secondRect || !this.rectanglesOverlapWithGap(firstRect, secondRect, SPRITE_COLLISION_GAP_PX))
                        continue;
                    const down = firstRect.bottom + SPRITE_COLLISION_GAP_PX - secondRect.top;
                    const up = secondRect.bottom + SPRITE_COLLISION_GAP_PX - firstRect.top;
                    const moved = this.shiftVisualVertically(second, down <= up ? down : -up);
                    changed || (changed = moved);
                }
            }
            if (!changed)
                break;
        }
    }
    shiftVisualVertically(visual, requestedDeltaPx) {
        const projected = this.projectToCss(visual.sprite.position.x, visual.sprite.position.y, visual.sprite.position.z);
        const body = this.projectedBodyRect(visual.kind, visual.territory, visual.sprite);
        if (!projected || !body)
            return false;
        const band = this.verticalBandForIndex(visual.bandIndex, visual.kind);
        const halfHeight = (body.bottom - body.top) / 2;
        const minY = band.top + halfHeight + 4;
        const maxY = band.bottom - halfHeight - 4;
        const nextY = Math.max(minY, Math.min(maxY, projected.y + requestedDeltaPx));
        const applied = nextY - projected.y;
        if (Math.abs(applied) < 0.5)
            return false;
        if (visual.id.startsWith("school-")) {
            const agent = this.fishGroups.flatMap(group => group.agents).find(candidate => candidate.debugId === visual.id);
            if (!agent)
                return false;
            agent.verticalOffsetPx += applied;
            const position = this.worldPositionInVerticalBand(agent.kind, agent.territory, agent.sprite, agent.phase, agent.seed, agent.progress, agent.bandIndex, agent.verticalOffsetPx);
            agent.position.y = position.y;
            agent.position.z = position.z;
            agent.sprite.position.copyFrom(agent.position);
        }
        else {
            const actor = this.flowActors.find(candidate => candidate.id === visual.id);
            const event = this.whales.find(candidate => candidate.eventId === visual.id);
            const entity = actor ?? event;
            if (!entity)
                return false;
            entity.verticalOffsetPx += applied;
            const position = this.worldPositionInVerticalBand(entity.kind, entity.territory, entity.sprite, entity.phase, entity.phase / (Math.PI * 2), entity.progress, entity.bandIndex, entity.verticalOffsetPx);
            entity.sprite.position.y = position.y;
            entity.sprite.position.z = position.z;
            entity.pathDepth = position.z;
        }
        return true;
    }
    labelRect(x, anchorY, width, height, below, viewportHeight) {
        const clampedAnchor = below
            ? Math.max(24, Math.min(viewportHeight - 28, anchorY))
            : Math.max(28, Math.min(viewportHeight - 24, anchorY));
        const top = below ? clampedAnchor : clampedAnchor - height;
        return { left: x - width / 2, right: x + width / 2, top, bottom: top + height };
    }
    rectanglesOverlap(a, b) {
        return a.left < b.right + LABEL_COLLISION_GAP_PX
            && a.right + LABEL_COLLISION_GAP_PX > b.left
            && a.top < b.bottom + LABEL_COLLISION_GAP_PX
            && a.bottom + LABEL_COLLISION_GAP_PX > b.top;
    }
    removeLabel(label) {
        label?.remove();
    }
    updateFlowActors(now) {
        for (let index = this.flowActors.length - 1; index >= 0; index--) {
            const actor = this.flowActors[index];
            const distance = Math.abs(actor.targetX - actor.startX);
            const elapsedMs = Math.min(80, Math.max(0, now - actor.lastUpdatedAt));
            actor.lastUpdatedAt = now;
            actor.progress = distance > Number.EPSILON
                ? Math.min(1, actor.progress + actor.speedWorldPerSecond * elapsedMs / 1000 / distance)
                : 1;
            if (actor.progress >= 1) {
                actor.completed = true;
                this.disposeFlowActor(actor);
                this.flowActors.splice(index, 1);
                continue;
            }
            const progress = actor.progress;
            const pulse = 1 + Math.sin(progress * Math.PI * 3 + actor.phase) * (0.025 + actor.intensity * 0.04);
            actor.sprite.position.x = positionOnTransitPath({ fromX: actor.startX, toX: actor.targetX }, progress);
            actor.sprite.width = actor.size * pulse;
            actor.sprite.height = actor.size * 0.5 * pulse;
            const vertical = this.worldPositionInVerticalBand(actor.kind, actor.territory, actor.sprite, actor.phase, actor.phase / (Math.PI * 2), progress, actor.bandIndex, actor.verticalOffsetPx);
            actor.sprite.position.y = vertical.y;
            actor.sprite.position.z = vertical.z;
            actor.pathDepth = vertical.z;
            actor.sprite.invertU = actor.direction < 0;
            const fadeIn = Math.min(1, progress / 0.12);
            actor.sprite.color.a = fadeIn;
            if (actor.label)
                this.placeScreenLabel(actor.label, actor.sprite.position.x, actor.sprite.position.y + actor.size * 0.62, actor.sprite.position.z, actor.sprite.color.a, this.labelBelowForKind(actor.kind), this.volumeLabelPriority(actor.kind, actor.notional, 1), [this.projectedBodyRect(actor.kind, actor.territory, actor.sprite)].filter((rect) => rect !== null));
        }
    }
    disposeFlowActor(actor) {
        actor.sprite.dispose();
        this.removeLabel(actor.label);
        actor.label = null;
        this.debugArenaPath("despawn", actor.territory === "left" ? this.options.leftSymbol : this.options.rightSymbol, actor.territory, actor.side, actor.pathDepth, { fromX: actor.startX, toX: actor.targetX });
        this.debugExit({
            animalId: actor.id,
            symbol: actor.territory === "left" ? this.options.leftSymbol : this.options.rightSymbol,
            side: actor.side,
            volume: actor.notional,
            direction: swimDirectionForSide(actor.side),
            kind: actor.kind,
            source: "money_flow_batch",
            exitX: actor.targetX,
            removalReason: "completed_full_transit"
        });
    }
    spawnEvent(event, allowPreviouslySeen = false) {
        const alreadySeen = this.seenEventIds.has(event.id);
        if (alreadySeen && !allowPreviouslySeen)
            return;
        if (!alreadySeen)
            this.seenEventIds.add(event.id);
        const territory = this.options.leftSymbol === event.symbol ? "left" : "right";
        if (!alreadySeen)
            this.recordEvent();
        if (this.flowActors.length + this.whales.length >= this.budget.maxVisibleAnimals || !this.canUseHighlight(territory) || this.territoryOccupancy(territory) >= this.budget.maxOccupancyPerTerritory) {
            this.pendingEvents.push(event);
            if (this.options.debugWhaleOcean !== false && this.pendingEvents.length <= MAX_PENDING_EVENT_QUEUE_DIAGNOSTIC)
                console.info("[WhaleOcean][QUEUE] highlight event deferred; source event retained", {
                    eventId: event.id,
                    symbol: event.symbol,
                    side: event.side,
                    queueLength: this.pendingEvents.length,
                    reason: this.flowActors.length + this.whales.length >= this.budget.maxVisibleAnimals
                        ? "global_entity_budget"
                        : !this.canUseHighlight(territory) ? "large_highlight_reserve" : "projected_territory_occupancy"
                });
            return;
        }
        const baseColor = event.side === "buy"
            ? (territory === "left" ? this.options.leftColor : this.options.rightColor)
            : (territory === "left" ? "#a85e27" : "#0b8e94");
        const movingRight = event.side === "buy";
        const kind = animalKindForEvent(event.kind);
        const size = this.spriteWidthFor(kind, territory);
        const phase = this.random() * Math.PI * 2;
        const seed = this.random();
        const quoteCurrency = this.symbols.get(event.symbol)?.quoteCurrency ?? quoteCurrencyForSymbol(event.symbol);
        const labelText = `${formatCompactVolume(event.notionalUsdt)} ${quoteCurrency ?? "QUOTE"}`;
        const labelWidthPx = Math.min(230, 30 + labelText.length * 8.6);
        const labelHeightPx = 24;
        const bandIndex = this.chooseBandIndex(kind, territory, event.side, size, labelWidthPx, labelHeightPx, phase, seed);
        const depth = this.verticalBandForIndex(bandIndex, kind).depth;
        const safeSpriteWidth = size * 1.12;
        const path = this.getTransitPath(territory, event.side, depth, this.spriteHalfWidth(safeSpriteWidth), 0, this.visibleBodyExtents(kind, territory, safeSpriteWidth));
        const sprite = this.createAnimatedSprite(kind, territory, `whale-ocean-${event.kind}-${event.id}`, seed);
        sprite.width = size;
        sprite.height = size * 0.5;
        sprite.invertU = !movingRight;
        sprite.position.x = path.fromX;
        const verticalOffsetPx = (seed - 0.5) * 10;
        const vertical = this.worldPositionInVerticalBand(kind, territory, sprite, phase, seed, 0, bandIndex, verticalOffsetPx);
        sprite.position.y = vertical.y;
        sprite.position.z = vertical.z;
        sprite.color.a = 0;
        sprite.isVisible = true;
        const label = this.createVolumeLabel(labelText, baseColor);
        const distance = Math.abs(path.toX - path.fromX);
        const nowPerformance = performance.now();
        this.whales.push({
            sprite,
            label,
            labelText,
            startedAt: nowPerformance,
            startX: path.fromX,
            targetX: path.toX,
            direction: path.toX >= path.fromX ? 1 : -1,
            progress: 0,
            speedWorldPerSecond: Math.max(0.01, distance / 13),
            lastUpdatedAt: nowPerformance,
            completed: false,
            pathDepth: depth,
            phase,
            size,
            territory,
            kind,
            side: event.side,
            notional: event.notionalUsdt,
            quoteCurrency,
            eventId: event.id,
            bandIndex,
            verticalOffsetPx
        });
        this.debugArenaPath("spawn", event.symbol, territory, event.side, depth, path);
        this.debugSpawn("created", { symbol: event.symbol, side: event.side, totalNotional: event.notionalUsdt, peakNotional: event.notionalUsdt, baseline: 0, firstReceivedAt: Date.now(), lastReceivedAt: Date.now(), batchCount: 1 }, event.id, kind, "classified_event");
        this.rebalancePopulation();
    }
    promotePendingEvents() {
        if (this.pendingEvents.length === 0)
            return;
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
    updateWhales(now) {
        for (let index = this.whales.length - 1; index >= 0; index--) {
            const event = this.whales[index];
            const distance = Math.abs(event.targetX - event.startX);
            const elapsedMs = Math.min(80, Math.max(0, now - event.lastUpdatedAt));
            event.lastUpdatedAt = now;
            event.progress = distance > Number.EPSILON
                ? Math.min(1, event.progress + event.speedWorldPerSecond * elapsedMs / 1000 / distance)
                : 1;
            if (event.progress >= 1) {
                event.completed = true;
                event.sprite.dispose();
                this.removeLabel(event.label);
                event.label = null;
                this.debugArenaPath("despawn", event.territory === "left" ? this.options.leftSymbol : this.options.rightSymbol, event.territory, event.side, event.pathDepth, { fromX: event.startX, toX: event.targetX });
                this.debugExit({ animalId: event.eventId, symbol: event.territory === "left" ? this.options.leftSymbol : this.options.rightSymbol, side: event.side, volume: event.notional, direction: swimDirectionForSide(event.side), kind: event.kind, source: "classified_event", exitX: event.targetX, removalReason: "completed_full_transit" });
                this.whales.splice(index, 1);
                continue;
            }
            const progress = event.progress;
            const pulse = 1 + Math.sin(progress * Math.PI) * 0.12;
            event.sprite.position.x = positionOnTransitPath({ fromX: event.startX, toX: event.targetX }, progress);
            event.sprite.width = event.size * pulse;
            event.sprite.height = event.size * 0.5 * pulse;
            const vertical = this.worldPositionInVerticalBand(event.kind, event.territory, event.sprite, event.phase, event.phase / (Math.PI * 2), progress, event.bandIndex, event.verticalOffsetPx);
            event.sprite.position.y = vertical.y;
            event.sprite.position.z = vertical.z;
            event.pathDepth = vertical.z;
            event.sprite.invertU = event.direction < 0;
            const fadeIn = Math.min(1, progress / 0.14);
            event.sprite.color.a = fadeIn;
            if (event.label)
                this.placeScreenLabel(event.label, event.sprite.position.x, event.sprite.position.y + event.size * 0.56, event.sprite.position.z, event.sprite.color.a, this.labelBelowForKind(event.kind), this.volumeLabelPriority(event.kind, event.notional, 2), [this.projectedBodyRect(event.kind, event.territory, event.sprite)].filter((rect) => rect !== null));
        }
    }
    recordEvent() {
        this.alertCount++;
        this.write("events", String(this.alertCount));
    }
    seedScoreState(symbol, team) {
        const normalized = symbol.trim().toUpperCase();
        const state = {
            matchTotal: cloneCreatureCounts(team?.matchTotal),
            recent: []
        };
        const windowEnd = Date.parse(this.options.scoreboard?.windowEndUtc ?? "") || Date.now();
        if (team?.last30Seconds && creatureTradeCount(team.last30Seconds) > 0)
            state.recent.push({ at: windowEnd, counts: cloneCreatureCounts(team.last30Seconds) });
        for (const sequence of team?.lastSequences ?? []) {
            if (sequence.symbol.trim().toUpperCase() !== normalized)
                continue;
            const key = this.sequenceKey(sequence.sourceId, normalized);
            this.lastBatchSequence.set(key, Math.max(this.lastBatchSequence.get(key) ?? 0, sequence.sequence));
        }
        this.scoreStates.set(normalized, state);
    }
    acceptScoreBatch(symbol, batch) {
        const state = this.scoreStates.get(symbol);
        const counts = batch.creatureCounts;
        if (!state || !counts)
            return;
        addCreatureCounts(state.matchTotal, counts);
        const eventAt = Date.parse(batch.eventTimeUtc) || Date.now();
        state.recent.push({ at: eventAt, counts: cloneCreatureCounts(counts) });
        this.pruneScoreWindow(state, Date.now());
        this.updateScoreboardHud();
    }
    pruneScoreWindow(state, now) {
        const cutoff = now - 30000;
        while (state.recent.length > 0 && state.recent[0].at < cutoff)
            state.recent.shift();
    }
    getRecentScore(symbol) {
        const state = this.scoreStates.get(symbol);
        const result = emptyCreatureCounts();
        if (!state)
            return result;
        this.pruneScoreWindow(state, Date.now());
        for (const item of state.recent)
            addCreatureCounts(result, item.counts);
        return result;
    }
    sequenceKey(sourceId, symbol) {
        return `${(sourceId ?? "").trim()}\u0000${symbol}`;
    }
    updateScoreboardHud() {
        const leftSymbol = this.options.leftSymbol.trim().toUpperCase();
        const rightSymbol = this.options.rightSymbol.trim().toUpperCase();
        const left = this.scoreStates.get(leftSymbol);
        const right = this.scoreStates.get(rightSymbol);
        if (!left || !right)
            return;
        const leftRecent = this.getRecentScore(leftSymbol);
        const rightRecent = this.getRecentScore(rightSymbol);
        const control = oceanControl(creaturePoints(leftRecent), creaturePoints(rightRecent));
        this.write("left-score", formatInteger(creaturePoints(left.matchTotal)));
        this.write("right-score", formatInteger(creaturePoints(right.matchTotal)));
        this.write("left-window-score", formatInteger(creaturePoints(leftRecent)));
        this.write("right-window-score", formatInteger(creaturePoints(rightRecent)));
        this.write("left-total-trades", formatInteger(creatureTradeCount(left.matchTotal)));
        this.write("right-total-trades", formatInteger(creatureTradeCount(right.matchTotal)));
        this.write("left-window-trades", formatInteger(creatureTradeCount(leftRecent)));
        this.write("right-window-trades", formatInteger(creatureTradeCount(rightRecent)));
        this.write("left-buy-points", formatInteger(sidePoints(left.matchTotal, "buy")));
        this.write("left-sell-points", formatInteger(sidePoints(left.matchTotal, "sell")));
        this.write("right-buy-points", formatInteger(sidePoints(right.matchTotal, "buy")));
        this.write("right-sell-points", formatInteger(sidePoints(right.matchTotal, "sell")));
        for (const kind of ["small", "medium", "large", "shark", "whale"]) {
            this.write(`left-${kind}`, formatInteger(left.matchTotal.buy[kind] + left.matchTotal.sell[kind]));
            this.write(`right-${kind}`, formatInteger(right.matchTotal.buy[kind] + right.matchTotal.sell[kind]));
        }
        this.write("control-left", control.left === null ? "—" : `${control.left}%`);
        this.write("control-right", control.right === null ? "—" : `${control.right}%`);
        const leftBar = this.root?.querySelector('[data-whale-ocean="control-left-bar"]');
        const rightBar = this.root?.querySelector('[data-whale-ocean="control-right-bar"]');
        if (leftBar)
            leftBar.style.width = `${control.left ?? 50}%`;
        if (rightBar)
            rightBar.style.width = `${control.right ?? 50}%`;
    }
    updateHud() {
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
        this.updateScoreboardHud();
    }
    hasLiveData() {
        return [...this.symbols.values()].some(state => state.updatedAt > 0);
    }
    // Territory divider is presentation-only: it must never affect actors or fish.
    /** Development-only overlay; it is not constructed unless explicitly enabled. */
    updateGeometryDebugOverlay() {
        if (!this.options.debugWhaleOcean)
            return;
        const stage = this.canvas.parentElement;
        if (!stage)
            return;
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
        ];
        for (const [kind, x, label] of markers) {
            const marker = document.createElement("div");
            marker.className = `whale-ocean__geometry-marker whale-ocean__geometry-marker--${kind}`;
            marker.style.left = `${x}px`;
            marker.innerHTML = `<span>${label}</span>`;
            overlay.append(marker);
        }
        for (const animal of geometry.animals) {
            if (animal.screenX === null)
                continue;
            const fish = document.createElement("i");
            fish.className = `whale-ocean__geometry-fish whale-ocean__geometry-fish--${animal.territory}`;
            fish.title = `${animal.id} · world X ${animal.worldX}`;
            fish.style.left = `${animal.screenX}px`;
            overlay.append(fish);
        }
    }
    updateTerritoryDivider() {
        const divider = this.root?.querySelector('[data-whale-ocean="territory-divider"]');
        if (!divider)
            return;
        const stage = divider.parentElement;
        const reference = stage ?? this.canvas;
        const canvasRect = this.canvas.getBoundingClientRect();
        const referenceRect = reference.getBoundingClientRect();
        const centerX = canvasRect.left - referenceRect.left + canvasRect.width / 2;
        divider.style.setProperty("--whale-ocean-divider-x", `${Math.round(centerX * 100) / 100}px`);
    }
    setFlowStatus(status, reason) {
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
    logMatchState(reason, transition = null, warning = false) {
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
    write(key, value) {
        const element = this.root?.querySelector(`[data-whale-ocean="${key}"]`);
        if (element)
            element.textContent = value;
    }
    random() {
        this.randomState = (this.randomState * 1664525 + 1013904223) >>> 0;
        return this.randomState / 4294967296;
    }
}
async function waitForSpriteTexture(texture) {
    const deadline = performance.now() + 8000;
    while (!texture.isReady()) {
        if (performance.now() >= deadline)
            throw new Error("Timed out loading Whale Ocean sprite atlas.");
        await new Promise(resolve => setTimeout(resolve, 16));
    }
}
function parseNumber(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
}
function round2(value) {
    return Math.round(value * 100) / 100;
}
function formatPrice(value) {
    if (value === null || value === undefined || !Number.isFinite(value) || value <= 0)
        return "—";
    return new Intl.NumberFormat(undefined, { maximumSignificantDigits: 8 }).format(value);
}
function formatPercent(value) {
    return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}
function formatInteger(value) {
    return Math.max(0, Math.round(value)).toLocaleString(undefined, { maximumFractionDigits: 0 });
}
function formatPressure(value) {
    return value === null ? "—" : `${(value * 100).toFixed(1)}%`;
}
function formatVolume(value) {
    if (!Number.isFinite(value) || value <= 0)
        return "—";
    return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(value);
}
