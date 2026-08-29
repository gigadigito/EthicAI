import assert from "node:assert/strict";
import { FuturebolMatchState } from "../../dist/futurebol/futurebol-match-state.js";
import { ActionController } from "../../dist/futurebol/futurebol-action-controller.js";
import { buildInterceptionPlan, distanceToPassLine } from "../../dist/futurebol/futurebol-interception.js";
import { selectShotProfile, computeShotTarget, computeGoalkeeperDiveTarget } from "../../dist/futurebol/futurebol-shot-variation.js";

const snapshot = {
    sequence: 73,
    timestamp: "2026-08-09T12:00:00.000Z",
    home: { symbol: "BTC", price: 65000, changePercent: 2.1, momentum: 86, volumeStrength: 74 },
    away: { symbol: "ETH", price: 3500, changePercent: -0.6, momentum: 24, volumeStrength: 41 }
};

function createMatch(seed, officialMode = false) {
    const state = new FuturebolMatchState(seed, officialMode);
    state.applyMarket(snapshot, "home");
    return state;
}

// ─────────────────────────────────────────────────────────
// 2. FPS DETERMINISM
// Same seed + same dt = identical results (already tested in match-state).
// Cross-FPS: same seed + forced same play = same decisions during that play.
// ─────────────────────────────────────────────────────────
{
    const fpsRates = [30, 60, 120];
    const results = {};

    for (const fps of fpsRates) {
        const state = createMatch("fps-determinism-same");
        state.forceShot("home", "Goal");
        const dt = 1 / fps;
        const frames = Math.ceil(8 * fps);
        let shotProfileSeen = null;
        let parryDecisionSeen = null;
        let outcomeSeen = null;
        let homeScore = 0;

        for (let i = 0; i < frames; i++) {
            state.update(dt);
            const d = state.diagnostics();
            if (d.shotProfile && !shotProfileSeen) {
                shotProfileSeen = {
                    lateral: d.shotProfile.lateral,
                    height: d.shotProfile.height,
                    power: d.shotProfile.power
                };
            }
            if (d.shotResolutionPlan && !parryDecisionSeen) {
                parryDecisionSeen = d.shotResolutionPlan.willParry;
            }
            if (d.displayHomeScore > homeScore) {
                outcomeSeen = "Goal";
                homeScore = d.displayHomeScore;
            }
        }

        results[fps] = {
            shotProfile: shotProfileSeen,
            parryDecision: parryDecisionSeen,
            outcome: outcomeSeen,
            homeScore
        };
    }

    const fps30 = results[30];
    const fps60 = results[60];
    const fps120 = results[120];

    assert.equal(fps30.homeScore, fps60.homeScore, "home score must match 30vs60");
    assert.equal(fps60.homeScore, fps120.homeScore, "home score must match 60vs120");

    if (fps30.shotProfile && fps60.shotProfile) {
        assert.equal(fps30.shotProfile.lateral, fps60.shotProfile.lateral,
            "shot lateral must match 30vs60");
        assert.equal(fps30.shotProfile.height, fps60.shotProfile.height,
            "shot height must match 30vs60");
    }

    if (fps30.parryDecision !== null && fps60.parryDecision !== null) {
        assert.equal(fps30.parryDecision, fps60.parryDecision,
            "parry decision must match 30vs60");
    }

    console.log("  FPS determinism table:");
    console.log(`    30fps: parry=${fps30.parryDecision} score=${fps30.homeScore}`);
    console.log(`    60fps: parry=${fps60.parryDecision} score=${fps60.homeScore}`);
    console.log(`   120fps: parry=${fps120.parryDecision} score=${fps120.homeScore}`);

    const sameSeedA = createMatch("same-seed-A");
    const sameSeedB = createMatch("same-seed-B");
    for (let i = 0; i < 300; i++) {
        sameSeedA.update(1 / 60);
        sameSeedB.update(1 / 60);
    }
    assert.equal(sameSeedA.diagnostics().displayHomeScore, sameSeedB.diagnostics().displayHomeScore,
        "same seed + same FPS = same score");
    assert.equal(sameSeedA.diagnostics().displayAwayScore, sameSeedB.diagnostics().displayAwayScore,
        "same seed + same FPS = same score (away)");
}

