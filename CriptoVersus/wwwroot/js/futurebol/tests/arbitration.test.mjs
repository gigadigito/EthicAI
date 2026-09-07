import assert from "node:assert/strict";
import { ActionController } from "../../dist/futurebol/futurebol-action-controller.js";
import { FuturebolTeamBehavior } from "../../dist/futurebol/futurebol-team-behavior.js";
import { FuturebolMatchState } from "../../dist/futurebol/futurebol-match-state.js";

function makeCtx(overrides = {}) {
    return {
        ballOwnerId: null,
        ballState: "Free",
        ballPosition: { x: 0, y: 0.55, z: 0 },
        ballVelocity: { x: 0, y: 0, z: 0 },
        playPhase: "BuildUp",
        outcome: null,
        phaseElapsed: 0,
        intendedReceiverId: null,
        lastActionResult: null,
        possessionTeam: null,
        requiredOutcome: null,
        ...overrides
    };
}

function makePlayer(overrides = {}) {
    return {
        id: "home-attacker",
        team: "home",
        role: "attacker",
        position: { x: 5, y: 0, z: 0 },
        targetPosition: { x: 5, y: 0, z: 0 },
        movementSpeed: 5.2,
        currentSpeed: 0,
        facingAngle: 0,
        animation: "idle",
        animationTime: 0,
        actionProgress: 0,
        basePosition: { x: 3.5, y: 0, z: -3 },
        zone: { minimumX: -23, maximumX: 23, minimumZ: -13, maximumZ: 13 },
        tacticalIntent: "HoldingPosition",
        ...overrides
    };
}

function makeBehaviorCtx(overrides = {}) {
    return {
        attackingTeam: "home",
        style: "Balanced",
        scenario: "DirectAttack",
        phase: "BuildUp",
        ballPosition: { x: 0, y: 0.55, z: 0 },
        ballOwnerId: "home-attacker",
        phaseElapsed: 0,
        seed: 12345,
        playIndex: 1,
        ...overrides
    };
}

const multiPlayerScenario = {
    id: "test-multi",
    type: "DirectAttack",
    attackingTeam: "home",
    expectedOutcome: "Goal",
    actions: [
        { kind: "PlayerAction", type: "MoveTo", playerId: "home-attacker", team: "home", duration: 0.5, target: { x: 15, y: 0, z: 0 } },
        { kind: "PlayerAction", type: "SupportRun", playerId: "home-midfielder", team: "home", duration: 0.5, target: { x: 10, y: 0, z: 2 } },
        { kind: "BallAction", type: "ShootToGoal", team: "home", duration: 0.5 }
    ]
};

function advanceFrames(ac, totalSeconds, ctxFn) {
    const frames = Math.ceil(totalSeconds / 0.1) + 1;
    for (let i = 0; i < frames; i++) {
        const result = ac.update(0.1, ctxFn ? ctxFn() : makeCtx());
        if (result.completed) break;
    }
}

// ========== TEST 1: Current action player is controlled ==========
{
    const ac = new ActionController();
    ac.startScenario(multiPlayerScenario);
    assert.equal(ac.isPlayerControlled("home-attacker"), true, "Player in current action should be controlled");
    assert.equal(ac.isPlayerControlled("home-midfielder"), false, "Player only in future action should NOT be controlled");
    assert.equal(ac.isPlayerControlled("home-defender"), false);
}

// ========== TEST 2: Player only in distant action is NOT controlled ==========
{
    const ac = new ActionController();
    ac.startScenario(multiPlayerScenario);
    const ids = ac.getControlledPlayerIds();
    assert.ok(ids.has("home-attacker"), "Current action player should be in controlled set");
    assert.equal(ids.has("home-midfielder"), false, "Player only in future action should NOT be in controlled set");
    assert.equal(ids.has("home-defender"), false);
}

// ========== TEST 3: Next action player controlled when current action is imminent ==========
{
    const ac = new ActionController();
    ac.startScenario(multiPlayerScenario);
    // Current action: MoveTo home-attacker (0.5s duration)
    // At progress 0%, next action player NOT controlled
    assert.equal(ac.isPlayerControlled("home-midfielder"), false);
    // Advance to >70% of 0.5s = >0.35s
    for (let i = 0; i < 4; i++) ac.update(0.1, makeCtx());
    // Now actionProgress should be >= 0.7, next action imminent
    assert.equal(ac.isPlayerControlled("home-midfielder"), true, "Next action player should be controlled when current action is imminent");
}

