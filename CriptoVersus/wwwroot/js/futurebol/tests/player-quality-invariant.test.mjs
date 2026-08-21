import assert from "node:assert/strict";
import BabylonModule from "babylonjs";
import { FuturebolRenderer } from "../../dist/futurebol/futurebol-renderer.js";

const B = BabylonModule;

class TestEngine extends B.NullEngine {
    constructor() {
        super();
    }
}

const testBabylon = new Proxy(B, {
    get(target, property) {
        return property === "Engine" ? TestEngine : target[property];
    }
});

const renderer = new FuturebolRenderer(
    testBabylon,
    {},
    {
        home: { symbol: "BTC", logoUrl: null },
        away: { symbol: "ETH", logoUrl: null }
    },
    false,
    "High",
    false
);

let disposals = 0;
const appliedQualities = [];
const skeletalVisual = {
    root: {},
    meshes: [],
    update() {},
    diagnostics() {
        return {
            kind: "Skeletal",
            skeletonCount: 2,
            currentAnimation: "Idle",
            requestedAnimation: "Idle"
        };
    },
    setQuality(quality) {
        appliedQualities.push(quality);
    },
    reset() {},
    dispose() {
        disposals += 1;
    }
};

const visuals = new Map([["home-attacker", skeletalVisual]]);
renderer.playerVisuals = visuals;
renderer.activeVisualKind = "Skeletal";

renderer.setQuality("Low");
assert.equal(renderer.playerVisuals, visuals, "High -> Low must preserve the player visual map");
assert.equal(renderer.playerVisuals.get("home-attacker"), skeletalVisual, "High -> Low must preserve player references");
assert.equal(renderer.diagnostics("home-attacker").kind, "Skeletal");
assert.equal(disposals, 0, "setQuality must not dispose skeletal players");

renderer.setQuality("High");
assert.equal(renderer.playerVisuals, visuals, "Low -> High must preserve the player visual map");
assert.equal(renderer.playerVisuals.get("home-attacker"), skeletalVisual, "Low -> High must preserve player references");
assert.equal(renderer.diagnostics("home-attacker").kind, "Skeletal");
assert.equal(disposals, 0, "setQuality must not recreate skeletal players");
assert.deepEqual(appliedQualities, ["Low", "High"]);

renderer.dispose();
assert.equal(disposals, 1, "renderer disposal must still release the preserved visual once");

console.log("Futurebol player quality invariants passed.");
