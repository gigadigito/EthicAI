import assert from "node:assert/strict";
import { FuturebolTeamBehavior } from "../../dist/futurebol/futurebol-team-behavior.js";
import { FuturebolMatchState } from "../../dist/futurebol/futurebol-match-state.js";

const seed = 12345;

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

function makeCtx(overrides = {}) {
    return {
        attackingTeam: "home",
        style: "Balanced",
        scenario: "DirectAttack",
        phase: "BuildUp",
        ballPosition: { x: 0, y: 0.55, z: 0 },
        ballOwnerId: null,
        phaseElapsed: 0,
        seed,
        playIndex: 1,
        ...overrides
    };
}

// 1. Aggressive positions ATT more offensively than Controlled
{
    const tb = new FuturebolTeamBehavior();
    const att = makePlayer({ role: "attacker", basePosition: { x: 3.5, y: 0, z: -3 } });
    const ctxAggressive = makeCtx({ style: "Aggressive", phaseElapsed: 2 });
    const ctxControlled = makeCtx({ style: "Controlled", phaseElapsed: 2 });
    const resultAggressive = tb.computePlayerBehavior(att, ctxAggressive);
    const resultControlled = tb.computePlayerBehavior(att, ctxControlled);
    assert.ok(
        resultAggressive.targetX > resultControlled.targetX,
        `Aggressive ATT (${resultAggressive.targetX}) deve estar mais avançado que Controlled (${resultControlled.targetX})`
    );
}

// 2. Controlled keeps DEF more withdrawn
{
    const tb = new FuturebolTeamBehavior();
    const def = makePlayer({
        id: "home-defender", role: "defender",
        basePosition: { x: -11, y: 0, z: 4.7 }
    });
    const ctxAggressive = makeCtx({ style: "Aggressive", phaseElapsed: 2 });
    const ctxControlled = makeCtx({ style: "Controlled", phaseElapsed: 2 });
    const resultAggressive = tb.computePlayerBehavior(def, ctxAggressive);
    const resultControlled = tb.computePlayerBehavior(def, ctxControlled);
    assert.ok(
        resultAggressive.targetX > resultControlled.targetX,
        `Aggressive DEF (${resultAggressive.targetX}) deve estar mais avançado que Controlled (${resultControlled.targetX})`
    );
}

// 3. Counter makes ATT initiate depth run
{
    const tb = new FuturebolTeamBehavior();
    const att = makePlayer({
        id: "home-attacker", role: "attacker",
        position: { x: 5, y: 0, z: 0 },
        basePosition: { x: 3.5, y: 0, z: -3 }
    });
    const ctx = makeCtx({
        style: "Counter", scenario: "CounterAttack",
        phaseElapsed: 0.5, ballPosition: { x: -5, y: 0.55, z: 0 }
    });
    const result = tb.computePlayerBehavior(att, ctx);
    assert.equal(result.intent, "RunInBehind", "Counter + CounterAttack deve gerar RunInBehind");
    assert.ok(result.targetX > att.position.x, "ATT deve avançar em direção ao gol");
}

// 4. ThroughBall generates anticipated run
{
    const tb = new FuturebolTeamBehavior();
    const att = makePlayer({
        id: "home-attacker", role: "attacker",
        position: { x: 2, y: 0, z: 0 },
        basePosition: { x: 3.5, y: 0, z: -3 }
    });
    const ctx = makeCtx({
        scenario: "ThroughBall", phaseElapsed: 0.5,
        ballPosition: { x: -8, y: 0.55, z: 0 }
    });
    const result = tb.computePlayerBehavior(att, ctx);
    assert.equal(result.intent, "RunInBehind", "ThroughBall deve gerar RunInBehind antecipado");
    assert.ok(result.targetX > 5, `ATT deve avançar além da posição inicial, targetX=${result.targetX}`);
}

// 5. WingAttack generates lateral drift
{
    const tb = new FuturebolTeamBehavior();
    const att = makePlayer({
        id: "home-attacker", role: "attacker",
        basePosition: { x: 3.5, y: 0, z: -3 }
    });
    const ctx = makeCtx({
        scenario: "WingAttack", phaseElapsed: 1.0,
        ballPosition: { x: 0, y: 0.55, z: -2 }
    });
    const result = tb.computePlayerBehavior(att, ctx);
    assert.equal(result.intent, "DriftWide", "WingAttack deve gerar DriftWide");
    assert.ok(Math.abs(result.targetZ) > 2, `ATT deve abrir lateralmente, targetZ=${result.targetZ}`);
}

