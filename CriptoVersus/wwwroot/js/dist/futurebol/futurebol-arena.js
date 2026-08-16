const SIDE_TIER_COUNT = 6;
const END_TIER_COUNT = 5;
const SIDE_SECTOR_CENTERS = [-22, -11, 0, 11, 22];
const END_SECTOR_CENTERS = [-10.3, 0, 10.3];
/**
 * Cenário esportivo estilizado do Futurebol.
 *
 * Toda a geometria é estática e mesclada por material. Os assentos são sugeridos
 * por bancos setorizados, evitando milhares de cadeiras e draw calls individuais.
 */
export class FuturebolArena {
    constructor(B, scene, quality) {
        this.B = B;
        this.scene = scene;
        this.detailMeshes = [];
        const materials = this.createMaterials();
        this.createBowl(materials);
        this.createStadiumShell(materials);
        this.createConcourseAndTunnels(materials);
        this.createLightingStructure(materials);
        this.createScoreboards(materials);
        for (const material of Object.values(materials))
            material.freeze();
        this.setQuality(quality);
    }
    setQuality(quality) {
        const detailsEnabled = quality !== "Low";
        for (const mesh of this.detailMeshes)
            mesh.setEnabled(detailsEnabled);
    }
    createBowl(materials) {
        const sideTiers = [];
        const sideUpperTiers = [];
        const endTiers = [];
        const endUpperTiers = [];
        const darkSeats = [];
        const coolSeats = [];
        const warmSeats = [];
        const aisles = [];
        for (const side of [-1, 1]) {
            for (let row = 0; row < SIDE_TIER_COUNT; row++) {
                const height = 0.65 + row * 0.58;
                const z = side * (16.25 + row * 0.86);
                const targetTiers = row < 3 ? sideTiers : sideUpperTiers;
                targetTiers.push(this.box(`futurebol-side-tier-${side}-${row}`, 59, height, 0.92, 0, height / 2 - 0.02, z, row < 3 ? materials.tier : materials.upperTier));
                for (let sector = 0; sector < SIDE_SECTOR_CENTERS.length; sector++) {
                    const target = (row + sector) % 7 === 0
                        ? warmSeats
                        : (row + sector) % 3 === 0
                            ? coolSeats
                            : darkSeats;
                    target.push(this.box(`futurebol-side-seat-bank-${side}-${row}-${sector}`, 10.25, 0.24, 0.46, SIDE_SECTOR_CENTERS[sector], height + 0.08, z - side * 0.12, target === warmSeats
                        ? materials.seatWarm
                        : target === coolSeats
                            ? materials.seatCool
                            : materials.seatDark));
                }
                for (const aisleX of [-16.5, -5.5, 5.5, 16.5]) {
                    aisles.push(this.box(`futurebol-side-aisle-${side}-${row}-${aisleX}`, 0.48, 0.07, 0.82, aisleX, height + 0.06, z, materials.aisle));
                }
            }
        }
        for (const side of [-1, 1]) {
            for (let row = 0; row < END_TIER_COUNT; row++) {
                const height = 0.62 + row * 0.56;
                const x = side * (26.25 + row * 0.84);
                const targetTiers = row < 3 ? endTiers : endUpperTiers;
                targetTiers.push(this.box(`futurebol-end-tier-${side}-${row}`, 0.9, height, 31.2, x, height / 2 - 0.02, 0, row < 3 ? materials.tier : materials.upperTier));
                for (let sector = 0; sector < END_SECTOR_CENTERS.length; sector++) {
                    const target = (row + sector) % 5 === 0
                        ? warmSeats
                        : (row + sector) % 2 === 0
                            ? coolSeats
                            : darkSeats;
                    target.push(this.box(`futurebol-end-seat-bank-${side}-${row}-${sector}`, 0.46, 0.24, 9.45, x - side * 0.12, height + 0.08, END_SECTOR_CENTERS[sector], target === warmSeats
                        ? materials.seatWarm
                        : target === coolSeats
                            ? materials.seatCool
                            : materials.seatDark));
                }
            }
        }
        this.merge("futurebol-arena-side-tiers", sideTiers, materials.tier);
        this.merge("futurebol-arena-side-upper-tiers", sideUpperTiers, materials.upperTier);
        this.merge("futurebol-arena-end-tiers", endTiers, materials.tier);
        this.merge("futurebol-arena-end-upper-tiers", endUpperTiers, materials.upperTier);
        this.merge("futurebol-arena-seat-pattern-dark", darkSeats, materials.seatDark);
        this.merge("futurebol-arena-seat-pattern-cool", coolSeats, materials.seatCool);
        this.merge("futurebol-arena-seat-pattern-warm", warmSeats, materials.seatWarm);
        this.merge("futurebol-arena-sector-aisles", aisles, materials.aisle, true);
    }
    createStadiumShell(materials) {
        const shell = [];
        const supports = [];
        for (const side of [-1, 1]) {
            shell.push(this.box(`futurebol-side-back-wall-${side}`, 62, 7.4, 0.45, 0, 3.7, side * 21.9, materials.shell));
            shell.push(this.box(`futurebol-side-canopy-${side}`, 62, 0.3, 5.2, 0, 8.35, side * 21, materials.shell));
            for (const x of [-27, -13.5, 0, 13.5, 27]) {
                supports.push(this.box(`futurebol-side-roof-support-${side}-${x}`, 0.26, 5, 0.32, x, 5.8, side * 21.55, materials.concourse));
            }
        }
        for (const side of [-1, 1]) {
            shell.push(this.box(`futurebol-end-back-wall-${side}`, 0.4, 6.2, 43.5, side * 30.9, 3.1, 0, materials.shell));
            shell.push(this.box(`futurebol-end-canopy-${side}`, 4.2, 0.28, 43.5, side * 30, 7.45, 0, materials.shell));
        }
        this.merge("futurebol-arena-shell", shell, materials.shell);
        this.merge("futurebol-arena-roof-supports", supports, materials.concourse, true);
    }
    createConcourseAndTunnels(materials) {
        const concourse = [];
        const portals = [];
        const portalFrames = [];
        const cyanRibbons = [];
        const orangeRibbons = [];
        for (const side of [-1, 1]) {
            concourse.push(this.box(`futurebol-side-concourse-${side}`, 59, 0.9, 0.72, 0, 4.35, side * 21.25, materials.concourse));
            const frontZ = side * 15.72;
            portals.push(this.box(`futurebol-player-tunnel-${side}`, 5.2, 2.55, 0.2, 0, 1.27, frontZ, materials.portal));
            portalFrames.push(this.box(`futurebol-player-tunnel-header-${side}`, 6, 0.28, 0.28, 0, 2.62, frontZ - side * 0.03, materials.aisle));
            for (const x of [-2.85, 2.85]) {
                portalFrames.push(this.box(`futurebol-player-tunnel-side-${side}-${x}`, 0.28, 2.7, 0.28, x, 1.32, frontZ - side * 0.03, materials.aisle));
            }
            for (const x of [-20, -10, 10, 20]) {
                const target = x < 0 ? orangeRibbons : cyanRibbons;
                target.push(this.box(`futurebol-side-led-panel-${side}-${x}`, 8.6, 0.32, 0.16, x, 1.18, side * 15.55, x < 0 ? materials.orange : materials.cyan));
            }
        }
        for (const side of [-1, 1]) {
            for (const z of [-10, 0, 10]) {
                const target = side < 0 ? orangeRibbons : cyanRibbons;
                target.push(this.box(`futurebol-end-led-panel-${side}-${z}`, 0.16, 0.3, 8.4, side * 25.62, 1.12, z, side < 0 ? materials.orange : materials.cyan));
            }
        }
        this.merge("futurebol-arena-concourse", concourse, materials.concourse);
        this.merge("futurebol-arena-tunnels", portals, materials.portal, true);
        this.merge("futurebol-arena-tunnel-frames", portalFrames, materials.aisle, true);
        this.merge("futurebol-arena-led-ribbons-cyan", cyanRibbons, materials.cyan);
        this.merge("futurebol-arena-led-ribbons-orange", orangeRibbons, materials.orange);
    }
    createLightingStructure(materials) {
        const fixtures = [];
        const halos = [];
        for (const side of [-1, 1]) {
            for (const x of [-23, -8, 8, 23]) {
                fixtures.push(this.box(`futurebol-stadium-floodlight-${side}-${x}`, 10.2, 0.22, 0.34, x, 8.05, side * 20.45, materials.lamp));
                halos.push(this.box(`futurebol-stadium-floodlight-halo-${side}-${x}`, 10.7, 0.42, 0.12, x, 8.05, side * 20.25, materials.lampHalo));
            }
        }
        this.merge("futurebol-arena-floodlights", fixtures, materials.lamp);
        this.merge("futurebol-arena-floodlight-halos", halos, materials.lampHalo, true);
    }
    createScoreboards(materials) {
        const scoreboards = [];
        const homeBars = [];
        const awayBars = [];
        for (const side of [-1, 1]) {
            const z = side * 21.62;
            scoreboards.push(this.box(`futurebol-arena-scoreboard-${side}`, 12, 2.3, 0.24, 0, 6.25, z, materials.portal));
            homeBars.push(this.box(`futurebol-arena-scoreboard-home-${side}`, 4.3, 0.18, 0.14, -3, 6.25, z - side * 0.16, materials.orange));
            awayBars.push(this.box(`futurebol-arena-scoreboard-away-${side}`, 4.3, 0.18, 0.14, 3, 6.25, z - side * 0.16, materials.cyan));
        }
        this.merge("futurebol-arena-scoreboards", scoreboards, materials.portal, true);
        this.merge("futurebol-arena-scoreboard-home-bars", homeBars, materials.orange, true);
        this.merge("futurebol-arena-scoreboard-away-bars", awayBars, materials.cyan, true);
    }
    createMaterials() {
        const shell = this.material("futurebol-arena-shell-material", 0.022, 0.034, 0.078);
        shell.emissiveColor = new this.B.Color3(0.008, 0.015, 0.04);
        const tier = this.material("futurebol-arena-tier-material", 0.045, 0.064, 0.12);
        const upperTier = this.material("futurebol-arena-upper-tier-material", 0.062, 0.082, 0.145);
        const seatDark = this.material("futurebol-arena-seat-dark-material", 0.07, 0.105, 0.18);
        const seatCool = this.material("futurebol-arena-seat-cool-material", 0.04, 0.34, 0.42);
        const seatWarm = this.material("futurebol-arena-seat-warm-material", 0.72, 0.24, 0.045);
        const aisle = this.material("futurebol-arena-aisle-material", 0.22, 0.28, 0.36);
        const concourse = this.material("futurebol-arena-concourse-material", 0.075, 0.1, 0.17);
        const portal = this.material("futurebol-arena-portal-material", 0.008, 0.014, 0.03);
        const cyan = this.emissiveMaterial("futurebol-arena-cyan-material", 0.04, 0.56, 0.68);
        const orange = this.emissiveMaterial("futurebol-arena-orange-material", 0.9, 0.3, 0.035);
        const lamp = this.emissiveMaterial("futurebol-arena-lamp-material", 0.78, 0.9, 1);
        const lampHalo = this.emissiveMaterial("futurebol-arena-lamp-halo-material", 0.25, 0.58, 0.82);
        lampHalo.alpha = 0.2;
        lampHalo.backFaceCulling = false;
        return {
            shell,
            tier,
            upperTier,
            seatDark,
            seatCool,
            seatWarm,
            aisle,
            concourse,
            portal,
            cyan,
            orange,
            lamp,
            lampHalo
        };
    }
    material(name, red, green, blue) {
        const material = new this.B.StandardMaterial(name, this.scene);
        material.diffuseColor = new this.B.Color3(red, green, blue);
        material.specularColor = new this.B.Color3(0.025, 0.035, 0.055);
        return material;
    }
    emissiveMaterial(name, red, green, blue) {
        const material = this.material(name, red, green, blue);
        material.emissiveColor = new this.B.Color3(red * 0.78, green * 0.78, blue * 0.78);
        material.disableLighting = true;
        return material;
    }
    box(name, width, height, depth, x, y, z, material) {
        const mesh = this.B.MeshBuilder.CreateBox(name, { width, height, depth }, this.scene);
        mesh.position.set(x, y, z);
        mesh.material = material;
        mesh.isPickable = false;
        return mesh;
    }
    merge(name, meshes, material, detail = false) {
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
