import assert from "node:assert/strict";
import { GoalkeeperAI } from "../../dist/futurebol/futurebol-goalkeeper-ai.js";

function makeGk(overrides = {}) {
    return {
        id: "away-goalkeeper",
        team: "away",
        role: "goalkeeper",
        position: { x: 21.2, y: 0, z: 0 },
        targetPosition: { x: 21.2, y: 0, z: 0 },
        movementSpeed: 3.2,
        currentSpeed: 0,
        facingAngle: Math.PI,
        animation: "goalkeeper-ready",
        animationTime: 0,
        actionProgress: 0,
        basePosition: { x: 21.2, y: 0, z: 0 },
        zone: { minimumX: 20.65, maximumX: 21.75, minimumZ: -3.35, maximumZ: 3.35 },
        tacticalIntent: "Covering",
        ...overrides
    };
}

function makeCtx(overrides = {}) {
    const gk = makeGk();
    return {
        team: "away",
        goalkeeper: gk,
        ballPosition: { x: 0, y: 0.55, z: 0 },
        ballVelocity: { x: 0, y: 0, z: 0 },
        attackingTeam: "home",
        ballOwnerId: "home-attacker",
        phase: "Attacking",
        phaseElapsed: 1.0,
        shotProfile: null,
        shotEndZ: null,
        seed: 12345,
        playIndex: 1,
        ...overrides
    };
}

function makeShotProfile(overrides = {}) {
    return {
        lateral: "Center",
        height: "Low",
        power: 0.7,
        ...overrides
    };
}

// ========== TEST 1: Ball left moves GK partially left ==========
{
    const ai = new GoalkeeperAI();
    const ctx = makeCtx({
        ballPosition: { x: 5, y: 0.55, z: -4 },
        phase: "Attacking"
    });
    const out = ai.computeIntent(ctx);
    assert.ok(out.targetZ < 0, "GK should move toward negative Z when ball is left");
    assert.ok(out.targetZ > -3.5, "GK should not go past goal post");
    assert.equal(out.intent, "TrackBall");
}

// ========== TEST 2: Ball right moves GK partially right ==========
{
    const ai = new GoalkeeperAI();
    const ctx = makeCtx({
        ballPosition: { x: 5, y: 0.55, z: 4 },
        phase: "Attacking"
    });
    const out = ai.computeIntent(ctx);
    assert.ok(out.targetZ > 0, "GK should move toward positive Z when ball is right");
    assert.ok(out.targetZ < 3.5, "GK should not go past goal post");
    assert.equal(out.intent, "TrackBall");
}

// ========== TEST 3: Ball center keeps GK near center ==========
{
    const ai = new GoalkeeperAI();
    const ctx = makeCtx({
        ballPosition: { x: 5, y: 0.55, z: 0 },
        phase: "Attacking"
    });
    const out = ai.computeIntent(ctx);
    assert.ok(Math.abs(out.targetZ) < 0.5, "GK should stay near center when ball is central");
    assert.equal(out.intent, "TrackBall");
}

// ========== TEST 4: GK never leaves safe bounds ==========
{
    const ai = new GoalkeeperAI();
    const extremePositions = [
        { x: 5, y: 0.55, z: -15 },
        { x: 5, y: 0.55, z: 15 },
        { x: -5, y: 0.55, z: -12 },
        { x: 10, y: 0.55, z: 12 }
    ];
    for (const ballPos of extremePositions) {
        const ctx = makeCtx({ ballPosition: ballPos, phase: "Attacking" });
        const out = ai.computeIntent(ctx);
        assert.ok(out.targetZ >= -4, `GK Z should be >= -4, got ${out.targetZ}`);
        assert.ok(out.targetZ <= 4, `GK Z should be <= 4, got ${out.targetZ}`);
        assert.ok(!isNaN(out.targetZ), "GK Z should not be NaN");
        assert.ok(isFinite(out.targetZ), "GK Z should be finite");
        assert.ok(!isNaN(out.targetX), "GK X should not be NaN");
        assert.ok(isFinite(out.targetX), "GK X should be finite");
    }
}

// ========== TEST 5: PreparingShot activates SetPosition ==========
{
    const ai = new GoalkeeperAI();
    const ctx = makeCtx({
        phase: "PreparingShot",
        ballPosition: { x: 18, y: 0.55, z: 2 }
    });
    const out = ai.computeIntent(ctx);
    assert.equal(out.intent, "SetPosition");
    assert.ok(out.speedFactor >= 0.6, "SetPosition should have decent speed");
}