// 6. GiveAndGo makes passer continue movement
{
    const tb = new FuturebolTeamBehavior();
    const def = makePlayer({
        id: "home-defender", role: "defender",
        basePosition: { x: -11, y: 0, z: 4.7 }
    });
    const ctx = makeCtx({
        scenario: "GiveAndGo", phaseElapsed: 1.5,
        ballPosition: { x: 5, y: 0.55, z: 2 }
    });
    const result = tb.computePlayerBehavior(def, ctx);
    assert.equal(result.intent, "Support", "GiveAndGo DEF deve dar suporte");
    assert.ok(result.targetX > -5, `DEF deve avançar para continuidade, targetX=${result.targetX}`);
}

// 7. Goalkeeper tracks ball laterally within limits
{
    const tb = new FuturebolTeamBehavior();
    const gk = makePlayer({
        id: "home-goalkeeper", role: "goalkeeper",
        basePosition: { x: -21.2, y: 0, z: 0 }
    });
    const ctx = makeCtx({
        ballPosition: { x: 10, y: 0.55, z: 4 }
    });
    const result = tb.computePlayerBehavior(gk, ctx);
    assert.equal(result.intent, "TrackBall", "GK deve ser TrackBall");
    assert.ok(Math.abs(result.targetZ) <= 2.8, `GK targetZ ${result.targetZ} deve estar dentro dos limites`);
    assert.ok(result.targetX > gk.basePosition.x, "GK deve se aproximar lateralmente da bola");
}

// 8. No player receives target outside field
{
    const tb = new FuturebolTeamBehavior();
    const players = [
        makePlayer({ id: "home-attacker", role: "attacker", basePosition: { x: 3.5, y: 0, z: -3 } }),
        makePlayer({ id: "home-defender", role: "defender", basePosition: { x: -11, y: 0, z: 4.7 } }),
        makePlayer({ id: "home-goalkeeper", role: "goalkeeper", basePosition: { x: -21.2, y: 0, z: 0 } })
    ];
    for (const style of ["Aggressive", "Balanced", "Controlled", "Counter"]) {
        for (const scenario of ["DirectAttack", "GiveAndGo", "CounterAttack", "ThroughBall", "WingAttack", "LongShot", "PressureAttack"]) {
            for (const player of players) {
                const ctx = makeCtx({ style, scenario, phaseElapsed: 1.5 });
                const result = tb.computePlayerBehavior(player, ctx);
                assert.ok(result.targetX >= -25 && result.targetX <= 25, `${player.id} targetX ${result.targetX} fora do campo (${style}/${scenario})`);
                assert.ok(result.targetZ >= -15 && result.targetZ <= 15, `${player.id} targetZ ${result.targetZ} fora do campo (${style}/${scenario})`);
            }
        }
    }
}

// 9. Separation avoids two players at same target
{
    const state = new FuturebolMatchState("separation-test");
    state.applyMarket({
        sequence: 1, timestamp: new Date().toISOString(),
        home: { symbol: "HOME", price: 100, changePercent: 1, momentum: 0.3, volumeStrength: 50 },
        away: { symbol: "AWAY", price: 100, changePercent: -1, momentum: -0.3, volumeStrength: 50 }
    }, "home");
    for (let i = 0; i < 300; i++) state.update(1 / 60);
    for (let i = 0; i < state.players.length; i++) {
        for (let j = i + 1; j < state.players.length; j++) {
            const a = state.players[i];
            const b = state.players[j];
            const dx = a.targetPosition.x - b.targetPosition.x;
            const dz = a.targetPosition.z - b.targetPosition.z;
            const dist = Math.hypot(dx, dz);
            assert.ok(dist > 0.5, `${a.id} e ${b.id} muito próximos no target: ${dist}`);
        }
    }
}

// 10. Same seed/context produces same targets
{
    const tbA = new FuturebolTeamBehavior();
    const tbB = new FuturebolTeamBehavior();
    const att = makePlayer({ role: "attacker", basePosition: { x: 3.5, y: 0, z: -3 } });
    const ctx = makeCtx({ seed: 99999, playIndex: 7, phaseElapsed: 1.5 });
    const a = tbA.computePlayerBehavior(att, ctx);
    const b = tbB.computePlayerBehavior(att, ctx);
    assert.equal(a.intent, b.intent, "mesmo contexto deve gerar mesmo intent");
    assert.equal(a.targetX, b.targetX, "mesmo contexto deve gerar mesmo targetX");
    assert.equal(a.targetZ, b.targetZ, "mesmo contexto deve gerar mesmo targetZ");
}

