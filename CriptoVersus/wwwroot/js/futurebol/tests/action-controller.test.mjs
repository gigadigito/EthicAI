import assert from "node:assert/strict";
import { ActionController } from "../../dist/futurebol/futurebol-action-controller.js";

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

function advanceFrames(ac, totalSeconds, ctxFn) {
    const frames = Math.ceil(totalSeconds / 0.1) + 1;
    let result = { completed: false, result: null };
    for (let i = 0; i < frames; i++) {
        result = ac.update(0.1, ctxFn ? ctxFn() : makeCtx());
        if (result.completed) break;
    }
    return result.completed;
}

const simpleScenario = {
    id: "test-simple",
    type: "DirectAttack",
    attackingTeam: "home",
    expectedOutcome: "Goal",
    actions: [
        { kind: "PlayerAction", type: "MoveTo", playerId: "home-defender", team: "home", duration: 0.5, target: { x: 5, y: 0, z: 1 } },
        { kind: "BallAction", type: "PassToPlayer", team: "home", duration: 0.8, targetPlayerId: "home-attacker", target: { x: 10, y: 0.55, z: 0 } },
        { kind: "BallAction", type: "ShootToGoal", team: "home", duration: 0.6 },
        { kind: "PlayerAction", type: "Celebrate", playerId: "home-attacker", team: "home", duration: 0.5 }
    ]
};

const timeoutScenario = {
    id: "test-timeout",
    type: "DirectAttack",
    attackingTeam: "home",
    expectedOutcome: "Goal",
    actions: [
        { kind: "PlayerAction", type: "MoveTo", playerId: "home-defender", team: "home", duration: 100, target: { x: 5, y: 0, z: 1 } }
    ]
};

const parallelScenario = {
    id: "test-parallel",
    type: "DirectAttack",
    attackingTeam: "home",
    expectedOutcome: "Goal",
    actions: [
        { kind: "PlayerAction", type: "RunTo", playerId: "home-attacker", team: "home", duration: 1.0, target: { x: 15, y: 0, z: 0 } },
        { kind: "PlayerAction", type: "RecoverRun", playerId: "home-defender", team: "home", duration: 1.0, target: { x: 5, y: 0, z: 0 } },
        { kind: "PlayerAction", type: "SupportRun", playerId: "home-attacker", team: "home", duration: 1.0, target: { x: 10, y: 0, z: 2 } }
    ]
};

// 1. Initial state
{
    const ac = new ActionController();
    assert.equal(ac.isActive, false);
    assert.equal(ac.currentAction, null);
    assert.equal(ac.currentScenario, null);
    assert.equal(ac.totalElapsed, 0);
    assert.equal(ac.actionProgress, 1);
}

// 2. Start scenario
{
    const ac = new ActionController();
    ac.startScenario(simpleScenario);
    assert.equal(ac.isActive, true);
    assert.equal(ac.currentScenario?.id, "test-simple");
    assert.equal(ac.currentAction?.type, "MoveTo");
    assert.equal(ac.totalElapsed, 0);
}

// 3. Sequential: action A completes → action B
{
    const ac = new ActionController();
    ac.startScenario(simpleScenario);

    let completed = ac.update(0.1, makeCtx());
    assert.equal(completed.completed, false);
    assert.equal(ac.currentAction?.type, "MoveTo");
    assert.ok(ac.actionProgress > 0);

    completed = advanceFrames(ac, 0.5);
    assert.equal(completed, false);
    assert.equal(ac.currentAction?.type, "PassToPlayer");
}

// 4. PassToPlayer completes when ball owner matches target
{
    const ac = new ActionController();
    ac.startScenario(simpleScenario);

    advanceFrames(ac, 0.5);
    assert.equal(ac.currentAction?.type, "PassToPlayer");

    const completed = ac.update(0.1, makeCtx({
        ballOwnerId: "home-attacker",
        ballState: "Controlled"
    }));
    assert.equal(completed.completed, false);
    assert.equal(ac.currentAction?.type, "ShootToGoal");
}