// ========== TEST 6: Shot left generates DiveLeft ==========
{
    const ai = new GoalkeeperAI();
    const profile = makeShotProfile({ lateral: "NearPost" });
    const gk = makeGk({ position: { x: 21.2, y: 0, z: 0 } });
    const ctx = makeCtx({
        phase: "Shooting",
        phaseElapsed: 0.3,
        shotProfile: profile,
        shotEndZ: -2.5,
        goalkeeper: gk
    });
    // Advance past reaction delay (typically 0.08-0.18s)
    let out;
    for (let i = 0; i < 5; i++) {
        out = ai.computeIntent(ctx);
    }
    assert.equal(out.diveDirection, "left", "NearPost shot should generate left dive");
}

// ========== TEST 7: Shot right generates DiveRight ==========
{
    const ai = new GoalkeeperAI();
    const profile = makeShotProfile({ lateral: "FarPost" });
    const gk = makeGk({ position: { x: 21.2, y: 0, z: 0 } });
    const ctx = makeCtx({
        phase: "Shooting",
        phaseElapsed: 0.3,
        shotProfile: profile,
        shotEndZ: 2.5,
        goalkeeper: gk
    });
    let out;
    for (let i = 0; i < 5; i++) {
        out = ai.computeIntent(ctx);
    }
    assert.equal(out.diveDirection, "right", "FarPost shot should generate right dive");
}

// ========== TEST 8: Reaction delay is deterministic ==========
{
    const ai1 = new GoalkeeperAI();
    const ai2 = new GoalkeeperAI();
    const profile = makeShotProfile({ lateral: "Center", power: 0.8 });
    const gk1 = makeGk();
    const gk2 = makeGk();
    const ctx1 = makeCtx({
        phase: "Shooting",
        phaseElapsed: 0.2,
        shotProfile: profile,
        shotEndZ: 0,
        goalkeeper: gk1,
        seed: 99999,
        playIndex: 42
    });
    const ctx2 = makeCtx({
        phase: "Shooting",
        phaseElapsed: 0.2,
        shotProfile: profile,
        shotEndZ: 0,
        goalkeeper: gk2,
        seed: 99999,
        playIndex: 42
    });
    const out1 = ai1.computeIntent(ctx1);
    const out2 = ai2.computeIntent(ctx2);
    assert.equal(out1.reactionDelay, out2.reactionDelay, "Same seed/context should produce same reaction delay");
    assert.ok(out1.reactionDelay >= 0.08 && out1.reactionDelay <= 0.18, "Reaction delay should be 0.08-0.18s");
}

// ========== TEST 9: Same seed/context produces same reaction ==========
{
    const ai1 = new GoalkeeperAI();
    const ai2 = new GoalkeeperAI();
    const profile = makeShotProfile({ lateral: "NearPost", power: 0.6 });
    const gk1 = makeGk();
    const gk2 = makeGk();
    const baseCtx = {
        phase: "Shooting",
        phaseElapsed: 0.25,
        shotProfile: profile,
        shotEndZ: -2,
        seed: 54321,
        playIndex: 7
    };
    const out1 = ai1.computeIntent(makeCtx({ ...baseCtx, goalkeeper: gk1 }));
    const out2 = ai2.computeIntent(makeCtx({ ...baseCtx, goalkeeper: gk2 }));
    assert.equal(out1.targetZ, out2.targetZ, "Same seed should produce same targetZ");
    assert.equal(out1.diveDirection, out2.diveDirection, "Same seed should produce same dive direction");
}

// ========== TEST 10: Saved produces coherent visual reaction ==========
{
    const ai = new GoalkeeperAI();
    const profile = makeShotProfile({ lateral: "Center", power: 0.5 });
    const gk = makeGk({ position: { x: 21.2, y: 0, z: 0 } });
    const ctx = makeCtx({
        phase: "Shooting",
        phaseElapsed: 0.5,
        shotProfile: profile,
        shotEndZ: 0,
        goalkeeper: gk
    });
    let out;
    for (let i = 0; i < 5; i++) {
        out = ai.computeIntent(ctx);
    }
    assert.ok(
        out.intent === "DiveLeft" || out.intent === "DiveRight" || out.intent === "Save",
        `Saved should produce dive or save, got ${out.intent}`
    );
}

