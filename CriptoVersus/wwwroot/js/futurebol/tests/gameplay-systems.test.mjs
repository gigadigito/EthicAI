import assert from "node:assert/strict";
import { FuturebolBallController } from "../../dist/futurebol/futurebol-ball-controller.js";
import { FuturebolMatchRules } from "../../dist/futurebol/futurebol-match-rules.js";
import { FuturebolMatchState } from "../../dist/futurebol/futurebol-match-state.js";
import { FuturebolPlayerAI } from "../../dist/futurebol/futurebol-player-ai.js";
import { FuturebolScenarioController } from "../../dist/futurebol/futurebol-scenario-controller.js";

const snapshot = {
    sequence: 73,
    timestamp: "2026-08-09T12:00:00.000Z",
    home: { symbol: "BTC", price: 65000, changePercent: 2.1, momentum: 86, volumeStrength: 74 },
    away: { symbol: "ETH", price: 3500, changePercent: -0.6, momentum: 24, volumeStrength: 41 }
};

const tacticalState = new FuturebolMatchState("gameplay-zones");
tacticalState.applyMarket(snapshot, "home");
for (let index = 0; index < 900; index++)
    tacticalState.update(1 / 60);

for (const player of tacticalState.players) {
    assert.ok(
        player.position.x >= player.zone.minimumX - 0.56 &&
        player.position.x <= player.zone.maximumX + 0.56,
        `${player.id} deve permanecer em sua zona longitudinal`
    );
    assert.ok(
        player.position.z >= player.zone.minimumZ - 0.56 &&
        player.position.z <= player.zone.maximumZ + 0.56,
        `${player.id} deve permanecer em sua zona lateral`
    );
    assert.ok(player.tacticalIntent, `${player.id} deve possuir uma função tática ativa`);
}

const ai = new FuturebolPlayerAI();
const mockOwner = {
    id: "home-defender", team: "home", role: "defender",
    position: { x: -8, y: 0, z: 3 },
    targetPosition: { x: -5, y: 0, z: 2 },
    movementSpeed: 4.1, currentSpeed: 2, facingAngle: 0,
    animation: "idle", animationTime: 0, actionProgress: 0,
    basePosition: { x: -11, y: 0, z: 4.7 },
    zone: { minimumX: -22, maximumX: 0, minimumZ: -7, maximumZ: 7 },
    tacticalIntent: "Possessing"
};
const mockAttacker = {
    id: "home-attacker", team: "home", role: "attacker",
    position: { x: 2, y: 0, z: -1 },
    targetPosition: { x: 6, y: 0, z: -1.5 },
    movementSpeed: 5.2, currentSpeed: 3, facingAngle: 0,
    animation: "run", animationTime: 0, actionProgress: 0,
    basePosition: { x: -3.5, y: 0, z: -3 },
    zone: { minimumX: -10, maximumX: 22, minimumZ: -7, maximumZ: 7 },
    tacticalIntent: "AttackingSpace"
};
const mockHomeGK = {
    id: "home-goalkeeper", team: "home", role: "goalkeeper",
    position: { x: -21.2, y: 0, z: 0 },
    targetPosition: { x: -21.2, y: 0, z: 0 },
    movementSpeed: 3.2, currentSpeed: 0, facingAngle: 0,
    animation: "idle", animationTime: 0, actionProgress: 0,
    basePosition: { x: -21.2, y: 0, z: 0 },
    zone: { minimumX: -23, maximumX: -18, minimumZ: -4, maximumZ: 4 },
    tacticalIntent: "HoldingPosition"
};
const mockAwayDefender = {
    id: "away-defender", team: "away", role: "defender",
    position: { x: 10, y: 0, z: -2 },
    targetPosition: { x: 8, y: 0, z: -1 },
    movementSpeed: 4.1, currentSpeed: 2, facingAngle: Math.PI,
    animation: "idle", animationTime: 0, actionProgress: 0,
    basePosition: { x: 11, y: 0, z: -4.7 },
    zone: { minimumX: 0, maximumX: 22, minimumZ: -7, maximumZ: 7 },
    tacticalIntent: "Pressing"
};
const mockAwayAttacker = {
    id: "away-attacker", team: "away", role: "attacker",
    position: { x: 5, y: 0, z: 2 },
    targetPosition: { x: 3, y: 0, z: 1.5 },
    movementSpeed: 5.2, currentSpeed: 1, facingAngle: Math.PI,
    animation: "idle", animationTime: 0, actionProgress: 0,
    basePosition: { x: 3.5, y: 0, z: 3 },
    zone: { minimumX: -22, maximumX: 10, minimumZ: -7, maximumZ: 7 },
    tacticalIntent: "Covering"
};
const mockAwayGK = {
    id: "away-goalkeeper", team: "away", role: "goalkeeper",
    position: { x: 21.2, y: 0, z: 0 },
    targetPosition: { x: 21.2, y: 0, z: 0 },
    movementSpeed: 3.2, currentSpeed: 0, facingAngle: Math.PI,
    animation: "idle", animationTime: 0, actionProgress: 0,
    basePosition: { x: 21.2, y: 0, z: 0 },
    zone: { minimumX: 18, maximumX: 23, minimumZ: -4, maximumZ: 4 },
    tacticalIntent: "HoldingPosition"
};
const mockHomeTeam = [mockHomeGK, mockOwner, mockAttacker];
const mockAwayTeam = [mockAwayGK, mockAwayDefender, mockAwayAttacker];

