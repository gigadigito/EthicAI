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
    initialHistoryReady: true,
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
    initialHistoryReady: true,
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
    initialHistoryReady: true,
    scoreEvents: [
        scoreEvent(2001, 1, "home"),
        scoreEvent(2002, 2, "home"),
        scoreEvent(2003, 3, "away")
    ]
});
reloadState.applyOfficialMatchState(recovered, false);
assert.equal(reloadState.homeScore, 2);
assert.equal(reloadState.awayScore, 1);
assert.equal(reloadState.displayElapsedSeconds, 900);
assert.equal(reloadState.isSynchronizationReplay, true, "reload com histórico pronto deve iniciar REPLAY imediatamente (Path B)");
assert.equal(reloadState.displayHomeScore, 0, "reload REPLAY começa em 0x0");
advanceUntil(reloadState, () => !reloadState.isSynchronizationReplay);
assert.equal(reloadState.displayHomeScore, 2, "reload REPLAY atinge placar autoritativo");
assert.equal(reloadState.displayAwayScore, 1);
assert.equal(reloadState.homeScore, 2, "reload REPLAY preserva placar autoritativo");
assert.equal(reloadState.awayScore, 1);
reloadState.applyOfficialMatchState(officialState({ sequence: 2, homeScore: 0, awayScore: 0 }), true);
assert.equal(reloadState.homeScore, 2, "estado oficial obsoleto não deve sobrescrever o estado recuperado");
assert.equal(reloadState.awayScore, 1);
reloadState.applyOfficialMatchState(officialState({ sequence: 3, homeScore: 1, awayScore: 0, isFinished: true }), true);
assert.equal(reloadState.homeScore, 2, "a mesma versão não pode retroceder o placar oficial");
assert.equal(reloadState.awayScore, 1);

const multiPointState = new FuturebolMatchState("official-multipoint", true);
multiPointState.applyOfficialMatchState(officialState(), false);
multiPointState.applyOfficialMatchState(officialState({
    sequence: 8,
    homeScore: 3,
    initialHistoryReady: true,
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
    initialHistoryReady: true,
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
    initialHistoryReady: true,
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
    initialHistoryReady: true,
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
    initialHistoryReady: true,
    scoreEvents: [scoreEvent(6001, 1, "home"), scoreEvent(6002, 2, "away")]
}), false);
assert.equal(alreadySynchronizedState.isSynchronizationReplay, true, "Path B: histórico pronto no initialize deve iniciar REPLAY");
assert.equal(alreadySynchronizedState.displayHomeScore, 0);
assert.equal(alreadySynchronizedState.displayAwayScore, 0);
advanceUntil(alreadySynchronizedState, () => !alreadySynchronizedState.isSynchronizationReplay);
assert.equal(alreadySynchronizedState.displayHomeScore, 1);
assert.equal(alreadySynchronizedState.displayAwayScore, 1);

advanceUntil(reloadState, () => !reloadState.isSynchronizationReplay);
for (let i = 0; i < 300; i++) reloadState.update(1 / 60);
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

const sevenSixEvents = [
    "home", "home", "away", "home", "away", "home", "away",
    "away", "home", "away", "home", "away", "home"
].map((team, index) => scoreEvent(7000 + index, index + 1, team));
const sevenSixState = new FuturebolMatchState("official-replay-7x6", true);
sevenSixState.applyOfficialMatchState(officialState({
    sequence: 13,
    homeScore: 7,
    awayScore: 6,
    scoreEvents: []
}), false);
assert.equal(sevenSixState.synchronizationPhase, "BOOTSTRAP_PENDING", "7x6 aguarda histórico antes do REPLAY");
sevenSixState.applyOfficialMatchState(officialState({
    sequence: 13,
    homeScore: 7,
    awayScore: 6,
    initialHistoryReady: true,
    scoreEvents: sevenSixEvents
}), true);
assert.equal(sevenSixState.isSynchronizationReplay, true, "7x6 deve iniciar REPLAY");
assert.equal(sevenSixState.synchronizationPhase, "REPLAY");
assert.equal(sevenSixState.displayHomeScore, 0, "REPLAY 7x6 deve começar em 0x0");
assert.equal(sevenSixState.displayAwayScore, 0);
assert.equal(sevenSixState.homeScore, 7, "placar autoritativo 7x6 preservado");
assert.equal(sevenSixState.awayScore, 6);

advanceUntil(sevenSixState, () => !sevenSixState.isSynchronizationReplay);
assert.equal(sevenSixState.displayHomeScore, 7, "REPLAY 7x6 deve terminar em 7x6");
assert.equal(sevenSixState.displayAwayScore, 6);
assert.equal(sevenSixState.homeScore, 7);
assert.equal(sevenSixState.awayScore, 6);
assert.equal(sevenSixState.synchronizationPhase, "LIVE", "último cinematic 7x6 deve concluir em LIVE");

