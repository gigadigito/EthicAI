import assert from "node:assert/strict";
import { FuturebolScenarioController } from "../../dist/futurebol/futurebol-scenario-controller.js";

const seed = 12345;

// 1. Basic selection returns valid scenario structure
{
    const ctrl = new FuturebolScenarioController();
    const scenario = ctrl.selectScenario("home", "Goal", seed, 1);
    assert.ok(scenario.id.length > 0);
    assert.ok(scenario.actions.length > 0);
    assert.equal(scenario.attackingTeam, "home");
    assert.equal(scenario.expectedOutcome, "Goal");
}

// 2. DirectAttack produces correct action kinds
{
    const ctrl = new FuturebolScenarioController();
    const scenario = ctrl.selectScenario("home", "Goal", seed, 1);
    const kinds = new Set(scenario.actions.map(a => a.kind));
    assert.ok(kinds.has("PlayerAction"), "deve ter ações de jogador");
    assert.ok(kinds.has("BallAction"), "deve ter ações de bola");
    assert.ok(kinds.has("TeamAction"), "deve ter ações coletivas");
}

// 3. Same seed + same context → same scenario
{
    const ctrlA = new FuturebolScenarioController();
    const ctrlB = new FuturebolScenarioController();
    const a = ctrlA.selectScenario("home", "Goal", seed, 5);
    const b = ctrlB.selectScenario("home", "Goal", seed, 5);
    assert.equal(a.type, b.type);
    assert.equal(a.actions.length, b.actions.length);
    assert.deepEqual(a.actions[0], b.actions[0]);
}

// 4. Different seeds → may produce different scenario types
{
    const ctrl = new FuturebolScenarioController();
    const types = new Set();
    for (let i = 0; i < 20; i++) {
        const scenario = ctrl.selectScenario("home", "Goal", seed, i);
        types.add(scenario.type);
    }
    assert.ok(types.size >= 2, `deve produzir pelo menos 2 tipos distintos, produziu: ${[...types].join(',')}`);
}

// 5. Consecutive same type avoidance
{
    const ctrl = new FuturebolScenarioController();
    const types = [];
    for (let i = 0; i < 20; i++) {
        const scenario = ctrl.selectScenario("home", "Goal", seed, i);
        types.push(scenario.type);
    }
    let maxConsecutive = 1;
    let current = 1;
    for (let i = 1; i < types.length; i++) {
        if (types[i] === types[i - 1]) {
            current++;
            maxConsecutive = Math.max(maxConsecutive, current);
        } else {
            current = 1;
        }
    }
    assert.ok(maxConsecutive <= 3, `não deve ter mais de 3 repetições consecutivas, teve ${maxConsecutive}: ${types.join(',')}`);
}

// 6. Away team scenarios mirror home
{
    const ctrlHome = new FuturebolScenarioController();
    const ctrlAway = new FuturebolScenarioController();
    const homeScenario = ctrlHome.selectScenario("home", "Goal", seed, 1);
    const awayScenario = ctrlAway.selectScenario("away", "Goal", seed, 1);
    assert.equal(homeScenario.type, awayScenario.type);
    assert.equal(homeScenario.attackingTeam, "home");
    assert.equal(awayScenario.attackingTeam, "away");
}

// 7. Each scenario type has distinct characteristics
{
    const ctrl = new FuturebolScenarioController();
    const scenarios = { DirectAttack: null, GiveAndGo: null, CounterAttack: null };
    for (let i = 0; i < 100; i++) {
        const s = ctrl.selectScenario("home", "Goal", seed, i);
        if (!scenarios[s.type]) scenarios[s.type] = s;
    }
    for (const [type, scenario] of Object.entries(scenarios)) {
        assert.ok(scenario !== null, `${type} deve ser selecionado em 100 tentativas`);
    }
    const da = scenarios.DirectAttack;
    const gg = scenarios.GiveAndGo;
    const ca = scenarios.CounterAttack;
    assert.ok(da.actions.length > 0, "DirectAttack deve ter ações");
    assert.ok(gg.actions.length > 0, "GiveAndGo deve ter ações");
    assert.ok(ca.actions.length > 0, "CounterAttack deve ter ações");
}

