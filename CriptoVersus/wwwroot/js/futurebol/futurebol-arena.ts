import type { Mesh, Scene, StandardMaterial } from "babylonjs";
import type { FuturebolQuality } from "./futurebol-types.js";

type BabylonApi = typeof import("babylonjs");

const SIDE_TIER_COUNT = 8;
const END_TIER_COUNT = 6;
const SIDE_AISLES = [-16.5, -5.5, 5.5, 16.5];
const END_STAND_HALF_DEPTH = 15.6;
export const FUTUREBOL_END_STAND_GOAL_OPENING_HALF_WIDTH = 5.4;
const END_STAND_SECTION_DEPTH = END_STAND_HALF_DEPTH - FUTUREBOL_END_STAND_GOAL_OPENING_HALF_WIDTH;
const END_STAND_SECTION_CENTER = FUTUREBOL_END_STAND_GOAL_OPENING_HALF_WIDTH + END_STAND_SECTION_DEPTH / 2;
const END_AISLES = [-10.4, 10.4];

interface ThinTransform {
    x: number;
    y: number;
    z: number;
    yaw?: number;
    scaleX?: number;
    scaleY?: number;
    scaleZ?: number;
}

interface ArenaMaterials {
    shell: StandardMaterial;
    tier: StandardMaterial;
    upperTier: StandardMaterial;
    seatDark: StandardMaterial;
    seatCool: StandardMaterial;
    seatWarm: StandardMaterial;
    crowdDark: StandardMaterial;
    crowdCool: StandardMaterial;
    crowdWarm: StandardMaterial;
    crowdLight: StandardMaterial;
    aisle: StandardMaterial;
    concourse: StandardMaterial;
    portal: StandardMaterial;
    cyan: StandardMaterial;
    orange: StandardMaterial;
    lamp: StandardMaterial;
    lampHalo: StandardMaterial;
}

/** Static, browser-friendly stadium presentation shared by Lab, Match and Broadcast. */
export class FuturebolArena {
    private readonly detailMeshes: Mesh[] = [];
    private seatInstanceCount = 0;
    private crowdInstanceCount = 0;
    private floodlightInstanceCount = 0;

    public constructor(
        private readonly B: BabylonApi,
        private readonly scene: Scene,
        quality: FuturebolQuality
    ) {
        const materials = this.createMaterials();
        this.createSteppedBowl(materials);
        this.createInstancedSeatsAndCrowd(materials);
        this.createStadiumShell(materials);
        this.createConcourseTunnelsAndBoards(materials);
        this.createFloodlightBanks(materials);
        this.createScoreboards(materials);

        for (const material of Object.values(materials))
            material.freeze();

        this.setQuality(quality);
        console.info(
            "[Futurebol][Arena] REAL_STADIUM_BUILDER_ACTIVE",
            {
                version: "STADIUM_V3",
                quality,
                meshes: this.scene.meshes.filter(mesh => mesh.name.startsWith("futurebol-arena-")).length,
                seatInstances: this.seatInstanceCount,
                crowdInstances: this.crowdInstanceCount,
                floodlightInstances: this.floodlightInstanceCount
            }
        );
    }

    public setQuality(quality: FuturebolQuality): void {
        const detailsEnabled = quality !== "Low";
        for (const mesh of this.detailMeshes)
            mesh.setEnabled(detailsEnabled);
    }