// 5. ShootToGoal completes by duration
{
    const ac = new ActionController();
    ac.startScenario(simpleScenario);

    advanceFrames(ac, 0.5);
    ac.update(0.1, makeCtx({ ballOwnerId: "home-attacker", ballState: "Controlled" }));
    assert.equal(ac.currentAction?.type, "ShootToGoal");

    const completed = advanceFrames(ac, 0.6);
    assert.equal(completed, false);
    assert.equal(ac.currentAction?.type, "Celebrate");
}

// 6. Scenario finishes after all actions
{
    const ac = new ActionController();
    ac.startScenario(simpleScenario);

    advanceFrames(ac, 0.5);
    ac.update(0.1, makeCtx({ ballOwnerId: "home-attacker", ballState: "Controlled" }));
    advanceFrames(ac, 0.6);
    assert.equal(ac.currentAction?.type, "Celebrate");

    const completed = advanceFrames(ac, 0.5, () => makeCtx({ playPhase: "Resetting" }));
    assert.equal(completed, true);
    assert.equal(ac.isActive, false);
    assert.equal(ac.currentAction, null);
}

// 7. Timeout: action exceeds 6 seconds → auto-advance
{
    const ac = new ActionController();
    ac.startScenario(timeoutScenario);
    assert.equal(ac.currentAction?.type, "MoveTo");

    const completed = advanceFrames(ac, 6.1);
    assert.equal(completed, true);
    assert.equal(ac.isActive, false);
}

// 8. Cancel: scenario stops immediately
{
    const ac = new ActionController();
    ac.startScenario(simpleScenario);
    assert.equal(ac.isActive, true);

    advanceFrames(ac, 0.3);
    ac.cancel();
    assert.equal(ac.isActive, false);
    assert.equal(ac.currentAction, null);
    assert.equal(ac.totalElapsed, 0);
}

// 9. Reset match → ActionController empty
{
    const ac = new ActionController();
    ac.startScenario(simpleScenario);
    advanceFrames(ac, 0.3);
    ac.cancel();
    assert.equal(ac.isActive, false);
    assert.equal(ac.currentAction, null);
    assert.equal(ac.diagnostics().scenarioType, null);
}

// 10. Parallel actions execute sequentially
{
    const ac = new ActionController();
    ac.startScenario(parallelScenario);

    assert.equal(ac.currentAction?.type, "RunTo");
    advanceFrames(ac, 1.0);
    assert.equal(ac.currentAction?.type, "RecoverRun");
    advanceFrames(ac, 1.0);
    assert.equal(ac.currentAction?.type, "SupportRun");
    advanceFrames(ac, 1.0);
    assert.equal(ac.isActive, false);
}

// 11. Diagnostics
{
    const ac = new ActionController();
    const diag = ac.diagnostics();
    assert.equal(diag.scenarioType, null);
    assert.equal(diag.actionIndex, 0);
    assert.equal(diag.actionCount, 0);
    assert.equal(diag.currentActionType, "none");

    ac.startScenario(simpleScenario);
    const diag2 = ac.diagnostics();
    assert.equal(diag2.scenarioType, "DirectAttack");
    assert.equal(diag2.actionIndex, 0);
    assert.equal(diag2.actionCount, 4);
    assert.equal(diag2.currentActionType, "MoveTo");
    assert.equal(diag2.officialGoal, true);
}

// 12. Dispose prevents further updates
{
    const ac = new ActionController();
    ac.startScenario(simpleScenario);
    ac.dispose();
    assert.equal(ac.isActive, false);
    assert.equal(ac.update(0.1, makeCtx()).completed, false);
}

// 13. No double-completion: ShootToGoal only completes once
{
    const shootScenario = {
        id: "test-shoot",
        type: "DirectAttack",
        attackingTeam: "home",
        expectedOutcome: "Goal",
        actions: [
            { kind: "BallAction", type: "ShootToGoal", team: "home", duration: 0.76 },
            { kind: "PlayerAction", type: "Celebrate", playerId: "home-attacker", team: "home", duration: 1.0 }
        ]
    };
    const ac = new ActionController();
    ac.startScenario(shootScenario);
    advanceFrames(ac, 0.76);
    assert.equal(ac.currentAction?.type, "Celebrate");
    const completed = advanceFrames(ac, 1.0, () => makeCtx({ playPhase: "Resetting" }));
    assert.equal(completed, true);
    assert.equal(ac.isActive, false);
}