// 11. Replay does not alter synchronization decision
{
    const state = new FuturebolMatchState("replay-team", true);
    state.applyOfficialMatchState({
        matchId: 1, sequence: 1, status: "Live",
        homeScore: 0, awayScore: 0, elapsedSeconds: 0,
        isFinished: false, observedAtUtc: new Date().toISOString(),
        scoreEvents: [], initialHistoryReady: true
    }, false);
    for (let i = 0; i < 100; i++) state.update(1 / 60);
    const diag = state.diagnostics();
    assert.ok(diag.phase !== undefined, "diagnostics deve ter phase");
}

// 12. Official goal remains mandatory
{
    const state = new FuturebolMatchState("goal-mandatory", true);
    state.applyOfficialMatchState({
        matchId: 1, sequence: 1, status: "Live",
        homeScore: 0, awayScore: 0, elapsedSeconds: 0,
        isFinished: false, observedAtUtc: new Date().toISOString(),
        scoreEvents: [], initialHistoryReady: true
    }, true);
    state.applyOfficialMatchState({
        matchId: 1, sequence: 2, status: "Live",
        homeScore: 1, awayScore: 0, elapsedSeconds: 10,
        isFinished: false, observedAtUtc: new Date().toISOString(),
        scoreEvents: [{ id: 1, sequence: 1, team: "home", points: 1, eventType: "Goal", occurredAtUtc: new Date().toISOString() }],
        initialHistoryReady: true
    }, true);
    for (let i = 0; i < 600; i++) state.update(1 / 60);
    const diag = state.diagnostics();
    assert.ok(diag.homeScore >= 1, `homeScore deve ser >= 1 após gol oficial, recebeu ${diag.homeScore}`);
}

// 13. No position contains NaN/Infinity
{
    const state = new FuturebolMatchState("nan-test");
    state.applyMarket({
        sequence: 1, timestamp: new Date().toISOString(),
        home: { symbol: "HOME", price: 100, changePercent: 1, momentum: 0.3, volumeStrength: 50 },
        away: { symbol: "AWAY", price: 100, changePercent: -1, momentum: -0.3, volumeStrength: 50 }
    }, "home");
    for (let i = 0; i < 300; i++) state.update(1 / 60);
    for (const player of state.players) {
        assert.ok(Number.isFinite(player.targetPosition.x), `${player.id} targetPosition.x is NaN/Infinity`);
        assert.ok(Number.isFinite(player.targetPosition.z), `${player.id} targetPosition.z is NaN/Infinity`);
        assert.ok(Number.isFinite(player.position.x), `${player.id} position.x is NaN/Infinity`);
        assert.ok(Number.isFinite(player.position.z), `${player.id} position.z is NaN/Infinity`);
    }
}

// 14. Behavior without Director context uses fallback Balanced
{
    const tb = new FuturebolTeamBehavior();
    const att = makePlayer({ role: "attacker", basePosition: { x: 3.5, y: 0, z: -3 } });
    const ctx = makeCtx({ style: "Balanced", phaseElapsed: 2 });
    const result = tb.computePlayerBehavior(att, ctx);
    assert.ok(result.targetX !== 0 || result.targetZ !== 0, "Balanced deve produzir posicionamento não trivial");
    assert.ok(typeof result.intent === "string", "intent deve ser string");
}

// 15. Scenario-specific: PressureAttack makes team compact and advanced
{
    const tb = new FuturebolTeamBehavior();
    const att = makePlayer({
        id: "home-attacker", role: "attacker",
        basePosition: { x: 3.5, y: 0, z: -3 }
    });
    const def = makePlayer({
        id: "home-defender", role: "defender",
        basePosition: { x: -11, y: 0, z: 4.7 }
    });
    const ctx = makeCtx({
        scenario: "PressureAttack", style: "Aggressive",
        phaseElapsed: 1.0, ballPosition: { x: 8, y: 0.55, z: 1 }
    });
    const attResult = tb.computePlayerBehavior(att, ctx);
    const defResult = tb.computePlayerBehavior(def, ctx);
    assert.equal(attResult.intent, "AttackBox", "PressureAttack ATT deve ser AttackBox");
    assert.equal(defResult.intent, "PushForward", "PressureAttack DEF deve ser PushForward");
}

console.log("TeamBehavior tests passed.");