const passOption = ai.selectPassReceiver({
    owner: mockOwner,
    attackingTeam: "home",
    teammates: mockHomeTeam,
    opponents: mockAwayTeam
});
assert.ok(passOption !== null, "o passe deve ter ao menos um receptor válido");
assert.equal(passOption.receiver.id, "home-attacker", "o passe deve priorizar o companheiro avançado e disponível");

const passState = new FuturebolMatchState("gameplay-pass-release");
passState.applyMarket(snapshot, "home");
passState.forcePass("home");
let passReleased = false;
for (let index = 0; index < 120; index++) {
    passState.update(1 / 60);
    passReleased ||=
        passState.ballState === "Passing" &&
        passState.currentBallOwnerId === null &&
        Math.hypot(passState.ballVelocity.x, passState.ballVelocity.z) > 1;
}
assert.ok(passReleased, "o contato do passe deve liberar uma bola com velocidade própria");

const passBallPosition = { x: 0, y: 0.55, z: 0 };
const passBall = new FuturebolBallController(passBallPosition);
const passSpeed = passBall.launchPass({ x: 12, y: 0.55, z: 1 });
const shotBallPosition = { x: 0, y: 0.55, z: 0 };
const shotBall = new FuturebolBallController(shotBallPosition);
const shotSpeed = shotBall.launchShot({ x: 12, y: 1, z: 1 });
assert.ok(shotSpeed > passSpeed * 1.4, "o chute deve sair sensivelmente mais forte que o passe");

let previousSpeed = passBall.horizontalSpeed();
for (let index = 0; index < 300; index++)
    passBall.updateFlight(1 / 120, []);
assert.ok(passBall.horizontalSpeed() < previousSpeed, "a bola deve desacelerar no gramado");
assert.equal(passBallPosition.y, 0.55, "a bola deve estabilizar no gramado após os rebotes");

const postBallPosition = { x: 22.8, y: 0.55, z: 3.5 };
const postBall = new FuturebolBallController(postBallPosition);
postBall.launchShot({ x: 26, y: 0.8, z: 3.5 });
let hitPost = false;
for (let index = 0; index < 60; index++)
    hitPost ||= postBall.updateFlight(1 / 120, []).postCollision;
assert.ok(hitPost, "a trajetória deve colidir com a trave em vez de atravessá-la");

const collisionBallPosition = { x: 0, y: 0.55, z: 0 };
const collisionBall = new FuturebolBallController(collisionBallPosition);
collisionBall.launchPass({ x: 6, y: 0.55, z: 0 });
const blockingPlayer = {
    ...mockAwayDefender,
    position: { x: 3, y: 0, z: 0 },
    targetPosition: { x: 3, y: 0, z: 0 },
    currentSpeed: 0
};
let playerCollision = false;
for (let index = 0; index < 90; index++)
    playerCollision ||= collisionBall.updateFlight(1 / 120, [blockingPlayer]).playerCollisions.includes(blockingPlayer.id);
assert.ok(playerCollision, "a bola livre deve responder à colisão com um jogador");

const rules = new FuturebolMatchRules();
const goal = rules.evaluateBoundary(
    { x: 24.9, y: 1, z: 0 },
    { x: 25.1, y: 1, z: 0 },
    "home"
);
assert.equal(goal.kind, "Goal");
assert.equal(goal.scoringTeam, "home");
assert.equal(goal.restartType, "Kickoff");

