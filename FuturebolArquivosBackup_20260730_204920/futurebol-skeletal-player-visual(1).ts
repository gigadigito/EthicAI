import type {
    AbstractMesh,
    Bone,
    InstantiatedEntries,
    Mesh,
    Scene,
    Skeleton,
    StandardMaterial,
    TransformNode
} from "babylonjs";
import type { FuturebolPlayerState, FuturebolQuality, FuturebolTeam, FuturebolVisualUpdateContext } from "../futurebol-types.js";
import { FuturebolAnimationController } from "./futurebol-animation-controller.js";
import { FUTUREBOL_PLAYER_ASSET, resolveCandidateName, selectFuturebolAnimation } from "./futurebol-animation-map.js";
import type { FuturebolPlayerVisual } from "./futurebol-player-visual.js";

type BabylonApi = typeof import("babylonjs");

export class FuturebolSkeletalPlayerVisual implements FuturebolPlayerVisual {
    public readonly root: TransformNode;
    public readonly meshes: AbstractMesh[];
    private readonly skeletons: Skeleton[];
    private readonly animationController: FuturebolAnimationController;
    private readonly rootMotionNodes: Array<{ node: TransformNode; x: number; z: number }> = [];
    private readonly qualityMaterials: StandardMaterial[] = [];
    private disposed = false;

    public constructor(
        private readonly B: BabylonApi,
        private readonly scene: Scene,
        private readonly player: FuturebolPlayerState,
        entries: InstantiatedEntries
    ) {
        this.root = new B.TransformNode(`futurebol-skeletal-${player.id}`, scene);
        this.root.scaling.setAll(FUTUREBOL_PLAYER_ASSET.scale);
        for (const node of entries.rootNodes) node.parent = this.root;
        this.meshes = entries.rootNodes.flatMap(node => [node as AbstractMesh, ...node.getChildMeshes(false)]).filter(isMeshLike);
        this.skeletons = entries.skeletons;
        if (!this.skeletons.length) throw new Error(`Skeleton ausente na instância ${player.id}.`);
        this.applyUniformMaterials();
        this.hideHumanHead();
        this.attachCoinHead();
        this.captureRootMotionNodes(entries.rootNodes as TransformNode[]);
        this.animationController = new FuturebolAnimationController(entries.animationGroups, player.id);
    }

    public update(player: FuturebolPlayerState, context: FuturebolVisualUpdateContext, deltaSeconds: number): void {
        this.root.position.set(player.position.x, player.position.y, player.position.z);
        this.root.rotation.y = -player.facingAngle + FUTUREBOL_PLAYER_ASSET.yawOffsetRadians;
        for (const rootMotion of this.rootMotionNodes) {
            rootMotion.node.position.x = rootMotion.x;
            rootMotion.node.position.z = rootMotion.z;
        }
        const requested = selectFuturebolAnimation(player, context);
        this.animationController.request(requested, player.currentSpeed);
        this.animationController.update(deltaSeconds);
    }

    public diagnostics() {
        return {
            kind: "Skeletal" as const,
            skeletonCount: this.skeletons.length,
            currentAnimation: this.animationController.currentAnimation,
            requestedAnimation: this.animationController.requestedAnimation
        };
    }

    public reset(): void { this.animationController.reset(); }

    public setQuality(quality: FuturebolQuality): void {
        for (const material of this.qualityMaterials) {
            material.specularColor = quality === "High"
                ? new this.B.Color3(.48, .5, .55)
                : new this.B.Color3(.28, .3, .34);
            material.specularPower = quality === "High" ? 80 : 48;
        }
    }

