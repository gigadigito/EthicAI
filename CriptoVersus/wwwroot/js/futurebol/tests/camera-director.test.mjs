import assert from "node:assert/strict";
import { FuturebolCameraDirector } from "../../dist/futurebol/futurebol-camera-director.js";

function makePlayer(overrides = {}) {
    return {
        id: "home-attacker",
        team: "home",
        role: "attacker",
        position: { x: 10, y: 0, z: 0 },
        targetPosition: { x: 10, y: 0, z: 0 },
        movementSpeed: 5.2,
        currentSpeed: 0,
        facingAngle: 0,
        animation: "idle",
        animationTime: 0,
        actionProgress: 0,
        basePosition: { x: -3.5, y: 0, z: -3 },
        zone: { minimumX: -9.5, maximumX: 20.1, minimumZ: -10.5, maximumZ: 10.5 },
        tacticalIntent: "HoldingPosition",
        ...overrides
    };
}

function makeGk(overrides = {}) {
    return makePlayer({
        id: "away-goalkeeper",
        team: "away",
        role: "goalkeeper",
        position: { x: 21.2, y: 0, z: 0 },
        basePosition: { x: 21.2, y: 0, z: 0 },
        zone: { minimumX: 20.65, maximumX: 21.75, minimumZ: -3.35, maximumZ: 3.35 },
        tacticalIntent: "Covering",
        ...overrides
    });
}

function makeCtx(overrides = {}) {
    return {
        phase: "Neutral",
        outcome: null,
        activeTeam: "home",
        ballPosition: { x: 0, y: 0.55, z: 0 },
        ballVelocity: { x: 0, y: 0, z: 0 },
        ballOwnerId: null,
        lastShooterId: null,
        players: [makePlayer(), makeGk()],
        pressure: 0,
        quality: "Medium",
        reducedMotion: false,
        phaseElapsed: 0,
        goalHoldDuration: 1.65,
        saveHoldDuration: 1.15,
        goalkeeperIntent: null,
        goalkeeperDiveDirection: null,
        shotPower: null,
        shotOrdinal: 0,
        ...overrides
    };
}

// ========== TEST 1: Broadcast mode in Neutral phase ==========
{
    const director = new FuturebolCameraDirector();
    const ctx = makeCtx({ phase: "Neutral" });
    const out = director.compute(ctx);
    assert.equal(out.mode, "Broadcast", "Should be Broadcast in Neutral phase");
    assert.equal(out.focus, "midfield", "Focus should be midfield in Broadcast");
}

// ========== TEST 2: BuildUp mode in BuildUp phase ==========
{
    const director = new FuturebolCameraDirector();
    const ctx = makeCtx({ phase: "BuildUp" });
    const out = director.compute(ctx);
    assert.equal(out.mode, "BuildUp", "Should be BuildUp in BuildUp phase");
}

// ========== TEST 3: Attack mode in Passing phase ==========
{
    const director = new FuturebolCameraDirector();
    const ctx = makeCtx({ phase: "Passing" });
    const out = director.compute(ctx);
    assert.equal(out.mode, "Attack", "Should be Attack in Passing phase");
}

// ========== TEST 4: Attack mode in Attacking phase ==========
{
    const director = new FuturebolCameraDirector();
    const ctx = makeCtx({ phase: "Attacking" });
    const out = director.compute(ctx);
    assert.equal(out.mode, "Attack", "Should be Attack in Attacking phase");
}

// ========== TEST 5: ShotPreparation mode ==========
{
    const director = new FuturebolCameraDirector();
    const ctx = makeCtx({ phase: "PreparingShot" });
    const out = director.compute(ctx);
    assert.equal(out.mode, "ShotPreparation", "Should be ShotPreparation in PreparingShot phase");
    assert.equal(out.focus, "shooter", "Focus should be shooter in ShotPreparation");
}

// ========== TEST 6: ShotTracking mode ==========
{
    const director = new FuturebolCameraDirector();
    const ctx = makeCtx({ phase: "Shooting" });
    const out = director.compute(ctx);
    assert.equal(out.mode, "ShotTracking", "Should be ShotTracking in Shooting phase");
    assert.equal(out.focus, "ball", "Focus should be ball in ShotTracking");
}

// ========== TEST 7: GoalCelebration mode on Goal outcome ==========
{
    const director = new FuturebolCameraDirector();
    const ctx = makeCtx({ phase: "Outcome", outcome: "Goal", phaseElapsed: 0.5 });
    const out = director.compute(ctx);
    assert.equal(out.mode, "GoalCelebration", "Should be GoalCelebration on Goal");
    assert.equal(out.focus, "shooter", "Focus should be shooter in GoalCelebration");
}