const goalState = new FuturebolMatchState("gameplay-goal-restart");
goalState.applyMarket(snapshot, "home");
goalState.forceShot("home", "Goal");
let goalDetected = false;
let restartDetected = false;
for (let index = 0; index < 480; index++) {
    goalState.update(1 / 60);
    goalDetected ||= goalState.homeScore === 1;
    restartDetected ||=
        goalDetected &&
        (goalState.currentPlayPhase === "Resetting" || goalState.currentPlayPhase === "Cooldown");
}
assert.ok(goalDetected, "a travessia válida da linha deve registrar o gol");
assert.ok(restartDetected, "a partida deve entrar no fluxo de reinício depois do gol");
assert.equal(goalState.lastRestartType, "Kickoff");

const goalkeeperState = new FuturebolMatchState("gameplay-goalkeeper");
goalkeeperState.applyMarket(snapshot, "home");
goalkeeperState.forceShot("home", "Saved");
const goalkeeper = goalkeeperState.players.find(player => player.id === "away-goalkeeper");
let goalkeeperReacted = false;
let goalkeeperTrackedLaterally = false;
for (let index = 0; index < 420; index++) {
    goalkeeperState.update(1 / 60);
    goalkeeperReacted ||= goalkeeper.animation === "goalkeeper-dive";
    goalkeeperTrackedLaterally ||= Math.abs(goalkeeper.targetPosition.z) > 0.2;
    assert.ok(Math.abs(goalkeeper.position.x - goalkeeper.basePosition.x) <= 0.56);
    assert.ok(Math.abs(goalkeeper.position.z) <= 3.36);
}
assert.ok(goalkeeperReacted, "o goleiro deve reagir à trajetória do chute");
assert.ok(goalkeeperTrackedLaterally, "o goleiro deve acompanhar lateralmente a bola");
assert.ok(Math.abs(goalkeeper.targetPosition.z) < 0.05, "o goleiro deve voltar ao centro no reinício");

// --- PASSO 15: diagnostics ---
{
    const diagState = new FuturebolMatchState("diag-test");
    diagState.applyMarket(snapshot, "home");
    const diag = diagState.diagnostics();
    assert.equal(diag.phase, "Neutral");
    assert.equal(diag.ballState, "Free");
    assert.equal(diag.activeTeam, null);
    assert.equal(diag.players.length, 6);
    assert.ok(typeof diag.elapsed === "number");
    assert.ok(typeof diag.pressure === "number");
    assert.ok(typeof diag.scenario.scenarioType === "string" || diag.scenario.scenarioType === null);
    assert.ok(Array.isArray(diag.players));
    const homeGK = diag.players.find(p => p.id === "home-goalkeeper");
    assert.ok(homeGK, "diagnostics deve incluir goleiro home");
    assert.equal(homeGK.team, "home");
    assert.equal(homeGK.role, "goalkeeper");
    assert.ok(typeof homeGK.facingAngle === "number");
    assert.ok(typeof homeGK.currentSpeed === "number");
}

// --- PASSO 15: diagnostics during active scenario ---
{
    const diagActive = new FuturebolMatchState("diag-active");
    diagActive.applyMarket(snapshot, "home");
    for (let i = 0; i < 200; i++) diagActive.update(1 / 60);
    const activeDiag = diagActive.diagnostics();
    assert.ok(activeDiag.scenario.scenarioType === null || activeDiag.scenario.scenarioType.length > 0,
        "diagnostics during active play deve ter scenario type");
    assert.ok(activeDiag.players.every(p => p.tacticalIntent.length > 0),
        "todos os jogadores devem ter tacticalIntent");
}

// --- PASSO 15: collective behavior sends off-ball targets during scenario ---
{
    const cbState = new FuturebolMatchState("collective-behavior");
    cbState.applyMarket(snapshot, "home");
    for (let i = 0; i < 200; i++) cbState.update(1 / 60);

    if (cbState.actionController.isActive) {
        const attackingTeam = cbState.activeTeam;
        const defendingTeam = attackingTeam === "home" ? "away" : "home";
        const defPlayer = cbState.players.find(p => p.team === defendingTeam && p.role === "defender");
        assert.ok(defPlayer, "deve haver defensor do time defensor");
        assert.ok(Math.abs(defPlayer.targetPosition.z) < 12, "target do defensor deve estar dentro do campo");
        assert.ok(defPlayer.targetPosition.x > -23 && defPlayer.targetPosition.x < 23, "target x deve estar dentro do campo");
    }
}

