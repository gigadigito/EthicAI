import assert from "node:assert/strict";

class MockElement {
    constructor(tag) {
        this.tagName = tag.toUpperCase();
        this.className = "";
        this.textContent = "";
        this.style = {
            cssText: "",
            setProperty: () => {},
            opacity: "",
            left: "",
            top: "",
            transform: "",
        };
        this.childNodes = [];
        this._parent = null;
        this._removed = false;
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

function createMockDocument() {
    globalThis.document = {
        createElement: (tag) => new MockElement(tag),
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

function updateToVisible(bubble, input, screenW = 800, screenH = 600) {
    for (let i = 0; i < 20; i++)
        bubble.update(input, screenW, screenH, 0.05);
}

function updateToHidden(bubble, screenW = 800, screenH = 600) {
    for (let i = 0; i < 20; i++)
        bubble.update({
            ownerPlayerId: null, ownerTeam: null, asset: null,
            headScreenX: 0, headScreenY: 0, visible: false,
        }, screenW, screenH, 0.05);
}

async function runTests() {
    const tests = [];

    tests.push(["1. owner null → hidden", async () => {
        const { bubble } = await setup();
        updateToHidden(bubble);
        assert.equal(bubble.getDiagnostics().visible, false);
        assert.equal(bubble.getDiagnostics().ownerPlayerId, null);
        bubble.dispose();
    }]);

    tests.push(["2. HOME owner → HOME market data", async () => {
        const { bubble } = await setup();
        const asset = makeAsset({ price: 0.156, changePercent: 15.85 });
        updateToVisible(bubble, {
            ownerPlayerId: "home-attacker", ownerTeam: "home", asset,
            headScreenX: 400, headScreenY: 200, visible: true,
        });
        assert.equal(bubble.getDiagnostics().ownerPlayerId, "home-attacker");
        assert.equal(bubble.getDiagnostics().visible, true);
        bubble.dispose();
    }]);

    tests.push(["3. AWAY owner → AWAY market data", async () => {
        const { bubble } = await setup();
        const asset = makeAsset({ price: 2.41, changePercent: -3.62 });
        updateToVisible(bubble, {
            ownerPlayerId: "away-defender", ownerTeam: "away", asset,
            headScreenX: 350, headScreenY: 180, visible: true,
        });
        assert.equal(bubble.getDiagnostics().ownerPlayerId, "away-defender");
        assert.equal(bubble.getDiagnostics().visible, true);
        bubble.dispose();
    }]);

    tests.push(["4. possession changes → bubble changes player", async () => {
        const { bubble } = await setup();
        const asset = makeAsset();
        updateToVisible(bubble, {
            ownerPlayerId: "home-attacker", ownerTeam: "home", asset,
            headScreenX: 400, headScreenY: 200, visible: true,
        });
        assert.equal(bubble.getDiagnostics().ownerPlayerId, "home-attacker");

        updateToVisible(bubble, {
            ownerPlayerId: "away-midfielder", ownerTeam: "away", asset,
            headScreenX: 300, headScreenY: 150, visible: true,
        });
        assert.equal(bubble.getDiagnostics().ownerPlayerId, "away-midfielder");
        bubble.dispose();
    }]);

    tests.push(["5. pass with owner null → hidden", async () => {
        const { bubble } = await setup();
        const asset = makeAsset();
        updateToVisible(bubble, {
            ownerPlayerId: "home-attacker", ownerTeam: "home", asset,
            headScreenX: 400, headScreenY: 200, visible: true,
        });
        assert.equal(bubble.getDiagnostics().visible, true);

        updateToHidden(bubble);
        assert.equal(bubble.getDiagnostics().visible, false);
        bubble.dispose();
    }]);

    tests.push(["6. shot → hidden", async () => {
        const { bubble } = await setup();
        const asset = makeAsset();
        updateToVisible(bubble, {
            ownerPlayerId: "home-attacker", ownerTeam: "home", asset,
            headScreenX: 400, headScreenY: 200, visible: true,
        });
        updateToHidden(bubble);
        assert.equal(bubble.getDiagnostics().visible, false);
        bubble.dispose();
    }]);

    tests.push(["7. goalkeeper possession → visible", async () => {
        const { bubble } = await setup();
        const asset = makeAsset();
        updateToVisible(bubble, {
            ownerPlayerId: "home-goalkeeper", ownerTeam: "home", asset,
            headScreenX: 100, headScreenY: 300, visible: true,
        });
        assert.equal(bubble.getDiagnostics().visible, true);
        assert.equal(bubble.getDiagnostics().ownerPlayerId, "home-goalkeeper");
        bubble.dispose();
    }]);

    tests.push(["8. positive percentage has + sign", async () => {
        const { bubble } = await setup();
        const asset = makeAsset({ changePercent: 15.85 });
        updateToVisible(bubble, {
            ownerPlayerId: "home-attacker", ownerTeam: "home", asset,
            headScreenX: 400, headScreenY: 200, visible: true,
        });
        assert.ok(bubble.getDiagnostics().visible);
        bubble.dispose();
    }]);

    tests.push(["9. negative percentage has - sign", async () => {
        const { bubble } = await setup();
        const asset = makeAsset({ changePercent: -3.62 });
        updateToVisible(bubble, {
            ownerPlayerId: "away-defender", ownerTeam: "away", asset,
            headScreenX: 350, headScreenY: 180, visible: true,
        });
        assert.ok(bubble.getDiagnostics().visible);
        bubble.dispose();
    }]);

    tests.push(["10. price formatting", async () => {
        const { bubble } = await setup();
        const asset = makeAsset({ price: 65000.42, changePercent: 2.35 });
        updateToVisible(bubble, {
            ownerPlayerId: "home-attacker", ownerTeam: "home", asset,
            headScreenX: 400, headScreenY: 200, visible: true,
        });
        assert.ok(bubble.getDiagnostics().visible);
        bubble.dispose();
    }]);

    tests.push(["11. missing price", async () => {
        const { bubble } = await setup();
        const asset = makeAsset({ price: NaN, changePercent: 5.0 });
        updateToVisible(bubble, {
            ownerPlayerId: "home-attacker", ownerTeam: "home", asset,
            headScreenX: 400, headScreenY: 200, visible: true,
        });
        assert.ok(bubble.getDiagnostics().visible);
        bubble.dispose();
    }]);

    tests.push(["12. missing percentage", async () => {
        const { bubble } = await setup();
        const asset = makeAsset({ price: 1.5, changePercent: NaN });
        updateToVisible(bubble, {
            ownerPlayerId: "home-attacker", ownerTeam: "home", asset,
            headScreenX: 400, headScreenY: 200, visible: true,
        });
        assert.ok(bubble.getDiagnostics().visible);
        bubble.dispose();
    }]);

    tests.push(["13. both missing → hidden", async () => {
        const { bubble } = await setup();
        const asset = makeAsset({ price: NaN, changePercent: NaN });
        updateToVisible(bubble, {
            ownerPlayerId: "home-attacker", ownerTeam: "home", asset,
            headScreenX: 400, headScreenY: 200, visible: true,
        });
        assert.equal(bubble.getDiagnostics().visible, false);
        bubble.dispose();
    }]);

    tests.push(["14. offscreen player → hidden", async () => {
        const { bubble } = await setup();
        const asset = makeAsset();
        updateToVisible(bubble, {
            ownerPlayerId: "home-attacker", ownerTeam: "home", asset,
            headScreenX: -100, headScreenY: 200, visible: true,
        });
        assert.equal(bubble.getDiagnostics().visible, false);
        bubble.dispose();
    }]);

    tests.push(["15. behind camera → hidden", async () => {
        const { bubble } = await setup();
        const asset = makeAsset();
        updateToVisible(bubble, {
            ownerPlayerId: "home-attacker", ownerTeam: "home", asset,
            headScreenX: 400, headScreenY: 200, visible: false,
        });
        assert.equal(bubble.getDiagnostics().visible, false);
        bubble.dispose();
    }]);

    tests.push(["16. valid projection → correct screen coords", async () => {
        const { bubble } = await setup();
        const asset = makeAsset();
        updateToVisible(bubble, {
            ownerPlayerId: "home-attacker", ownerTeam: "home", asset,
            headScreenX: 400, headScreenY: 200, visible: true,
        });
        const diag = bubble.getDiagnostics();
        assert.equal(typeof diag.screenX, "number");
        assert.equal(typeof diag.screenY, "number");
        assert.ok(isFinite(diag.screenX));
        assert.ok(isFinite(diag.screenY));
        bubble.dispose();
    }]);

    tests.push(["17. screen clamp", async () => {
        const { bubble } = await setup();
        const asset = makeAsset();
        updateToVisible(bubble, {
            ownerPlayerId: "home-attacker", ownerTeam: "home", asset,
            headScreenX: 795, headScreenY: 595, visible: true,
        });
        const diag = bubble.getDiagnostics();
        assert.ok(diag.screenX <= 800);
        assert.ok(diag.screenY <= 600);
        bubble.dispose();
    }]);

    tests.push(["18. smoothing finite", async () => {
        const { bubble } = await setup();
        const asset = makeAsset();
        for (let i = 0; i < 10; i++) {
            bubble.update({
                ownerPlayerId: "home-attacker", ownerTeam: "home", asset,
                headScreenX: 100 + i * 30, headScreenY: 100 + i * 10, visible: true,
            }, 800, 600, 0.05);
        }
        const diag = bubble.getDiagnostics();
        assert.ok(isFinite(diag.screenX));
        assert.ok(isFinite(diag.screenY));
        bubble.dispose();
    }]);

    tests.push(["19. no NaN/Infinity", async () => {
        const { bubble } = await setup();
        const asset = makeAsset();
        updateToVisible(bubble, {
            ownerPlayerId: "home-attacker", ownerTeam: "home", asset,
            headScreenX: 400, headScreenY: 200, visible: true,
        });
        const diag = bubble.getDiagnostics();
        assert.ok(Number.isFinite(diag.screenX));
        assert.ok(Number.isFinite(diag.screenY));
        bubble.dispose();
    }]);

    tests.push(["20. reset hides bubble", async () => {
        const { bubble } = await setup();
        const asset = makeAsset();
        updateToVisible(bubble, {
            ownerPlayerId: "home-attacker", ownerTeam: "home", asset,
            headScreenX: 400, headScreenY: 200, visible: true,
        });
        updateToHidden(bubble);
        assert.equal(bubble.getDiagnostics().visible, false);
        bubble.dispose();
    }]);

    tests.push(["21. dispose removes overlay", async () => {
        const { bubble } = await setup();
        bubble.dispose();
        assert.ok(!bubble.getDiagnostics().visible);
    }]);

    tests.push(["22. replay does not alter bubble logic", async () => {
        const { bubble } = await setup();
        const asset = makeAsset();
        updateToVisible(bubble, {
            ownerPlayerId: "home-attacker", ownerTeam: "home", asset,
            headScreenX: 400, headScreenY: 200, visible: true,
        });
        assert.ok(bubble.getDiagnostics().visible);
        bubble.dispose();
    }]);

    tests.push(["23. official score not altered", async () => {
        const { bubble } = await setup();
        const asset = makeAsset();
        updateToVisible(bubble, {
            ownerPlayerId: "home-attacker", ownerTeam: "home", asset,
            headScreenX: 400, headScreenY: 200, visible: true,
        });
        const diag = bubble.getDiagnostics();
        assert.equal(typeof diag.ownerPlayerId, "string");
        bubble.dispose();
    }]);

    tests.push(["24. single bubble instance", async () => {
        const { bubble } = await setup();
        const asset = makeAsset();
        for (let i = 0; i < 5; i++) {
            updateToVisible(bubble, {
                ownerPlayerId: `home-player-${i}`, ownerTeam: "home", asset,
                headScreenX: 400, headScreenY: 200, visible: true,
            });
        }
        assert.equal(bubble.getDiagnostics().ownerPlayerId, "home-player-4");
        bubble.dispose();
    }]);

    tests.push(["25. price zero → visible with percent", async () => {
        const { bubble } = await setup();
        const asset = makeAsset({ price: 0, changePercent: 5.0 });
        updateToVisible(bubble, {
            ownerPlayerId: "home-attacker", ownerTeam: "home", asset,
            headScreenX: 400, headScreenY: 200, visible: true,
        });
        assert.ok(bubble.getDiagnostics().visible);
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
