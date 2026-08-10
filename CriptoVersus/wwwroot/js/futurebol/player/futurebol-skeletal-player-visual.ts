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

import type {
    FuturebolPlayerState,
    FuturebolQuality,
    FuturebolTeamVisualConfiguration,
    FuturebolVisualAnimationState,
    FuturebolVisualUpdateContext
} from "../futurebol-types.js";

import { FuturebolAnimationController } from "./futurebol-animation-controller.js";

import {
    FUTUREBOL_PLAYER_ASSET,
    resolveCandidateName,
    selectFuturebolAnimation
} from "./futurebol-animation-map.js";

import type {
    FuturebolPlayerVisual
} from "./futurebol-player-visual.js";

type BabylonApi = typeof import("babylonjs");

export class FuturebolSkeletalPlayerVisual
    implements FuturebolPlayerVisual {

    public readonly root: TransformNode;
    public readonly meshes: AbstractMesh[];

    /**
     * Nó intermediário utilizado para aplicar poses procedurais,
     * como o mergulho do goleiro, sem interferir no posicionamento
     * principal do jogador ou no root motion do GLB.
     */
    private readonly poseRoot: TransformNode;

    private readonly skeletons: Skeleton[];
    private readonly animationController: FuturebolAnimationController;

    private readonly rootMotionNodes: Array<{
        node: TransformNode;
        x: number;
        z: number;
    }> = [];

    private readonly qualityMaterials: StandardMaterial[] = [];

    /**
     * Deslocamentos visuais temporários utilizados no mergulho.
     *
     * Eles não alteram a posição lógica do jogador no MatchState.
     */
    private diveOffsetY = 0;
    private diveOffsetZ = 0;
    private diveTiltX = 0;
    private diveTiltZ = 0;

    private disposed = false;

    public constructor(
        private readonly B: BabylonApi,
        private readonly scene: Scene,
        private readonly player: FuturebolPlayerState,
        entries: InstantiatedEntries,
        private readonly teamVisual: FuturebolTeamVisualConfiguration,
        private readonly logoMaterial: StandardMaterial
    ) {
        this.root = new B.TransformNode(
            `futurebol-skeletal-${player.id}`,
            scene
        );

        this.root.scaling.setAll(
            FUTUREBOL_PLAYER_ASSET.scale
        );

        /*
         * O GLB deixa de ser filho direto do root principal.
         *
         * O poseRoot permite inclinar e elevar o corpo durante o
         * mergulho sem alterar a posição lógica do jogador.
         */
        this.poseRoot = new B.TransformNode(
            `futurebol-skeletal-pose-${player.id}`,
            scene
        );

        this.poseRoot.parent = this.root;

        for (const node of entries.rootNodes) {
            node.parent = this.poseRoot;
        }

        this.meshes = entries.rootNodes
            .flatMap(node => [
                node as AbstractMesh,
                ...node.getChildMeshes(false)
            ])
            .filter(isMeshLike);

        this.skeletons = entries.skeletons;

        if (!this.skeletons.length) {
            throw new Error(
                `Skeleton ausente na instância ${player.id}.`
            );
        }

        this.root.metadata = { team: teamVisual.symbol };
        this.applyTeamMaterial();
        this.hideHumanHead();
        this.attachCoinHead();

        this.captureRootMotionNodes(
            entries.rootNodes as TransformNode[]
        );

        this.animationController =
            new FuturebolAnimationController(
                entries.animationGroups,
                player.id
            );
    }

    public update(
        player: FuturebolPlayerState,
        context: FuturebolVisualUpdateContext,
        deltaSeconds: number
    ): void {
        const requested = selectFuturebolAnimation(
            player,
            context
        );

        /*
         * Atualiza primeiro a pose procedural para que os offsets
         * sejam considerados no posicionamento final deste frame.
         */
        this.updateGoalkeeperDivePose(
            player,
            requested,
            deltaSeconds
        );

        this.root.position.set(
            player.position.x,
            player.position.y + this.diveOffsetY,
            player.position.z + this.diveOffsetZ
        );

        this.root.rotation.y =
            -player.facingAngle +
            FUTUREBOL_PLAYER_ASSET.yawOffsetRadians;

        /*
         * Impede que animações do GLB desloquem permanentemente
         * o personagem para fora de sua posição lógica.
         */
        for (const rootMotion of this.rootMotionNodes) {
            rootMotion.node.position.x = rootMotion.x;
            rootMotion.node.position.z = rootMotion.z;
        }

        this.animationController.request(
            requested,
            player.currentSpeed
        );

        this.animationController.update(
            deltaSeconds
        );
    }

    public diagnostics() {
        return {
            kind: "Skeletal" as const,
            skeletonCount: this.skeletons.length,
            currentAnimation:
                this.animationController.currentAnimation,
            requestedAnimation:
                this.animationController.requestedAnimation
        };
    }

    public reset(): void {
        this.animationController.reset();

        this.diveOffsetY = 0;
        this.diveOffsetZ = 0;
        this.diveTiltX = 0;
        this.diveTiltZ = 0;

        this.poseRoot.position.set(0, 0, 0);
        this.poseRoot.rotation.set(0, 0, 0);
    }

    public setQuality(quality: FuturebolQuality): void {
        for (const material of this.qualityMaterials) {
            material.specularPower = quality === "High" ? 128 : 104;
        }
    }

    public dispose(): void {
        if (this.disposed)
            return;

        this.disposed = true;

        this.animationController.dispose();

        for (const skeleton of this.skeletons) {
            skeleton.dispose();
        }

        // Materiais e texturas compartilhados pertencem à factory.
        this.root.dispose(false, false);
        for (const material of this.qualityMaterials)
            material.dispose(false, false);
    }

    /**
     * Cria visualmente o mergulho lateral do goleiro.
     *
     * A animação Jump movimenta os membros, enquanto este método:
     *
     * - desloca o jogador na direção da bola;
     * - eleva o corpo no início do movimento;
     * - inclina o corpo lateralmente;
     * - retorna suavemente à posição em pé.
     */
    private updateGoalkeeperDivePose(
        player: FuturebolPlayerState,
        requested: FuturebolVisualAnimationState,
        deltaSeconds: number
    ): void {
        const divingLeft =
            requested === "GoalkeeperDiveLeft";

        const divingRight =
            requested === "GoalkeeperDiveRight";

        const isDiving =
            player.role === "goalkeeper" &&
            (divingLeft || divingRight);

        const progress = clamp(
            player.actionProgress,
            0,
            1
        );

        /*
         * O lado é aplicado no eixo Z do campo, pois os goleiros
         * defendem lateralmente entre as duas traves.
         */
        const side = divingRight
            ? 1
            : divingLeft
                ? -1
                : 0;

        /*
         * O deslocamento lateral cresce até o fim do mergulho.
         * Quando a fase Shooting acaba, isDiving torna-se falso
         * e os valores retornam suavemente para zero.
         */
        const travelProgress = isDiving
            ? smoothStep(progress)
            : 0;

        /*
         * A elevação cria um arco: sobe no começo e volta a baixar
         * quando o goleiro chega ao final do mergulho.
         */
        const liftProgress = isDiving
            ? Math.sin(progress * Math.PI)
            : 0;

        const desiredOffsetZ =
            side * travelProgress * 1.15;

        const desiredOffsetY =
            liftProgress * 0.34;

        /*
         * Rotação em X derruba o corpo lateralmente no campo.
         * Uma pequena rotação em Z evita um movimento rígido.
         */
        const desiredTiltX =
            side * travelProgress * 1.12;

        const desiredTiltZ =
            -side * liftProgress * 0.14;

        /*
         * Entrada rápida no mergulho e recuperação um pouco mais
         * suave para não parecer que o jogador teletransportou.
         */
        const responsiveness =
            isDiving ? 13 : 8.5;

        const safeDelta = clamp(
            deltaSeconds,
            0,
            0.1
        );

        const blend = safeDelta > 0
            ? 1 - Math.exp(
                -responsiveness * safeDelta
            )
            : 0;

        this.diveOffsetZ = lerp(
            this.diveOffsetZ,
            desiredOffsetZ,
            blend
        );

        this.diveOffsetY = lerp(
            this.diveOffsetY,
            desiredOffsetY,
            blend
        );

        this.diveTiltX = lerp(
            this.diveTiltX,
            desiredTiltX,
            blend
        );

        this.diveTiltZ = lerp(
            this.diveTiltZ,
            desiredTiltZ,
            blend
        );

        /*
         * poseRoot afeta corpo, cabeça-moeda e logos juntos.
         */
        this.poseRoot.position.y =
            this.diveOffsetY * 0.12;

        this.poseRoot.rotation.x =
            this.diveTiltX;

        this.poseRoot.rotation.z =
            this.diveTiltZ;

        /*
         * Evita pequenos resíduos numéricos depois da recuperação.
         */
        if (
            !isDiving &&
            Math.abs(this.diveOffsetY) < 0.001 &&
            Math.abs(this.diveOffsetZ) < 0.001 &&
            Math.abs(this.diveTiltX) < 0.001 &&
            Math.abs(this.diveTiltZ) < 0.001
        ) {
            this.diveOffsetY = 0;
            this.diveOffsetZ = 0;
            this.diveTiltX = 0;
            this.diveTiltZ = 0;

            this.poseRoot.position.y = 0;
            this.poseRoot.rotation.x = 0;
            this.poseRoot.rotation.z = 0;
        }
    }

    private applyTeamMaterial(): void {
        const material = new this.B.StandardMaterial(
            `${this.player.id}-team`,
            this.scene
        );
        material.diffuseColor = this.player.team === "home"
            ? new this.B.Color3(0.95, 0.48, 0.08)
            : new this.B.Color3(0.12, 0.68, 0.84);
        material.specularColor = new this.B.Color3(0.3, 0.32, 0.36);
        material.specularPower = 104;
        this.qualityMaterials.push(material);

        for (const mesh of this.meshes) {
            const name = assetName(mesh.name);
            if (name === "OriginalHeadHidden" || isNativeCoinLogo(name) || isNativeCoinCore(name))
                continue;
            mesh.material = material;
        }
    }

    private hideHumanHead(): void {
        for (const mesh of this.meshes) {
            const name = assetName(mesh.name).toLowerCase();
            if (
                name === "originalheadhidden" ||
                FUTUREBOL_PLAYER_ASSET.headMeshCandidates
                    .some(candidate => candidate.toLowerCase() === name)
            ) {
                mesh.setEnabled(false);
            }
        }
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
        anchor.isPickable = false;
        anchor.attachToBone(headBone as Bone, sourceMesh);
        anchor.position.y = FUTUREBOL_PLAYER_ASSET.coinLocalOffsetY;

        const coin = this.B.MeshBuilder.CreateCylinder(
            `${this.player.id}-coin-head`,
            {
                height: FUTUREBOL_PLAYER_ASSET.coinThickness,
                diameter: FUTUREBOL_PLAYER_ASSET.coinDiameter,
                tessellation: 48,
                faceColors: [
                    new this.B.Color4(1, 1, 1, 1),
                    this.player.team === "home"
                        ? new this.B.Color4(0.62, 0.42, 0.18, 1)
                        : new this.B.Color4(0.34, 0.62, 0.74, 1),
                    new this.B.Color4(1, 1, 1, 1)
                ]
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

        const symbolDistance = FUTUREBOL_PLAYER_ASSET.coinThickness / 2 +
            FUTUREBOL_PLAYER_ASSET.coinSymbolSurfaceOffset;
        const frontSymbol = this.createCoinSymbolPlane(
            `${this.player.id}-coin-logo-front`,
            symbolDistance,
            0
        );
        const backSymbol = this.createCoinSymbolPlane(
            `${this.player.id}-coin-logo-back`,
            -symbolDistance,
            Math.PI
        );
        frontSymbol.parent = anchor;
        backSymbol.parent = anchor;
        this.meshes.push(frontSymbol, backSymbol);
    }

    private createCoinSymbolPlane(name: string, z: number, rotationY: number): Mesh {
        const symbol = this.B.MeshBuilder.CreatePlane(
            name,
            { size: FUTUREBOL_PLAYER_ASSET.coinSymbolSize },
            this.scene
        );
        symbol.position.z = z;
        symbol.rotation.y = rotationY;
        symbol.material = this.logoMaterial;
        symbol.isPickable = false;
        symbol.alwaysSelectAsActiveMesh = true;
        symbol.renderingGroupId = 2;
        return symbol;
    }

    private captureRootMotionNodes(
        rootNodes: readonly TransformNode[]
    ): void {
        const nodes = rootNodes.flatMap(
            root => [
                root,
                ...root.getChildTransformNodes(false)
            ]
        );

        const name = resolveCandidateName(
            nodes.map(node => node.name),
            FUTUREBOL_PLAYER_ASSET
                .rootMotionCandidates
        );

        for (
            const node of nodes.filter(
                candidate => candidate.name === name
            )
        ) {
            this.rootMotionNodes.push({
                node,
                x: node.position.x,
                z: node.position.z
            });
        }
    }

    private coinMaterial(): StandardMaterial {
        const material = new this.B.StandardMaterial(
            `${this.player.id}-coin-metal`,
            this.scene
        );
        material.diffuseColor = this.player.team === "home"
            ? new this.B.Color3(0.98, 0.49, 0.06)
            : new this.B.Color3(0.08, 0.72, 0.88);
        material.specularColor = this.player.team === "home"
            ? new this.B.Color3(1, 0.84, 0.48)
            : new this.B.Color3(0.62, 0.94, 1);
        material.specularPower = 112;
        this.qualityMaterials.push(material);
        return material;
    }

}

function assetName(name: string): string {
    const separator = name.lastIndexOf(":");
    return separator >= 0 ? name.slice(separator + 1) : name;
}

function isNativeCoinLogo(name: string): boolean {
    return name.includes("Futurebol_CoinFrontLogoSurface") ||
        name.includes("Futurebol_CoinBackLogoSurface");
}

function isNativeCoinCore(name: string): boolean {
    return name.includes("Futurebol_CoinCore");
}

function isMeshLike(
    value: AbstractMesh
): boolean {
    return (
        typeof value.getClassName === "function" &&
        value.getClassName() !== "TransformNode"
    );
}

function clamp(
    value: number,
    minimum: number,
    maximum: number
): number {
    return Math.min(
        maximum,
        Math.max(minimum, value)
    );
}

function lerp(
    from: number,
    to: number,
    amount: number
): number {
    return from + (to - from) * amount;
}

function smoothStep(
    value: number
): number {
    const safeValue = clamp(value, 0, 1);

    return (
        safeValue *
        safeValue *
        (3 - 2 * safeValue)
    );
}