    public dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.animationController.dispose();
        for (const skeleton of this.skeletons) skeleton.dispose();
        this.root.dispose(false, true);
    }

    private applyUniformMaterials(): void {
        const base = this.player.role === "goalkeeper"
            ? (this.player.team === "home" ? new this.B.Color3(.25, .12, .04) : new this.B.Color3(.025, .2, .25))
            : (this.player.team === "home" ? new this.B.Color3(.94, .36, .035) : new this.B.Color3(.025, .62, .78));
        const material = new this.B.StandardMaterial(`${this.player.id}-uniform`, this.scene);
        material.diffuseColor = base;
        material.specularColor = new this.B.Color3(.28, .3, .34);
        material.specularPower = 48;
        this.qualityMaterials.push(material);
        for (const mesh of this.meshes) {
            if (mesh.name.toLowerCase().includes("head")) continue;
            mesh.material = material;
        }
    }

    private hideHumanHead(): void {
        const name = resolveCandidateName(this.meshes.map(mesh => mesh.name), FUTUREBOL_PLAYER_ASSET.headMeshCandidates);
        if (!name) return;
        for (const mesh of this.meshes.filter(candidate => candidate.name === name || candidate.name.endsWith(`:${name}`)))
            mesh.setEnabled(false);
    }

    private attachCoinHead(): void {
        const bones = this.skeletons.flatMap(skeleton => skeleton.bones);
        const boneName = resolveCandidateName(
            bones.map(bone => bone.name),
            FUTUREBOL_PLAYER_ASSET.headBoneCandidates
        );
        const headBone = bones.find(bone => bone.name === boneName) ?? null;
        const sourceMesh = this.meshes.find(mesh => Boolean(mesh.skeleton)) as Mesh | undefined;

        if (!headBone || !sourceMesh)
            throw new Error(`Bone de cabeça não resolvido para ${this.player.id}.`);

        const anchor = this.B.MeshBuilder.CreateBox(
            `${this.player.id}-coin-bone-anchor`,
            { size: 0.001 },
            this.scene
        );
        // Não use isVisible=false no anchor: em alguns modelos Babylon isso também
        // faz os filhos anexados ao bone herdarem invisibilidade. O cubo é microscópico.
        anchor.isPickable = false;
        anchor.attachToBone(headBone as Bone, sourceMesh);
        anchor.position.y = FUTUREBOL_PLAYER_ASSET.coinLocalOffsetY;

        const coin = this.B.MeshBuilder.CreateCylinder(
            `${this.player.id}-coin-head`,
            {
                height: FUTUREBOL_PLAYER_ASSET.coinThickness,
                diameter: FUTUREBOL_PLAYER_ASSET.coinDiameter,
                tessellation: 48
            },
            this.scene
        );
        coin.parent = anchor;
        coin.rotation.x = Math.PI / 2;
        coin.material = this.coinMaterial();
        coin.isPickable = false;
        coin.alwaysSelectAsActiveMesh = true;
        coin.renderingGroupId = 1;
        this.meshes.push(coin);

        const symbolMaterial = this.symbolMaterial(this.player.team);
        const symbolDistance =
            FUTUREBOL_PLAYER_ASSET.coinThickness / 2 +
            FUTUREBOL_PLAYER_ASSET.coinSymbolSurfaceOffset;

        // Duas faces garantem que o logo permaneça visível mesmo quando o jogador gira.
        const frontSymbol = this.createCoinSymbolPlane(
            `${this.player.id}-coin-symbol-front`,
            symbolMaterial,
            symbolDistance,
            0
        );
        const backSymbol = this.createCoinSymbolPlane(
            `${this.player.id}-coin-symbol-back`,
            symbolMaterial,
            -symbolDistance,
            Math.PI
        );

        frontSymbol.parent = anchor;
        backSymbol.parent = anchor;
        this.meshes.push(frontSymbol, backSymbol);
    }

    private createCoinSymbolPlane(
        name: string,
        material: StandardMaterial,
        z: number,
        rotationY: number
    ): Mesh {
        const symbol = this.B.MeshBuilder.CreatePlane(
            name,
            { size: FUTUREBOL_PLAYER_ASSET.coinSymbolSize },
            this.scene
        );
        symbol.position.z = z;
        symbol.rotation.y = rotationY;
        symbol.material = material;
        symbol.isPickable = false;
        symbol.alwaysSelectAsActiveMesh = true;
        symbol.renderingGroupId = 2;
        return symbol;
    }

    private captureRootMotionNodes(rootNodes: readonly TransformNode[]): void {
        const nodes = rootNodes.flatMap(root => [root, ...root.getChildTransformNodes(false)]);
        const name = resolveCandidateName(nodes.map(node => node.name), FUTUREBOL_PLAYER_ASSET.rootMotionCandidates);
        for (const node of nodes.filter(candidate => candidate.name === name))
            this.rootMotionNodes.push({ node, x: node.position.x, z: node.position.z });
    }

    private coinMaterial(): StandardMaterial {
        const material = new this.B.StandardMaterial(`${this.player.id}-coin-metal`, this.scene);
        material.diffuseColor = this.player.team === "home" ? new this.B.Color3(.98, .49, .06) : new this.B.Color3(.08, .72, .88);
        material.specularColor = new this.B.Color3(.9, .82, .62); material.specularPower = 96; this.qualityMaterials.push(material); return material;
    }

    private symbolMaterial(team: FuturebolTeam): StandardMaterial {
        const texture = new this.B.DynamicTexture(
            `${this.player.id}-skeletal-symbol-texture`,
            { width: 512, height: 512 },
            this.scene,
            false
        );
        texture.hasAlpha = true;
        texture.drawText(
            team === "home" ? "₿" : "Ξ",
            null,
            382,
            'bold 350px "Segoe UI Symbol", "Arial Unicode MS", Arial, sans-serif',
            "#ffffff",
            "transparent",
            true,
            true
        );

        const material = new this.B.StandardMaterial(`${this.player.id}-skeletal-symbol`, this.scene);
        material.disableLighting = true;
        material.backFaceCulling = false;
        material.useAlphaFromDiffuseTexture = true;
        material.emissiveColor = new this.B.Color3(1, 1, 1);
        material.diffuseColor = new this.B.Color3(1, 1, 1);
        material.diffuseTexture = texture;
        material.opacityTexture = texture;

        // Evita que a face do logo seja ocultada pelo cilindro por conflito de profundidade.
        material.zOffset = -2;
        return material;
    }
}

function isMeshLike(value: AbstractMesh): boolean { return typeof value.getClassName === "function" && value.getClassName() !== "TransformNode"; }