    private createSteppedBowl(materials: ArenaMaterials): void {
        const lowerDecks: Mesh[] = [];
        const upperDecks: Mesh[] = [];
        const risers: Mesh[] = [];
        const aisles: Mesh[] = [];

        for (const side of [-1, 1]) {
            for (let row = 0; row < SIDE_TIER_COUNT; row++) {
                const deckY = 0.5 + row * 0.72;
                const z = side * (15.75 + row);
                const target = row < 4 ? lowerDecks : upperDecks;
                const material = row < 4 ? materials.tier : materials.upperTier;
                target.push(this.box(`futurebol-side-step-deck-${side}-${row}`, 59, 0.2, 1.12, 0, deckY, z, material));
                risers.push(this.box(
                    `futurebol-side-step-riser-${side}-${row}`,
                    59, 0.72, 0.16, 0, deckY - 0.36, z - side * 0.52, materials.tier
                ));

                for (const aisleX of SIDE_AISLES) {
                    aisles.push(this.box(
                        `futurebol-side-stair-${side}-${row}-${aisleX}`,
                        0.68, 0.09, 1, aisleX, deckY + 0.14, z, materials.aisle
                    ));
                }
            }
        }

        for (const side of [-1, 1]) {
            for (let row = 0; row < END_TIER_COUNT; row++) {
                const deckY = 0.5 + row * 0.72;
                const x = side * (26.15 + row);
                const target = row < 3 ? lowerDecks : upperDecks;
                const material = row < 3 ? materials.tier : materials.upperTier;
                for (const section of [-1, 1]) {
                    const sectionZ = section * END_STAND_SECTION_CENTER;
                    target.push(this.box(
                        `futurebol-end-step-deck-${side}-${row}-${section}`,
                        1.12, 0.2, END_STAND_SECTION_DEPTH, x, deckY, sectionZ, material
                    ));
                    risers.push(this.box(
                        `futurebol-end-step-riser-${side}-${row}-${section}`,
                        0.16, 0.72, END_STAND_SECTION_DEPTH, x - side * 0.52, deckY - 0.36, sectionZ, materials.tier
                    ));
                }

                for (const aisleZ of END_AISLES) {
                    aisles.push(this.box(
                        `futurebol-end-stair-${side}-${row}-${aisleZ}`,
                        0.92, 0.08, 0.62, x, deckY + 0.12, aisleZ, materials.aisle
                    ));
                }
            }
        }

        this.merge("futurebol-arena-lower-step-decks", lowerDecks, materials.tier);
        this.merge("futurebol-arena-upper-step-decks", upperDecks, materials.upperTier);
        this.merge("futurebol-arena-step-risers", risers, materials.tier);
        this.merge("futurebol-arena-sector-stairs", aisles, materials.aisle, true);
    }

    private createInstancedSeatsAndCrowd(materials: ArenaMaterials): void {
        const darkSeats: ThinTransform[] = [];
        const coolSeats: ThinTransform[] = [];
        const warmSeats: ThinTransform[] = [];
        const darkCrowd: ThinTransform[] = [];
        const coolCrowd: ThinTransform[] = [];
        const warmCrowd: ThinTransform[] = [];
        const lightCrowd: ThinTransform[] = [];

        for (const side of [-1, 1]) {
            for (let row = 0; row < SIDE_TIER_COUNT; row++) {
                const deckY = 0.5 + row * 0.72;
                const z = side * (15.75 + row);
                let column = 0;
                for (let x = -27.05; x <= 27.05; x += 0.94) {
                    if (SIDE_AISLES.some(aisle => Math.abs(x - aisle) < 0.52))
                        continue;
                    if (row < 3 && Math.abs(x) < 3.15)
                        continue;

                    const seat: ThinTransform = {
                        x,
                        y: deckY + 0.42,
                        z: z + side * 0.2,
                        yaw: side < 0 ? Math.PI : 0
                    };
                    this.pickSeatGroup(row, column, darkSeats, coolSeats, warmSeats).push(seat);

                    if (row > 0 && this.hasSpectator(row, column, side)) {
                        const spectator: ThinTransform = {
                            x,
                            y: deckY + 1.02,
                            z: z + side * 0.12,
                            scaleX: 0.88 + ((column + row) % 3) * 0.06,
                            scaleY: 0.9 + ((column * 3 + row) % 4) * 0.05,
                            scaleZ: 0.88
                        };
                        this.pickCrowdGroup(row, column, darkCrowd, coolCrowd, warmCrowd, lightCrowd).push(spectator);
                    }
                    column += 1;
                }
            }
        }

        for (const side of [-1, 1]) {
            for (let row = 0; row < END_TIER_COUNT; row++) {
                const deckY = 0.5 + row * 0.72;
                const x = side * (26.15 + row);
                let column = 0;
                for (let z = -13.75; z <= 13.75; z += 0.98) {
                    if (Math.abs(z) < FUTUREBOL_END_STAND_GOAL_OPENING_HALF_WIDTH)
                        continue;
                    if (END_AISLES.some(aisle => Math.abs(z - aisle) < 0.54))
                        continue;

                    const seat: ThinTransform = {
                        x: x + side * 0.2,
                        y: deckY + 0.42,
                        z,
                        yaw: side < 0 ? -Math.PI / 2 : Math.PI / 2
                    };
                    this.pickSeatGroup(row, column, darkSeats, coolSeats, warmSeats).push(seat);

                    if (row > 0 && this.hasSpectator(row, column, side)) {
                        const spectator: ThinTransform = {
                            x: x + side * 0.12,
                            y: deckY + 1.02,
                            z,
                            scaleX: 0.9,
                            scaleY: 0.92 + ((column + row) % 4) * 0.05,
                            scaleZ: 0.9
                        };
                        this.pickCrowdGroup(row, column, darkCrowd, coolCrowd, warmCrowd, lightCrowd).push(spectator);
                    }
                    column += 1;
                }
            }
        }

        this.createSeatInstances("futurebol-arena-seats-dark", darkSeats, materials.seatDark);
        this.createSeatInstances("futurebol-arena-seats-cool", coolSeats, materials.seatCool);
        this.createSeatInstances("futurebol-arena-seats-warm", warmSeats, materials.seatWarm);
        this.createCrowdInstances("futurebol-arena-crowd-dark", darkCrowd, materials.crowdDark, true);
        this.createCrowdInstances("futurebol-arena-crowd-cool", coolCrowd, materials.crowdCool, true);
        this.createCrowdInstances("futurebol-arena-crowd-warm", warmCrowd, materials.crowdWarm, true);
        this.createCrowdInstances("futurebol-arena-crowd-light", lightCrowd, materials.crowdLight, true);
    }