// ========== TEST 4: Controlled set updates as actions complete ==========
{
    const ac = new ActionController();
    ac.startScenario(multiPlayerScenario);
    for (let i = 0; i < 5; i++) ac.update(0.1, makeCtx());
    // After 0.5s, MoveTo (attacker) completed, SupportRun (midfielder) starts
    const ids = ac.getControlledPlayerIds();
    assert.equal(ids.has("home-attacker"), false, "Attacker should not be controlled after MoveTo completes");
    assert.ok(ids.has("home-midfielder"), "Midfielder should be controlled during SupportRun");
}

// ========== TEST 5: TeamBehavior skips ActionController-controlled players ==========
{
    const tb = new FuturebolTeamBehavior();
    const attacker = makePlayer({ id: "home-attacker", role: "attacker", basePosition: { x: 3.5, y: 0, z: -3 } });
    const midfielder = makePlayer({ id: "home-midfielder", role: "midfielder", basePosition: { x: 0, y: 0, z: -5 } });
    const defender = makePlayer({ id: "home-defender", role: "defender", basePosition: { x: -2, y: 0, z: -8 } });

    const ctx = makeBehaviorCtx();
    const resultAttacker = tb.computePlayerBehavior(attacker, ctx);
    const resultMidfielder = tb.computePlayerBehavior(midfielder, ctx);
    const resultDefender = tb.computePlayerBehavior(defender, ctx);

    assert.ok(Number.isFinite(resultAttacker.targetX));
    assert.ok(Number.isFinite(resultAttacker.targetZ));
    assert.ok(Number.isFinite(resultMidfielder.targetX));
    assert.ok(Number.isFinite(resultMidfielder.targetZ));
    assert.ok(Number.isFinite(resultDefender.targetX));
    assert.ok(Number.isFinite(resultDefender.targetZ));
}

// ========== TEST 6: Match-state arbitration excludes controlled players ==========
{
    const ac = new ActionController();
    ac.startScenario(multiPlayerScenario);
    const controlledIds = ac.getControlledPlayerIds();
    assert.ok(controlledIds.has("home-attacker"));
    assert.equal(controlledIds.has("home-midfielder"), false);
    assert.equal(controlledIds.has("home-defender"), false);

    const players = [
        makePlayer({ id: "home-attacker", role: "attacker" }),
        makePlayer({ id: "home-midfielder", role: "midfielder" }),
        makePlayer({ id: "home-defender", role: "defender" })
    ];

    const tb = new FuturebolTeamBehavior();
    const ctx = makeBehaviorCtx();
    for (const player of players) {
        if (controlledIds.has(player.id)) continue;
        const output = tb.computePlayerBehavior(player, ctx);
        player.targetPosition.x = output.targetX;
        player.targetPosition.z = output.targetZ;
    }

    // Defender was updated by TeamBehavior
    assert.ok(Number.isFinite(players[2].targetPosition.x));
    // Attacker was skipped by TeamBehavior (still at original)
    assert.equal(players[0].targetPosition.x, 5);
    // Midfielder was NOT controlled (distant action), so TeamBehavior updated it
    assert.ok(Number.isFinite(players[1].targetPosition.x));
}

// ========== TEST 7: Cancel clears ownership ==========
{
    const ac = new ActionController();
    ac.startScenario(multiPlayerScenario);
    assert.equal(ac.isPlayerControlled("home-attacker"), true);
    ac.cancel();
    assert.equal(ac.isPlayerControlled("home-attacker"), false);
    assert.equal(ac.getControlledPlayerIds().size, 0);
}

// ========== TEST 8: Scenario finish clears ownership ==========
{
    const shortScenario = {
        id: "test-short",
        type: "DirectAttack",
        attackingTeam: "home",
        expectedOutcome: "Goal",
        actions: [
            { kind: "PlayerAction", type: "MoveTo", playerId: "home-attacker", team: "home", duration: 0.3, target: { x: 10, y: 0, z: 0 } }
        ]
    };
    const ac = new ActionController();
    ac.startScenario(shortScenario);
    assert.equal(ac.isPlayerControlled("home-attacker"), true);
    for (let i = 0; i < 4; i++) ac.update(0.1, makeCtx());
    assert.equal(ac.isPlayerControlled("home-attacker"), false);
    assert.equal(ac.getControlledPlayerIds().size, 0);
}

