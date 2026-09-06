import assert from "node:assert/strict";
import { FuturebolFootballDirector } from "../../dist/futurebol/futurebol-football-director.js";
import { FuturebolScenarioController } from "../../dist/futurebol/futurebol-scenario-controller.js";

const seed = 12345;
const MATCH_DURATION = 90;

function makeCtx(overrides = {}) {
    return {
        attackingTeam: "home",
        pressure: 0.5,
        homeScore: 1,
        awayScore: 0,
        elapsedSeconds: 30,
        matchDurationSeconds: MATCH_DURATION,
        latestSnapshot: null,
        officialGoalPending: false,
        previousScenario: null,
        recentScenarios: [],
        seed,
        playIndex: 1,
        ...overrides
    };
}

const ALL_SCENARIOS = [
    "DirectAttack", "GiveAndGo", "CounterAttack",
    "ThroughBall", "WingAttack", "LongShot", "PressureAttack"
];

// 1. High pressure favors aggressive scenarios
{
    const dir = new FuturebolFootballDirector();
    const aggressive = ["DirectAttack", "PressureAttack", "ThroughBall"];
    let aggressiveCount = 0;
    for (let i = 0; i < 80; i++) {
        const decision = dir.decide(makeCtx({
            pressure: 0.8,
            latestSnapshot: { home: { momentum: 0.5 }, away: { momentum: -0.2 } },
            playIndex: i
        }));
        if (aggressive.includes(decision.scenario)) aggressiveCount++;
    }
    assert.ok(aggressiveCount > 25, `alta pressão deve favorecer cenários agressivos, teve ${aggressiveCount}/80`);
}

// 2. Momentum recovery favors CounterAttack
{
    const dir = new FuturebolFootballDirector();
    let counterCount = 0;
    for (let i = 0; i < 80; i++) {
        const decision = dir.decide(makeCtx({
            pressure: -0.4,
            latestSnapshot: { home: { momentum: -0.6 }, away: { momentum: 0.4 } },
            playIndex: i
        }));
        if (decision.scenario === "CounterAttack") counterCount++;
    }
    assert.ok(counterCount > 15, `momentum de recuperação deve favorecer CounterAttack, teve ${counterCount}/80`);
}

// 3. Winning near end favors controlled behavior
{
    const dir = new FuturebolFootballDirector();
    let controlledCount = 0;
    for (let i = 0; i < 80; i++) {
        const decision = dir.decide(makeCtx({
            pressure: 0.2,
            homeScore: 3,
            awayScore: 1,
            elapsedSeconds: 80,
            playIndex: i
        }));
        if (decision.style === "Controlled") controlledCount++;
    }
    assert.ok(controlledCount > 20, `vantagem perto do final deve favorecer estilo Controlado, teve ${controlledCount}/80`);
}

// 4. Losing near end favors aggressive behavior
{
    const dir = new FuturebolFootballDirector();
    let aggressiveCount = 0;
    for (let i = 0; i < 80; i++) {
        const decision = dir.decide(makeCtx({
            pressure: -0.2,
            homeScore: 0,
            awayScore: 2,
            elapsedSeconds: 80,
            playIndex: i
        }));
        if (decision.style === "Aggressive") aggressiveCount++;
    }
    assert.ok(aggressiveCount > 20, `desvantagem perto do final deve favorecer estilo Agressivo, teve ${aggressiveCount}/80`);
}

// 5. Anti-repetition reduces chance of last scenario
{
    const dir = new FuturebolFootballDirector();
    const recent = ["DirectAttack", "DirectAttack", "DirectAttack"];
    let directCount = 0;
    for (let i = 0; i < 80; i++) {
        const decision = dir.decide(makeCtx({
            recentScenarios: recent,
            playIndex: i
        }));
        if (decision.scenario === "DirectAttack") directCount++;
    }
    assert.ok(directCount < 30, `antirrepetição deve reduzir cenário repetido, teve ${directCount}/80 (< 30)`);
}

// 6. Same context + same seed → same decision
{
    const dirA = new FuturebolFootballDirector();
    const dirB = new FuturebolFootballDirector();
    const ctx = makeCtx({ seed: 99999, playIndex: 7 });
    const a = dirA.decide(ctx);
    const b = dirB.decide(ctx);
    assert.equal(a.scenario, b.scenario, "mesmo contexto + mesmo seed deve produzir mesma decisão");
    assert.equal(a.style, b.style, "mesmo contexto + mesmo seed deve produzir mesmo estilo");
}

// 7. Official goal pending never results in incompatible scenario
{
    const dir = new FuturebolFootballDirector();
    const compatible = ["DirectAttack", "ThroughBall", "LongShot", "CounterAttack"];
    let compatibleCount = 0;
    for (let i = 0; i < 80; i++) {
        const decision = dir.decide(makeCtx({
            officialGoalPending: true,
            playIndex: i
        }));
        if (compatible.includes(decision.scenario)) compatibleCount++;
    }
    assert.ok(compatibleCount > 50, `gol oficial deve favorecer cenários compatíveis, teve ${compatibleCount}/80`);
}

