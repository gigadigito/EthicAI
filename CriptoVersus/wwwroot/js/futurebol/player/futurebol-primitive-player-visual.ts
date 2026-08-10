import type { AbstractMesh, Scene, StandardMaterial, TransformNode } from "babylonjs";
import type {
    FuturebolPlayerState,
    FuturebolQuality,
    FuturebolTeamVisualConfiguration,
    FuturebolVisualUpdateContext
} from "../futurebol-types.js";
import type { FuturebolPlayerVisual } from "./futurebol-player-visual.js";
import { selectFuturebolAnimation } from "./futurebol-animation-map.js";

type BabylonApi = typeof import("babylonjs");

export class FuturebolPrimitivePlayerVisual implements FuturebolPlayerVisual {
    public readonly root: TransformNode;
    public readonly meshes: AbstractMesh[] = [];
    private readonly poseRoot: TransformNode;
    private readonly leftArm: TransformNode;
    private readonly rightArm: TransformNode;
    private readonly leftLeg: TransformNode;
    private readonly rightLeg: TransformNode;
    private requested: ReturnType<typeof selectFuturebolAnimation> | null = null;
    private readonly qualityMaterials: StandardMaterial[] = [];
    private disposed = false;

    public constructor(
        private readonly B: BabylonApi,
        private readonly scene: Scene,
        player: FuturebolPlayerState,
        teamVisual: FuturebolTeamVisualConfiguration,
        logoMaterial: StandardMaterial
    ) {
        this.root = new B.TransformNode(`futurebol-player-${player.id}`, scene);
        this.root.metadata = { team: teamVisual.symbol };
        this.poseRoot = new B.TransformNode(`${player.id}-pose`, scene);
        this.poseRoot.parent = this.root;
        const dark = this.material(`${player.id}-dark`, new B.Color3(.025, .035, .07));
        const teamMaterial = this.material(
            `${player.id}-team`,
            player.team === "home"
                ? new B.Color3(.95, .48, .08)
                : new B.Color3(.12, .68, .84)
        );
        const coinMaterial = this.material(
            `${player.id}-coin`,
            player.team === "home"
                ? new B.Color3(.95, .48, .08)
                : new B.Color3(.12, .68, .84)
        );
        coinMaterial.specularColor = player.team === "home"
            ? new B.Color3(1, .82, .42)
            : new B.Color3(.58, .92, 1);
        coinMaterial.specularPower = 96;

        const body = B.MeshBuilder.CreateCylinder(`${player.id}-body`, { height: 1.55, diameterTop: .7, diameterBottom: .92, tessellation: 12 }, scene);
        body.parent = this.poseRoot; body.position.y = 1.86; body.material = teamMaterial; this.meshes.push(body);
        this.leftLeg = this.limb(player.id, "left-leg", -.27, 1.18, 1.15, .23, dark);
        this.rightLeg = this.limb(player.id, "right-leg", .27, 1.18, 1.15, .23, dark);
        this.leftArm = this.limb(player.id, "left-arm", -.52, 2.38, 1.08, .19, teamMaterial);
        this.rightArm = this.limb(player.id, "right-arm", .52, 2.38, 1.08, .19, teamMaterial);
        const head = new B.TransformNode(`${player.id}-coin-anchor`, scene); head.parent = this.poseRoot; head.position.y = 3.15;
        const coinThickness = .38;
        const coin = B.MeshBuilder.CreateCylinder(
            `${player.id}-coin-head`,
            {
                height: coinThickness,
                diameter: 1.28,
                tessellation: 40
            },
            scene
        );
        coin.parent = head; coin.rotation.x = Math.PI / 2; coin.material = coinMaterial; this.meshes.push(coin);
        const logoDistance = coinThickness / 2 + .018;
        const frontLogo = this.coinLogoPlane(
            `${player.id}-coin-logo-front`,
            logoMaterial,
            logoDistance,
            0
        );
        const backLogo = this.coinLogoPlane(
            `${player.id}-coin-logo-back`,
            logoMaterial,
            -logoDistance,
            Math.PI
        );
        frontLogo.parent = head;
        backLogo.parent = head;
        this.meshes.push(frontLogo, backLogo);
    }