// ========== TEST 8: GoalkeeperSave mode on Saved outcome ==========
{
    const director = new FuturebolCameraDirector();
    const ctx = makeCtx({ phase: "Outcome", outcome: "Saved", phaseElapsed: 0.3 });
    const out = director.compute(ctx);
    assert.equal(out.mode, "GoalkeeperSave", "Should be GoalkeeperSave on Saved");
    assert.equal(out.focus, "goalkeeper", "Focus should be goalkeeper in GoalkeeperSave");
}

// ========== TEST 9: Parry mode when goalkeeper is diving ==========
{
    const director = new FuturebolCameraDirector();
    const ctx = makeCtx({
        phase: "Outcome",
        outcome: "Saved",
        phaseElapsed: 0.3,
        goalkeeperIntent: "DiveLeft"
    });
    const out = director.compute(ctx);
    assert.equal(out.mode, "Parry", "Should be Parry when GK is diving");
}

// ========== TEST 10: Recovery mode after goal hold ==========
{
    const director = new FuturebolCameraDirector();
    const ctx = makeCtx({ phase: "Outcome", outcome: "Goal", phaseElapsed: 2.0 });
    const out = director.compute(ctx);
    assert.equal(out.mode, "Recovery", "Should be Recovery after goal hold");
}

// ========== TEST 11: Recovery mode after save hold ==========
{
    const director = new FuturebolCameraDirector();
    const ctx = makeCtx({ phase: "Outcome", outcome: "Saved", phaseElapsed: 1.5 });
    const out = director.compute(ctx);
    assert.equal(out.mode, "Recovery", "Should be Recovery after save hold");
}

// ========== TEST 12: Resetting phase returns to Broadcast ==========
{
    const director = new FuturebolCameraDirector();
    const ctx = makeCtx({ phase: "Resetting" });
    const out = director.compute(ctx);
    assert.equal(out.mode, "Broadcast", "Should be Broadcast in Resetting");
}

// ========== TEST 13: Cooldown phase returns to Broadcast ==========
{
    const director = new FuturebolCameraDirector();
    const ctx = makeCtx({ phase: "Cooldown" });
    const out = director.compute(ctx);
    assert.equal(out.mode, "Broadcast", "Should be Broadcast in Cooldown");
}

// ========== TEST 14: Camera shake on high power shot ==========
{
    const director = new FuturebolCameraDirector();
    const ctx = makeCtx({ phase: "Shooting", shotPower: 0.85 });
    const out = director.compute(ctx);
    assert.ok(out.shake !== null, "Should have shake on high power shot");
    assert.ok(out.shake.intensity > 0, "Shake intensity should be positive");
}

// ========== TEST 15: No camera shake in reduced motion ==========
{
    const director = new FuturebolCameraDirector();
    const ctx = makeCtx({ phase: "Shooting", shotPower: 0.85, reducedMotion: true });
    const out = director.compute(ctx);
    assert.equal(out.shake, null, "Should not have shake in reduced motion");
}

// ========== TEST 16: No camera shake in low quality ==========
{
    const director = new FuturebolCameraDirector();
    const ctx = makeCtx({ phase: "Shooting", shotPower: 0.85, quality: "Low" });
    const out = director.compute(ctx);
    assert.equal(out.shake, null, "Should not have shake in low quality");
}

// ========== TEST 17: Camera shake on goal (first 0.5s) ==========
{
    const director = new FuturebolCameraDirector();
    const ctx = makeCtx({ phase: "Outcome", outcome: "Goal", phaseElapsed: 0.2 });
    const out = director.compute(ctx);
    assert.ok(out.shake !== null, "Should have shake on goal");
}

// ========== TEST 18: No camera shake after goal fadeout ==========
{
    const director = new FuturebolCameraDirector();
    const ctx = makeCtx({ phase: "Outcome", outcome: "Goal", phaseElapsed: 1.0 });
    const out = director.compute(ctx);
    assert.equal(out.shake, null, "Should not have shake after goal fadeout");
}

// ========== TEST 19: FOV changes with mode ==========
{
    const broadcastDirector = new FuturebolCameraDirector();
    const broadcastCtx = makeCtx({ phase: "Neutral" });
    const broadcastOut = broadcastDirector.compute(broadcastCtx);

    const shotDirector = new FuturebolCameraDirector();
    const shotCtx = makeCtx({ phase: "Shooting" });
    const shotOut = shotDirector.compute(shotCtx);

    assert.ok(broadcastOut.fov > shotOut.fov, "Broadcast FOV should be wider than ShotTracking");
}

