import assert from "node:assert/strict";
import { FuturebolPlayerVisualFactory } from "../../dist/futurebol/player/futurebol-player-visual-factory.js";

class FakeMaterial {
    constructor(name) {
        this.name = name;
    }

    dispose() {}
}

class FakeDynamicTexture {
    drawText() {}
    dispose() {}
}

class FakeColor3 {
    constructor(r, g, b) {
        this.r = r;
        this.g = g;
        this.b = b;
    }
}

const fakeBabylon = {
    StandardMaterial: FakeMaterial,
    DynamicTexture: FakeDynamicTexture,
    Color3: FakeColor3
};
const teams = {
    home: { symbol: "BTC", logoUrl: null },
    away: { symbol: "ETH", logoUrl: null }
};

function createFactory(progress) {
    return new FuturebolPlayerVisualFactory(
        fakeBabylon,
        {},
        teams,
        false,
        false,
        stage => progress.push(stage)
    );
}

const successProgress = [];
const successFactory = createFactory(successProgress);
successFactory.loader = {
    loadTimeMs: 12,
    async load() {},
    markReady() {
        successProgress.push("Pronto");
    },
    dispose() {}
};
const success = await successFactory.create([], "Skeletal");
assert.equal(success.activeKind, "Skeletal", "successful asset loading must keep the skeletal visual");
assert.equal(success.assetLoaded, true);
assert.equal(success.fallbackActive, false);
successFactory.dispose();

const failureProgress = [];
const failureFactory = createFactory(failureProgress);
failureFactory.loader = {
    loadTimeMs: 0,
    async load() {
        throw new Error("simulated asset load failure");
    },
    markReady() {},
    dispose() {}
};
const warnings = [];
const originalWarn = console.warn;
console.warn = (...args) => warnings.push(args);
let failure;
try {
    failure = await failureFactory.create([], "Skeletal");
} finally {
    console.warn = originalWarn;
}
assert.equal(failure.activeKind, "Primitives", "asset failure must activate the emergency primitive fallback");
assert.equal(failure.assetLoaded, false);
assert.equal(failure.fallbackActive, true);
assert.match(failure.warning, /reason=asset-load-failed/);
assert.ok(
    warnings.some(args => String(args[0]).includes("kind=Primitives reason=asset-load-failed")),
    "the fallback reason must be explicit in diagnostics"
);
failureFactory.dispose();

console.log("Futurebol player visual fallback policy passed.");
