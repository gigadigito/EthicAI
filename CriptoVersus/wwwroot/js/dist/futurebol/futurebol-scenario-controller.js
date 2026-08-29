function attackDirection(team) {
    return team === "home" ? 1 : -1;
}
function opponent(team) {
    return team === "home" ? "away" : "home";
}
function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}
function deterministicUnit(seed, salt) {
    let value = (seed ^ Math.imul(salt, 0x9e3779b1)) >>> 0;
    value ^= value >>> 16;
    value = Math.imul(value, 0x7feb352d);
    value ^= value >>> 15;
    value = Math.imul(value, 0x846ca68b);
    value ^= value >>> 16;
    return (value >>> 0) / 4294967295;
}
function deterministicSigned(seed, salt) {
    return deterministicUnit(seed, salt) * 2 - 1;
}
function laneZ(seed, playIndex, team) {
    return clamp(deterministicSigned(seed, playIndex * 7 + (team === "home" ? 1 : 2)) * 3.5, -4.5, 4.5);
}
function supportZ(seed, playIndex, team, mainLane) {
    return clamp(mainLane * -0.5 + deterministicSigned(seed, playIndex * 11 + (team === "home" ? 5 : 8)) * 1.5, -5, 5);
}
function shotPlacement(seed, playIndex, team, mainLane) {
    return clamp(mainLane * 0.2 + deterministicSigned(seed, playIndex * 13 + (team === "home" ? 3 : 9)) * 2.5, -2.8, 2.8);
}
function goalkeeperTargetZ(ballZ) {
    return clamp(ballZ * 0.85, -2.8, 2.8);
}
function playerAction(type, playerId, team, duration, target) {
    return {
        kind: "PlayerAction",
        type,
        playerId,
        team,
        duration,
        target: target ? { x: target.x, y: 0, z: target.z } : undefined
    };
}
function ballAction(type, team, duration, targetPlayerId, target) {
    return {
        kind: "BallAction",
        type,
        team,
        duration,
        targetPlayerId,
        target: target ? { x: target.x, y: 0.55, z: target.z } : undefined
    };
}
function teamAction(type, team, duration) {
    return { kind: "TeamAction", type, team, duration };
}
function createDirectAttack(attackingTeam, outcome, seed, playIndex) {
    const dir = attackDirection(attackingTeam);
    const defTeam = opponent(attackingTeam);
    const lane = laneZ(seed, playIndex, attackingTeam);
    const shotZ = shotPlacement(seed, playIndex, attackingTeam, lane);
    const defenderId = `${attackingTeam}-defender`;
    const attackerId = `${attackingTeam}-attacker`;
    const defGoalkeeperId = `${defTeam}-goalkeeper`;
    const actions = [
        teamAction("PressForward", attackingTeam, 1.4),
        playerAction("MoveTo", defenderId, attackingTeam, 1.4, {
            x: clamp(dir * 13, -17, 17),
            z: lane * 0.6
        }),
        playerAction("MoveTo", attackerId, attackingTeam, 1.4, {
            x: clamp(dir * 11, -19, 19),
            z: lane
        }),
        ballAction("PassToPlayer", attackingTeam, 0.92, attackerId, {
            x: clamp(dir * 15, -18, 18),
            z: lane
        }),
        playerAction("MoveTo", defGoalkeeperId, defTeam, 1.0, {
            x: clamp(-dir * 21.2, -22, 22),
            z: goalkeeperTargetZ(shotZ)
        }),
        playerAction("Dribble", attackerId, attackingTeam, 1.6, {
            x: clamp(dir * 20, -19.5, 19.5),
            z: lane * 0.35
        }),
        ballAction("ShootToGoal", attackingTeam, 0.76),
        playerAction("Celebrate", attackerId, attackingTeam, 1.0),
        playerAction("Disappointed", defGoalkeeperId, defTeam, 0.8),
        teamAction("HoldShape", attackingTeam, 0.5)
    ];
    return {
        id: `direct-${attackingTeam}-${playIndex}`,
        type: "DirectAttack",
        attackingTeam,
        expectedOutcome: outcome,
        actions
    };
}
function createGiveAndGo(attackingTeam, outcome, seed, playIndex) {
    const dir = attackDirection(attackingTeam);
    const defTeam = opponent(attackingTeam);
    const lane = laneZ(seed, playIndex, attackingTeam);
    const supLane = supportZ(seed, playIndex, attackingTeam, lane);
    const shotZ = shotPlacement(seed, playIndex, attackingTeam, lane);
    const defenderId = `${attackingTeam}-defender`;
    const attackerId = `${attackingTeam}-attacker`;
    const defGoalkeeperId = `${defTeam}-goalkeeper`;
    const actions = [
        teamAction("PressForward", attackingTeam, 1.5),
        playerAction("MoveTo", attackerId, attackingTeam, 1.0, {
            x: clamp(dir * 6, -19, 19),
            z: lane
        }),
        playerAction("MoveTo", defenderId, attackingTeam, 1.0, {
            x: clamp(dir * 9, -17, 17),
            z: supLane
        }),
        ballAction("PassToPlayer", attackingTeam, 0.92, defenderId, {
            x: clamp(dir * 11, -17, 17),
            z: supLane
        }),
        playerAction("RunTo", attackerId, attackingTeam, 1.4, {
            x: clamp(dir * 19, -19.5, 19.5),
            z: lane * 0.35
        }),
        playerAction("MoveTo", defGoalkeeperId, defTeam, 1.0, {
            x: clamp(-dir * 21.2, -22, 22),
            z: goalkeeperTargetZ(shotZ)
        }),
        ballAction("PassToPlayer", attackingTeam, 0.92, attackerId, {
            x: clamp(dir * 20, -19, 19),
            z: lane * 0.25
        }),
        playerAction("Dribble", attackerId, attackingTeam, 0.8, {
            x: clamp(dir * 21, -19.5, 19.5),
            z: lane * 0.2
        }),
        ballAction("ShootToGoal", attackingTeam, 0.76),
        playerAction("Celebrate", attackerId, attackingTeam, 1.0),
        playerAction("Disappointed", defGoalkeeperId, defTeam, 0.8),
        teamAction("HoldShape", attackingTeam, 0.5)
    ];
    return {
        id: `giveandgo-${attackingTeam}-${playIndex}`,
        type: "GiveAndGo",
        attackingTeam,
        expectedOutcome: outcome,
        actions
    };
}
function createCounterAttack(attackingTeam, outcome, seed, playIndex) {
    const dir = attackDirection(attackingTeam);
    const defTeam = opponent(attackingTeam);
    const lane = laneZ(seed, playIndex, attackingTeam);
    const shotZ = shotPlacement(seed, playIndex, attackingTeam, lane);
    const attackerId = `${attackingTeam}-attacker`;
    const defenderId = `${attackingTeam}-defender`;
    const defGoalkeeperId = `${defTeam}-goalkeeper`;
    const actions = [
        teamAction("PressForward", attackingTeam, 1.0),
        playerAction("RunTo", attackerId, attackingTeam, 1.3, {
            x: clamp(dir * 19, -19.5, 19.5),
            z: lane * 0.3
        }),
        playerAction("SupportRun", defenderId, attackingTeam, 1.1, {
            x: clamp(dir * 11, -17, 17),
            z: lane * -0.4
        }),
        playerAction("MoveTo", defGoalkeeperId, defTeam, 0.8, {
            x: clamp(-dir * 21.2, -22, 22),
            z: goalkeeperTargetZ(shotZ)
        }),
        ballAction("PassToPlayer", attackingTeam, 0.82, attackerId, {
            x: clamp(dir * 20, -19, 19),
            z: lane * 0.25
        }),
        playerAction("Dribble", attackerId, attackingTeam, 0.9, {
            x: clamp(dir * 21.5, -19.5, 19.5),
            z: lane * 0.15
        }),
        ballAction("ShootToGoal", attackingTeam, 0.76),
        playerAction("Celebrate", attackerId, attackingTeam, 1.0),
        playerAction("Disappointed", defGoalkeeperId, defTeam, 0.8),
        teamAction("HoldShape", attackingTeam, 0.5)
    ];
    return {
        id: `counter-${attackingTeam}-${playIndex}`,
        type: "CounterAttack",
        attackingTeam,
        expectedOutcome: outcome,
        actions
    };
}
export class FuturebolScenarioController {
    constructor() {
        this.lastScenarioType = null;
        this.consecutiveSameCount = 0;
    }
    selectScenario(attackingTeam, outcome, seed, playIndex, context) {
        const roll = deterministicUnit(seed, playIndex * 41 + 13);
        let selected;
        if (context?.isCounterAttack) {
            selected = roll < 0.65 ? "CounterAttack" : roll < 0.85 ? "DirectAttack" : "GiveAndGo";
        }
        else if (roll < 0.45) {
            selected = "DirectAttack";
        }
        else if (roll < 0.75) {
            selected = "GiveAndGo";
        }
        else {
            selected = "CounterAttack";
        }
        if (selected === this.lastScenarioType) {
            this.consecutiveSameCount += 1;
            if (this.consecutiveSameCount >= 2) {
                selected = selected === "DirectAttack"
                    ? (roll < 0.5 ? "GiveAndGo" : "CounterAttack")
                    : "DirectAttack";
                this.consecutiveSameCount = 0;
            }
        }
        else {
            this.consecutiveSameCount = 0;
        }
        this.lastScenarioType = selected;
        switch (selected) {
            case "GiveAndGo":
                return createGiveAndGo(attackingTeam, outcome, seed, playIndex);
            case "CounterAttack":
                return createCounterAttack(attackingTeam, outcome, seed, playIndex);
            default:
                return createDirectAttack(attackingTeam, outcome, seed, playIndex);
        }
    }
    reset() {
        this.lastScenarioType = null;
        this.consecutiveSameCount = 0;
    }
}