sevenSixState.applyOfficialMatchState(officialState({
    sequence: 14,
    homeScore: 8,
    awayScore: 6,
    scoreEvents: [...sevenSixEvents, scoreEvent(7013, 14, "home")]
}), true);
assert.equal(sevenSixState.isSynchronizationReplay, false, "gol live pós-replay não reativa REPLAY");
assert.equal(sevenSixState.displayHomeScore, 8);
assert.equal(sevenSixState.homeScore, 8);
assert.equal(sevenSixState.synchronizationPhase, "LIVE", "gol posterior não pode reabrir REPLAY");

const advancingCatchUpState = new FuturebolMatchState("official-replay-advancing-target", true);
const firstCatchUpEvent = scoreEvent(7500, 1, "home");
advancingCatchUpState.applyOfficialMatchState(officialState({
    sequence: 1,
    homeScore: 1,
    initialHistoryReady: true,
    scoreEvents: [firstCatchUpEvent]
}), false);
assert.equal(advancingCatchUpState.synchronizationPhase, "REPLAY");
advancingCatchUpState.applyOfficialMatchState(officialState({
    sequence: 2,
    homeScore: 2,
    initialHistoryReady: true,
    scoreEvents: [firstCatchUpEvent, scoreEvent(7501, 2, "home")]
}), true);
advanceUntil(advancingCatchUpState, () => !advancingCatchUpState.isSynchronizationReplay);
assert.equal(advancingCatchUpState.displayHomeScore, 2, "gol recebido durante catch-up deve tornar o novo alvo alcançável");
assert.equal(advancingCatchUpState.displayAwayScore, 0);
assert.equal(advancingCatchUpState.synchronizationPhase, "LIVE", "catch-up com alvo atualizado também deve terminar");

const oneZeroEvents = [scoreEvent(8000, 1, "home")];
const oneZeroState = new FuturebolMatchState("official-replay-1x0", true);
oneZeroState.applyOfficialMatchState(officialState({
    sequence: 1,
    homeScore: 1,
    awayScore: 0,
    scoreEvents: []
}), false);
oneZeroState.applyOfficialMatchState(officialState({
    sequence: 1,
    homeScore: 1,
    awayScore: 0,
    initialHistoryReady: true,
    scoreEvents: oneZeroEvents
}), true);
assert.equal(oneZeroState.isSynchronizationReplay, true, "1x0 com histórico deve iniciar REPLAY");
assert.equal(oneZeroState.synchronizationPhase, "REPLAY");
assert.equal(oneZeroState.displayHomeScore, 0, "REPLAY 1x0 deve começar em 0x0");
assert.equal(oneZeroState.displayAwayScore, 0);

advanceUntil(oneZeroState, () => !oneZeroState.isSynchronizationReplay);
assert.equal(oneZeroState.displayHomeScore, 1, "REPLAY 1x0 deve terminar em 1x0");
assert.equal(oneZeroState.displayAwayScore, 0);
assert.equal(oneZeroState.synchronizationPhase, "LIVE");

const zeroZeroEmpty = new FuturebolMatchState("official-zero-zero-empty", true);
zeroZeroEmpty.applyOfficialMatchState(officialState({
    sequence: 0,
    homeScore: 0,
    awayScore: 0,
    scoreEvents: []
}), false);
assert.equal(zeroZeroEmpty.isSynchronizationReplay, false, "0x0 sem histórico não deve ativar REPLAY");
assert.equal(zeroZeroEmpty.displayHomeScore, 0);
zeroZeroEmpty.applyOfficialMatchState(officialState({
    sequence: 1,
    homeScore: 0,
    awayScore: 0,
    initialHistoryReady: true,
    scoreEvents: []
}), true);
assert.equal(zeroZeroEmpty.isSynchronizationReplay, false, "0x0 com histórico vazio vai direto para LIVE");
assert.equal(zeroZeroEmpty.displayHomeScore, 0);
assert.equal(zeroZeroEmpty.synchronizationPhase, "LIVE", "histórico vazio deve sair de BOOTSTRAP_PENDING sem exibir REPLAY");
zeroZeroEmpty.applyOfficialMatchState(officialState({
    sequence: 2,
    homeScore: 1,
    awayScore: 0,
    initialHistoryReady: true,
    scoreEvents: [scoreEvent(9000, 1, "home")]
}), true);
assert.equal(zeroZeroEmpty.isSynchronizationReplay, false, "primeiro gol real deve ser LIVE");
assert.equal(zeroZeroEmpty.displayHomeScore, 1);
assert.equal(zeroZeroEmpty.homeScore, 1);

const groupedLiveGoals = new FuturebolMatchState("official-grouped-live", true);
groupedLiveGoals.applyOfficialMatchState(officialState({
    sequence: 0,
    homeScore: 0,
    awayScore: 0,
    initialHistoryReady: true,
    scoreEvents: []
}), true);
assert.equal(groupedLiveGoals.isSynchronizationReplay, false);
assert.equal(groupedLiveGoals.displayHomeScore, 0);
groupedLiveGoals.applyOfficialMatchState(officialState({
    sequence: 3,
    homeScore: 2,
    awayScore: 0,
    initialHistoryReady: true,
    scoreEvents: [
        scoreEvent(9100, 1, "home"),
        scoreEvent(9101, 2, "home")
    ]
}), true);
assert.equal(groupedLiveGoals.isSynchronizationReplay, false, "gols agrupados em LIVE continuam LIVE");
assert.equal(groupedLiveGoals.displayHomeScore, 2);
assert.equal(groupedLiveGoals.homeScore, 2);