    private createStadiumShell(materials: ArenaMaterials): void {
        const shell: Mesh[] = [];
        const roofFascias: Mesh[] = [];
        const supports: Mesh[] = [];
        const wallRibs: Mesh[] = [];

        for (const side of [-1, 1]) {
            shell.push(this.box(
                `futurebol-side-back-wall-${side}`,
                62,
                3.1,
                0.38,
                0,
                7.15,
                side * 24.25,
                materials.shell
            ));
            shell.push(this.box(
                `futurebol-side-canopy-${side}`,
                62,
                0.28,
                4.8,
                0,
                9.45,
                side * 21.7,
                materials.shell,
                side * 0.12
            ));
            roofFascias.push(this.box(
                `futurebol-side-roof-fascia-${side}`,
                60,
                0.58,
                0.32,
                0,
                8.55,
                side * 18.35,
                materials.concourse
            ));

            for (const x of [-27, -13.5, 0, 13.5, 27]) {
                supports.push(this.box(
                    `futurebol-side-roof-column-${side}-${x}`,
                    0.28,
                    5.2,
                    0.3,
                    x,
                    6.7,
                    side * 23.65,
                    materials.concourse
                ));
                supports.push(this.box(
                    `futurebol-side-roof-brace-${side}-${x}`,
                    0.24,
                    5.1,
                    0.24,
                    x,
                    7.15,
                    side * 22.25,
                    materials.aisle,
                    side * 0.55
                ));
            }

            for (let x = -28; x <= 28; x += 4) {
                wallRibs.push(this.box(
                    `futurebol-side-wall-rib-${side}-${x}`,
                    0.18,
                    4.1,
                    0.18,
                    x,
                    6.35,
                    side * 23.98,
                    materials.concourse
                ));
            }
        }

        for (const side of [-1, 1]) {
            shell.push(this.box(
                `futurebol-end-back-wall-${side}`,
                0.38,
                6.5,
                44,
                side * 31.1,
                3.25,
                0,
                materials.shell
            ));
            shell.push(this.box(
                `futurebol-end-canopy-${side}`,
                4.4,
                0.28,
                44,
                side * 29.9,
                7.55,
                0,
                materials.shell,
                0,
                0,
                -side * 0.08
            ));
        }

        this.merge("futurebol-arena-shell", shell, materials.shell);
        this.merge("futurebol-arena-roof-fascias", roofFascias, materials.concourse);
        this.merge("futurebol-arena-roof-trusses", supports, materials.concourse, true);
        this.merge("futurebol-arena-wall-ribs", wallRibs, materials.concourse, true);
    }