// 14. Event arriving during scenario: cancel + restart works
{
    const ac = new ActionController();
    ac.startScenario(simpleScenario);
    advanceFrames(ac, 0.5);
    ac.cancel();
    ac.startScenario({
        id: "test-new",
        type: "GiveAndGo",
        attackingTeam: "away",
        expectedOutcome: "Saved",
        actions: [
            { kind: "PlayerAction", type: "MoveTo", playerId: "away-defender", team: "away", duration: 0.5, target: { x: -5, y: 0, z: 0 } }
        ]
    });
    assert.equal(ac.currentScenario?.type, "GiveAndGo");
    assert.equal(ac.currentAction?.type, "MoveTo");
}

// 15. Overwrite scenario while active
{
    const ac = new ActionController();
    ac.startScenario(simpleScenario);
    ac.startScenario({
        id: "test-overwrite",
        type: "CounterAttack",
        attackingTeam: "home",
        expectedOutcome: "Goal",
        actions: [
            { kind: "PlayerAction", type: "RunTo", playerId: "home-attacker", team: "home", duration: 0.5, target: { x: 20, y: 0, z: 0 } }
        ]
    });
    assert.equal(ac.currentScenario?.type, "CounterAttack");
    assert.equal(ac.currentAction?.type, "RunTo");
}

// 16. PassToPlayer completes by context (ball owner match) OR by duration
{
    const ac = new ActionController();
    ac.startScenario(simpleScenario);
    advanceFrames(ac, 0.5);
    assert.equal(ac.currentAction?.type, "PassToPlayer");

    ac.update(0.1, makeCtx({ ballOwnerId: "home-attacker", ballState: "Controlled" }));
    assert.equal(ac.currentAction?.type, "ShootToGoal", "PassToPlayer deve completar quando ballOwnerId corresponde ao targetPlayerId");
}

// 17. Celebrate/Disappointed complete when playPhase is Resetting
{
    const celebrateScenario = {
        id: "test-celebrate",
        type: "DirectAttack",
        attackingTeam: "home",
        expectedOutcome: "Goal",
        actions: [
            { kind: "PlayerAction", type: "Celebrate", playerId: "home-attacker", team: "home", duration: 10 }
        ]
    };
    const ac = new ActionController();
    ac.startScenario(celebrateScenario);
    ac.update(0.1, makeCtx({ playPhase: "BuildUp" }));
    assert.equal(ac.currentAction?.type, "Celebrate");

    const completed = ac.update(0.1, makeCtx({ playPhase: "Resetting" }));
    assert.equal(completed.completed, true);
}

// 18. Total elapsed accumulates across actions
{
    const ac = new ActionController();
    ac.startScenario(simpleScenario);
    advanceFrames(ac, 0.5);
    assert.ok(ac.totalElapsed >= 0.5);
    advanceFrames(ac, 0.8);
    assert.ok(ac.totalElapsed >= 1.3);
}

// 19. Empty scenario finishes immediately
{
    const emptyScenario = {
        id: "test-empty",
        type: "DirectAttack",
        attackingTeam: "home",
        expectedOutcome: "Goal",
        actions: []
    };
    const ac = new ActionController();
    ac.startScenario(emptyScenario);
    const completed = ac.update(0.1, makeCtx());
    assert.equal(completed.completed, true);
    assert.equal(ac.isActive, false);
}

// 20. Repeated startScenario resets cleanly
{
    const ac = new ActionController();
    for (let i = 0; i < 5; i++) {
        ac.startScenario(simpleScenario);
        assert.equal(ac.totalElapsed, 0, `iteração ${i}: startScenario deve resetar totalElapsed`);
        advanceFrames(ac, 0.2);
    }
    assert.equal(ac.currentAction?.type, "MoveTo");
}

console.log("ActionController tests passed.");
