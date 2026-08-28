import assert from "node:assert/strict";
import { FuturebolBallController } from "../../dist/futurebol/futurebol-ball-controller.js";
import { FuturebolMatchRules } from "../../dist/futurebol/futurebol-match-rules.js";
import { FuturebolMatchState } from "../../dist/futurebol/futurebol-match-state.js";
import { FuturebolPlayerAI } from "../../dist/futurebol/futurebol-player-ai.js";

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
const owner = tacticalState.players.find(player => player.id === "home-defender");
const attacker = tacticalState.players.find(player => player.id === "home-attacker");
const passOption = ai.selectPassReceiver({
    owner,
    attackingTeam: "home",
    teammates: tacticalState.players.filter(player => player.team === "home"),
    opponents: tacticalState.players.filter(player => player.team === "away")
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
    ...tacticalState.players.find(player => player.id === "away-defender"),
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

console.log("Futurebol gameplay systems tests passed.");