// ========== TEST 9: No NaN/Infinity ==========
{
    const tb = new FuturebolTeamBehavior();
    const ctx = makeBehaviorCtx();
    const roles = ["attacker", "midfielder", "defender"];
    for (const role of roles) {
        const player = makePlayer({ id: `home-${role}`, role, basePosition: { x: Math.random() * 10, y: 0, z: Math.random() * 5 } });
        const result = tb.computePlayerBehavior(player, ctx);
        assert.ok(Number.isFinite(result.targetX), `targetX must be finite for ${role}`);
        assert.ok(Number.isFinite(result.targetZ), `targetZ must be finite for ${role}`);
        assert.ok(Number.isFinite(result.speedFactor), `speedFactor must be finite for ${role}`);
        assert.ok(result.speedFactor >= 0, `speedFactor must be non-negative for ${role}`);
    }
}

// ========== TEST 10: BallAction with targetPlayerId marks current receiver ==========
{
    const passScenario = {
        id: "test-pass",
        type: "GiveAndGo",
        attackingTeam: "home",
        expectedOutcome: "Goal",
        actions: [
            { kind: "BallAction", type: "PassToPlayer", team: "home", duration: 0.5, targetPlayerId: "home-attacker", target: { x: 10, y: 0.55, z: 0 } }
        ]
    };
    const ac = new ActionController();
    ac.startScenario(passScenario);
    const ids = ac.getControlledPlayerIds();
    assert.equal(ids.size, 1);
    assert.ok(ids.has("home-attacker"));
}

// ========== TEST 10b: BallAction without targetPlayerId marks nobody ==========
{
    const shootScenario = {
        id: "test-shoot",
        type: "DirectAttack",
        attackingTeam: "home",
        expectedOutcome: "Goal",
        actions: [
            { kind: "BallAction", type: "ShootToGoal", team: "home", duration: 0.5 }
        ]
    };
    const ac = new ActionController();
    ac.startScenario(shootScenario);
    assert.equal(ac.getControlledPlayerIds().size, 0);
}

// ========== TEST 11: Inactive controller returns empty ==========
{
    const ac = new ActionController();
    assert.equal(ac.isPlayerControlled("home-attacker"), false);
    assert.equal(ac.getControlledPlayerIds().size, 0);
}

// ========== TEST 12: Intent stability ==========
{
    const tb = new FuturebolTeamBehavior();
    const player = makePlayer({ id: "home-attacker", role: "attacker", basePosition: { x: 3.5, y: 0, z: -3 } });
    const ctx = makeBehaviorCtx();
    const r1 = tb.computePlayerBehavior(player, ctx);
    const r2 = tb.computePlayerBehavior(player, ctx);
    assert.equal(r1.intent, r2.intent);
}

// ========== TEST 13: Intent stable within phase ==========
{
    const tb = new FuturebolTeamBehavior();
    const player = makePlayer({ id: "home-attacker", role: "attacker", basePosition: { x: 3.5, y: 0, z: -3 } });
    const ctx1 = makeBehaviorCtx({ phase: "BuildUp", phaseElapsed: 0 });
    const ctx2 = makeBehaviorCtx({ phase: "BuildUp", phaseElapsed: 1 });
    const r1 = tb.computePlayerBehavior(player, ctx1);
    const r2 = tb.computePlayerBehavior(player, ctx2);
    assert.equal(r1.intent, r2.intent);
}

// ========== TEST 14: Intent valid on phase transition ==========
{
    const tb = new FuturebolTeamBehavior();
    const player = makePlayer({ id: "home-attacker", role: "attacker", basePosition: { x: 3.5, y: 0, z: -3 } });
    const r1 = tb.computePlayerBehavior(player, makeBehaviorCtx({ phase: "BuildUp" }));
    const r2 = tb.computePlayerBehavior(player, makeBehaviorCtx({ phase: "Attacking" }));
    assert.ok(r1.intent);
    assert.ok(r2.intent);
}

