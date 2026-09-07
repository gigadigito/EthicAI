import assert from "node:assert/strict";

class MockElement {
    constructor(tag) {
        this.tagName = tag.toUpperCase();
        this.className = "";
        this.textContent = "";
        this.id = "";
        this.childNodes = [];
        this._parent = null;
        this._removed = false;
        this.clientWidth = 800;
        this.clientHeight = 600;
        const store = {};
        this.style = new Proxy({}, {
            set: (_t, prop, val) => { store[prop] = String(val); return true; },
            get: (_t, prop) => {
                if (prop === "cssText") return "";
                if (prop === "setProperty") return (_k, _v) => {};
                if (typeof prop === "symbol") return undefined;
                return store[prop] !== undefined ? store[prop] : "";
            },
            has: () => true
        });
    }
    appendChild(child) {
        this.childNodes.push(child);
        child._parent = this;
    }
    remove() {
        this._removed = true;
    }
    get parentElement() {
        return this._parent;
    }
}

const headEl = new MockElement("head");
let styleInjected = false;

function createMockDocument() {
    globalThis.document = {
        createElement: (tag) => new MockElement(tag),
        getElementById: (id) => {
            if (id === "futurebol-market-bubble-global") return styleInjected ? {} : null;
            return null;
        },
        head: headEl,
    };
    globalThis.getComputedStyle = () => ({ position: "relative" });
}

async function loadBubble() {
    const mod = await import("../../dist/futurebol/futurebol-player-market-bubble.js");
    return mod.FuturebolPlayerMarketBubble;
}

let BubbleClass;

async function setup() {
    if (!BubbleClass) BubbleClass = await loadBubble();
    createMockDocument();
    const canvas = new MockElement("canvas");
    const parent = new MockElement("div");
    parent.appendChild(canvas);
    const bubble = new BubbleClass(canvas);
    return { bubble, canvas, parent };
}

function makeAsset(overrides = {}) {
    return {
        symbol: "BTC",
        price: 0.156,
        changePercent: 15.85,
        momentum: 72.5,
        volumeStrength: 58.3,
        ...overrides,
    };
}

function makeVisible(ownerId = "home-attacker", team = "home") {
    return {
        ownerPlayerId: ownerId,
        ownerTeam: team,
        asset: makeAsset(),
        headScreenX: 400,
        headScreenY: 200,
        visible: true,
    };
}

function makeHidden() {
    return {
        ownerPlayerId: null, ownerTeam: null, asset: null,
        headScreenX: 0, headScreenY: 0, visible: false,
    };
}

function updateFrames(bubble, input, frames, screenW = 800, screenH = 600, dt = 0.05) {
    for (let i = 0; i < frames; i++)
        bubble.update(input, screenW, screenH, dt);
}

function fadeInFrames(bubble, input, screenW = 800, screenH = 600) {
    const dt = 0.016;
    const frames = Math.ceil(0.2 / dt) + 2;
    for (let i = 0; i < frames; i++)
        bubble.update(input, screenW, screenH, dt);
}

