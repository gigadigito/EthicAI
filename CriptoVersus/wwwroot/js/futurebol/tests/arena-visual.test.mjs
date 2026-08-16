import assert from "node:assert/strict";
import BabylonModule from "babylonjs";
import { FuturebolArena } from "../../dist/futurebol/futurebol-arena.js";

const B = BabylonModule;
const engine = new B.NullEngine();
const scene = new B.Scene(engine);
const arena = new FuturebolArena(B, scene, "Medium");

const meshNames = new Set(scene.meshes.map(mesh => mesh.name));
for (const expected of [
    "futurebol-arena-lower-step-decks",
    "futurebol-arena-upper-step-decks",
    "futurebol-arena-step-risers",
    "futurebol-arena-seats-dark",
    "futurebol-arena-seats-cool",
    "futurebol-arena-seats-warm",
    "futurebol-arena-crowd-dark",
    "futurebol-arena-sector-stairs",
    "futurebol-arena-shell",
    "futurebol-arena-roof-fascias",
    "futurebol-arena-roof-trusses",
    "futurebol-arena-concourse",
    "futurebol-arena-tunnels",
    "futurebol-arena-ad-board-backs",
    "futurebol-arena-ad-lights-cyan",
    "futurebol-arena-floodlight-frames",
    "futurebol-arena-floodlight-bulbs",
    "futurebol-arena-scoreboards"
]) assert.ok(meshNames.has(expected), `missing stadium element: ${expected}`);

assert.ok(scene.meshes.length <= 32, "repeated stadium modules must stay within a small draw-call budget");
assert.ok(
    scene.meshes.reduce((total, mesh) => total + mesh.getTotalVertices(), 0) < 8200,
    "the stylized stadium must stay within a modest static vertex budget"
);
const seatInstances = scene.meshes
    .filter(mesh => mesh.name.startsWith("futurebol-arena-seats-"))
    .reduce((total, mesh) => total + mesh.thinInstanceCount, 0);
const crowdInstances = scene.meshes
    .filter(mesh => mesh.name.startsWith("futurebol-arena-crowd-"))
    .reduce((total, mesh) => total + mesh.thinInstanceCount, 0);
assert.ok(seatInstances > 1000, "the enlarged bowl must show individual seat backs across the real camera framing");
assert.ok(crowdInstances > 500, "the enlarged stands must include a visibly dense stylized crowd");
assert.equal(scene.getMeshByName("futurebol-arena-floodlight-bulbs")?.thinInstanceCount, 144);
assert.equal(scene.lights.length, 0, "decorative floodlights must remain emissive geometry, not dynamic lights");
assert.ok(scene.meshes.every(mesh => mesh.isWorldMatrixFrozen), "static arena transforms must be frozen");
assert.ok(scene.materials.every(material => material.isFrozen), "shared arena materials must be frozen");

const mediumEnabled = scene.meshes.filter(mesh => mesh.isEnabled()).length;
arena.setQuality("Low");
const lowEnabled = scene.meshes.filter(mesh => mesh.isEnabled()).length;
assert.ok(lowEnabled < mediumEnabled, "Low quality must disable secondary arena details");
assert.equal(scene.getMeshByName("futurebol-arena-lower-step-decks")?.isEnabled(), true);
assert.equal(scene.getMeshByName("futurebol-arena-seats-dark")?.isEnabled(), true);
assert.equal(scene.getMeshByName("futurebol-arena-crowd-dark")?.isEnabled(), false);
assert.equal(scene.getMeshByName("futurebol-arena-floodlight-halos")?.isEnabled(), false);

arena.setQuality("High");
assert.equal(scene.meshes.filter(mesh => mesh.isEnabled()).length, mediumEnabled);

engine.dispose();
console.log("Futurebol stadium visual and performance tests passed.");