// ========== TEST 15: Behavior hints override scenario defaults ==========
{
    const tb = new FuturebolTeamBehavior();
    const player = makePlayer({ id: "home-attacker", role: "attacker", basePosition: { x: 3.5, y: 0, z: -3 } });
    const rDefault = tb.computePlayerBehavior(player, makeBehaviorCtx({ scenario: "DirectAttack", ballOwnerId: null }));
    assert.ok(rDefault.intent);
    assert.ok(Number.isFinite(rDefault.targetX));
    assert.ok(Number.isFinite(rDefault.targetZ));

    const rHint = tb.computePlayerBehavior(player, makeBehaviorCtx({
        scenario: "DirectAttack", ballOwnerId: null,
        behaviorHints: { attacker: "HoldPosition" }
    }));
    assert.equal(rHint.intent, "HoldPosition");
    assert.ok(Number.isFinite(rHint.targetX));
    assert.ok(Number.isFinite(rHint.targetZ));
}

// ========== TEST 16: ThroughBall — ATT free at start, gets RunInBehind ==========
{
    const throughBallScenario = {
        id: "throughball-home-1",
        type: "ThroughBall",
        attackingTeam: "home",
        expectedOutcome: "Goal",
        behaviorHints: { attacker: "RunInBehind", defender: "Support" },
        actions: [
            { kind: "TeamAction", type: "PressForward", team: "home", duration: 1.2 },
            { kind: "PlayerAction", type: "MoveTo", playerId: "home-defender", team: "home", duration: 1.0, target: { x: 8, z: 1 } },
            { kind: "PlayerAction", type: "RunTo", playerId: "home-attacker", team: "home", duration: 1.6, target: { x: 21, z: 0 } },
            { kind: "BallAction", type: "PassToPlayer", team: "home", duration: 0.85, targetPlayerId: "home-attacker", target: { x: 17, z: 0 } },
            { kind: "PlayerAction", type: "Dribble", playerId: "home-attacker", team: "home", duration: 0.8, target: { x: 21, z: 0 } },
            { kind: "BallAction", type: "ShootToGoal", team: "home", duration: 0.76 },
            { kind: "PlayerAction", type: "Celebrate", playerId: "home-attacker", team: "home", duration: 1.0 }
        ]
    };

    const ac = new ActionController();
    ac.startScenario(throughBallScenario);

    // At index 0 (PressForward): attacker is NOT controlled
    assert.equal(ac.isPlayerControlled("home-attacker"), false, "ATT should be free at PressForward");
    assert.equal(ac.isPlayerControlled("home-defender"), false, "DEF should be free at PressForward");

    // TeamBehavior gives ATT RunInBehind
    const tb = new FuturebolTeamBehavior();
    const attacker = makePlayer({ id: "home-attacker", role: "attacker", basePosition: { x: 3.5, y: 0, z: -3 } });
    const ctx = makeBehaviorCtx({ scenario: "ThroughBall", ballOwnerId: null, behaviorHints: { attacker: "RunInBehind" } });
    const result = tb.computePlayerBehavior(attacker, ctx);
    assert.equal(result.intent, "RunInBehind", "ATT should get RunInBehind hint while free");
}

// ========== TEST 17: ThroughBall — ATT becomes controlled at RunTo ==========
{
    const throughBallScenario = {
        id: "throughball-home-2",
        type: "ThroughBall",
        attackingTeam: "home",
        expectedOutcome: "Goal",
        actions: [
            { kind: "TeamAction", type: "PressForward", team: "home", duration: 1.2 },
            { kind: "PlayerAction", type: "MoveTo", playerId: "home-defender", team: "home", duration: 1.0, target: { x: 8, z: 1 } },
            { kind: "PlayerAction", type: "RunTo", playerId: "home-attacker", team: "home", duration: 1.6, target: { x: 21, z: 0 } },
            { kind: "BallAction", type: "PassToPlayer", team: "home", duration: 0.85, targetPlayerId: "home-attacker", target: { x: 17, z: 0 } },
            { kind: "PlayerAction", type: "Dribble", playerId: "home-attacker", team: "home", duration: 0.8, target: { x: 21, z: 0 } },
            { kind: "BallAction", type: "ShootToGoal", team: "home", duration: 0.76 },
            { kind: "PlayerAction", type: "Celebrate", playerId: "home-attacker", team: "home", duration: 1.0 }
        ]
    };

    const ac = new ActionController();
    ac.startScenario(throughBallScenario);

    // Advance past PressForward (1.2s) + MoveTo DEF (1.0s) = 2.2s to reach RunTo ATT
    advanceFrames(ac, 2.3, makeCtx);
    assert.equal(ac.isPlayerControlled("home-attacker"), true, "ATT should be controlled during RunTo");
    assert.equal(ac.currentAction?.type, "RunTo");
}