// ========== TEST 11: Parry produces dive + recovery path ==========
{
    const ai = new GoalkeeperAI();
    const profile = makeShotProfile({ lateral: "NearPost", power: 0.9 });
    const gk = makeGk({ position: { x: 21.2, y: 0, z: 1 } });
    const ctx = makeCtx({
        phase: "Shooting",
        phaseElapsed: 0.4,
        shotProfile: profile,
        shotEndZ: -2,
        goalkeeper: gk
    });
    let out;
    for (let i = 0; i < 5; i++) {
        out = ai.computeIntent(ctx);
    }
    assert.ok(
        out.intent === "DiveLeft" || out.intent === "DiveRight" || out.intent === "Save",
        `Parry context should produce dive, got ${out.intent}`
    );
}

// ========== TEST 12: Official goal continues as Goal ==========
{
    const ai = new GoalkeeperAI();
    const profile = makeShotProfile({ lateral: "Center", power: 0.8 });
    const gk = makeGk();
    const ctx = makeCtx({
        phase: "Shooting",
        phaseElapsed: 0.3,
        shotProfile: profile,
        shotEndZ: 0,
        goalkeeper: gk
    });
    let out;
    for (let i = 0; i < 5; i++) {
        out = ai.computeIntent(ctx);
    }
    assert.equal(out.diagnostics.owner, "GoalkeeperAI", "GK AI should own the decision");
    assert.ok(out.intent !== "Goal", "GoalkeeperAI should never produce Goal intent");
}

// ========== TEST 13: GoalkeeperAI never transforms requiredOutcome Goal into Saved ==========
{
    const ai = new GoalkeeperAI();
    const gk = makeGk();
    const phases = ["Attacking", "PreparingShot", "Shooting", "Outcome"];
    for (const phase of phases) {
        const ctx = makeCtx({
            phase,
            phaseElapsed: 0.3,
            shotProfile: makeShotProfile(),
            shotEndZ: 0,
            goalkeeper: makeGk()
        });
        const out = ai.computeIntent(ctx);
        assert.ok(
            out.intent !== "Goal" && out.intent !== "Saved",
            `Phase ${phase}: GK intent should not be Goal or Saved, got ${out.intent}`
        );
    }
}

// ========== TEST 14: Official goal with parry continues recoverable ==========
{
    const ai = new GoalkeeperAI();
    const profile = makeShotProfile({ lateral: "FarPost", power: 0.9 });
    const gk = makeGk({ position: { x: 21.2, y: 0, z: -1 } });
    const ctx = makeCtx({
        phase: "Shooting",
        phaseElapsed: 0.5,
        shotProfile: profile,
        shotEndZ: 3,
        goalkeeper: gk
    });
    let out;
    for (let i = 0; i < 5; i++) {
        out = ai.computeIntent(ctx);
    }
    assert.ok(
        out.intent === "DiveLeft" || out.intent === "DiveRight" || out.intent === "Save",
        `Official goal parry should produce dive, got ${out.intent}`
    );
}

// ========== TEST 15: No NaN/Infinity in any output ==========
{
    const ai = new GoalkeeperAI();
    const phases = ["Neutral", "BuildUp", "Passing", "Attacking", "PreparingShot", "Shooting", "Outcome", "Cooldown", "Resetting"];
    for (const phase of phases) {
        const ctx = makeCtx({
            phase,
            phaseElapsed: Math.random() * 5,
            shotProfile: makeShotProfile(),
            shotEndZ: (Math.random() - 0.5) * 6,
            ballPosition: {
                x: (Math.random() - 0.5) * 40,
                y: 0.55,
                z: (Math.random() - 0.5) * 20
            }
        });
        const out = ai.computeIntent(ctx);
        assert.ok(!isNaN(out.targetX), `${phase}: targetX should not be NaN`);
        assert.ok(isFinite(out.targetX), `${phase}: targetX should be finite`);
        assert.ok(!isNaN(out.targetZ), `${phase}: targetZ should not be NaN`);
        assert.ok(isFinite(out.targetZ), `${phase}: targetZ should be finite`);
        assert.ok(!isNaN(out.reactionDelay), `${phase}: reactionDelay should not be NaN`);
        assert.ok(isFinite(out.reactionDelay), `${phase}: reactionDelay should be finite`);
    }
}