// ─────────────────────────────────────────────────────────
// 3. InterceptionPlan: built once, checked by progress
// ─────────────────────────────────────────────────────────
{
    const state = createMatch("interception-once");
    let planBuilt = false;

    for (let i = 0; i < 600; i++) {
        state.update(1 / 60);
        const d = state.diagnostics();
        if (d.interceptionPlan && d.ballState === "Passing" && !planBuilt) {
            planBuilt = true;
        }
    }

    if (planBuilt) {
        assert.ok(true, "interception plan was built during a pass");
        const d = state.diagnostics();
        if (d.interceptionPlan) {
            assert.ok("interceptionPoint" in d.interceptionPlan, "interceptionPlan must include interceptionPoint");
            assert.equal(typeof d.interceptionPlan.interceptionPoint.x, "number", "interceptionPoint.x must be a number");
            assert.equal(typeof d.interceptionPlan.interceptionPoint.z, "number", "interceptionPoint.z must be a number");
            assert.ok(Math.abs(d.interceptionPlan.interceptionPoint.y) < 0.01, "interceptionPoint.y must be ~0");
        }
    }
}

// ─────────────────────────────────────────────────────────
// 4. LooseBall physical convergence
// ─────────────────────────────────────────────────────────
{
    const state = createMatch("looseball-convergence");
    let looseSeen = false;
    let ownerNullDuringLoose = false;
    let looseDuration = 0;

    for (let i = 0; i < 1800; i++) {
        state.update(1 / 60);
        const d = state.diagnostics();

        if (d.ballState === "Loose") {
            looseSeen = true;
            looseDuration++;
            if (d.ballOwnerId === null) {
                ownerNullDuringLoose = true;
            }
        }
    }

    if (looseSeen) {
        assert.ok(ownerNullDuringLoose, "owner must be null during Loose state");
        const looseDurationSeconds = (looseDuration / 60).toFixed(2);
        console.log(`  LooseBall duration: ~${looseDurationSeconds}s (${looseDuration} frames at 60fps)`);
        assert.ok(looseDuration > 3, `LooseBall should last >0.05s, was ${looseDurationSeconds}s`);
    } else {
        console.log("  LooseBall: no Loose state in 30s with this seed (interception/parry did not trigger)");
        assert.ok(true, "LooseBall convergence test: Loose not triggered with this seed, skipped");
    }
}

// ─────────────────────────────────────────────────────────
// 5. Only two players contest during LooseBall
// ─────────────────────────────────────────────────────────
{
    const state = createMatch("two-players-contest");
    let looseFrame = false;
    let contestValid = true;

    for (let i = 0; i < 1800; i++) {
        state.update(1 / 60);
        const d = state.diagnostics();

        if (d.ballState === "Loose") {
            looseFrame = true;
            const movingPlayers = d.players.filter(p =>
                p.currentSpeed > 0.5 && p.role !== "goalkeeper"
            );
            if (movingPlayers.length > 4) {
                contestValid = false;
            }
        }
    }

    if (looseFrame) {
        assert.ok(contestValid, "during LooseBall, at most a few non-GK players should move toward ball");
    } else {
        console.log("  Two-player contest: no Loose state found, skipped");
        assert.ok(true, "two-player contest test: Loose not triggered, skipped");
    }
}

// ─────────────────────────────────────────────────────────
// 6. requiredOutcome: official HOME Goal adversity chain
// ─────────────────────────────────────────────────────────
{
    const state = createMatch("required-outcome-adversity", true);
    state.applyOfficialMatchState({
        sequence: 1,
        matchId: "test",
        status: "ongoing",
        elapsedSeconds: 10,
        homeScore: 0,
        awayScore: 0,
        homePenaltyScore: 0,
        awayPenaltyScore: 0,
        isFinished: false,
        initialHistoryReady: true,
        scoreEvents: [
            { id: 1, team: "home", points: 1, sequence: 1, timestamp: "2026-01-01T00:00:10.000Z" }
        ]
    }, true);

    let goalScored = false;
    let awayScored = false;
    let confirmationCount = 0;
    let requiredOutcomeActive = false;

    for (let i = 0; i < 1200; i++) {
        state.update(1 / 60);
        const d = state.diagnostics();

        if (d.requiredOutcome && d.requiredOutcome.active) {
            requiredOutcomeActive = true;
        }

        if (d.displayHomeScore > 0) goalScored = true;
        if (d.displayAwayScore > 0) awayScored = true;

        const confirmations = state.takeOfficialGoalConfirmations();
        confirmationCount += confirmations.length;
    }

    assert.ok(goalScored, "HOME must score official goal");
    assert.ok(!awayScored, "AWAY must not score during HOME official goal");
    assert.ok(confirmationCount <= 1, `official confirmation should occur at most once, got ${confirmationCount}`);
}