// 8. Reset clears history
{
    const ctrl = new FuturebolScenarioController();
    for (let i = 0; i < 5; i++) ctrl.selectScenario("home", "Goal", seed, i);
    ctrl.reset();
    const scenario = ctrl.selectScenario("home", "Goal", seed, 0);
    assert.ok(scenario.id.length > 0);
}

// 9. CounterAttack context bias
{
    const ctrl = new FuturebolScenarioController();
    let counterCount = 0;
    for (let i = 0; i < 50; i++) {
        const s = ctrl.selectScenario("home", "Goal", seed, i, { isCounterAttack: true });
        if (s.type === "CounterAttack") counterCount++;
    }
    assert.ok(counterCount > 15, `CounterAttack context deve favorecer counter, teve ${counterCount}/50`);
}

// 10. All actions have positive duration
{
    const ctrl = new FuturebolScenarioController();
    for (let i = 0; i < 30; i++) {
        const scenario = ctrl.selectScenario("home", "Goal", seed, i);
        for (const action of scenario.actions) {
            assert.ok(action.duration > 0, `ação ${action.type} deve ter duração positiva`);
        }
    }
}

// 11. Ball actions have targetPlayerId where applicable
{
    const ctrl = new FuturebolScenarioController();
    for (let i = 0; i < 30; i++) {
        const scenario = ctrl.selectScenario("home", "Goal", seed, i);
        for (const action of scenario.actions) {
            if (action.kind === "BallAction" && action.type === "PassToPlayer") {
                assert.ok(action.targetPlayerId, `PassToPlayer deve ter targetPlayerId`);
            }
        }
    }
}

// 12. Player actions have targets where applicable
{
    const ctrl = new FuturebolScenarioController();
    for (let i = 0; i < 30; i++) {
        const scenario = ctrl.selectScenario("home", "Goal", seed, i);
        for (const action of scenario.actions) {
            if (action.kind === "PlayerAction" && (action.type === "MoveTo" || action.type === "RunTo" || action.type === "Dribble")) {
                assert.ok(action.target, `${action.type} deve ter target`);
                assert.ok(typeof action.target.x === "number", "target.x deve ser número");
                assert.ok(typeof action.target.z === "number", "target.z deve ser número");
            }
        }
    }
}

// 13. Scenarios never produce targets outside field bounds
{
    const ctrl = new FuturebolScenarioController();
    for (let i = 0; i < 30; i++) {
        const scenario = ctrl.selectScenario("home", "Goal", seed, i);
        for (const action of scenario.actions) {
            if (action.kind === "PlayerAction" && action.target) {
                assert.ok(action.target.x >= -23 && action.target.x <= 23, `${action.type} target.x ${action.target.x} fora do campo`);
                assert.ok(action.target.z >= -15 && action.target.z <= 15, `${action.type} target.z ${action.target.z} fora do campo`);
            }
        }
    }
}

// 14. ShootToGoal always present in every scenario
{
    const ctrl = new FuturebolScenarioController();
    for (let i = 0; i < 30; i++) {
        const scenario = ctrl.selectScenario("home", "Goal", seed, i);
        const hasShoot = scenario.actions.some(a => a.kind === "BallAction" && a.type === "ShootToGoal");
        assert.ok(hasShoot, `${scenario.type} #${i} deve conter ShootToGoal`);
    }
}

// 15. PassToPlayer present in all scenario types
{
    const ctrl = new FuturebolScenarioController();
    for (let i = 0; i < 30; i++) {
        const scenario = ctrl.selectScenario("home", "Goal", seed, i);
        const hasPass = scenario.actions.some(a => a.kind === "BallAction" && a.type === "PassToPlayer");
        assert.ok(hasPass, `${scenario.type} #${i} deve conter PassToPlayer`);
    }
}

console.log("ScenarioController tests passed.");
