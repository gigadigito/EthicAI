import { FuturebolCamera } from "./futurebol-camera.js";
// @ts-ignore Browser module queries are intentional: this is the cache boundary for the visual arena builder.
import { FuturebolArena as FuturebolArenaRuntime } from "./futurebol-arena.js?v=20260820-replay-live-goal-opening-1";
import { resolvePlayerVisualKind } from "./player/futurebol-animation-map.js";
import { FuturebolPlayerVisualFactory } from "./player/futurebol-player-visual-factory.js";
export class FuturebolRenderer {
    constructor(B, canvas, teams, development, quality, reducedMotion) {
        this.B = B;
        this.teams = teams;
        this.development = development;
        this.playerVisuals = new Map();
        this.netMeshes = [];
        this.ballTrail = [];
        this.ballTrailHistory = [];
        this.trailSampleElapsed = 0;
        this.goalFlashElapsed = 0;
        this.shadowGenerator = null;
        this.visualFactory = null;
        this.visualGeneration = 0;
        this.disposed = false;
        this.visualPreference = "Auto";
        this.activeVisualKind = "Primitives";
        this.fallbackActive = false;
        this.assetLoaded = false;
        this.assetLoadTimeMs = 0;
        this.visualWarning = null;
        this.simulateAssetFailure = false;
        this.progressCallback = () => undefined;
        this.quality = quality;
        this.engine = new B.Engine(canvas, quality !== "Low", {
            preserveDrawingBuffer: false,
            stencil: quality === "High",
            powerPreference: quality === "Low" ? "low-power" : "high-performance",
            doNotHandleContextLost: false
        });
        this.scene = new B.Scene(this.engine);
        this.scene.clearColor = new B.Color4(0.024, 0.041, 0.082, 1);
        this.scene.ambientColor = new B.Color3(0.18, 0.22, 0.3);
        this.camera = new FuturebolCamera(B, this.scene, reducedMotion);
        this.field = this.createField();
        this.directionalLight = this.createLights();
        this.arena = new FuturebolArenaRuntime(B, this.scene, quality);
        this.createGoals();
        this.createMarkings();
        this.ball = this.createBall();
        const ballEffects = this.createBallEffects();
        this.ballShadow = ballEffects.shadow;
        this.ballTrail.push(...ballEffects.trail);
        const possession = this.createPossessionIndicator();
        this.possessionRing = possession.mesh;
        this.possessionRingMaterial = possession.material;
        const goalFlash = this.createGoalFlash();
        this.goalFlash = goalFlash.mesh;
        this.goalFlashMaterial = goalFlash.material;
        this.applyQuality(quality);
    }
    async initializePlayers(players, preference, simulateAssetFailure, onProgress) {
        this.visualPreference = preference;
        this.simulateAssetFailure = simulateAssetFailure;
        this.progressCallback = onProgress;
        await this.switchPlayerVisuals(players, true);
    }
    setQuality(quality) {
        this.applyQuality(quality);
    }
    async setPlayerVisualPreference(players, preference) {
        const expectedKind = resolvePlayerVisualKind(preference);
        this.visualPreference = preference;
        if (expectedKind !== this.activeVisualKind || this.fallbackActive)
            await this.switchPlayerVisuals(players, false);
    }
    update(players, ballPosition, pressure, phase, activeTeam, ballOwnerId, outcome, deltaSeconds) {
        for (const player of players) {
            const visual = this.playerVisuals.get(player.id);
            if (!visual)
                continue;
            visual.update(player, { phase, activeTeam, ballOwnerId, outcome }, deltaSeconds);
        }
        this.ball.position.set(ballPosition.x, ballPosition.y, ballPosition.z);
        this.ball.rotation.x += deltaSeconds * 5.2;
        this.ball.rotation.z += deltaSeconds * 3.7;
        this.updatePossessionIndicator(players, ballOwnerId, deltaSeconds);
        this.updateBallEffects(ballPosition, phase, deltaSeconds);
        this.updateGoalFlash(phase, activeTeam, outcome, deltaSeconds);
        this.camera.update(ballPosition, pressure, phase, activeTeam, deltaSeconds);
    }
    setFixedCamera(value) {
        this.camera.setFixed(value);
    }
    resetPlayers() {
        for (const visual of this.playerVisuals.values())
            visual.reset();
        this.possessionRing.setEnabled(false);
        this.goalFlash.setEnabled(false);
        this.goalFlashMaterial.alpha = 0;
        this.ballTrailHistory.length = 0;
        this.trailSampleElapsed = 0;
        for (const trail of this.ballTrail)
            trail.setEnabled(false);
    }
    reconfigureTeams(teams) {
        Object.assign(this.teams.home, teams.home);
        Object.assign(this.teams.away, teams.away);
        this.visualFactory?.reconfigureTeams(this.teams);
    }
    applyQuality(quality) {
        this.quality = quality;
        this.arena?.setQuality(quality);
        for (const visual of this.playerVisuals.values())
            visual.setQuality(quality);
        const scaling = quality === "Low" ? 1.5 : quality === "High" ? 0.82 : 1;
        this.engine.setHardwareScalingLevel(scaling);
        for (const net of this.netMeshes)
            net.setEnabled(quality !== "Low");
        for (const trail of this.ballTrail)
            trail.setEnabled(false);
        if (quality === "Low") {
            this.shadowGenerator?.dispose();
            this.shadowGenerator = null;
            this.field.receiveShadows = false;
            this.scene.imageProcessingConfiguration.contrast = 1;
            return;
        }
        const expectedMapSize = quality === "High" ? 1024 : 512;
        if (this.shadowGenerator && this.shadowGenerator.getShadowMap()?.getSize().width !== expectedMapSize) {
            this.shadowGenerator.dispose();
            this.shadowGenerator = null;
        }
        if (!this.shadowGenerator) {
            this.shadowGenerator = new this.B.ShadowGenerator(expectedMapSize, this.directionalLight);
            this.shadowGenerator.useBlurExponentialShadowMap = true;
            this.shadowGenerator.blurKernel = quality === "High" ? 12 : 6;
            for (const mesh of this.playerMeshes())
                this.shadowGenerator.addShadowCaster(mesh);
            this.shadowGenerator.addShadowCaster(this.ball);
        }
        this.field.receiveShadows = true;
        this.scene.imageProcessingConfiguration.contrast = quality === "High" ? 1.12 : 1.05;
    }
    resize() {
        this.engine.resize();
        const height = this.engine.getRenderHeight();
        if (height > 0)
            this.camera.setViewportAspect(this.engine.getRenderWidth() / height);
    }
    dispose() {
        if (this.disposed)
            return;
        this.disposed = true;
        this.visualGeneration += 1;
        for (const visual of this.playerVisuals.values())
            visual.dispose();
        this.playerVisuals.clear();
        this.visualFactory?.dispose();
        this.visualFactory = null;
        this.netMeshes.length = 0;
        this.shadowGenerator?.dispose();
        this.scene.dispose();
        this.engine.dispose();
    }
    diagnostics(playerId) {
        const visual = (playerId ? this.playerVisuals.get(playerId) : null) ?? this.playerVisuals.values().next().value;
        const details = visual?.diagnostics() ?? { kind: this.activeVisualKind, skeletonCount: 0, currentAnimation: null, requestedAnimation: null };
        return {
            ...details,
            assetLoaded: this.assetLoaded,
            fallbackActive: this.fallbackActive,
            loadTimeMs: this.assetLoadTimeMs,
            warning: this.visualWarning,
            logos: this.visualFactory?.logoDiagnostics() ?? this.emptyLogoDiagnostics()
        };
    }
    async switchPlayerVisuals(players, force) {
        const kind = resolvePlayerVisualKind(this.visualPreference);
        if (!force && kind === this.activeVisualKind && !this.fallbackActive)
            return;
        const generation = ++this.visualGeneration;
        for (const visual of this.playerVisuals.values())
            visual.dispose();
        this.playerVisuals.clear();
        this.visualFactory?.dispose();
        const factory = new FuturebolPlayerVisualFactory(this.B, this.scene, this.teams, this.development, this.simulateAssetFailure, this.progressCallback);
        this.visualFactory = factory;
        const result = await factory.create(players, kind);
        if (this.disposed || generation !== this.visualGeneration) {
            for (const visual of result.visuals.values())
                visual.dispose();
            factory.dispose();
            return;
        }
        this.playerVisuals = result.visuals;
        this.activeVisualKind = result.activeKind;
        this.fallbackActive = result.fallbackActive;
        this.assetLoaded = result.assetLoaded;
        this.assetLoadTimeMs = result.loadTimeMs;
        this.visualWarning = result.warning;
        this.rebuildShadows();
    }
    playerMeshes() { return [...this.playerVisuals.values()].flatMap(visual => [...visual.meshes]); }
    emptyLogoDiagnostics() {
        return {
            home: {
                ...this.teams.home,
                loaded: false,
                fallbackActive: !this.teams.home.logoUrl,
                error: null
            },
            away: {
                ...this.teams.away,
                loaded: false,
                fallbackActive: !this.teams.away.logoUrl,
                error: null
            }
        };
    }
    rebuildShadows() {
        this.shadowGenerator?.dispose();
        this.shadowGenerator = null;
        this.applyQuality(this.quality);
    }
    createBallEffects() {
        const shadow = this.B.MeshBuilder.CreateDisc("futurebol-ball-shadow", {
            radius: 0.62,
            tessellation: 32
        }, this.scene);
        shadow.rotation.x = Math.PI / 2;
        shadow.position.y = 0.025;
        shadow.isPickable = false;
        const shadowMaterial = this.createMaterial("futurebol-ball-shadow-material", new this.B.Color3(0.005, 0.008, 0.012));
        shadowMaterial.alpha = 0.34;
        shadowMaterial.disableLighting = true;
        shadowMaterial.backFaceCulling = false;
        shadow.material = shadowMaterial;
        const trail = [];
        for (let index = 0; index < 6; index++) {
            const size = 0.25 - index * 0.026;
            const sample = this.B.MeshBuilder.CreateSphere(`futurebol-ball-trail-${index}`, {
                diameter: Math.max(0.09, size),
                segments: 8
            }, this.scene);
            const material = this.createMaterial(`futurebol-ball-trail-material-${index}`, new this.B.Color3(0.78, 0.9, 1));
            material.emissiveColor = new this.B.Color3(0.3, 0.58, 0.86);
            material.alpha = Math.max(0.08, 0.3 - index * 0.04);
            material.disableLighting = true;
            sample.material = material;
            sample.isPickable = false;
            sample.setEnabled(false);
            trail.push(sample);
        }
        return {
            shadow,
            trail
        };
    }
    createPossessionIndicator() {
        const material = this.createMaterial("futurebol-possession-ring-material", new this.B.Color3(1, 0.58, 0.08));
        material.emissiveColor = new this.B.Color3(0.65, 0.28, 0.025);
        material.alpha = 0.82;
        material.disableLighting = true;
        const mesh = this.B.MeshBuilder.CreateTorus("futurebol-possession-ring", {
            diameter: 1.85,
            thickness: 0.09,
            tessellation: 48
        }, this.scene);
        mesh.rotation.x = Math.PI / 2;
        mesh.position.y = 0.055;
        mesh.material = material;
        mesh.isPickable = false;
        mesh.setEnabled(false);
        return {
            mesh,
            material
        };
    }
    createGoalFlash() {
        const material = this.createMaterial("futurebol-goal-flash-material", new this.B.Color3(0.12, 0.75, 0.95));
        material.emissiveColor = new this.B.Color3(0.1, 0.65, 0.95);
        material.alpha = 0;
        material.disableLighting = true;
        material.backFaceCulling = false;
        const mesh = this.B.MeshBuilder.CreatePlane("futurebol-goal-flash", {
            width: 7,
            height: 3.4
        }, this.scene);
        mesh.position.y = 1.65;
        mesh.material = material;
        mesh.isPickable = false;
        mesh.renderingGroupId = 3;
        mesh.setEnabled(false);
        return {
            mesh,
            material
        };
    }
    updatePossessionIndicator(players, ballOwnerId, deltaSeconds) {
        const owner = ballOwnerId
            ? players.find(player => player.id === ballOwnerId) ?? null
            : null;
        if (!owner) {
            this.possessionRing.setEnabled(false);
            return;
        }
        this.possessionRing.setEnabled(true);
        this.possessionRing.position.x = owner.position.x;
        this.possessionRing.position.y = 0.055;
        this.possessionRing.position.z = owner.position.z;
        const pulse = 1 + Math.sin(owner.animationTime * 1.5) * 0.06;
        const blend = deltaSeconds > 0
            ? 1 - Math.exp(-10 * Math.min(deltaSeconds, 0.1))
            : 0;
        this.possessionRing.scaling.x = lerp(this.possessionRing.scaling.x, pulse, blend);
        this.possessionRing.scaling.y = lerp(this.possessionRing.scaling.y, pulse, blend);
        this.possessionRing.scaling.z = lerp(this.possessionRing.scaling.z, pulse, blend);
        if (owner.team === "home") {
            this.possessionRingMaterial.diffuseColor =
                new this.B.Color3(1, 0.52, 0.06);
            this.possessionRingMaterial.emissiveColor =
                new this.B.Color3(0.72, 0.25, 0.02);
        }
        else {
            this.possessionRingMaterial.diffuseColor =
                new this.B.Color3(0.05, 0.76, 0.96);
            this.possessionRingMaterial.emissiveColor =
                new this.B.Color3(0.02, 0.48, 0.78);
        }
    }
    updateBallEffects(ballPosition, phase, deltaSeconds) {
        this.ballShadow.position.x = ballPosition.x;
        this.ballShadow.position.y = 0.026;
        this.ballShadow.position.z = ballPosition.z;
        const shadowScale = clamp(1 - (ballPosition.y - 0.55) * 0.12, 0.42, 1);
        this.ballShadow.scaling.set(shadowScale, shadowScale, shadowScale);
        const shadowMaterial = this.ballShadow.material;
        if (shadowMaterial) {
            shadowMaterial.alpha = clamp(0.38 - (ballPosition.y - 0.55) * 0.055, 0.08, 0.38);
        }
        const trailActive = this.quality !== "Low" &&
            (phase === "Passing" || phase === "Shooting");
        if (!trailActive) {
            this.ballTrailHistory.length = 0;
            this.trailSampleElapsed = 0;
            for (const trail of this.ballTrail)
                trail.setEnabled(false);
            return;
        }
        this.trailSampleElapsed += Math.max(0, deltaSeconds);
        if (this.trailSampleElapsed >= 0.032 ||
            this.ballTrailHistory.length === 0) {
            this.trailSampleElapsed = 0;
            this.ballTrailHistory.unshift({
                x: ballPosition.x,
                y: ballPosition.y,
                z: ballPosition.z
            });
            if (this.ballTrailHistory.length > this.ballTrail.length)
                this.ballTrailHistory.length = this.ballTrail.length;
        }
        for (let index = 0; index < this.ballTrail.length; index++) {
            const sample = this.ballTrail[index];
            const position = this.ballTrailHistory[index];
            if (!position) {
                sample.setEnabled(false);
                continue;
            }
            sample.setEnabled(true);
            sample.position.set(position.x, position.y, position.z);
        }
    }
    updateGoalFlash(phase, activeTeam, outcome, deltaSeconds) {
        const goalActive = phase === "Outcome" &&
            outcome === "Goal" &&
            activeTeam !== null;
        if (!goalActive || !activeTeam) {
            this.goalFlashElapsed = 0;
            this.goalFlashMaterial.alpha = 0;
            this.goalFlash.setEnabled(false);
            return;
        }
        this.goalFlashElapsed += Math.max(0, deltaSeconds);
        const homeScored = activeTeam === "home";
        this.goalFlash.setEnabled(true);
        this.goalFlash.position.x = homeScored ? 26.85 : -26.85;
        this.goalFlash.position.y = 1.65;
        this.goalFlash.position.z = 0;
        this.goalFlash.rotation.y = homeScored
            ? -Math.PI / 2
            : Math.PI / 2;
        const pulse = 0.5 + 0.5 * Math.sin(this.goalFlashElapsed * 11);
        const scale = 1 + pulse * 0.08;
        this.goalFlash.scaling.set(scale, scale, scale);
        this.goalFlashMaterial.alpha = 0.18 + pulse * 0.34;
        if (homeScored) {
            this.goalFlashMaterial.diffuseColor =
                new this.B.Color3(1, 0.5, 0.04);
            this.goalFlashMaterial.emissiveColor =
                new this.B.Color3(1, 0.24, 0.01);
        }
        else {
            this.goalFlashMaterial.diffuseColor =
                new this.B.Color3(0.04, 0.78, 1);
            this.goalFlashMaterial.emissiveColor =
                new this.B.Color3(0.02, 0.52, 1);
        }
    }
    createField() {
        const field = this.B.MeshBuilder.CreateGround("futurebol-field", { width: 50, height: 30 }, this.scene);
        const material = new this.B.StandardMaterial("futurebol-field-material", this.scene);
        material.diffuseColor = new this.B.Color3(0.04, 0.255, 0.145);
        material.specularColor = new this.B.Color3(0.012, 0.035, 0.025);
        field.material = material;
        const stripeMaterials = [
            this.createMaterial("futurebol-grass-stripe-dark", new this.B.Color3(0.048, 0.29, 0.165)),
            this.createMaterial("futurebol-grass-stripe-light", new this.B.Color3(0.058, 0.335, 0.19))
        ];
        stripeMaterials.forEach(stripeMaterial => {
            stripeMaterial.alpha = 0.78;
            stripeMaterial.specularColor = new this.B.Color3(0.01, 0.025, 0.018);
        });
        for (let index = 0; index < 10; index++) {
            const stripe = this.B.MeshBuilder.CreateGround(`futurebol-grass-stripe-${index}`, { width: 5, height: 29.8 }, this.scene);
            stripe.position.set(-22.5 + index * 5, 0.012, 0);
            stripe.material = stripeMaterials[index % 2];
        }
        const borderMaterial = this.createMaterial("futurebol-field-border-material", new this.B.Color3(0.025, 0.115, 0.085));
        for (const z of [-15.65, 15.65]) {
            const border = this.B.MeshBuilder.CreateBox(`futurebol-field-border-${z}`, { width: 52, height: 0.12, depth: 0.7 }, this.scene);
            border.position.set(0, -0.015, z);
            border.material = borderMaterial;
        }
        return field;
    }
    createLights() {
        const hemispheric = new this.B.HemisphericLight("futurebol-ambient-light", new this.B.Vector3(0, 1, 0), this.scene);
        hemispheric.intensity = 0.76;
        hemispheric.diffuse = new this.B.Color3(0.7, 0.82, 1);
        hemispheric.groundColor = new this.B.Color3(0.055, 0.09, 0.12);
        const directional = new this.B.DirectionalLight("futurebol-key-light", new this.B.Vector3(-0.35, -1, 0.25), this.scene);
        directional.position = new this.B.Vector3(8, 24, -10);
        directional.diffuse = new this.B.Color3(0.92, 0.96, 1);
        directional.intensity = 1.24;
        return directional;
    }
    createGoals() {
        const material = this.createMaterial("futurebol-goal-material", new this.B.Color3(0.88, 0.92, 1));
        material.emissiveColor = new this.B.Color3(0.14, 0.16, 0.2);
        const netMaterial = this.createMaterial("futurebol-net-material", new this.B.Color3(0.64, 0.76, 0.84));
        netMaterial.alpha = 0.34;
        netMaterial.backFaceCulling = false;
        for (const side of [-1, 1]) {
            const frontX = side * 25;
            const rearX = side * 27;
            this.createGoalBar(`futurebol-crossbar-${side}`, frontX, 3, 0, 0.18, 0.18, 7.2, material);
            this.createGoalBar(`futurebol-rear-crossbar-${side}`, rearX, 3, 0, 0.14, 0.14, 7.2, material);
            for (const z of [-3.5, 3.5]) {
                this.createGoalBar(`futurebol-post-${side}-${z}`, frontX, 1.5, z, 0.18, 3, 0.18, material);
                this.createGoalBar(`futurebol-rear-post-${side}-${z}`, rearX, 1.5, z, 0.14, 3, 0.14, material);
                this.createGoalBar(`futurebol-depth-top-${side}-${z}`, side * 26, 3, z, 2.1, 0.12, 0.12, material);
                this.createGoalBar(`futurebol-depth-floor-${side}-${z}`, side * 26, 0.08, z, 2.1, 0.1, 0.1, material);
            }
            const backNet = this.B.MeshBuilder.CreatePlane(`futurebol-back-net-${side}`, { width: 7, height: 3 }, this.scene);
            backNet.position.set(rearX - side * 0.02, 1.5, 0);
            backNet.rotation.y = Math.PI / 2;
            backNet.material = netMaterial;
            this.netMeshes.push(backNet);
            const topNet = this.B.MeshBuilder.CreateGround(`futurebol-top-net-${side}`, { width: 2, height: 7 }, this.scene);
            topNet.position.set(side * 26, 3.01, 0);
            topNet.material = netMaterial;
            this.netMeshes.push(topNet);
        }
    }
    createGoalBar(name, x, y, z, width, height, depth, material) {
        const bar = this.B.MeshBuilder.CreateBox(name, { width, height, depth }, this.scene);
        bar.position.set(x, y, z);
        bar.material = material;
    }
    createMarkings() {
        const y = 0.04;
        const white = new this.B.Color3(0.82, 0.91, 0.88);
        const rectangle = [
            new this.B.Vector3(-25, y, -15),
            new this.B.Vector3(25, y, -15),
            new this.B.Vector3(25, y, 15),
            new this.B.Vector3(-25, y, 15),
            new this.B.Vector3(-25, y, -15)
        ];
        const outline = this.B.MeshBuilder.CreateLines("futurebol-touchlines", { points: rectangle }, this.scene);
        outline.color = white;
        const halfway = this.B.MeshBuilder.CreateLines("futurebol-halfway", {
            points: [new this.B.Vector3(0, y, -15), new this.B.Vector3(0, y, 15)]
        }, this.scene);
        halfway.color = white;
        const circlePoints = Array.from({ length: 49 }, (_, index) => {
            const angle = index / 48 * Math.PI * 2;
            return new this.B.Vector3(Math.cos(angle) * 4, y, Math.sin(angle) * 4);
        });
        const circle = this.B.MeshBuilder.CreateLines("futurebol-center-circle", { points: circlePoints }, this.scene);
        circle.color = white;
        for (const side of [-1, 1]) {
            const innerX = side * 18.5;
            const outerX = side * 25;
            const box = [
                new this.B.Vector3(outerX, y, -7),
                new this.B.Vector3(innerX, y, -7),
                new this.B.Vector3(innerX, y, 7),
                new this.B.Vector3(outerX, y, 7)
            ];
            const penalty = this.B.MeshBuilder.CreateLines(`futurebol-penalty-${side}`, { points: box }, this.scene);
            penalty.color = white;
        }
    }
    createBall() {
        const ball = this.B.MeshBuilder.CreateSphere("futurebol-ball", { diameter: 1.05, segments: 16 }, this.scene);
        const material = this.createMaterial("futurebol-ball-material", new this.B.Color3(0.94, 0.95, 0.98));
        material.specularColor = new this.B.Color3(0.8, 0.8, 0.8);
        ball.material = material;
        return ball;
    }
    createMaterial(name, color) {
        const material = new this.B.StandardMaterial(name, this.scene);
        material.diffuseColor = color;
        return material;
    }
}
function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
}
function lerp(from, to, amount) {
    return from + (to - from) * amount;
}
