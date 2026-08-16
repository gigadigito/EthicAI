import assert from "node:assert/strict";
import { FuturebolMatchState } from "../../dist/futurebol/futurebol-match-state.js";

const marketSnapshot = {
    sequence: 90,
    timestamp: "2026-08-06T12:00:00.000Z",
    home: { symbol: "BTC", price: 65000, changePercent: 2, momentum: 90, volumeStrength: 75 },
    away: { symbol: "ETH", price: 3500, changePercent: -1, momentum: 10, volumeStrength: 25 }
};

function officialState(overrides = {}) {
    return {
        matchId: 321,
        sequence: 0,
        status: "Ongoing",
        homeScore: 0,
        awayScore: 0,
        elapsedSeconds: 480,
        isFinished: false,
        observedAtUtc: "2026-08-06T12:00:00.000Z",
        scoreEvents: [],
        ...overrides
    };
}

function scoreEvent(id, sequence, team, points = 1) {
    return {
        id,
        sequence,
        team,
        points,
        eventType: "REPLAY_TEST_GOAL",
        occurredAtUtc: `2026-08-06T12:00:${String(sequence).padStart(2, "0")}.000Z`
    };
}

function advanceUntil(state, predicate, maxFrames = 5000) {
    for (let frame = 0; frame < maxFrames; frame++) {
        state.update(1 / 30);
        if (predicate())
            return;
    }
    assert.fail(`state did not reach the expected condition after ${maxFrames} frames`);
}

const scoreState = new FuturebolMatchState("official-score", true);
scoreState.update(2);
assert.equal(scoreState.displayElapsedSeconds, 0, "modo API não deve usar relógio local sem estado oficial");
scoreState.applyOfficialMatchState(officialState({ homeScore: 2, awayScore: 1 }), false);
assert.equal(scoreState.homeScore, 2, "o placar home deve vir do estado oficial");
assert.equal(scoreState.awayScore, 1, "o placar away deve vir do estado oficial");
assert.ok(scoreState.displayElapsedSeconds >= 480, "o relógio deve partir do tempo oficial");

scoreState.forceShot("away", "Goal");
let localGoalWasInvented = false;
for (let index = 0; index < 360; index++) {
    scoreState.update(1 / 60);
    localGoalWasInvented ||= scoreState.lastPlayOutcome === "Goal";
}
assert.equal(localGoalWasInvented, false, "uma jogada local não pode inventar gol no modo API");
assert.equal(scoreState.homeScore, 2);
assert.equal(scoreState.awayScore, 1, "a jogada local não pode sobrescrever o placar oficial");

const eventState = new FuturebolMatchState("official-event", true);
eventState.applyOfficialMatchState(officialState(), false);
eventState.applyOfficialMatchState(officialState({
    sequence: 1,
    homeScore: 1,
    scoreEvents: [{
        id: 1001,
        sequence: 1,
        team: "home",
        points: 1,
        eventType: "PERCENT_THRESHOLD_GOAL",
        occurredAtUtc: "2026-08-06T12:00:01.000Z"
    }]
}), true);

let officialShotSeen = false;
let officialGoalSeen = false;
let crossedGoalLine = false;
for (let index = 0; index < 360; index++) {
    eventState.update(1 / 60);
    officialShotSeen ||= eventState.ballState === "Shooting";
    officialGoalSeen ||= eventState.lastPlayOutcome === "Goal";
    crossedGoalLine ||= eventState.ballPosition.x > 25;
}
assert.ok(officialShotSeen, "um evento oficial deve disparar a sequência de chute");
assert.ok(officialGoalSeen, "um evento oficial deve produzir a encenação visual de gol");
assert.ok(crossedGoalLine, "a encenação oficial deve cruzar a linha do gol correto");
assert.equal(eventState.homeScore, 1, "a animação não deve incrementar novamente o placar oficial");
assert.equal(eventState.awayScore, 0);
assert.equal(eventState.isSynchronizationReplay, false, "um gol ao vivo não deve ativar o replay inicial");

eventState.reset();
assert.equal(eventState.homeScore, 1, "reset deve preservar o placar oficial no modo API");
assert.equal(eventState.awayScore, 0);
assert.ok(eventState.displayElapsedSeconds >= 480, "reset deve preservar o relógio oficial");
assert.equal(eventState.currentPlayPhase, "Neutral");