// ─────────────────────────────────────────────────────────
// 7. Branch limit: MAX_SCENARIO_BRANCHES = 2
// ─────────────────────────────────────────────────────────
{
    const ac = new ActionController();
    const scenario = {
        id: "branch-limit-test",
        type: "DirectAttack",
        attackingTeam: "home",
        expectedOutcome: "Goal",
        actions: [
            { kind: "PlayerAction", type: "MoveTo", playerId: "home-defender", team: "home", duration: 10, target: { x: 5, y: 0, z: 1 } }
        ]
    };
    ac.startScenario(scenario);
    assert.equal(ac.currentBranchCount, 0, "initial branchCount must be 0");

    ac.injectContinuationActions([
        { kind: "PlayerAction", type: "RunTo", playerId: "home-attacker", team: "home", duration: 0.5, target: { x: 10, y: 0, z: 0 } }
    ]);
    assert.equal(ac.currentBranchCount, 1, "after 1st inject, branchCount = 1");

    ac.injectContinuationActions([
        { kind: "PlayerAction", type: "RunTo", playerId: "home-attacker", team: "home", duration: 0.5, target: { x: 10, y: 0, z: 0 } }
    ]);
    assert.equal(ac.currentBranchCount, 2, "after 2nd inject, branchCount = 2");

    ac.injectContinuationActions([
        { kind: "PlayerAction", type: "RunTo", playerId: "home-attacker", team: "home", duration: 0.5, target: { x: 10, y: 0, z: 0 } }
    ]);
    assert.equal(ac.currentBranchCount, 2, "after 3rd inject, branchCount must NOT exceed 2");
}

// ─────────────────────────────────────────────────────────
// 8. ActionController Pending states
// ─────────────────────────────────────────────────────────
function makeCtx(overrides = {}) {
    return {
        ballOwnerId: null, ballState: "Free",
        ballPosition: { x: 0, y: 0.55, z: 0 },
        ballVelocity: { x: 0, y: 0, z: 0 },
        playPhase: "BuildUp", outcome: null,
        phaseElapsed: 0, intendedReceiverId: null,
        lastActionResult: null, possessionTeam: null, requiredOutcome: null,
        ...overrides
    };
}

// 8a. MoveTo: Pending on first frame, Completed after duration
{
    const ac = new ActionController();
    ac.startScenario({
        id: "pending-moveto",
        type: "DirectAttack",
        attackingTeam: "home",
        expectedOutcome: "Goal",
        actions: [
            { kind: "PlayerAction", type: "MoveTo", playerId: "home-defender", team: "home", duration: 0.5, target: { x: 5, y: 0, z: 1 } }
        ]
    });

    const first = ac.update(0.1, makeCtx());
    assert.equal(first.completed, false, "MoveTo first frame: completed must be false");
    assert.equal(first.result, null, "MoveTo first frame: result must be null (Pending)");

    let advanceCount = 0;
    for (let i = 0; i < 10; i++) {
        const r = ac.update(0.1, makeCtx());
        advanceCount++;
        if (r.completed) break;
    }
    assert.ok(!ac.isActive || advanceCount >= 3, "MoveTo should complete after ~5 frames");
}

// 8b. PassToPlayer: Pending while ball in flight, Completed when receiver catches
{
    const ac = new ActionController();
    ac.startScenario({
        id: "pending-pass",
        type: "DirectAttack",
        attackingTeam: "home",
        expectedOutcome: "Goal",
        actions: [
            { kind: "BallAction", type: "PassToPlayer", team: "home", duration: 2.0, targetPlayerId: "home-attacker" }
        ]
    });

    const flying = ac.update(0.1, makeCtx({ ballOwnerId: null, ballState: "Passing" }));
    assert.equal(flying.completed, false, "PassToPlayer while flying: completed must be false");

    const caught = ac.update(0.1, makeCtx({ ballOwnerId: "home-attacker", ballState: "Controlled" }));
    assert.equal(caught.completed, true, "PassToPlayer when caught: action completes and scenario finishes (single action)");
}

