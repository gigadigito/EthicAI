import assert from "node:assert/strict";
import BabylonModule from "babylonjs";
import { FuturebolArena } from "../../dist/futurebol/futurebol-arena.js";

const B = BabylonModule;
const engine = new B.NullEngine();
const scene = new B.Scene(engine);
const arena = new FuturebolArena(B, scene, "Medium");

const meshNames = new Set(scene.meshes.map(mesh => mesh.name));
for (const expected of [
    "futurebol-arena-side-tiers",
    "futurebol-arena-end-tiers",
    "futurebol-arena-seat-pattern-dark",
    "futurebol-arena-seat-pattern-cool",
    "futurebol-arena-seat-pattern-warm",
    "futurebol-arena-sector-aisles",
    "futurebol-arena-shell",
    "futurebol-arena-roof-supports",
    "futurebol-arena-concourse",
    "futurebol-arena-tunnels",
    "futurebol-arena-led-ribbons-cyan",
    "futurebol-arena-led-ribbons-orange",
    "futurebol-arena-floodlights",
    "futurebol-arena-scoreboards"
]) assert.ok(meshNames.has(expected), `missing stadium element: ${expected}`);

assert.ok(scene.meshes.length <= 24, "repeated stadium modules must be merged into a small draw-call budget");
assert.ok(
    scene.meshes.reduce((total, mesh) => total + mesh.getTotalVertices(), 0) < 6000,
    "the stylized stadium must stay within a modest static vertex budget"
);
assert.equal(scene.lights.length, 0, "decorative floodlights must remain emissive geometry, not dynamic lights");
assert.ok(scene.meshes.every(mesh => mesh.isWorldMatrixFrozen), "static arena transforms must be frozen");
assert.ok(scene.materials.every(material => material.isFrozen), "shared arena materials must be frozen");

const mediumEnabled = scene.meshes.filter(mesh => mesh.isEnabled()).length;
arena.setQuality("Low");
const lowEnabled = scene.meshes.filter(mesh => mesh.isEnabled()).length;
assert.ok(lowEnabled < mediumEnabled, "Low quality must disable secondary arena details");
assert.equal(scene.getMeshByName("futurebol-arena-side-tiers")?.isEnabled(), true);
assert.equal(scene.getMeshByName("futurebol-arena-seat-pattern-dark")?.isEnabled(), true);
assert.equal(scene.getMeshByName("futurebol-arena-floodlight-halos")?.isEnabled(), false);

arena.setQuality("High");
assert.equal(scene.meshes.filter(mesh => mesh.isEnabled()).length, mediumEnabled);

engine.dispose();
console.log("Futurebol stadium visual and performance tests passed.");
