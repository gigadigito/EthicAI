import assert from "node:assert/strict";
import { FuturebolMatchState } from "../../dist/futurebol/futurebol-match-state.js";

const offensiveSnapshot = {
    sequence: 42,
    timestamp: "2026-01-01T00:00:21.000Z",
    home: { symbol: "BTC", price: 65000, changePercent: 1.2, momentum: 88, volumeStrength: 72 },
    away: { symbol: "ETH", price: 3500, changePercent: -0.4, momentum: 28, volumeStrength: 61 }
};

const state = new FuturebolMatchState("futurebol-demo-001");
assert.equal(state.players.length, 6);
assert.deepEqual(state.players.filter(player => player.team === "home").map(player => player.role), ["goalkeeper", "defender", "attacker"]);
assert.deepEqual(state.players.filter(player => player.team === "away").map(player => player.role), ["goalkeeper", "defender", "attacker"]);
assert.ok(state.players.every(player => Number.isFinite(player.facingAngle)));

state.applyMarket(offensiveSnapshot, null);
const automaticPhases = new Set();
let automaticHadOwner = false;
let automaticHadPass = false;
let minimumPlayerSeparation = Number.POSITIVE_INFINITY;
for (let index = 0; index < 900; index++) {
    state.update(1 / 60);
    automaticPhases.add(state.currentPlayPhase);
    automaticHadOwner ||= state.currentBallOwnerId !== null;
    automaticHadPass ||= state.ballState === "Passing";
    for (let first = 0; first < state.players.length; first++) {
        for (let second = first + 1; second < state.players.length; second++) {
            const a = state.players[first].position;
            const b = state.players[second].position;
            minimumPlayerSeparation = Math.min(minimumPlayerSeparation, Math.hypot(a.x - b.x, a.z - b.z));
        }
    }
}

for (const expectedPhase of ["BuildUp", "Outcome", "Resetting", "Cooldown"])
    assert.ok(automaticPhases.has(expectedPhase), `a jogada automática deve visitar ${expectedPhase}; vistas=${[...automaticPhases].join(',')}`);
assert.ok(automaticHadOwner, "a jogada automática deve estabelecer posse");
assert.ok(state.cooldownRemainingSeconds > 0 && state.cooldownRemainingSeconds <= 25, `cooldown ${state.cooldownRemainingSeconds}`);

const passState = new FuturebolMatchState("futurebol-pass-001");
passState.applyMarket(offensiveSnapshot, "home");
passState.forcePass("home");
assert.equal(passState.currentBallOwnerId, "home-defender");
assert.equal(passState.intendedReceiverId, "home-attacker");
let passSeen = false;
let maxPassHeight = 0;
let receiverControlled = false;
for (let index = 0; index < 160; index++) {
    passState.update(1 / 60);
    passSeen ||= passState.ballState === "Passing";
    maxPassHeight = Math.max(maxPassHeight, passState.ballPosition.y);
    receiverControlled ||= passSeen && passState.currentBallOwnerId === "home-attacker" && passState.ballState === "Controlled";
}
assert.ok(passSeen, "o passe deve colocar a bola no estado Passing");
assert.ok(maxPassHeight > 1, "o passe deve possuir arco parabólico visível");
assert.ok(receiverControlled, "a posse só deve mudar depois do domínio do atacante");
assert.equal(passState.lastBallOwnerId, "home-defender");

const goalState = new FuturebolMatchState("futurebol-goal-001");
goalState.applyMarket(offensiveSnapshot, "home");
goalState.forceShot("home", "Goal");
let shotSeen = false;
let goalkeeperReacted = false;
let crossedGoalLine = false;
for (let index = 0; index < 360; index++) {
    goalState.update(1 / 60);
    shotSeen ||= goalState.ballState === "Shooting";
    goalkeeperReacted ||= goalState.players.find(player => player.id === "away-goalkeeper").animation === "goalkeeper-dive";
    crossedGoalLine ||= goalState.ballPosition.x > 25;
}
assert.ok(shotSeen, "o atacante deve chutar");
assert.ok(goalkeeperReacted, "o goleiro deve reagir ao chute");
assert.ok(crossedGoalLine, "um gol deve cruzar visualmente a linha");
assert.equal(goalState.homeScore, 1);
assert.equal(goalState.awayScore, 0);

const savedState = new FuturebolMatchState("futurebol-save-001");
savedState.applyMarket(offensiveSnapshot, "away");
savedState.forceShot("away", "Saved");
let savedSeen = false;
for (let index = 0; index < 300; index++) {
    savedState.update(1 / 60);
    savedSeen ||= savedState.ballState === "Saved";
}
assert.ok(savedSeen, "a defesa deve colocar a bola no estado Saved");
assert.equal(savedState.homeScore, 0);
assert.equal(savedState.awayScore, 0);

const deterministicA = new FuturebolMatchState("same-seed");
const deterministicB = new FuturebolMatchState("same-seed");
deterministicA.applyMarket(offensiveSnapshot, "home");
deterministicB.applyMarket(offensiveSnapshot, "home");
deterministicA.forceShot("home");
deterministicB.forceShot("home");
for (let index = 0; index < 360; index++) {
    deterministicA.update(1 / 60);
    deterministicB.update(1 / 60);
    if (index % 15 === 0) {
        assert.equal(deterministicA.currentPlayPhase, deterministicB.currentPlayPhase);
        assert.equal(deterministicA.ballState, deterministicB.ballState);
        assert.equal(deterministicA.ballPosition.x, deterministicB.ballPosition.x);
        assert.equal(deterministicA.ballPosition.z, deterministicB.ballPosition.z);
    }
}
assert.equal(deterministicA.homeScore, deterministicB.homeScore);

for (const player of state.players) {
    assert.ok(player.position.x >= -23 && player.position.x <= 23);
    assert.ok(player.position.z >= -13 && player.position.z <= 13);
}

goalState.reset();
assert.equal(goalState.elapsedSeconds, 0);
assert.equal(goalState.homeScore, 0);
assert.equal(goalState.ballPosition.x, 0);
assert.equal(goalState.currentPlayPhase, "Neutral");

// V2: formação neutra realmente imóvel.
const idleState = new FuturebolMatchState("idle-state");
const initialPositions = idleState.players.map(player => ({ ...player.position }));
for (let index = 0; index < 180; index++) idleState.update(1 / 60);
assert.deepEqual(idleState.players.map(player => player.position), initialPositions);
assert.ok(idleState.players.every(player => player.currentSpeed === 0));

// V3: goleiros não abandonam a área enquanto acompanham a jogada.
for (const goalkeeper of state.players.filter(player => player.role === "goalkeeper")) {
    const expectedX = goalkeeper.team === "home" ? -21.2 : 21.2;
    assert.ok(Math.abs(goalkeeper.position.x - expectedX) <= 0.56);
    assert.ok(Math.abs(goalkeeper.position.z) <= 3.36);
}

console.log("Futurebol match state V3 tests passed");