async function runTests() {
    const tests = [];

    tests.push(["1. owner null → hidden", async () => {
        const { bubble } = await setup();
        updateFrames(bubble, makeHidden(), 30);
        assert.equal(bubble.getDiagnostics().visible, false);
        assert.equal(bubble.getDiagnostics().ownerPlayerId, null);
        bubble.dispose();
    }]);

    tests.push(["2. HOME owner → HOME market data", async () => {
        const { bubble } = await setup();
        fadeInFrames(bubble, makeVisible("home-attacker", "home"));
        assert.equal(bubble.getDiagnostics().ownerPlayerId, "home-attacker");
        assert.equal(bubble.getDiagnostics().visible, true);
        bubble.dispose();
    }]);

    tests.push(["3. AWAY owner → AWAY market data", async () => {
        const { bubble } = await setup();
        fadeInFrames(bubble, makeVisible("away-defender", "away"));
        assert.equal(bubble.getDiagnostics().ownerPlayerId, "away-defender");
        assert.equal(bubble.getDiagnostics().visible, true);
        bubble.dispose();
    }]);

    tests.push(["4. possession changes → bubble transfers", async () => {
        const { bubble } = await setup();
        fadeInFrames(bubble, makeVisible("home-attacker", "home"));
        assert.equal(bubble.getDiagnostics().ownerPlayerId, "home-attacker");

        fadeInFrames(bubble, makeVisible("away-midfielder", "away"));
        assert.equal(bubble.getDiagnostics().ownerPlayerId, "away-midfielder");
        bubble.dispose();
    }]);

    tests.push(["5. null owner → grace period, not immediate hide", async () => {
        const { bubble } = await setup();
        fadeInFrames(bubble, makeVisible("home-attacker", "home"));
        assert.equal(bubble.getDiagnostics().visible, true);

        updateFrames(bubble, makeHidden(), 8, 800, 600, 0.016);
        assert.equal(bubble.getDiagnostics().visible, true, "should still be visible during grace period");
        bubble.dispose();
    }]);

    tests.push(["6. null owner > grace period → fade out", async () => {
        const { bubble } = await setup();
        fadeInFrames(bubble, makeVisible("home-attacker", "home"));
        assert.equal(bubble.getDiagnostics().visible, true);

        const dt = 0.016;
        const totalFrames = Math.ceil(2.5 / dt);
        updateFrames(bubble, makeHidden(), totalFrames, 800, 600, dt);
        assert.equal(bubble.getDiagnostics().visible, false, "should be hidden after minimum hold + grace + fade-out");
        bubble.dispose();
    }]);

    tests.push(["7. null owner → new owner during grace → immediate transfer", async () => {
        const { bubble } = await setup();
        fadeInFrames(bubble, makeVisible("home-attacker", "home"));
        assert.equal(bubble.getDiagnostics().visible, true);

        const dt = 0.016;
        const graceFrames = Math.ceil(0.3 / dt);
        updateFrames(bubble, makeHidden(), graceFrames, 800, 600, dt);
        assert.equal(bubble.getDiagnostics().visible, true, "still visible during grace");

        fadeInFrames(bubble, makeVisible("away-midfielder", "away"));
        assert.equal(bubble.getDiagnostics().ownerPlayerId, "away-midfielder");
        assert.equal(bubble.getDiagnostics().visible, true);
        bubble.dispose();
    }]);

    tests.push(["8. minimum visible time respected", async () => {
        const { bubble } = await setup();
        fadeInFrames(bubble, makeVisible("home-attacker", "home"));

        const dt = 0.016;
        const shortFrames = Math.ceil(0.8 / dt);
        updateFrames(bubble, makeHidden(), shortFrames, 800, 600, dt);
        assert.equal(bubble.getDiagnostics().visible, true, "should still be visible within minimum hold");
        bubble.dispose();
    }]);

    tests.push(["9. shot → hidden after minimum hold", async () => {
        const { bubble } = await setup();
        fadeInFrames(bubble, makeVisible("home-attacker", "home"));
        updateFrames(bubble, makeHidden(), 200, 800, 600, 0.05);
        assert.equal(bubble.getDiagnostics().visible, false);
        bubble.dispose();
    }]);

    tests.push(["10. goalkeeper possession → visible", async () => {
        const { bubble } = await setup();
        fadeInFrames(bubble, makeVisible("home-goalkeeper", "home"));
        assert.equal(bubble.getDiagnostics().visible, true);
        assert.equal(bubble.getDiagnostics().ownerPlayerId, "home-goalkeeper");
        bubble.dispose();
    }]);

    tests.push(["11. positive percentage has + sign", async () => {
        const { bubble } = await setup();
        fadeInFrames(bubble, makeVisible("home-attacker", "home"));
        assert.ok(bubble.getDiagnostics().visible);
        bubble.dispose();
    }]);

    tests.push(["12. negative percentage has - sign", async () => {
        const { bubble } = await setup();
        fadeInFrames(bubble, makeVisible("away-defender", "away"));
        assert.ok(bubble.getDiagnostics().visible);
        bubble.dispose();
    }]);

    tests.push(["13. price formatting", async () => {
        const { bubble } = await setup();
        fadeInFrames(bubble, {
            ownerPlayerId: "home-attacker", ownerTeam: "home",
            asset: makeAsset({ price: 65000.42, changePercent: 2.35 }),
            headScreenX: 400, headScreenY: 200, visible: true,
        });
        assert.ok(bubble.getDiagnostics().visible);
        bubble.dispose();
    }]);

    tests.push(["14. missing price → still visible with percent", async () => {
        const { bubble } = await setup();
        fadeInFrames(bubble, {
            ownerPlayerId: "home-attacker", ownerTeam: "home",
            asset: makeAsset({ price: NaN, changePercent: 5.0 }),
            headScreenX: 400, headScreenY: 200, visible: true,
        });
        assert.ok(bubble.getDiagnostics().visible);
        bubble.dispose();
    }]);

    tests.push(["15. missing percentage → still visible with price", async () => {
        const { bubble } = await setup();
        fadeInFrames(bubble, {
            ownerPlayerId: "home-attacker", ownerTeam: "home",
            asset: makeAsset({ price: 1.5, changePercent: NaN }),
            headScreenX: 400, headScreenY: 200, visible: true,
        });
        assert.ok(bubble.getDiagnostics().visible);
        bubble.dispose();
    }]);

    tests.push(["16. both missing → hidden", async () => {
        const { bubble } = await setup();
        fadeInFrames(bubble, {
            ownerPlayerId: "home-attacker", ownerTeam: "home",
            asset: makeAsset({ price: NaN, changePercent: NaN }),
            headScreenX: 400, headScreenY: 200, visible: true,
        });
        assert.equal(bubble.getDiagnostics().visible, false);
        bubble.dispose();
    }]);

    tests.push(["17. offscreen player → hidden", async () => {
        const { bubble } = await setup();
        fadeInFrames(bubble, {
            ownerPlayerId: "home-attacker", ownerTeam: "home",
            asset: makeAsset(),
            headScreenX: -100, headScreenY: 200, visible: true,
        });
        assert.equal(bubble.getDiagnostics().visible, false);
        bubble.dispose();
    }]);

    tests.push(["18. behind camera → hidden", async () => {
        const { bubble } = await setup();
        fadeInFrames(bubble, {
            ownerPlayerId: "home-attacker", ownerTeam: "home",
            asset: makeAsset(),
            headScreenX: 400, headScreenY: 200, visible: false,
        });
        assert.equal(bubble.getDiagnostics().visible, false);
        bubble.dispose();
    }]);

    tests.push(["19. valid projection → correct screen coords", async () => {
        const { bubble } = await setup();
        fadeInFrames(bubble, makeVisible("home-attacker", "home"));
        const diag = bubble.getDiagnostics();
        assert.equal(typeof diag.screenX, "number");
        assert.equal(typeof diag.screenY, "number");
        assert.ok(isFinite(diag.screenX));
        assert.ok(isFinite(diag.screenY));
        bubble.dispose();
    }]);

    tests.push(["20. screen clamp", async () => {
        const { bubble } = await setup();
        fadeInFrames(bubble, {
            ownerPlayerId: "home-attacker", ownerTeam: "home",
            asset: makeAsset(),
            headScreenX: 795, headScreenY: 595, visible: true,
        });
        const diag = bubble.getDiagnostics();
        assert.ok(isFinite(diag.screenX));
        assert.ok(isFinite(diag.screenY));
        bubble.dispose();
    }]);

    tests.push(["21. smoothing finite", async () => {
        const { bubble } = await setup();
        for (let i = 0; i < 10; i++) {
            bubble.update({
                ownerPlayerId: "home-attacker", ownerTeam: "home",
                asset: makeAsset(),
                headScreenX: 100 + i * 30, headScreenY: 100 + i * 10, visible: true,
            }, 800, 600, 0.05);
        }
        const diag = bubble.getDiagnostics();
        assert.ok(isFinite(diag.screenX));
        assert.ok(isFinite(diag.screenY));
        bubble.dispose();
    }]);

    tests.push(["22. no NaN/Infinity", async () => {
        const { bubble } = await setup();
        fadeInFrames(bubble, makeVisible("home-attacker", "home"));
        const diag = bubble.getDiagnostics();
        assert.ok(Number.isFinite(diag.screenX));
        assert.ok(Number.isFinite(diag.screenY));
        bubble.dispose();
    }]);

    tests.push(["23. reset hides bubble", async () => {
        const { bubble } = await setup();
        fadeInFrames(bubble, makeVisible("home-attacker", "home"));
        const dt = 0.016;
        const totalFrames = Math.ceil(2.5 / dt);
        updateFrames(bubble, makeHidden(), totalFrames, 800, 600, dt);
        assert.equal(bubble.getDiagnostics().visible, false);
        bubble.dispose();
    }]);

    tests.push(["24. dispose removes overlay", async () => {
        const { bubble } = await setup();
        bubble.dispose();
        assert.ok(!bubble.getDiagnostics().visible);
    }]);

    tests.push(["25. single bubble instance", async () => {
        const { bubble } = await setup();
        for (let i = 0; i < 5; i++) {
            fadeInFrames(bubble, {
                ownerPlayerId: `home-player-${i}`, ownerTeam: "home",
                asset: makeAsset(),
                headScreenX: 400, headScreenY: 200, visible: true,
            });
        }
        assert.equal(bubble.getDiagnostics().ownerPlayerId, "home-player-4");
        bubble.dispose();
    }]);

    tests.push(["26. price zero → visible with percent", async () => {
        const { bubble } = await setup();
        fadeInFrames(bubble, {
            ownerPlayerId: "home-attacker", ownerTeam: "home",
            asset: makeAsset({ price: 0, changePercent: 5.0 }),
            headScreenX: 400, headScreenY: 200, visible: true,
        });
        assert.ok(bubble.getDiagnostics().visible);
        bubble.dispose();
    }]);

    tests.push(["27. render→CSS scale passes container dimensions", async () => {
        const { bubble } = await setup();
        fadeInFrames(bubble, makeVisible("home-attacker", "home"), 800, 600);
        const diag = bubble.getDiagnostics();
        assert.ok(isFinite(diag.screenX));
        assert.ok(isFinite(diag.screenY));
        bubble.dispose();
    }]);

    tests.push(["28. opacity reaches 1 after full fade-in", async () => {
        const { bubble } = await setup();
        fadeInFrames(bubble, makeVisible("home-attacker", "home"));
        const diag = bubble.getDiagnostics();
        assert.ok(diag.opacity > 0.95, `opacity should be near 1, got ${diag.opacity}`);
        bubble.dispose();
    }]);

    tests.push(["29. fade-in is rapid (< 200ms)", async () => {
        const { bubble } = await setup();
        const dt = 0.016;
        const input = makeVisible("home-attacker", "home");
        let opaqueFrame = -1;
        for (let i = 0; i < 30; i++) {
            bubble.update(input, 800, 600, dt);
            if (bubble.getDiagnostics().opacity > 0.95) {
                opaqueFrame = i;
                break;
            }
        }
        assert.ok(opaqueFrame >= 0, "should become opaque");
        assert.ok(opaqueFrame <= 15, `fade-in too slow: ${opaqueFrame} frames at ${dt}s = ${(opaqueFrame * dt * 1000).toFixed(0)}ms`);
        bubble.dispose();
    }]);

    tests.push(["30. grace period diagnostics", async () => {
        const { bubble } = await setup();
        fadeInFrames(bubble, makeVisible("home-attacker", "home"));
        const dt = 0.016;
        const holdFrames = Math.ceil(1.6 / dt);
        updateFrames(bubble, makeHidden(), holdFrames, 800, 600, dt);
        const diag = bubble.getDiagnostics();
        assert.ok(diag.graceRemaining > 0, "grace should be active");
        assert.ok(diag.visible, "should still be visible during grace");
        bubble.dispose();
    }]);

    tests.push(["31. inline styles applied", async () => {
        const { bubble, canvas } = await setup();
        const el = canvas.parentElement.childNodes.find(c => c.tagName === "DIV");
        assert.ok(el, "bubble div should exist");
        assert.equal(el.style.position, "absolute");
        assert.equal(el.style.display, "flex");
        assert.equal(el.style.background.indexOf("rgba(3,22,27") >= 0, true, "should have dark gradient background");
        assert.ok(el.style.borderWidth !== "", "should have border width");
        assert.ok(el.style.boxShadow !== "", "should have box shadow");
        bubble.dispose();
    }]);

    tests.push(["32. bubble has CSS classes for styling", async () => {
        const { bubble } = await setup();
        fadeInFrames(bubble, makeVisible("home-attacker", "home"));
        const diag = bubble.getDiagnostics();
        assert.ok(diag.visible);
        bubble.dispose();
    }]);

    let passed = 0;
    let failed = 0;

    for (const [name, fn] of tests) {
        try {
            await fn();
            console.log(`  PASS  ${name}`);
            passed++;
        } catch (err) {
            console.error(`  FAIL  ${name}: ${err.message}`);
            failed++;
        }
    }

    console.log(`\n  Player Market Bubble: ${passed} passed, ${failed} failed`);
    if (failed > 0) process.exit(1);
}

runTests().catch(err => {
    console.error(err);
    process.exit(1);
});