// --- PASSO 15: GiveAndGo has Dribble after second pass ---
{
    const ggCtrl = new FuturebolScenarioController();
    let ggCount = 0;
    let ggWithDribble = 0;
    for (let i = 0; i < 50; i++) {
        const s = ggCtrl.selectScenario("home", "Goal", 12345, i);
        if (s.type === "GiveAndGo") {
            ggCount++;
            const hasDribble = s.actions.some(a => a.kind === "PlayerAction" && a.type === "Dribble");
            if (hasDribble) ggWithDribble++;
        }
    }
    assert.ok(ggWithDribble > 0, `GiveAndGo deve ter ao menos 1 Dribble action em ${ggCount} cenários, teve ${ggWithDribble}`);
}

// --- PASSO 15: CounterAttack has Dribble ---
{
    const caCtrl = new FuturebolScenarioController();
    let caCount = 0;
    let caWithDribble = 0;
    for (let i = 0; i < 50; i++) {
        const s = caCtrl.selectScenario("home", "Goal", 12345, i);
        if (s.type === "CounterAttack") {
            caCount++;
            const hasDribble = s.actions.some(a => a.kind === "PlayerAction" && a.type === "Dribble");
            if (hasDribble) caWithDribble++;
        }
    }
    assert.ok(caWithDribble > 0, `CounterAttack deve ter Dribble action, teve ${caWithDribble}/${caCount}`);
}

// --- PASSO 15: scenario player animations are set correctly ---
{
    const animState = new FuturebolMatchState("anim-test");
    animState.applyMarket(snapshot, "home");
    for (let i = 0; i < 200; i++) animState.update(1 / 60);

    if (animState.actionController.isActive) {
        const ballOwner = animState.players.find(p => p.id === animState.currentBallOwnerId);
        if (ballOwner) {
            assert.ok(
                ballOwner.animation === "run" || ballOwner.animation === "walk" || ballOwner.animation === "kick" || ballOwner.animation === "idle",
                `ball owner animation deve ser válida, recebeu: ${ballOwner.animation}`
            );
        }
    }
}

// --- PASSO 11: diagnostics includes new fields ---
{
    const diagState = new FuturebolMatchState("diag-passo11");
    diagState.applyMarket(snapshot, "home");
    const diag = diagState.diagnostics();
    assert.ok("interceptionPlan" in diag, "diagnostics deve incluir interceptionPlan");
    assert.ok("shotProfile" in diag, "diagnostics deve incluir shotProfile");
    assert.ok("shotResolutionPlan" in diag, "diagnostics deve incluir shotResolutionPlan");
    assert.ok("pendingBranch" in diag, "diagnostics deve incluir pendingBranch");
    assert.ok("requiredOutcome" in diag, "diagnostics deve incluir requiredOutcome");
    assert.ok("shotOrdinal" in diag, "diagnostics deve incluir shotOrdinal");
    assert.ok("branchCount" in diag, "diagnostics deve incluir branchCount");
    assert.ok("looseBallElapsed" in diag, "diagnostics deve incluir looseBallElapsed");
    assert.equal(diag.interceptionPlan, null, "interceptionPlan deve ser null em Neutral");
    assert.equal(diag.shotProfile, null, "shotProfile deve ser null em Neutral");
    assert.equal(diag.shotResolutionPlan, null, "shotResolutionPlan deve ser null em Neutral");
    assert.equal(diag.pendingBranch, null, "pendingBranch deve ser null em Neutral");
    assert.equal(diag.requiredOutcome, null, "requiredOutcome deve ser null em Neutral");
    assert.equal(diag.shotOrdinal, 0, "shotOrdinal deve iniciar em 0");
    assert.equal(diag.branchCount, 0, "branchCount deve iniciar em 0");
    assert.equal(diag.looseBallElapsed, 0, "looseBallElapsed deve iniciar em 0");
}