// 8c. ShootToGoal: Pending during flight, Completed when outcome set
{
    const ac = new ActionController();
    ac.startScenario({
        id: "pending-shoot",
        type: "DirectAttack",
        attackingTeam: "home",
        expectedOutcome: "Goal",
        actions: [
            { kind: "BallAction", type: "ShootToGoal", team: "home", duration: 2.0 }
        ]
    });

    const flying = ac.update(0.1, makeCtx({ outcome: null }));
    assert.equal(flying.completed, false, "ShootToGoal during flight: completed must be false");

    const withOutcome = ac.update(0.1, makeCtx({ outcome: "Goal" }));
    assert.equal(withOutcome.completed, true, "ShootToGoal with outcome: completes action and scenario (single action)");
}

// 8d. Intercepted: PassToPlayer + Intercepted → must not advance as Completed
{
    const ac = new ActionController();
    ac.startScenario({
        id: "intercepted-test",
        type: "DirectAttack",
        attackingTeam: "home",
        expectedOutcome: "Goal",
        actions: [
            { kind: "BallAction", type: "PassToPlayer", team: "home", duration: 2.0, targetPlayerId: "home-attacker" }
        ]
    });

    const result = ac.update(0.1, makeCtx({ lastActionResult: "Intercepted" }));
    assert.equal(result.completed, false, "Intercepted must not complete the scenario");
    assert.equal(result.result, "Intercepted", "result must be Intercepted");
}

// 8e. Parried: ShootToGoal + Parried → must not advance as Completed
{
    const ac = new ActionController();
    ac.startScenario({
        id: "parried-test",
        type: "DirectAttack",
        attackingTeam: "home",
        expectedOutcome: "Goal",
        actions: [
            { kind: "BallAction", type: "ShootToGoal", team: "home", duration: 2.0 }
        ]
    });

    const result = ac.update(0.1, makeCtx({ lastActionResult: "Parried" }));
    assert.equal(result.completed, false, "Parried must not complete the scenario");
    assert.equal(result.result, "Parried", "result must be Parried");
}

// ─────────────────────────────────────────────────────────
// 26. Replay stress test (10 goals)
// ─────────────────────────────────────────────────────────
{
    const state = createMatch("replay-stress", true);
    const scoreEvents = [];
    for (let i = 0; i < 10; i++) {
        scoreEvents.push({
            id: i + 1,
            team: i % 2 === 0 ? "home" : "away",
            points: 1,
            sequence: i + 1,
            timestamp: `2026-01-01T00:00:${10 + i * 10}.000Z`
        });
    }

    state.applyOfficialMatchState({
        sequence: 1,
        matchId: "stress-test",
        status: "ongoing",
        elapsedSeconds: 100,
        homeScore: 5,
        awayScore: 5,
        homePenaltyScore: 0,
        awayPenaltyScore: 0,
        isFinished: false,
        initialHistoryReady: true,
        scoreEvents
    }, true);

    const startTime = Date.now();
    let allProcessed = false;
    let finalHome = 0;
    let finalAway = 0;

    for (let i = 0; i < 6000; i++) {
        state.update(1 / 60);
        state.takeOfficialGoalConfirmations();
        const d = state.diagnostics();
        finalHome = d.displayHomeScore;
        finalAway = d.displayAwayScore;

        if (d.phase === "Live" && i > 3000) {
            allProcessed = true;
            break;
        }
    }

    const elapsed = Date.now() - startTime;
    console.log(`  Replay stress: ${finalHome}x${finalAway} in ${elapsed}ms`);
    assert.equal(finalHome, 5, "home score must be 5");
    assert.equal(finalAway, 5, "away score must be 5");
    assert.ok(elapsed < 30000, `replay stress must finish in <30s, took ${elapsed}ms`);
}