    private createConcourseTunnelsAndBoards(materials: ArenaMaterials): void {
        const concourse: Mesh[] = [];
        const tunnels: Mesh[] = [];
        const tunnelFrames: Mesh[] = [];
        const boardBacks: Mesh[] = [];
        const cyanBoards: Mesh[] = [];
        const orangeBoards: Mesh[] = [];

        for (const side of [-1, 1]) {
            concourse.push(this.box(
                `futurebol-side-concourse-${side}`,
                59,
                0.74,
                0.72,
                0,
                4.25,
                side * 21.25,
                materials.concourse
            ));

            const frontZ = side * 15.62;
            tunnels.push(this.box(
                `futurebol-player-tunnel-${side}`,
                6.2,
                2.75,
                0.22,
                0,
                1.36,
                frontZ,
                materials.portal
            ));
            tunnelFrames.push(this.box(
                `futurebol-player-tunnel-header-${side}`,
                7,
                0.3,
                0.3,
                0,
                2.83,
                frontZ - side * 0.04,
                materials.cyan
            ));
            for (const x of [-3.35, 3.35]) {
                tunnelFrames.push(this.box(
                    `futurebol-player-tunnel-side-${side}-${x}`,
                    0.3,
                    3,
                    0.3,
                    x,
                    1.4,
                    frontZ - side * 0.04,
                    materials.cyan
                ));
            }

            for (const x of [-24, -16, -8, 8, 16, 24]) {
                boardBacks.push(this.box(
                    `futurebol-side-ad-board-${side}-${x}`,
                    7.2,
                    0.82,
                    0.18,
                    x,
                    0.58,
                    side * 15.52,
                    materials.portal
                ));
                const target = x < 0 ? orangeBoards : cyanBoards;
                target.push(this.box(
                    `futurebol-side-ad-light-${side}-${x}`,
                    5.7,
                    0.2,
                    0.12,
                    x,
                    0.58,
                    side * 15.4,
                    x < 0 ? materials.orange : materials.cyan
                ));
            }
        }

        for (const side of [-1, 1]) {
            for (const z of [-11, 11]) {
                boardBacks.push(this.box(
                    `futurebol-end-ad-board-${side}-${z}`,
                    0.18,
                    0.82,
                    6.6,
                    side * 25.58,
                    0.58,
                    z,
                    materials.portal
                ));
                const target = side < 0 ? orangeBoards : cyanBoards;
                target.push(this.box(
                    `futurebol-end-ad-light-${side}-${z}`,
                    0.12,
                    0.2,
                    5.2,
                    side * 25.46,
                    0.58,
                    z,
                    side < 0 ? materials.orange : materials.cyan
                ));
            }
        }

        this.merge("futurebol-arena-concourse", concourse, materials.concourse);
        this.merge("futurebol-arena-tunnels", tunnels, materials.portal);
        this.merge("futurebol-arena-tunnel-frames", tunnelFrames, materials.cyan, true);
        this.merge("futurebol-arena-ad-board-backs", boardBacks, materials.portal);
        this.merge("futurebol-arena-ad-lights-cyan", cyanBoards, materials.cyan);
        this.merge("futurebol-arena-ad-lights-orange", orangeBoards, materials.orange);
    }

    private createFloodlightBanks(materials: ArenaMaterials): void {
        const frames: Mesh[] = [];
        const supports: Mesh[] = [];
        const halos: Mesh[] = [];
        const bulbs: ThinTransform[] = [];

        for (const side of [-1, 1]) {
            for (const bankX of [-21, -7, 7, 21]) {
                frames.push(this.box(
                    `futurebol-floodlight-frame-${side}-${bankX}`,
                    6.8,
                    1.38,
                    0.24,
                    bankX,
                    7.16,
                    side * 18.58,
                    materials.concourse
                ));
                halos.push(this.box(
                    `futurebol-floodlight-halo-${side}-${bankX}`,
                    6.4,
                    1.12,
                    0.12,
                    bankX,
                    7.16,
                    side * 18.4,
                    materials.lampHalo
                ));

                for (const supportX of [-2.35, 2.35]) {
                    supports.push(this.box(
                        `futurebol-floodlight-support-${side}-${bankX}-${supportX}`,
                        0.2,
                        1.7,
                        0.2,
                        bankX + supportX,
                        7.92,
                        side * 19.25,
                        materials.aisle,
                        side * 0.38
                    ));
                }

                for (let row = 0; row < 2; row++) {
                    for (let column = 0; column < 9; column++) {
                        bulbs.push({
                            x: bankX - 2.72 + column * 0.68,
                            y: 6.94 + row * 0.46,
                            z: side * 18.34
                        });
                    }
                }
            }
        }

        this.merge("futurebol-arena-floodlight-frames", frames, materials.concourse);
        this.merge("futurebol-arena-floodlight-supports", supports, materials.aisle, true);
        this.merge("futurebol-arena-floodlight-halos", halos, materials.lampHalo, true);

        const bulb = this.B.MeshBuilder.CreateBox(
            "futurebol-arena-floodlight-bulbs",
            { width: 0.5, height: 0.3, depth: 0.16 },
            this.scene
        );
        bulb.material = materials.lamp;
        this.applyThinInstances(bulb, bulbs, true);
        this.floodlightInstanceCount += bulbs.length;
    }