// 8. All new scenarios generate valid ActionSequence
{
    const ctrl = new FuturebolScenarioController();
    const newScenarios = ["ThroughBall", "WingAttack", "LongShot", "PressureAttack"];
    for (const type of newScenarios) {
        let found = false;
        for (let i = 0; i < 100; i++) {
            const scenario = ctrl.selectScenario("home", "Goal", seed, i);
            if (scenario.type === type) {
                found = true;
                assert.ok(scenario.actions.length > 0, `${type} deve ter ações`);
                const hasShoot = scenario.actions.some(a => a.kind === "BallAction" && a.type === "ShootToGoal");
                assert.ok(hasShoot, `${type} deve conter ShootToGoal`);
                const hasPass = scenario.actions.some(a => a.kind === "BallAction" && a.type === "PassToPlayer");
                assert.ok(hasPass, `${type} deve conter PassToPlayer`);
                break;
            }
        }
        assert.ok(found, `${type} deve ser selecionado em 100 tentativas`);
    }
}

// 9. No scenario references non-existent player
{
    const ctrl = new FuturebolScenarioController();
    for (let i = 0; i < 50; i++) {
        const scenario = ctrl.selectScenario("home", "Goal", seed, i);
        const validPlayers = new Set(["home-attacker", "home-defender", "home-goalkeeper", "away-attacker", "away-defender", "away-goalkeeper"]);
        for (const action of scenario.actions) {
            if (action.kind === "PlayerAction" && action.playerId) {
                assert.ok(validPlayers.has(action.playerId), `${action.playerId} deve ser jogador válido`);
            }
            if (action.kind === "BallAction" && action.targetPlayerId) {
                assert.ok(validPlayers.has(action.targetPlayerId), `${action.targetPlayerId} deve ser jogador válido`);
            }
        }
    }
}

// 10. Replay continues reaching official score correctly
{
    const ctrl = new FuturebolScenarioController();
    for (let i = 0; i < 20; i++) {
        const scenario = ctrl.selectScenario("home", "Goal", seed, i, { isReplay: true });
        assert.equal(scenario.expectedOutcome, "Goal", "replay deve manter expectedOutcome Goal");
        assert.equal(scenario.attackingTeam, "home", "replay deve manter attackingTeam");
    }
}

// 11. Decision always produces valid style
{
    const dir = new FuturebolFootballDirector();
    const validStyles = ["Controlled", "Balanced", "Aggressive", "Counter"];
    for (let i = 0; i < 50; i++) {
        const decision = dir.decide(makeCtx({ playIndex: i }));
        assert.ok(validStyles.includes(decision.style), `${decision.style} deve ser estilo válido`);
    }
}

// 12. Risk is always in valid range
{
    const dir = new FuturebolFootballDirector();
    for (let i = 0; i < 50; i++) {
        const decision = dir.decide(makeCtx({ playIndex: i }));
        assert.ok(decision.risk >= 0.1 && decision.risk <= 0.9, `risk ${decision.risk} deve estar em [0.1, 0.9]`);
    }
}

// 13. Different pressures produce different scenario distributions
{
    const dirLow = new FuturebolFootballDirector();
    const dirHigh = new FuturebolFootballDirector();
    const lowTypes = new Set();
    const highTypes = new Set();
    for (let i = 0; i < 50; i++) {
        lowTypes.add(dirLow.decide(makeCtx({ pressure: -0.5, playIndex: i })).scenario);
        highTypes.add(dirHigh.decide(makeCtx({ pressure: 0.8, playIndex: i })).scenario);
    }
    assert.ok(lowTypes.size >= 2, `baixa pressão deve gerar variedade, teve ${lowTypes.size}`);
    assert.ok(highTypes.size >= 2, `alta pressão deve gerar variedade, teve ${highTypes.size}`);
}

// 14. Counter-attack context still works via fallback
{
    const ctrl = new FuturebolScenarioController();
    let counterCount = 0;
    for (let i = 0; i < 50; i++) {
        const s = ctrl.selectScenario("home", "Goal", seed, i, { isCounterAttack: true });
        if (s.type === "CounterAttack") counterCount++;
    }
    assert.ok(counterCount > 10, `CounterAttack context deve favorecer counter, teve ${counterCount}/50`);
}

// 15. Spatial variations: WingAttack uses different lanes
{
    const ctrl = new FuturebolScenarioController();
    const wingZValues = new Set();
    let wingCount = 0;
    for (let i = 0; i < 100; i++) {
        const s = ctrl.selectScenario("home", "Goal", seed, i);
        if (s.type === "WingAttack") {
            wingCount++;
            const moveActions = s.actions.filter(a => a.kind === "PlayerAction" && a.type === "MoveTo" && a.target);
            for (const a of moveActions) {
                if (a.target) wingZValues.add(Math.round(a.target.z * 10) / 10);
            }
        }
    }
    assert.ok(wingCount > 0, "WingAttack deve ser selecionado");
    assert.ok(wingZValues.size >= 2, `WingAttack deve ter variações laterais, teve ${wingZValues.size} valores distintos`);
}

console.log("FootballDirector tests passed.");