// ========== TEST 20: GoalCelebration has tighter FOV ==========
{
    const director = new FuturebolCameraDirector();
    const ctx = makeCtx({ phase: "Outcome", outcome: "Goal", phaseElapsed: 0.5 });
    const out = director.compute(ctx);
    assert.ok(out.fov < 0.7, "GoalCelebration should have tighter FOV");
}

// ========== TEST 21: Focus tracks shooter in GoalCelebration ==========
{
    const director = new FuturebolCameraDirector();
    const shooter = makePlayer({ id: "home-attacker", position: { x: 18, y: 0, z: 2 } });
    const ctx = makeCtx({
        phase: "Outcome",
        outcome: "Goal",
        phaseElapsed: 0.5,
        lastShooterId: "home-attacker",
        players: [shooter, makeGk()]
    });
    const out = director.compute(ctx);
    assert.equal(out.focus, "shooter", "Focus should be shooter");
    assert.equal(out.mode, "GoalCelebration", "Mode should be GoalCelebration");
}

// ========== TEST 22: Focus tracks goalkeeper in GoalkeeperSave ==========
{
    const director = new FuturebolCameraDirector();
    const ctx = makeCtx({ phase: "Outcome", outcome: "Saved", phaseElapsed: 0.3 });
    const out = director.compute(ctx);
    assert.equal(out.focus, "goalkeeper", "Focus should be goalkeeper");
}

// ========== TEST 23: Reset clears state ==========
{
    const director = new FuturebolCameraDirector();
    const ctx = makeCtx({ phase: "Shooting" });
    director.compute(ctx);
    director.reset();
    const resetCtx = makeCtx({ phase: "Neutral" });
    const out = director.compute(resetCtx);
    assert.equal(out.mode, "Broadcast", "Should be Broadcast after reset");
}

// ========== TEST 24: Diagnostics are populated ==========
{
    const director = new FuturebolCameraDirector();
    const ctx = makeCtx({ phase: "BuildUp" });
    const out = director.compute(ctx);
    assert.ok(out.diagnostics.mode, "Diagnostics should have mode");
    assert.ok(out.diagnostics.focus, "Diagnostics should have focus");
    assert.ok(typeof out.diagnostics.fov === "number", "Diagnostics should have numeric fov");
    assert.ok(typeof out.diagnostics.holdRemaining === "number", "Diagnostics should have holdRemaining");
    assert.ok(typeof out.diagnostics.transitionProgress === "number", "Diagnostics should have transitionProgress");
    assert.ok(typeof out.diagnostics.frameCount === "number", "Diagnostics should have frameCount");
}

// ========== TEST 25: Ball position affects camera position in BuildUp ==========
{
    const director = new FuturebolCameraDirector();
    const leftCtx = makeCtx({ phase: "BuildUp", ballPosition: { x: 10, y: 0.55, z: -5 } });
    const rightCtx = makeCtx({ phase: "BuildUp", ballPosition: { x: 10, y: 0.55, z: 5 } });

    const leftOut = director.compute(leftCtx);
    const rightOut = director.compute(rightCtx);

    assert.ok(leftOut.targetZ < rightOut.targetZ, "Camera should follow ball laterally");
}

// ========== TEST 26: Pressure affects Broadcast camera ==========
{
    const director = new FuturebolCameraDirector();
    const homePressureCtx = makeCtx({ phase: "Neutral", pressure: 0.8 });
    const awayPressureCtx = makeCtx({ phase: "Neutral", pressure: -0.8 });

    const homeOut = director.compute(homePressureCtx);
    const awayOut = director.compute(awayPressureCtx);

    assert.ok(homeOut.positionX > awayOut.positionX, "Camera should shift with pressure");
}

// ========== TEST 27: ShotTracking follows ball velocity ==========
{
    const director = new FuturebolCameraDirector();
    const staticCtx = makeCtx({ phase: "Shooting", ballVelocity: { x: 0, y: 0, z: 0 } });
    const movingCtx = makeCtx({ phase: "Shooting", ballVelocity: { x: 15, y: 0, z: 0 } });

    const staticOut = director.compute(staticCtx);
    const movingOut = director.compute(movingCtx);

    assert.ok(movingOut.positionX > staticOut.positionX, "Camera should lead ball in ShotTracking");
}

// ========== TEST 28: Transition progress increases over time ==========
{
    const director = new FuturebolCameraDirector();
    const ctx1 = makeCtx({ phase: "BuildUp" });
    const out1 = director.compute(ctx1);

    director.updateDelta(0.2);
    const ctx2 = makeCtx({ phase: "BuildUp" });
    const out2 = director.compute(ctx2);

    assert.ok(out2.diagnostics.transitionProgress >= out1.diagnostics.transitionProgress, "Transition progress should increase");
}