    private createScoreboards(materials: ArenaMaterials): void {
        const scoreboards: Mesh[] = [];
        const homeBars: Mesh[] = [];
        const awayBars: Mesh[] = [];
        for (const side of [-1, 1]) {
            const z = side * 21.62;
            scoreboards.push(this.box(
                `futurebol-arena-scoreboard-${side}`,
                12,
                2.3,
                0.24,
                0,
                6.25,
                z,
                materials.portal
            ));
            homeBars.push(this.box(
                `futurebol-arena-scoreboard-home-${side}`,
                4.3,
                0.18,
                0.14,
                -3,
                6.25,
                z - side * 0.16,
                materials.orange
            ));
            awayBars.push(this.box(
                `futurebol-arena-scoreboard-away-${side}`,
                4.3,
                0.18,
                0.14,
                3,
                6.25,
                z - side * 0.16,
                materials.cyan
            ));
        }

        this.merge("futurebol-arena-scoreboards", scoreboards, materials.portal, true);
        this.merge("futurebol-arena-scoreboard-home-bars", homeBars, materials.orange, true);
        this.merge("futurebol-arena-scoreboard-away-bars", awayBars, materials.cyan, true);
    }

    private createSeatInstances(name: string, transforms: ThinTransform[], material: StandardMaterial): void {
        const seat = this.B.MeshBuilder.CreateBox(
            name,
            { width: 0.66, height: 0.58, depth: 0.16 },
            this.scene
        );
        seat.material = material;
        this.applyThinInstances(seat, transforms);
        this.seatInstanceCount += transforms.length;
    }

    private createCrowdInstances(
        name: string,
        transforms: ThinTransform[],
        material: StandardMaterial,
        detail: boolean
    ): void {
        const spectator = this.B.MeshBuilder.CreateSphere(
            name,
            { diameter: 0.43, segments: 6 },
            this.scene
        );
        spectator.material = material;
        this.applyThinInstances(spectator, transforms, detail);
        this.crowdInstanceCount += transforms.length;
    }

    private applyThinInstances(mesh: Mesh, transforms: ThinTransform[], detail = false): void {
        const matrices = new Float32Array(transforms.length * 16);
        for (let index = 0; index < transforms.length; index++) {
            const transform = transforms[index];
            const matrix = this.B.Matrix.Compose(
                new this.B.Vector3(
                    transform.scaleX ?? 1,
                    transform.scaleY ?? 1,
                    transform.scaleZ ?? 1
                ),
                this.B.Quaternion.RotationYawPitchRoll(transform.yaw ?? 0, 0, 0),
                new this.B.Vector3(transform.x, transform.y, transform.z)
            );
            matrix.copyToArray(matrices, index * 16);
        }

        mesh.thinInstanceSetBuffer("matrix", matrices, 16, true);
        mesh.isPickable = false;
        mesh.receiveShadows = false;
        mesh.freezeWorldMatrix();
        if (detail)
            this.detailMeshes.push(mesh);
    }

    private pickSeatGroup(
        row: number,
        column: number,
        dark: ThinTransform[],
        cool: ThinTransform[],
        warm: ThinTransform[]
    ): ThinTransform[] {
        const pattern = (row * 7 + column) % 13;
        if (pattern === 0 || pattern === 7)
            return warm;
        if (pattern === 3 || pattern === 4 || pattern === 10)
            return cool;
        return dark;
    }

    private pickCrowdGroup(
        row: number,
        column: number,
        dark: ThinTransform[],
        cool: ThinTransform[],
        warm: ThinTransform[],
        light: ThinTransform[]
    ): ThinTransform[] {
        const pattern = (row * 11 + column * 3) % 17;
        if (pattern < 3)
            return warm;
        if (pattern < 7)
            return cool;
        if (pattern === 8 || pattern === 13)
            return light;
        return dark;
    }

    private hasSpectator(row: number, column: number, side: number): boolean {
        return (row * 7 + column * 5 + (side > 0 ? 3 : 0)) % 10 < 6;
    }