const resetDuringGoalState = new FuturebolMatchState("official-reset-cinematic", true);
resetDuringGoalState.applyOfficialMatchState(officialState(), false);
resetDuringGoalState.applyOfficialMatchState(officialState({
    sequence: 2,
    awayScore: 1,
    scoreEvents: [{
        id: 1002,
        sequence: 2,
        team: "away",
        points: 1,
        eventType: "VOLUME_CROSSOVER_GOAL",
        occurredAtUtc: "2026-08-06T12:00:02.000Z"
    }]
}), true);
resetDuringGoalState.reset();
let resumedOfficialGoal = false;
for (let index = 0; index < 360; index++) {
    resetDuringGoalState.update(1 / 60);
    resumedOfficialGoal ||= resetDuringGoalState.lastPlayOutcome === "Goal";
}
assert.ok(resumedOfficialGoal, "reset durante um gol oficial deve preservar a cinematografia pendente");
assert.equal(resetDuringGoalState.awayScore, 1);

const reloadState = new FuturebolMatchState("official-reload", true);
const recovered = officialState({
    sequence: 3,
    homeScore: 2,
    awayScore: 1,
    elapsedSeconds: 900,
    status: "Completed",
    isFinished: true,
    scoreEvents: [{
        id: 2001,
        sequence: 3,
        team: "away",
        points: 1,
        eventType: "CANDLE_BATTLE_DOMINANCE",
        occurredAtUtc: "2026-08-06T12:05:00.000Z"
    }]
});
reloadState.applyOfficialMatchState(recovered, false);
assert.equal(reloadState.homeScore, 2);
assert.equal(reloadState.awayScore, 1);
assert.equal(reloadState.displayElapsedSeconds, 900);
assert.equal(reloadState.currentPlayPhase, "Neutral", "reload não deve repetir eventos históricos");
reloadState.applyOfficialMatchState(recovered, true);
assert.equal(reloadState.currentPlayPhase, "Neutral", "reconexão não deve repetir evento já conhecido");
reloadState.applyOfficialMatchState(officialState({ sequence: 2, homeScore: 0, awayScore: 0 }), true);
assert.equal(reloadState.homeScore, 2, "estado oficial obsoleto não deve sobrescrever o estado recuperado");
assert.equal(reloadState.awayScore, 1);
reloadState.applyOfficialMatchState(officialState({ sequence: 3, homeScore: 1, awayScore: 0 }), true);
assert.equal(reloadState.homeScore, 2, "a mesma versão não pode retroceder o placar oficial");
assert.equal(reloadState.awayScore, 1);

const multiPointState = new FuturebolMatchState("official-multipoint", true);
multiPointState.applyOfficialMatchState(officialState(), false);
multiPointState.applyOfficialMatchState(officialState({
    sequence: 8,
    homeScore: 3,
    scoreEvents: [{
        id: 3001,
        sequence: 8,
        team: "home",
        points: 3,
        eventType: "MULTI_POINT",
        occurredAtUtc: "2026-08-06T12:08:00.000Z"
    }]
}), true);
assert.equal(multiPointState.homeScore, 3, "evento multiponto deve aplicar o placar oficial integral");
multiPointState.applyOfficialMatchState(officialState({
    sequence: 8,
    homeScore: 3,
    scoreEvents: [{ id: 3001, sequence: 8, team: "home", points: 3, eventType: "MULTI_POINT", occurredAtUtc: "2026-08-06T12:08:00.000Z" }]
}), true);
assert.equal(multiPointState.homeScore, 3, "evento duplicado não pode somar pontos localmente");