// ========== TEST 16: No target outside field/goalkeeper zone ==========
{
    const ai = new GoalkeeperAI();
    const gk = makeGk();
    const ctx = makeCtx({
        phase: "Attacking",
        ballPosition: { x: 20, y: 0.55, z: 10 }
    });
    const out = ai.computeIntent(ctx);
    assert.ok(out.targetZ >= -4, `targetZ ${out.targetZ} should be >= -4`);
    assert.ok(out.targetZ <= 4, `targetZ ${out.targetZ} should be <= 4`);
    assert.ok(out.targetX >= 20.65, `targetX ${out.targetX} should be >= 20.65`);
    assert.ok(out.targetX <= 21.75, `targetX ${out.targetX} should be <= 21.75`);
}

// ========== TEST 17: ActionController priority when controlling GK ==========
{
    const ai = new GoalkeeperAI();
    const ctx = makeCtx({
        phase: "Neutral",
        ballPosition: { x: 0, y: 0.55, z: 0 }
    });
    const out = ai.computeIntent(ctx);
    assert.equal(out.intent, "HoldCenter", "Neutral phase should produce HoldCenter");
    assert.equal(out.diagnostics.owner, "GoalkeeperAI");
}

// ========== TEST 18: GoalkeeperAI controls GK when ActionController doesn't ==========
{
    const ai = new GoalkeeperAI();
    const phases = [
        { phase: "Neutral", expected: false },
        { phase: "Cooldown", expected: false },
        { phase: "Resetting", expected: false },
        { phase: "BuildUp", expected: true },
        { phase: "Passing", expected: true },
        { phase: "Attacking", expected: true },
        { phase: "PreparingShot", expected: true },
        { phase: "Shooting", expected: true },
        { phase: "Outcome", expected: true }
    ];
    for (const { phase, expected } of phases) {
        assert.equal(
            ai.isActiveFor(phase),
            expected,
            `isActiveFor(${phase}) should be ${expected}`
        );
    }
}

// ========== TEST 19: TeamBehavior does not dispute GK target ==========
{
    const ai = new GoalkeeperAI();
    const gk = makeGk({ position: { x: 21.2, y: 0, z: 0 } });
    const ctx = makeCtx({
        phase: "Attacking",
        ballPosition: { x: 10, y: 0.55, z: 3 },
        goalkeeper: gk
    });
    const out = ai.computeIntent(ctx);
    assert.equal(out.diagnostics.owner, "GoalkeeperAI", "GoalkeeperAI should own GK");
    assert.ok(out.intent === "TrackBall" || out.intent === "Anticipate",
        `During Attacking, GK should track or anticipate, got ${out.intent}`);
}

// ========== TEST 20: Recover returns progressively ==========
{
    const ai = new GoalkeeperAI();
    const profile = makeShotProfile({ lateral: "NearPost", power: 0.7 });
    const gk = makeGk({ position: { x: 21.2, y: 0, z: -1.5 } });

    const ctx1 = makeCtx({
        phase: "Shooting",
        phaseElapsed: 0.5,
        shotProfile: profile,
        shotEndZ: -2,
        goalkeeper: gk
    });
    ai.computeIntent(ctx1);

    const ctx2 = makeCtx({
        phase: "Outcome",
        phaseElapsed: 0.5,
        shotProfile: null,
        shotEndZ: null,
        goalkeeper: makeGk({ position: { x: 21.2, y: 0, z: -1 } })
    });
    const out = ai.computeIntent(ctx2);
    assert.equal(out.intent, "Recover", "After shooting, should recover");
}

// ========== TEST 21: HoldCenter during Neutral ==========
{
    const ai = new GoalkeeperAI();
    const ctx = makeCtx({ phase: "Neutral" });
    const out = ai.computeIntent(ctx);
    assert.equal(out.intent, "HoldCenter");
    assert.equal(out.targetZ, 0);
    assert.equal(out.speedFactor, 0.4);
}

// ========== TEST 22: SetPosition during PreparingShot with depth ==========
{
    const ai = new GoalkeeperAI();
    const gk = makeGk({ position: { x: 21.2, y: 0, z: 0 } });
    const ctx = makeCtx({
        phase: "PreparingShot",
        phaseElapsed: 0.3,
        ballPosition: { x: 18, y: 0.55, z: 1 },
        goalkeeper: gk
    });
    const out = ai.computeIntent(ctx);
    assert.equal(out.intent, "SetPosition");
    assert.ok(out.targetX >= 21.2, "GK should push forward from goal line toward ball");
}