// ========== TEST 18: GiveAndGo — Passador released after PassToPlayer ==========
{
    const giveAndGoScenario = {
        id: "giveandgo-home-1",
        type: "GiveAndGo",
        attackingTeam: "home",
        expectedOutcome: "Goal",
        behaviorHints: { attacker: "RunInBehind", defender: "Support" },
        actions: [
            { kind: "TeamAction", type: "PressForward", team: "home", duration: 1.5 },
            { kind: "PlayerAction", type: "MoveTo", playerId: "home-attacker", team: "home", duration: 1.0, target: { x: 6, z: 0 } },
            { kind: "PlayerAction", type: "MoveTo", playerId: "home-defender", team: "home", duration: 1.0, target: { x: 9, z: 2 } },
            { kind: "BallAction", type: "PassToPlayer", team: "home", duration: 0.92, targetPlayerId: "home-defender", target: { x: 11, z: 2 } },
            { kind: "PlayerAction", type: "RunTo", playerId: "home-attacker", team: "home", duration: 1.4, target: { x: 19, z: 0 } },
            { kind: "BallAction", type: "PassToPlayer", team: "home", duration: 0.92, targetPlayerId: "home-attacker", target: { x: 20, z: 0 } },
            { kind: "PlayerAction", type: "Dribble", playerId: "home-attacker", team: "home", duration: 0.8, target: { x: 21, z: 0 } },
            { kind: "BallAction", type: "ShootToGoal", team: "home", duration: 0.76 },
            { kind: "PlayerAction", type: "Celebrate", playerId: "home-attacker", team: "home", duration: 1.0 }
        ]
    };

    const ac = new ActionController();
    ac.startScenario(giveAndGoScenario);

    // At index 0 (PressForward): attacker NOT controlled
    assert.equal(ac.isPlayerControlled("home-attacker"), false, "ATT free at PressForward");

    // Advance past PressForward(1.5) + MoveTo ATT(1.0) + MoveTo DEF(1.0) + PassTo DEF(0.92→1.0 timeout) = 4.5s
    // to reach ATT RunTo at index 4
    advanceFrames(ac, 4.6, makeCtx);
    assert.equal(ac.currentAction?.type, "RunTo", "Should be on ATT RunTo");
    assert.equal(ac.isPlayerControlled("home-attacker"), true, "ATT controlled during RunTo");

    // After RunTo completes (1.4→1.5 timeout), PassToPlayer ATT starts (index 5)
    advanceFrames(ac, 1.6, makeCtx);
    assert.equal(ac.currentAction?.type, "PassToPlayer", "Should be on PassToPlayer ATT");
    assert.equal(ac.isPlayerControlled("home-attacker"), true, "ATT controlled as pass receiver");
}

// ========== TEST 19: GiveAndGo — Attacker gets RunInBehind after pass to defender ==========
{
    const giveAndGoScenario = {
        id: "giveandgo-home-2",
        type: "GiveAndGo",
        attackingTeam: "home",
        expectedOutcome: "Goal",
        behaviorHints: { attacker: "RunInBehind", defender: "Support" },
        actions: [
            { kind: "TeamAction", type: "PressForward", team: "home", duration: 1.5 },
            { kind: "PlayerAction", type: "MoveTo", playerId: "home-attacker", team: "home", duration: 1.0, target: { x: 6, z: 0 } },
            { kind: "PlayerAction", type: "MoveTo", playerId: "home-defender", team: "home", duration: 1.0, target: { x: 9, z: 2 } },
            { kind: "BallAction", type: "PassToPlayer", team: "home", duration: 0.92, targetPlayerId: "home-defender", target: { x: 11, z: 2 } },
            { kind: "PlayerAction", type: "RunTo", playerId: "home-attacker", team: "home", duration: 1.4, target: { x: 19, z: 0 } },
            { kind: "BallAction", type: "PassToPlayer", team: "home", duration: 0.92, targetPlayerId: "home-attacker", target: { x: 20, z: 0 } },
            { kind: "PlayerAction", type: "Dribble", playerId: "home-attacker", team: "home", duration: 0.8, target: { x: 21, z: 0 } },
            { kind: "BallAction", type: "ShootToGoal", team: "home", duration: 0.76 },
            { kind: "PlayerAction", type: "Celebrate", playerId: "home-attacker", team: "home", duration: 1.0 }
        ]
    };

    const ac = new ActionController();
    ac.startScenario(giveAndGoScenario);

    // MoveTo ATT is index 1 (1.0s), after it completes we're at MoveTo DEF (index 2)
    // Total time to reach end of index 1: PressForward(1.5) + MoveTo ATT(1.0) = 2.5s
    advanceFrames(ac, 2.6, makeCtx);
    assert.equal(ac.currentAction?.type, "MoveTo", "Should be on MoveTo DEF");
    // ATT is not in current action (MoveTo DEF), not in next action (PassToPlayer DEF at index 3)
    assert.equal(ac.isPlayerControlled("home-attacker"), false, "ATT free after MoveTo completes");

    // TeamBehavior should give ATT RunInBehind while free
    const tb = new FuturebolTeamBehavior();
    const attacker = makePlayer({ id: "home-attacker", role: "attacker", basePosition: { x: 3.5, y: 0, z: -3 } });
    const ctx = makeBehaviorCtx({ scenario: "GiveAndGo", ballOwnerId: null, behaviorHints: { attacker: "RunInBehind" } });
    const result = tb.computePlayerBehavior(attacker, ctx);
    assert.equal(result.intent, "RunInBehind", "ATT gets RunInBehind while free");
}