    public update(player: FuturebolPlayerState, context: FuturebolVisualUpdateContext, deltaSeconds: number): void {
        this.root.position.set(player.position.x, player.position.y, player.position.z);
        this.root.rotation.y = -player.facingAngle;
        this.requested = selectFuturebolAnimation(player, context);
        let swing = 0, lean = 0, roll = 0, height = 0;
        if (this.requested === "Walk" || this.requested === "Run" || this.requested === "Dribble") {
            const amplitude = this.requested === "Walk" ? .46 : .78;
            swing = Math.sin(player.animationTime) * amplitude;
            lean = this.requested === "Walk" ? -.025 : -.09;
        } else if (this.requested === "Pass" || this.requested === "Shoot") {
            swing = Math.sin(Math.min(1, player.actionProgress) * Math.PI) * 1.05;
            lean = -.18 * Math.sin(player.actionProgress * Math.PI);
        } else if (this.requested.startsWith("GoalkeeperDive")) {
            const side = this.requested.endsWith("Right") ? 1 : -1;
            roll = side * smoothStep(player.actionProgress) * .88;
            height = Math.sin(player.actionProgress * Math.PI) * .32 - player.actionProgress * .12;
        }
        const blend = deltaSeconds <= 0 ? 0 : 1 - Math.exp(-10 * Math.min(deltaSeconds, .1));
        this.leftLeg.rotation.z = lerp(this.leftLeg.rotation.z, swing, blend);
        this.rightLeg.rotation.z = lerp(this.rightLeg.rotation.z, -swing, blend);
        this.leftArm.rotation.z = lerp(this.leftArm.rotation.z, -swing * .7, blend);
        this.rightArm.rotation.z = lerp(this.rightArm.rotation.z, swing * .7, blend);
        this.poseRoot.rotation.z = lerp(this.poseRoot.rotation.z, lean, blend);
        this.poseRoot.rotation.x = lerp(this.poseRoot.rotation.x, roll, blend);
        this.poseRoot.position.y = lerp(this.poseRoot.position.y, height, blend);
    }

    public diagnostics() { return { kind: "Primitives" as const, skeletonCount: 0, currentAnimation: this.requested, requestedAnimation: this.requested }; }
    public setQuality(quality: FuturebolQuality): void {
        for (const material of this.qualityMaterials) {
            const isCoin = material.name.endsWith("-coin");
            material.specularPower = isCoin
                ? (quality === "High" ? 112 : 88)
                : (quality === "High" ? 56 : 32);
        }
    }
    public reset(): void { this.requested = null; }
    public dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.root.dispose(false, false);
        for (const material of this.qualityMaterials)
            material.dispose(false, false);
    }

    private limb(id: string, name: string, x: number, y: number, length: number, diameter: number, material: StandardMaterial): TransformNode {
        const pivot = new this.B.TransformNode(`${id}-${name}-pivot`, this.scene); pivot.parent = this.poseRoot; pivot.position.set(x, y, 0);
        const mesh = this.B.MeshBuilder.CreateCylinder(`${id}-${name}`, { height: length, diameter, tessellation: 8 }, this.scene);
        mesh.parent = pivot; mesh.position.y = -length / 2; mesh.material = material; this.meshes.push(mesh); return pivot;
    }

    private material(name: string, color: import("babylonjs").Color3): StandardMaterial {
        const material = new this.B.StandardMaterial(name, this.scene);
        material.diffuseColor = color;
        material.specularColor = new this.B.Color3(.3, .32, .36);
        this.qualityMaterials.push(material);
        return material;
    }

    private coinLogoPlane(
        name: string,
        material: StandardMaterial,
        z: number,
        rotationY: number
    ): import('babylonjs').Mesh {
        const logo = this.B.MeshBuilder.CreatePlane(name, { size: .91 }, this.scene);
        logo.position.z = z;
        logo.rotation.y = rotationY;
        logo.material = material;
        logo.isPickable = false;
        logo.alwaysSelectAsActiveMesh = true;
        logo.renderingGroupId = 2;
        return logo;
    }
}

function lerp(a: number, b: number, t: number): number { return a + (b - a) * t; }
function smoothStep(value: number): number { const v = Math.min(1, Math.max(0, value)); return v * v * (3 - 2 * v); }