const reloadReplayState = new FuturebolMatchState("official-reload-replay", true);
reloadReplayState.applyOfficialMatchState(officialState({
    sequence: 13,
    homeScore: 7,
    awayScore: 6,
    scoreEvents: []
}), false);
reloadReplayState.applyOfficialMatchState(officialState({
    sequence: 13,
    homeScore: 7,
    awayScore: 6,
    initialHistoryReady: true,
    scoreEvents: sevenSixEvents
}), true);
assert.equal(reloadReplayState.isSynchronizationReplay, true, "reload 7x6 deve iniciar novo REPLAY completo");
assert.equal(reloadReplayState.displayHomeScore, 0, "reload REPLAY começa em 0x0");

advanceUntil(reloadReplayState, () => !reloadReplayState.isSynchronizationReplay);
assert.equal(reloadReplayState.displayHomeScore, 7, "reload REPLAY termina em 7x6");
assert.equal(reloadReplayState.displayAwayScore, 6);

const pathBState = new FuturebolMatchState("official-path-b-init", true);
pathBState.applyOfficialMatchState(officialState({
    sequence: 13,
    homeScore: 7,
    awayScore: 6,
    initialHistoryReady: true,
    scoreEvents: sevenSixEvents
}), false);
assert.equal(pathBState.isSynchronizationReplay, true, "Path B: histórico já pronto no initialize deve iniciar REPLAY imediatamente");
assert.equal(pathBState.displayHomeScore, 0, "Path B: REPLAY começa em 0x0");
assert.equal(pathBState.displayAwayScore, 0);
assert.equal(pathBState.homeScore, 7, "Path B: placar autoritativo 7x6 preservado");
assert.equal(pathBState.awayScore, 6);

advanceUntil(pathBState, () => !pathBState.isSynchronizationReplay);
assert.equal(pathBState.displayHomeScore, 7, "Path B: REPLAY termina em 7x6");
assert.equal(pathBState.displayAwayScore, 6);

const pathBOneZero = new FuturebolMatchState("official-path-b-1x0", true);
pathBOneZero.applyOfficialMatchState(officialState({
    sequence: 1,
    homeScore: 1,
    awayScore: 0,
    initialHistoryReady: true,
    scoreEvents: oneZeroEvents
}), false);
assert.equal(pathBOneZero.isSynchronizationReplay, true, "Path B 1x0 deve iniciar REPLAY");
assert.equal(pathBOneZero.displayHomeScore, 0, "Path B 1x0 começa em 0x0");
advanceUntil(pathBOneZero, () => !pathBOneZero.isSynchronizationReplay);
assert.equal(pathBOneZero.displayHomeScore, 1, "Path B 1x0 termina em 1x0");
assert.equal(pathBOneZero.displayAwayScore, 0);

const pathBEmpty = new FuturebolMatchState("official-path-b-empty", true);
pathBEmpty.applyOfficialMatchState(officialState({
    sequence: 0,
    homeScore: 0,
    awayScore: 0,
    initialHistoryReady: true,
    scoreEvents: []
}), false);
assert.equal(pathBEmpty.isSynchronizationReplay, false, "Path B 0x0 com histórico vazio vai direto para LIVE");

const pathBAfterLive = new FuturebolMatchState("official-path-b-after-live", true);
pathBAfterLive.applyOfficialMatchState(officialState({
    sequence: 3,
    homeScore: 2,
    awayScore: 1,
    initialHistoryReady: true,
    scoreEvents: [
        scoreEvent(9500, 1, "home"),
        scoreEvent(9501, 2, "home"),
        scoreEvent(9502, 3, "away")
    ]
}), false);
assert.equal(pathBAfterLive.isSynchronizationReplay, true, "Path B 2x1 inicia REPLAY");
advanceUntil(pathBAfterLive, () => !pathBAfterLive.isSynchronizationReplay);
assert.equal(pathBAfterLive.isSynchronizationReplay, false, "REPLAY terminou");
pathBAfterLive.applyOfficialMatchState(officialState({
    sequence: 4,
    homeScore: 3,
    awayScore: 1,
    initialHistoryReady: true,
    scoreEvents: [
        scoreEvent(9500, 1, "home"),
        scoreEvent(9501, 2, "home"),
        scoreEvent(9502, 3, "away"),
        scoreEvent(9503, 4, "home")
    ]
}), true);
assert.equal(pathBAfterLive.isSynchronizationReplay, false, "gol live pós-replay nunca reativa REPLAY");
assert.equal(pathBAfterLive.displayHomeScore, 3, "HUD acompança placar live");

console.log("Futurebol official match state tests passed");