// ========== TEST 20: Behavior hint not overwritten by heuristic ==========
{
    const tb = new FuturebolTeamBehavior();
    const player = makePlayer({ id: "home-attacker", role: "attacker", basePosition: { x: 3.5, y: 0, z: -3 } });
    const ctx = makeBehaviorCtx({
        scenario: "DirectAttack",
        ballOwnerId: null,
        behaviorHints: { attacker: "HoldPosition" }
    });
    const result = tb.computePlayerBehavior(player, ctx);
    assert.equal(result.intent, "HoldPosition", "Hint must not be overwritten by positional heuristic");
    assert.ok(Number.isFinite(result.targetX));
    assert.ok(Number.isFinite(result.targetZ));
}

// ========== TEST 21: Ownership transfer produces valid targets ==========
{
    const tb = new FuturebolTeamBehavior();
    const attacker = makePlayer({ id: "home-attacker", role: "attacker", basePosition: { x: 3.5, y: 0, z: -3 } });
    const ctx = makeBehaviorCtx({ scenario: "ThroughBall", ballOwnerId: null });
    const result = tb.computePlayerBehavior(attacker, ctx);
    assert.ok(Number.isFinite(result.targetX), "targetX must be finite");
    assert.ok(Number.isFinite(result.targetZ), "targetZ must be finite");
    assert.ok(result.speedFactor >= 0, "speedFactor must be non-negative");
}

// ========== TEST 22: RequiredOutcome preserved (no mutation) ==========
{
    const ac = new ActionController();
    const scenario = {
        id: "test-required",
        type: "DirectAttack",
        attackingTeam: "home",
        expectedOutcome: "Goal",
        actions: [
            { kind: "BallAction", type: "ShootToGoal", team: "home", duration: 0.5 }
        ]
    };
    ac.startScenario(scenario);
    assert.equal(ac.currentScenario?.expectedOutcome, "Goal");
    ac.update(0.1, makeCtx());
    assert.equal(ac.currentScenario?.expectedOutcome, "Goal");
}

// ========== TEST 23: Official goal not affected by ownership ==========
{
    const ac = new ActionController();
    const scenario = {
        id: "test-goal",
        type: "DirectAttack",
        attackingTeam: "home",
        expectedOutcome: "Goal",
        actions: [
            { kind: "BallAction", type: "ShootToGoal", team: "home", duration: 0.5 }
        ]
    };
    ac.startScenario(scenario);
    const diag = ac.diagnostics();
    assert.equal(diag.officialGoal, true);
}

// ========== TEST 24: Replay not affected ==========
{
    const ac = new ActionController();
    const scenario = {
        id: "test-replay",
        type: "DirectAttack",
        attackingTeam: "home",
        expectedOutcome: "Goal",
        actions: [
            { kind: "BallAction", type: "ShootToGoal", team: "home", duration: 0.5 }
        ]
    };
    ac.startScenario(scenario);
    // Start → update → complete → all clean
    advanceFrames(ac, 0.5, makeCtx);
    assert.equal(ac.isActive, false, "Scenario should complete cleanly");
}

