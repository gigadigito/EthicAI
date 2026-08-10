import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const path = fileURLToPath(new URL("../../../assets/futurebol/players/futurebol-humanoid.glb", import.meta.url));
const bytes = readFileSync(path);
assert.equal(bytes.length, 528920);
assert.equal(bytes.toString("utf8", 0, 4), "glTF");
const jsonLength = bytes.readUInt32LE(12);
const json = JSON.parse(bytes.toString("utf8", 20, 20 + jsonLength).replace(/\u0000+$/g, ""));
assert.equal(json.animations.length, 14);
assert.ok(json.skins.length >= 1);
assert.equal(json.skins[0].joints.length, 43);
assert.ok(json.nodes.some(node => node.name === "Head"));
assert.deepEqual(json.images ?? [], []);
assert.deepEqual(json.textures ?? [], []);
console.log("Futurebol local GLB metadata tests passed.");