// --- PASSO 11: action controller diagnostics includes branchCount ---
{
    const acDiagState = new FuturebolMatchState("ac-diag-passo11");
    acDiagState.applyMarket(snapshot, "home");
    for (let i = 0; i < 60; i++) acDiagState.update(1 / 60);
    const acDiag = acDiagState.diagnostics().scenario;
    assert.ok("branchCount" in acDiag, "action controller diagnostics deve incluir branchCount");
    assert.equal(typeof acDiag.branchCount, "number", "branchCount deve ser número");
}

// --- PASSO 11: requiredOutcome set for Goal scenarios ---
{
    const goalDiag = new FuturebolMatchState("goal-required");
    goalDiag.applyMarket(snapshot, "home");
    goalDiag.forceShot("home", "Goal");
    for (let i = 0; i < 30; i++) goalDiag.update(1 / 60);
    const diag = goalDiag.diagnostics();
    if (diag.requiredOutcome) {
        assert.equal(diag.requiredOutcome.outcome, "Goal", "requiredOutcome deve ser Goal");
        assert.equal(diag.requiredOutcome.team, "home", "requiredOutcome team deve ser home");
        assert.equal(diag.requiredOutcome.active, true, "requiredOutcome deve estar ativo");
    }
}

// --- PASSO 11: shot profile appears during shooting phase ---
{
    const shotDiag = new FuturebolMatchState("shot-profile-test");
    shotDiag.applyMarket(snapshot, "home");
    shotDiag.forceShot("home", "Goal");
    let profileSeen = false;
    for (let i = 0; i < 120; i++) {
        shotDiag.update(1 / 60);
        const d = shotDiag.diagnostics();
        profileSeen ||= d.shotProfile !== null;
    }
    assert.ok(profileSeen, "shotProfile deve ser definido durante o chute");
}

// --- PASSO 11: action controller returns object with completed + result ---
{
    import("../../dist/futurebol/futurebol-action-controller.js").then(({ ActionController }) => {
        const ac = new ActionController();
        ac.startScenario({
            id: "return-type-test",
            type: "DirectAttack",
            attackingTeam: "home",
            expectedOutcome: "Goal",
            actions: [
                { kind: "PlayerAction", type: "MoveTo", playerId: "home-defender", team: "home", duration: 0.3, target: { x: 5, y: 0, z: 1 } }
            ]
        });
        const result = ac.update(0.1, {
            ballOwnerId: null, ballState: "Free", ballPosition: { x: 0, y: 0.55, z: 0 },
            ballVelocity: { x: 0, y: 0, z: 0 }, playPhase: "BuildUp", outcome: null,
            phaseElapsed: 0, intendedReceiverId: null,
            lastActionResult: null, possessionTeam: null, requiredOutcome: null
        });
        assert.ok(typeof result === "object", "update deve retornar objeto");
        assert.ok("completed" in result, "resultado deve ter campo completed");
        assert.ok("result" in result, "resultado deve ter campo result");
        assert.equal(typeof result.completed, "boolean", "completed deve ser booleano");
    });
}

// --- PASSO 11: injectContinuationActions increments branchCount ---
{
    import("../../dist/futurebol/futurebol-action-controller.js").then(({ ActionController }) => {
        const ac = new ActionController();
        ac.startScenario({
            id: "branch-test",
            type: "DirectAttack",
            attackingTeam: "home",
            expectedOutcome: "Goal",
            actions: [
                { kind: "PlayerAction", type: "MoveTo", playerId: "home-defender", team: "home", duration: 10, target: { x: 5, y: 0, z: 1 } }
            ]
        });
        assert.equal(ac.currentBranchCount, 0);
        ac.injectContinuationActions([
            { kind: "PlayerAction", type: "RunTo", playerId: "home-attacker", team: "home", duration: 0.5, target: { x: 10, y: 0, z: 0 } }
        ]);
        assert.equal(ac.currentBranchCount, 1);
        ac.injectContinuationActions([
            { kind: "PlayerAction", type: "RunTo", playerId: "home-attacker", team: "home", duration: 0.5, target: { x: 10, y: 0, z: 0 } }
        ]);
        assert.equal(ac.currentBranchCount, 2);
        ac.injectContinuationActions([
            { kind: "PlayerAction", type: "RunTo", playerId: "home-attacker", team: "home", duration: 0.5, target: { x: 10, y: 0, z: 0 } }
        ]);
        assert.equal(ac.currentBranchCount, 2, "branchCount não deve exceder MAX_SCENARIO_BRANCHES");
    });
}

console.log("Futurebol gameplay systems tests passed.");