// ========== TEST 25: Next-action preparation with imminent threshold ==========
{
    const scenario = {
        id: "test-imminent",
        type: "DirectAttack",
        attackingTeam: "home",
        expectedOutcome: "Goal",
        actions: [
            { kind: "PlayerAction", type: "MoveTo", playerId: "home-attacker", team: "home", duration: 1.0, target: { x: 10, z: 0 } },
            { kind: "PlayerAction", type: "RunTo", playerId: "home-midfielder", team: "home", duration: 1.0, target: { x: 15, z: 2 } }
        ]
    };
    const ac = new ActionController();
    ac.startScenario(scenario);

    // At 50% progress (< 70%): next action player NOT controlled
    advanceFrames(ac, 0.5, makeCtx);
    assert.equal(ac.isPlayerControlled("home-midfielder"), false, "Next action player not controlled before 70%");

    // At 80% progress (> 70%): next action player controlled
    advanceFrames(ac, 0.3, makeCtx);
    assert.equal(ac.isPlayerControlled("home-midfielder"), true, "Next action player controlled after 70%");
}

// ========== TEST 26: PassToPlayer receiver only controlled during PassToPlayer ==========
{
    const scenario = {
        id: "test-pass-recv",
        type: "GiveAndGo",
        attackingTeam: "home",
        expectedOutcome: "Goal",
        actions: [
            { kind: "PlayerAction", type: "MoveTo", playerId: "home-defender", team: "home", duration: 0.5, target: { x: 10, z: 2 } },
            { kind: "BallAction", type: "PassToPlayer", team: "home", duration: 0.5, targetPlayerId: "home-attacker", target: { x: 12, z: 0 } },
            { kind: "PlayerAction", type: "MoveTo", playerId: "home-attacker", team: "home", duration: 0.5, target: { x: 15, z: 0 } }
        ]
    };
    const ac = new ActionController();
    ac.startScenario(scenario);

    // Before PassToPlayer (during MoveTo DEF): ATT NOT controlled
    assert.equal(ac.isPlayerControlled("home-attacker"), false, "ATT free before pass");

    // During PassToPlayer: ATT controlled as receiver
    advanceFrames(ac, 0.5, makeCtx);
    assert.equal(ac.currentAction?.type, "PassToPlayer");
    assert.equal(ac.isPlayerControlled("home-attacker"), true, "ATT controlled during pass");
}

// ========== TEST 27: TeamAction does NOT mark individual players ==========
{
    const scenario = {
        id: "test-team",
        type: "DirectAttack",
        attackingTeam: "home",
        expectedOutcome: "Goal",
        actions: [
            { kind: "TeamAction", type: "PressForward", team: "home", duration: 1.0 },
            { kind: "PlayerAction", type: "MoveTo", playerId: "home-attacker", team: "home", duration: 0.5, target: { x: 10, z: 0 } }
        ]
    };
    const ac = new ActionController();
    ac.startScenario(scenario);
    // TeamAction at index 0: no individual player controlled
    const ids = ac.getControlledPlayerIds();
    assert.equal(ids.size, 0, "TeamAction should not mark individual players");
    assert.equal(ac.isPlayerControlled("home-attacker"), false);
}

// ========== TEST 28: No target invalidity after ownership change ==========
{
    const tb = new FuturebolTeamBehavior();
    const attacker = makePlayer({ id: "home-attacker", role: "attacker", basePosition: { x: 3.5, y: 0, z: -3 } });
    const midfielder = makePlayer({ id: "home-midfielder", role: "midfielder", basePosition: { x: 0, y: 0, z: -5 } });
    const defender = makePlayer({ id: "home-defender", role: "defender", basePosition: { x: -2, y: 0, z: -8 } });
    const scenarios = ["DirectAttack", "GiveAndGo", "ThroughBall", "CounterAttack", "WingAttack", "LongShot", "PressureAttack"];
    for (const scenario of scenarios) {
        for (const player of [attacker, midfielder, defender]) {
            const ctx = makeBehaviorCtx({ scenario, ballOwnerId: null });
            const result = tb.computePlayerBehavior(player, ctx);
            assert.ok(Number.isFinite(result.targetX), `${scenario} ${player.role} targetX must be finite`);
            assert.ok(Number.isFinite(result.targetZ), `${scenario} ${player.role} targetZ must be finite`);
        }
    }
}

console.log("ActionController/TeamBehavior arbitration tests passed.");