    private createMaterials(): ArenaMaterials {
        const shell = this.material("futurebol-arena-shell-material", 0.018, 0.032, 0.07);
        shell.emissiveColor = new this.B.Color3(0.006, 0.012, 0.032);

        const tier = this.material("futurebol-arena-tier-material", 0.055, 0.075, 0.13);
        const upperTier = this.material("futurebol-arena-upper-tier-material", 0.075, 0.1, 0.17);
        const seatDark = this.material("futurebol-arena-seat-dark-material", 0.12, 0.2, 0.34);
        const seatCool = this.material("futurebol-arena-seat-cool-material", 0.025, 0.48, 0.58);
        const seatWarm = this.material("futurebol-arena-seat-warm-material", 0.92, 0.29, 0.035);
        const crowdDark = this.material("futurebol-arena-crowd-dark-material", 0.12, 0.16, 0.24);
        const crowdCool = this.material("futurebol-arena-crowd-cool-material", 0.05, 0.62, 0.7);
        const crowdWarm = this.material("futurebol-arena-crowd-warm-material", 0.95, 0.38, 0.08);
        const crowdLight = this.material("futurebol-arena-crowd-light-material", 0.62, 0.76, 0.82);
        seatDark.emissiveColor = new this.B.Color3(0.018, 0.035, 0.075);
        seatCool.emissiveColor = new this.B.Color3(0.008, 0.12, 0.15);
        seatWarm.emissiveColor = new this.B.Color3(0.2, 0.055, 0.006);
        const aisle = this.material("futurebol-arena-aisle-material", 0.28, 0.34, 0.42);
        const concourse = this.material("futurebol-arena-concourse-material", 0.09, 0.12, 0.2);
        const portal = this.material("futurebol-arena-portal-material", 0.004, 0.008, 0.02);

        const cyan = this.emissiveMaterial("futurebol-arena-cyan-material", 0.03, 0.68, 0.78);
        const orange = this.emissiveMaterial("futurebol-arena-orange-material", 1, 0.32, 0.025);
        const lamp = this.emissiveMaterial("futurebol-arena-lamp-material", 0.9, 0.96, 1);
        const lampHalo = this.emissiveMaterial("futurebol-arena-lamp-halo-material", 0.22, 0.58, 0.84);
        lampHalo.alpha = 0.2;
        lampHalo.backFaceCulling = false;

        return {
            shell,
            tier,
            upperTier,
            seatDark,
            seatCool,
            seatWarm,
            crowdDark,
            crowdCool,
            crowdWarm,
            crowdLight,
            aisle,
            concourse,
            portal,
            cyan,
            orange,
            lamp,
            lampHalo
        };
    }

    private material(name: string, red: number, green: number, blue: number): StandardMaterial {
        const material = new this.B.StandardMaterial(name, this.scene);
        material.diffuseColor = new this.B.Color3(red, green, blue);
        material.specularColor = new this.B.Color3(0.025, 0.035, 0.055);
        return material;
    }

    private emissiveMaterial(name: string, red: number, green: number, blue: number): StandardMaterial {
        const material = this.material(name, red, green, blue);
        material.emissiveColor = new this.B.Color3(red * 0.82, green * 0.82, blue * 0.82);
        material.disableLighting = true;
        return material;
    }

    private box(
        name: string,
        width: number,
        height: number,
        depth: number,
        x: number,
        y: number,
        z: number,
        material: StandardMaterial,
        rotationX = 0,
        rotationY = 0,
        rotationZ = 0
    ): Mesh {
        const mesh = this.B.MeshBuilder.CreateBox(name, { width, height, depth }, this.scene);
        mesh.position.set(x, y, z);
        mesh.rotation.set(rotationX, rotationY, rotationZ);
        mesh.material = material;
        mesh.isPickable = false;
        return mesh;
    }

    private merge(
        name: string,
        meshes: Mesh[],
        material: StandardMaterial,
        detail = false
    ): Mesh | null {
        if (meshes.length === 0)
            return null;

        const merged = this.B.Mesh.MergeMeshes(meshes, true, true, undefined, false, false);
        if (!merged)
            return null;

        merged.name = name;
        merged.material = material;
        merged.isPickable = false;
        merged.receiveShadows = false;
        merged.freezeWorldMatrix();
        if (detail)
            this.detailMeshes.push(merged);

        return merged;
    }
}