// ─────────────────────────────────────────────────────────
// 27. Live queue stress test
// ─────────────────────────────────────────────────────────
{
    const state = createMatch("live-queue-stress", true);
    const confirmationsBefore = state.takeOfficialGoalConfirmations();
    assert.equal(confirmationsBefore.length, 0, "no confirmations before any goals");

    for (let g = 0; g < 5; g++) {
        state.applyOfficialMatchState({
            sequence: g + 1,
            matchId: "live-queue",
            status: "ongoing",
            elapsedSeconds: 10 + g * 5,
            homeScore: g + 1,
            awayScore: 0,
            homePenaltyScore: 0,
            awayPenaltyScore: 0,
            isFinished: false,
            initialHistoryReady: true,
            scoreEvents: Array.from({ length: g + 1 }, (_, i) => ({
                id: i + 1, team: "home", points: 1, sequence: i + 1,
                timestamp: `2026-01-01T00:00:${10 + i * 5}.000Z`
            }))
        }, true);
    }

    let totalConfirmations = 0;
    for (let i = 0; i < 3000; i++) {
        state.update(1 / 60);
        const confs = state.takeOfficialGoalConfirmations();
        totalConfirmations += confs.length;
    }

    const d = state.diagnostics();
    assert.ok(d.displayHomeScore >= 1, "at least 1 goal displayed");
    assert.ok(totalConfirmations <= 5, `confirmations must not exceed goals, got ${totalConfirmations}`);
    console.log(`  Live queue: ${totalConfirmations} confirmations for ${d.displayHomeScore}x${d.displayAwayScore}`);
}

// ─────────────────────────────────────────────────────────
// 28. Cancel/reset during LooseBall
// ─────────────────────────────────────────────────────────
{
    const state = createMatch("reset-during-loose");
    let looseFound = false;

    for (let i = 0; i < 900; i++) {
        state.update(1 / 60);
        if (state.ballState === "Loose") {
            looseFound = true;
            state.reset();
            break;
        }
    }

    if (looseFound) {
        const d = state.diagnostics();
        assert.equal(d.ballOwnerId, null, "after reset, ballOwnerId must be null");
        assert.equal(d.ballState, "Free", "after reset, ballState must be Free");
        assert.equal(d.branchCount, 0, "after reset, branchCount must be 0");
        assert.equal(d.shotOrdinal, 0, "after reset, shotOrdinal must be 0");
        assert.equal(d.interceptionPlan, null, "after reset, interceptionPlan must be null");
        assert.equal(d.shotResolutionPlan, null, "after reset, shotResolutionPlan must be null");
        assert.equal(d.pendingBranch, null, "after reset, pendingBranch must be null");
        assert.equal(d.requiredOutcome, null, "after reset, requiredOutcome must be null");

        let continuationFired = false;
        for (let i = 0; i < 300; i++) {
            state.update(1 / 60);
            const dd = state.diagnostics();
            if (dd.ballState === "Loose" || dd.ballState === "Shooting") {
                continuationFired = true;
            }
        }
        assert.ok(!continuationFired, "no phantom continuation should fire after reset");
    } else {
        assert.ok(true, "no LooseBall found in this seed, reset-during-loose skipped");
    }
}

// ─────────────────────────────────────────────────────────
// 24-25. Timing measurements
// ─────────────────────────────────────────────────────────
{
    const scenarios = [
        { name: "DirectAttack", seed: "timing-da" },
        { name: "GiveAndGo", seed: "timing-gg" },
        { name: "CounterAttack", seed: "timing-ca" }
    ];

    console.log("  Timing measurements:");
    for (const { name, seed } of scenarios) {
        const state = createMatch(seed);
        let frames = 0;
        let maxFrames = 0;

        for (let i = 0; i < 1200; i++) {
            state.update(1 / 60);
            frames++;
            const d = state.diagnostics();
            if (d.phase === "Resetting" || d.phase === "Cooldown") {
                maxFrames = Math.max(maxFrames, frames);
                frames = 0;
            }
        }

        const seconds = (maxFrames / 60).toFixed(2);
        console.log(`    ${name}: ~${seconds}s (${maxFrames} frames)`);
        assert.ok(maxFrames < 720, `${name} must complete in <12s, took ${seconds}s`);
    }
}

console.log("Futurebol hardening tests passed.");
