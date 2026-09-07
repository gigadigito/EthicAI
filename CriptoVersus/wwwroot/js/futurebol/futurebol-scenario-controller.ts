import type {
    FootballScenario,
    FootballBehaviorHints,
    FuturebolAction,
    FuturebolScenarioType,
    FuturebolBallAction,
    FuturebolPlayerAction,
    FuturebolTeamAction
} from "./futurebol-action-types.js";
import type { FuturebolPlayOutcome, FuturebolTeam, FuturebolMarketSnapshot } from "./futurebol-types.js";
import { FuturebolFootballDirector } from "./futurebol-football-director.js";
import type { FootballDirectorContext, FootballDirectorDecision } from "./futurebol-football-director.js";

function attackDirection(team: FuturebolTeam): number {
    return team === "home" ? 1 : -1;
}

function opponent(team: FuturebolTeam): FuturebolTeam {
    return team === "home" ? "away" : "home";
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

function deterministicUnit(seed: number, salt: number): number {
    let value = (seed ^ Math.imul(salt, 0x9e3779b1)) >>> 0;
    value ^= value >>> 16;
    value = Math.imul(value, 0x7feb352d);
    value ^= value >>> 15;
    value = Math.imul(value, 0x846ca68b);
    value ^= value >>> 16;
    return (value >>> 0) / 4294967295;
}

function deterministicSigned(seed: number, salt: number): number {
    return deterministicUnit(seed, salt) * 2 - 1;
}

function laneZ(seed: number, playIndex: number, team: FuturebolTeam): number {
    return clamp(
        deterministicSigned(seed, playIndex * 7 + (team === "home" ? 1 : 2)) * 3.5,
        -4.5, 4.5
    );
}

function supportZ(seed: number, playIndex: number, team: FuturebolTeam, mainLane: number): number {
    return clamp(
        mainLane * -0.5 + deterministicSigned(seed, playIndex * 11 + (team === "home" ? 5 : 8)) * 1.5,
        -5, 5
    );
}

function shotPlacement(seed: number, playIndex: number, team: FuturebolTeam, mainLane: number): number {
    return clamp(
        mainLane * 0.2 + deterministicSigned(seed, playIndex * 13 + (team === "home" ? 3 : 9)) * 2.5,
        -2.8, 2.8
    );
}

function goalkeeperTargetZ(ballZ: number): number {
    return clamp(ballZ * 0.85, -2.8, 2.8);
}

function wingLane(seed: number, playIndex: number, team: FuturebolTeam): number {
    const side = deterministicUnit(seed, playIndex * 17 + (team === "home" ? 4 : 7)) > 0.5 ? 1 : -1;
    return clamp(side * (3.5 + deterministicUnit(seed, playIndex * 19 + 11) * 1.5), -5, 5);
}

function longShotDistance(seed: number, playIndex: number, team: FuturebolTeam): number {
    return clamp(
        14 + deterministicSigned(seed, playIndex * 23 + (team === "home" ? 6 : 10)) * 3,
        12, 17
    );
}

function playerAction(
    type: FuturebolPlayerAction["type"],
    playerId: string,
    team: FuturebolTeam,
    duration: number,
    target?: { x: number; z: number }
): FuturebolPlayerAction {
    return {
        kind: "PlayerAction",
        type,
        playerId,
        team,
        duration,
        target: target ? { x: target.x, y: 0, z: target.z } : undefined
    };
}

function ballAction(
    type: FuturebolBallAction["type"],
    team: FuturebolTeam,
    duration: number,
    targetPlayerId?: string,
    target?: { x: number; z: number }
): FuturebolBallAction {
    return {
        kind: "BallAction",
        type,
        team,
        duration,
        targetPlayerId,
        target: target ? { x: target.x, y: 0.55, z: target.z } : undefined
    };
}

function teamAction(
    type: FuturebolTeamAction["type"],
    team: FuturebolTeam,
    duration: number
): FuturebolTeamAction {
    return { kind: "TeamAction", type, team, duration };
}

function createDirectAttack(
    attackingTeam: FuturebolTeam,
    outcome: FuturebolPlayOutcome,
    seed: number,
    playIndex: number
): FootballScenario {
    const dir = attackDirection(attackingTeam);
    const defTeam = opponent(attackingTeam);
    const lane = laneZ(seed, playIndex, attackingTeam);
    const shotZ = shotPlacement(seed, playIndex, attackingTeam, lane);

    const defenderId = `${attackingTeam}-defender`;
    const attackerId = `${attackingTeam}-attacker`;
    const defGoalkeeperId = `${defTeam}-goalkeeper`;

    const actions: FuturebolAction[] = [
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
        actions,
        behaviorHints: { attacker: "AttackBox", defender: "Support" }
    };
}

function createGiveAndGo(
    attackingTeam: FuturebolTeam,
    outcome: FuturebolPlayOutcome,
    seed: number,
    playIndex: number
): FootballScenario {
    const dir = attackDirection(attackingTeam);
    const defTeam = opponent(attackingTeam);
    const lane = laneZ(seed, playIndex, attackingTeam);
    const supLane = supportZ(seed, playIndex, attackingTeam, lane);
    const shotZ = shotPlacement(seed, playIndex, attackingTeam, lane);

    const defenderId = `${attackingTeam}-defender`;
    const attackerId = `${attackingTeam}-attacker`;
    const defGoalkeeperId = `${defTeam}-goalkeeper`;

    const actions: FuturebolAction[] = [
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
        actions,
        behaviorHints: { attacker: "RunInBehind", defender: "Support" }
    };
}

function createCounterAttack(
    attackingTeam: FuturebolTeam,
    outcome: FuturebolPlayOutcome,
    seed: number,
    playIndex: number
): FootballScenario {
    const dir = attackDirection(attackingTeam);
    const defTeam = opponent(attackingTeam);
    const lane = laneZ(seed, playIndex, attackingTeam);
    const shotZ = shotPlacement(seed, playIndex, attackingTeam, lane);

    const attackerId = `${attackingTeam}-attacker`;
    const defenderId = `${attackingTeam}-defender`;
    const defGoalkeeperId = `${defTeam}-goalkeeper`;

    const actions: FuturebolAction[] = [
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
        actions,
        behaviorHints: { attacker: "RunInBehind", defender: "PushForward" }
    };
}

function createThroughBall(
    attackingTeam: FuturebolTeam,
    outcome: FuturebolPlayOutcome,
    seed: number,
    playIndex: number
): FootballScenario {
    const dir = attackDirection(attackingTeam);
    const defTeam = opponent(attackingTeam);
    const lane = laneZ(seed, playIndex, attackingTeam);
    const shotZ = shotPlacement(seed, playIndex, attackingTeam, lane);

    const defenderId = `${attackingTeam}-defender`;
    const attackerId = `${attackingTeam}-attacker`;
    const defGoalkeeperId = `${defTeam}-goalkeeper`;

    const passTargetX = clamp(dir * 17, -18, 18);
    const runTargetX = clamp(dir * 21, -19.5, 19.5);

    const actions: FuturebolAction[] = [
        teamAction("PressForward", attackingTeam, 1.2),
        playerAction("MoveTo", defenderId, attackingTeam, 1.0, {
            x: clamp(dir * 8, -17, 17),
            z: lane * 0.3
        }),
        playerAction("RunTo", attackerId, attackingTeam, 1.6, {
            x: runTargetX,
            z: lane * 0.2
        }),
        ballAction("PassToPlayer", attackingTeam, 0.85, attackerId, {
            x: passTargetX,
            z: lane * 0.15
        }),
        playerAction("MoveTo", defGoalkeeperId, defTeam, 1.0, {
            x: clamp(-dir * 21.2, -22, 22),
            z: goalkeeperTargetZ(shotZ)
        }),
        playerAction("Dribble", attackerId, attackingTeam, 0.8, {
            x: runTargetX,
            z: lane * 0.1
        }),
        ballAction("ShootToGoal", attackingTeam, 0.76),
        playerAction("Celebrate", attackerId, attackingTeam, 1.0),
        playerAction("Disappointed", defGoalkeeperId, defTeam, 0.8),
        teamAction("HoldShape", attackingTeam, 0.5)
    ];

    return {
        id: `throughball-${attackingTeam}-${playIndex}`,
        type: "ThroughBall",
        attackingTeam,
        expectedOutcome: outcome,
        actions,
        behaviorHints: { attacker: "RunInBehind", defender: "Support" }
    };
}

function createWingAttack(
    attackingTeam: FuturebolTeam,
    outcome: FuturebolPlayOutcome,
    seed: number,
    playIndex: number
): FootballScenario {
    const dir = attackDirection(attackingTeam);
    const defTeam = opponent(attackingTeam);
    const wingZ = wingLane(seed, playIndex, attackingTeam);
    const shotZ = shotPlacement(seed, playIndex, attackingTeam, wingZ);

    const defenderId = `${attackingTeam}-defender`;
    const attackerId = `${attackingTeam}-attacker`;
    const defGoalkeeperId = `${defTeam}-goalkeeper`;

    const actions: FuturebolAction[] = [
        teamAction("SpreadWide", attackingTeam, 1.3),
        playerAction("MoveTo", attackerId, attackingTeam, 1.2, {
            x: clamp(dir * 10, -19, 19),
            z: wingZ
        }),
        playerAction("MoveTo", defenderId, attackingTeam, 1.1, {
            x: clamp(dir * 14, -17, 17),
            z: wingZ * 0.5
        }),
        ballAction("PassToPlayer", attackingTeam, 0.88, attackerId, {
            x: clamp(dir * 15, -18, 18),
            z: wingZ
        }),
        playerAction("MoveTo", defGoalkeeperId, defTeam, 1.0, {
            x: clamp(-dir * 21.2, -22, 22),
            z: goalkeeperTargetZ(shotZ)
        }),
        playerAction("Dribble", attackerId, attackingTeam, 1.4, {
            x: clamp(dir * 20, -19.5, 19.5),
            z: wingZ * 0.4
        }),
        ballAction("PassToPlayer", attackingTeam, 0.85, defenderId, {
            x: clamp(dir * 18, -18, 18),
            z: wingZ * 0.2
        }),
        ballAction("ShootToGoal", attackingTeam, 0.76),
        playerAction("Celebrate", attackerId, attackingTeam, 1.0),
        playerAction("Disappointed", defGoalkeeperId, defTeam, 0.8),
        teamAction("HoldShape", attackingTeam, 0.5)
    ];

    return {
        id: `wing-${attackingTeam}-${playIndex}`,
        type: "WingAttack",
        attackingTeam,
        expectedOutcome: outcome,
        actions,
        behaviorHints: { attacker: "DriftWide", defender: "DriftWide" }
    };
}

function createLongShot(
    attackingTeam: FuturebolTeam,
    outcome: FuturebolPlayOutcome,
    seed: number,
    playIndex: number
): FootballScenario {
    const dir = attackDirection(attackingTeam);
    const defTeam = opponent(attackingTeam);
    const lane = laneZ(seed, playIndex, attackingTeam);
    const shotZ = shotPlacement(seed, playIndex, attackingTeam, lane);
    const distance = longShotDistance(seed, playIndex, attackingTeam);

    const defenderId = `${attackingTeam}-defender`;
    const attackerId = `${attackingTeam}-attacker`;
    const defGoalkeeperId = `${defTeam}-goalkeeper`;

    const actions: FuturebolAction[] = [
        teamAction("PressForward", attackingTeam, 1.1),
        playerAction("MoveTo", attackerId, attackingTeam, 1.0, {
            x: clamp(dir * distance, -19, 19),
            z: lane
        }),
        playerAction("MoveTo", defenderId, attackingTeam, 0.9, {
            x: clamp(dir * (distance - 4), -17, 17),
            z: lane * 0.4
        }),
        ballAction("PassToPlayer", attackingTeam, 0.88, attackerId, {
            x: clamp(dir * distance, -18, 18),
            z: lane
        }),
        playerAction("MoveTo", defGoalkeeperId, defTeam, 1.0, {
            x: clamp(-dir * 21.2, -22, 22),
            z: goalkeeperTargetZ(shotZ)
        }),
        playerAction("Dribble", attackerId, attackingTeam, 0.7, {
            x: clamp(dir * (distance + 1.5), -19.5, 19.5),
            z: lane * 0.5
        }),
        ballAction("ShootToGoal", attackingTeam, 0.76),
        playerAction("Celebrate", attackerId, attackingTeam, 1.0),
        playerAction("Disappointed", defGoalkeeperId, defTeam, 0.8),
        teamAction("HoldShape", attackingTeam, 0.5)
    ];

    return {
        id: `longshot-${attackingTeam}-${playIndex}`,
        type: "LongShot",
        attackingTeam,
        expectedOutcome: outcome,
        actions,
        behaviorHints: { attacker: "HoldPosition", defender: "Support" }
    };
}

function createPressureAttack(
    attackingTeam: FuturebolTeam,
    outcome: FuturebolPlayOutcome,
    seed: number,
    playIndex: number
): FootballScenario {
    const dir = attackDirection(attackingTeam);
    const defTeam = opponent(attackingTeam);
    const lane = laneZ(seed, playIndex, attackingTeam);
    const shotZ = shotPlacement(seed, playIndex, attackingTeam, lane);

    const defenderId = `${attackingTeam}-defender`;
    const attackerId = `${attackingTeam}-attacker`;
    const defGoalkeeperId = `${defTeam}-goalkeeper`;

    const actions: FuturebolAction[] = [
        teamAction("PressForward", attackingTeam, 0.9),
        playerAction("RunTo", attackerId, attackingTeam, 1.0, {
            x: clamp(dir * 16, -19.5, 19.5),
            z: lane * 0.3
        }),
        playerAction("SupportRun", defenderId, attackingTeam, 0.9, {
            x: clamp(dir * 12, -17, 17),
            z: lane * -0.3
        }),
        playerAction("MoveTo", defGoalkeeperId, defTeam, 0.8, {
            x: clamp(-dir * 21.2, -22, 22),
            z: goalkeeperTargetZ(shotZ)
        }),
        ballAction("PassToPlayer", attackingTeam, 0.72, attackerId, {
            x: clamp(dir * 18, -18, 18),
            z: lane * 0.2
        }),
        ballAction("ShootToGoal", attackingTeam, 0.76),
        playerAction("Celebrate", attackerId, attackingTeam, 1.0),
        playerAction("Disappointed", defGoalkeeperId, defTeam, 0.8),
        teamAction("HoldShape", attackingTeam, 0.5)
    ];

    return {
        id: `pressure-${attackingTeam}-${playIndex}`,
        type: "PressureAttack",
        attackingTeam,
        expectedOutcome: outcome,
        actions,
        behaviorHints: { attacker: "AttackBox", defender: "PushForward" }
    };
}

export interface DirectorDiagnostics {
    readonly lastDecision: FootballDirectorDecision | null;
    readonly recentScenarios: readonly FuturebolScenarioType[];
}

export class FuturebolScenarioController {
    private lastScenarioType: FuturebolScenarioType | null = null;
    private consecutiveSameCount = 0;
    private lastDecision: FootballDirectorDecision | null = null;
    private recentScenarios: FuturebolScenarioType[] = [];
    private readonly director = new FuturebolFootballDirector();

    public selectScenario(
        attackingTeam: FuturebolTeam,
        outcome: FuturebolPlayOutcome,
        seed: number,
        playIndex: number,
        context?: {
            isCounterAttack?: boolean;
            isReplay?: boolean;
            pressure?: number;
            homeScore?: number;
            awayScore?: number;
            elapsedSeconds?: number;
            matchDurationSeconds?: number;
            latestSnapshot?: FuturebolMarketSnapshot | null;
            officialGoalPending?: boolean;
        }
    ): FootballScenario {
        let selected: FuturebolScenarioType;

        if (context?.pressure !== undefined) {
            const directorCtx: FootballDirectorContext = {
                attackingTeam,
                pressure: context.pressure,
                homeScore: context.homeScore ?? 0,
                awayScore: context.awayScore ?? 0,
                elapsedSeconds: context.elapsedSeconds ?? 0,
                matchDurationSeconds: context.matchDurationSeconds ?? 90,
                latestSnapshot: context.latestSnapshot ?? null,
                officialGoalPending: context.officialGoalPending ?? false,
                previousScenario: this.lastScenarioType,
                recentScenarios: [...this.recentScenarios],
                seed,
                playIndex
            };

            const decision = this.director.decide(directorCtx);
            this.lastDecision = decision;
            selected = decision.scenario;
        } else {
            selected = this.fallbackSelection(seed, playIndex, context);
        }

        if (selected === this.lastScenarioType) {
            this.consecutiveSameCount += 1;
            if (this.consecutiveSameCount >= 2) {
                const allScenarios: FuturebolScenarioType[] = [
                    "DirectAttack", "GiveAndGo", "CounterAttack",
                    "ThroughBall", "WingAttack", "LongShot", "PressureAttack"
                ];
                const alternatives = allScenarios.filter(s => s !== selected);
                const roll = deterministicUnit(seed, playIndex * 43 + 19);
                selected = alternatives[Math.floor(roll * alternatives.length)];
                this.consecutiveSameCount = 0;
            }
        } else {
            this.consecutiveSameCount = 0;
        }
        this.lastScenarioType = selected;
        this.recentScenarios.push(selected);
        if (this.recentScenarios.length > 5) this.recentScenarios.shift();

        return this.createScenario(selected, attackingTeam, outcome, seed, playIndex);
    }

    private fallbackSelection(
        seed: number,
        playIndex: number,
        context?: { isCounterAttack?: boolean }
    ): FuturebolScenarioType {
        const roll = deterministicUnit(seed, playIndex * 41 + 13);

        if (context?.isCounterAttack) {
            return roll < 0.65 ? "CounterAttack" : roll < 0.85 ? "DirectAttack" : "GiveAndGo";
        } else if (roll < 0.30) {
            return "DirectAttack";
        } else if (roll < 0.50) {
            return "GiveAndGo";
        } else if (roll < 0.62) {
            return "CounterAttack";
        } else if (roll < 0.74) {
            return "ThroughBall";
        } else if (roll < 0.84) {
            return "WingAttack";
        } else if (roll < 0.92) {
            return "LongShot";
        } else {
            return "PressureAttack";
        }
    }

    private createScenario(
        type: FuturebolScenarioType,
        attackingTeam: FuturebolTeam,
        outcome: FuturebolPlayOutcome,
        seed: number,
        playIndex: number
    ): FootballScenario {
        switch (type) {
            case "GiveAndGo":
                return createGiveAndGo(attackingTeam, outcome, seed, playIndex);
            case "CounterAttack":
                return createCounterAttack(attackingTeam, outcome, seed, playIndex);
            case "ThroughBall":
                return createThroughBall(attackingTeam, outcome, seed, playIndex);
            case "WingAttack":
                return createWingAttack(attackingTeam, outcome, seed, playIndex);
            case "LongShot":
                return createLongShot(attackingTeam, outcome, seed, playIndex);
            case "PressureAttack":
                return createPressureAttack(attackingTeam, outcome, seed, playIndex);
            default:
                return createDirectAttack(attackingTeam, outcome, seed, playIndex);
        }
    }

    public directorDiagnostics(): DirectorDiagnostics {
        return {
            lastDecision: this.lastDecision,
            recentScenarios: [...this.recentScenarios]
        };
    }

    public reset(): void {
        this.lastScenarioType = null;
        this.consecutiveSameCount = 0;
        this.lastDecision = null;
        this.recentScenarios = [];
        this.director.reset();
    }
}