const targetFiveSevenEvents = [
    "home", "away", "away", "home", "home", "away",
    "away", "home", "away", "away", "home", "away"
].map((team, index) => scoreEvent(4000 + index, index + 1, team));
const targetFiveSevenState = new FuturebolMatchState("official-initial-replay-5x7", true);
targetFiveSevenState.applyOfficialMatchState(officialState({
    sequence: 12,
    homeScore: 5,
    awayScore: 7,
    scoreEvents: []
}), false);
targetFiveSevenState.applyOfficialMatchState(officialState({
    sequence: 12,
    homeScore: 5,
    awayScore: 7,
    scoreEvents: targetFiveSevenEvents
}), true);
assert.equal(targetFiveSevenState.isSynchronizationReplay, true, "o histórico recebido após o placar deve iniciar REPLAY");
assert.equal(targetFiveSevenState.displayHomeScore, 0, "o HUD do replay não pode começar no placar autoritativo 5x7");
assert.equal(targetFiveSevenState.displayAwayScore, 0, "o HUD do replay deve começar antes dos eventos históricos");
assert.equal(targetFiveSevenState.homeScore, 5, "a animação não pode alterar o placar home autoritativo");
assert.equal(targetFiveSevenState.awayScore, 7, "a animação não pode alterar o placar away autoritativo");

const replaySequence = ["home", "away", "away", "home"];
const replayEvents = replaySequence.map((team, index) => scoreEvent(5000 + index, index + 1, team));
const replayState = new FuturebolMatchState("official-initial-replay-sequence", true);
replayState.applyOfficialMatchState(officialState({
    sequence: 4,
    homeScore: 2,
    awayScore: 2,
    scoreEvents: []
}), false);
replayState.applyOfficialMatchState(officialState({
    sequence: 4,
    homeScore: 2,
    awayScore: 2,
    scoreEvents: replayEvents
}), true);

const observedReplayScores = ["0x0"];
let lastReplayScore = "0x0";
advanceUntil(replayState, () => {
    const score = `${replayState.displayHomeScore}x${replayState.displayAwayScore}`;
    if (score !== lastReplayScore) {
        observedReplayScores.push(score);
        lastReplayScore = score;
    }
    assert.equal(replayState.homeScore, 2, "o replay nunca pode sobrescrever o home autoritativo");
    assert.equal(replayState.awayScore, 2, "o replay nunca pode sobrescrever o away autoritativo");
    return !replayState.isSynchronizationReplay;
});
assert.deepEqual(
    observedReplayScores,
    ["0x0", "1x0", "1x1", "1x2", "2x2"],
    "o placar visual deve seguir a ordem real dos gols encenados"
);
assert.equal(replayState.isSynchronizationReplay, false, "REPLAY deve desaparecer após o último histórico");
assert.equal(replayState.displayHomeScore, 2);
assert.equal(replayState.displayAwayScore, 2);

const liveEvent = scoreEvent(5004, 5, "home");
replayState.applyOfficialMatchState(officialState({
    sequence: 5,
    homeScore: 3,
    awayScore: 2,
    scoreEvents: [...replayEvents, liveEvent]
}), true);
assert.equal(replayState.isSynchronizationReplay, false, "um gol novo depois do catch-up não pode reativar REPLAY");
assert.equal(replayState.displayHomeScore, 3, "depois do replay o HUD deve voltar ao placar live");
assert.equal(replayState.homeScore, 3, "o placar live continua sendo autoritativo");

const alreadySynchronizedState = new FuturebolMatchState("official-no-catch-up", true);
alreadySynchronizedState.applyOfficialMatchState(officialState({
    sequence: 2,
    homeScore: 1,
    awayScore: 1,
    scoreEvents: [scoreEvent(6001, 1, "home"), scoreEvent(6002, 2, "away")]
}), false);
assert.equal(alreadySynchronizedState.isSynchronizationReplay, false, "estado já carregado não deve mostrar REPLAY");
assert.equal(alreadySynchronizedState.displayHomeScore, 1);
assert.equal(alreadySynchronizedState.displayAwayScore, 1);

const frozenPositions = reloadState.players.map(player => ({ ...player.position }));
for (let index = 0; index < 120; index++) reloadState.update(1 / 60);
assert.deepEqual(
    reloadState.players.map(player => player.position),
    frozenPositions,
    "partida finalizada deve congelar a simulação oficial"
);

const mockState = new FuturebolMatchState("mock-regression");
mockState.applyMarket(marketSnapshot, "home");
mockState.forceShot("home", "Goal");
for (let index = 0; index < 360; index++)
    mockState.update(1 / 60);
assert.equal(mockState.homeScore, 1, "o modo mock deve continuar contabilizando gols locais");
mockState.reset();
assert.equal(mockState.homeScore, 0, "o reset mock deve continuar limpando o placar local");

console.log("Futurebol official match state tests passed");