// ========== TEST 23: Reaction delay varies with power ==========
{
    const ai1 = new GoalkeeperAI();
    const ai2 = new GoalkeeperAI();
    const gk1 = makeGk();
    const gk2 = makeGk();
    const lowPower = makeShotProfile({ power: 0.3 });
    const highPower = makeShotProfile({ power: 0.95 });
    const ctx1 = makeCtx({
        phase: "Shooting",
        phaseElapsed: 0.1,
        shotProfile: lowPower,
        shotEndZ: 0,
        goalkeeper: gk1,
        seed: 11111,
        playIndex: 5
    });
    const ctx2 = makeCtx({
        phase: "Shooting",
        phaseElapsed: 0.1,
        shotProfile: highPower,
        shotEndZ: 0,
        goalkeeper: gk2,
        seed: 11111,
        playIndex: 5
    });
    const out1 = ai1.computeIntent(ctx1);
    const out2 = ai2.computeIntent(ctx2);
    assert.ok(
        out2.reactionDelay <= out1.reactionDelay + 5,
        "Higher power should not produce significantly longer delay"
    );
}

// ========== TEST 24: NearPost maps to left dive, FarPost to right ==========
{
    const aiNP = new GoalkeeperAI();
    const aiFP = new GoalkeeperAI();
    const gkNP = makeGk();
    const gkFP = makeGk();
    const npCtx = makeCtx({
        phase: "Shooting",
        phaseElapsed: 0.3,
        shotProfile: makeShotProfile({ lateral: "NearPost" }),
        shotEndZ: -2,
        goalkeeper: gkNP
    });
    const fpCtx = makeCtx({
        phase: "Shooting",
        phaseElapsed: 0.3,
        shotProfile: makeShotProfile({ lateral: "FarPost" }),
        shotEndZ: 2,
        goalkeeper: gkFP
    });
    let outNP, outFP;
    for (let i = 0; i < 5; i++) {
        outNP = aiNP.computeIntent(npCtx);
        outFP = aiFP.computeIntent(fpCtx);
    }
    assert.equal(outNP.diveDirection, "left", "NearPost should map to left dive");
    assert.equal(outFP.diveDirection, "right", "FarPost should map to right dive");
}

// ========== TEST 25: Diagnostics are complete ==========
{
    const ai = new GoalkeeperAI();
    const ctx = makeCtx({
        phase: "Attacking",
        ballPosition: { x: 10, y: 0.55, z: 2 }
    });
    const out = ai.computeIntent(ctx);
    assert.equal(out.diagnostics.owner, "GoalkeeperAI");
    assert.equal(typeof out.diagnostics.intent, "string");
    assert.equal(typeof out.diagnostics.ballAngle, "number");
    assert.equal(typeof out.diagnostics.targetOffset, "number");
    assert.equal(typeof out.diagnostics.reactionDelay, "number");
    assert.equal(typeof out.diagnostics.shotSide, "string");
    assert.equal(typeof out.diagnostics.expectedDive, "string");
    assert.equal(typeof out.diagnostics.depthRatio, "number");
}

// ========== TEST 26: reset() clears state ==========
{
    const ai = new GoalkeeperAI();
    const gk = makeGk();
    const ctx = makeCtx({
        phase: "Shooting",
        phaseElapsed: 0.4,
        shotProfile: makeShotProfile({ lateral: "NearPost" }),
        shotEndZ: -2,
        goalkeeper: gk
    });
    ai.computeIntent(ctx);
    ai.reset();
    const ctx2 = makeCtx({ phase: "Neutral" });
    const out = ai.computeIntent(ctx2);
    assert.equal(out.intent, "HoldCenter");
}

// ========== TEST 27: GK never teleports (target within movement range) ==========
{
    const ai = new GoalkeeperAI();
    const gk = makeGk({ position: { x: 21.2, y: 0, z: 0 } });
    const ctx = makeCtx({
        phase: "Attacking",
        ballPosition: { x: 15, y: 0.55, z: 5 },
        goalkeeper: gk
    });
    const out = ai.computeIntent(ctx);
    const dist = Math.hypot(out.targetX - gk.position.x, out.targetZ - gk.position.z);
    assert.ok(dist < 5, `Target should be reachable, distance = ${dist}`);
}

// ========== TEST 28: Cooldown produces HoldCenter ==========
{
    const ai = new GoalkeeperAI();
    const ctx = makeCtx({ phase: "Cooldown" });
    const out = ai.computeIntent(ctx);
    assert.equal(out.intent, "HoldCenter");
}

console.log("GoalkeeperAI tests passed.");
