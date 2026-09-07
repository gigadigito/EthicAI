import { FUTUREBOL_FIELD } from "./futurebol-match-rules.js";
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
function attackDirection(team) {
    return team === "home" ? 1 : -1;
}
function opponent(team) {
    return team === "home" ? "away" : "home";
}
const GOAL_X = FUTUREBOL_FIELD.goalLineX;
const GOAL_HALF_WIDTH = FUTUREBOL_FIELD.goalHalfWidth;
const FIELD_HALF_LENGTH = FUTUREBOL_FIELD.halfLength;
const FIELD_HALF_WIDTH = FUTUREBOL_FIELD.halfWidth;
const STYLE_ATTACKER_OFFSET = {
    Aggressive: { x: 3.0, z: 0.8, speed: 1.15 },
    Balanced: { x: 1.5, z: 0.5, speed: 1.0 },
    Controlled: { x: 0.5, z: 0.3, speed: 0.85 },
    Counter: { x: 3.5, z: 1.0, speed: 1.2 }
};
const STYLE_DEFENDER_OFFSET = {
    Aggressive: { x: 2.0, z: 0.6, speed: 1.05 },
    Balanced: { x: 0.8, z: 0.3, speed: 0.9 },
    Controlled: { x: -0.5, z: 0.2, speed: 0.75 },
    Counter: { x: 1.5, z: 0.5, speed: 1.0 }
};
const STYLE_DEFENSIVE_MARK_OFFSET = {
    Aggressive: { blockDistance: 0.7, pressIntensity: 1.3 },
    Balanced: { blockDistance: 1.0, pressIntensity: 1.0 },
    Controlled: { blockDistance: 1.3, pressIntensity: 0.8 },
    Counter: { blockDistance: 0.8, pressIntensity: 1.1 }
};
const SCENARIO_ANTICIPATION = {
    DirectAttack: { attacker: "AttackBox", defender: "Support" },
    GiveAndGo: { attacker: "RunInBehind", defender: "Support" },
    CounterAttack: { attacker: "RunInBehind", defender: "PushForward" },
    ThroughBall: { attacker: "RunInBehind", defender: "Support" },
    WingAttack: { attacker: "DriftWide", defender: "DriftWide" },
    LongShot: { attacker: "HoldPosition", defender: "Support" },
    PressureAttack: { attacker: "AttackBox", defender: "PushForward" }
};
export class FuturebolTeamBehavior {
    constructor() {
        this.playerIntents = new Map();
        this.lastPhase = "Neutral";
        this.lastScenario = null;
        this.lastHintKey = "";
    }
    buildHintKey(ctx) {
        return `${ctx.behaviorHints?.attacker ?? ""}:${ctx.behaviorHints?.defender ?? ""}`;
    }
    computePlayerBehavior(player, ctx) {
        if (player.role === "goalkeeper") {
            return this.computeGoalkeeperBehavior(player, ctx);
        }
        const isAttacking = player.team === ctx.attackingTeam;
        const isOwner = player.id === ctx.ballOwnerId;
        const intentChanged = this.shouldRecalculateIntent(ctx);
        const cachedIntent = this.playerIntents.get(player.id);
        if (isAttacking && !isOwner) {
            const output = this.computeAttackingOffBall(player, ctx);
            if (intentChanged || !cachedIntent) {
                this.playerIntents.set(player.id, output.intent);
            }
            return { ...output, intent: intentChanged || !cachedIntent ? output.intent : cachedIntent };
        }
        else if (isAttacking && isOwner) {
            return this.computeBallCarrier(player, ctx);
        }
        else if (!isAttacking) {
            const output = this.computeDefendingBehavior(player, ctx);
            if (intentChanged || !cachedIntent) {
                this.playerIntents.set(player.id, output.intent);
            }
            return { ...output, intent: intentChanged || !cachedIntent ? output.intent : cachedIntent };
        }
        return this.holdPosition(player);
    }
    computeGoalkeeperBehavior(player, ctx) {
        const baseX = player.basePosition.x;
        const ballZ = ctx.ballPosition.z;
        const ballX = ctx.ballPosition.x;
        const lateralTrack = clamp(ballZ * 0.85, -GOAL_HALF_WIDTH + 0.7, GOAL_HALF_WIDTH - 0.7);
        const dirToBall = ballX > baseX ? 1 : -1;
        const distToBall = Math.abs(ballX - baseX);
        const depthAdjust = clamp(distToBall * 0.04, 0, 1.5);
        return {
            intent: "TrackBall",
            targetX: baseX + dirToBall * depthAdjust,
            targetZ: lateralTrack,
            speedFactor: 0.6
        };
    }
    computeAttackingOffBall(player, ctx) {
        const dir = attackDirection(ctx.attackingTeam);
        const ballX = ctx.ballPosition.x;
        const ballZ = ctx.ballPosition.z;
        const style = ctx.style;
        const scenario = ctx.scenario;
        const scenarioIntent = SCENARIO_ANTICIPATION[scenario]?.[player.role];
        const styleOffset = STYLE_ATTACKER_OFFSET[style];
        const distToGoal = Math.abs(GOAL_X * dir - player.position.x);
        if (player.role === "attacker") {
            return this.computeAttackerMovement(player, dir, ballX, ballZ, distToGoal, styleOffset, scenarioIntent, ctx);
        }
        return this.computeDefenderMovement(player, dir, ballX, ballZ, styleOffset, ctx);
    }
    computeAttackerMovement(player, dir, ballX, ballZ, distToGoal, styleOffset, scenarioIntent, ctx) {
        const hintIntent = ctx.behaviorHints?.attacker;
        let intent = hintIntent ?? scenarioIntent ?? "Support";
        let targetX;
        let targetZ;
        const useHint = hintIntent !== undefined;
        if (!useHint && ctx.scenario === "ThroughBall" && ctx.phaseElapsed < 1.2) {
            intent = "RunInBehind";
            targetX = clamp(player.position.x + dir * (5 + styleOffset.x), -FIELD_HALF_LENGTH + 1, FIELD_HALF_LENGTH - 1);
            targetZ = clamp(ballZ * 0.3 + player.basePosition.z * 0.7, -FIELD_HALF_WIDTH + 1, FIELD_HALF_WIDTH - 1);
        }
        else if (!useHint && ctx.scenario === "WingAttack") {
            intent = "DriftWide";
            const sideZ = player.basePosition.z >= 0 ? 1 : -1;
            targetX = clamp(ballX + dir * (2 + styleOffset.x), -FIELD_HALF_LENGTH + 1, FIELD_HALF_LENGTH - 1);
            targetZ = clamp(sideZ * (3.5 + styleOffset.z), -FIELD_HALF_WIDTH + 1, FIELD_HALF_WIDTH - 1);
        }
        else if (!useHint && ctx.scenario === "PressureAttack") {
            intent = "AttackBox";
            targetX = clamp(ballX + dir * (2.5 + styleOffset.x * 0.5), -FIELD_HALF_LENGTH + 1, FIELD_HALF_LENGTH - 1);
            targetZ = clamp(ballZ * 0.5 + player.basePosition.z * 0.5, -FIELD_HALF_WIDTH + 1, FIELD_HALF_WIDTH - 1);
        }
        else if (!useHint && distToGoal < 10) {
            intent = "AttackBox";
            targetX = clamp(player.position.x + dir * (0.5 + styleOffset.x * 0.3), -FIELD_HALF_LENGTH + 1, FIELD_HALF_LENGTH - 1);
            targetZ = clamp(ballZ * 0.4 + player.basePosition.z * 0.6, -FIELD_HALF_WIDTH + 1, FIELD_HALF_WIDTH - 1);
        }
        else if (!useHint && ctx.style === "Counter" && ctx.phaseElapsed < 1.5) {
            intent = "RunInBehind";
            targetX = clamp(player.position.x + dir * (4 + styleOffset.x), -FIELD_HALF_LENGTH + 1, FIELD_HALF_LENGTH - 1);
            targetZ = clamp(ballZ * 0.3 + player.basePosition.z * 0.7, -FIELD_HALF_WIDTH + 1, FIELD_HALF_WIDTH - 1);
        }
        else {
            if (!useHint)
                intent = "Support";
            targetX = clamp(ballX + dir * (3 + styleOffset.x), -FIELD_HALF_LENGTH + 1, FIELD_HALF_LENGTH - 1);
            targetZ = clamp(ballZ * 0.4 + player.basePosition.z * 0.6 + deterministicSigned(ctx.seed, ctx.playIndex * 17 + 3) * styleOffset.z, -FIELD_HALF_WIDTH + 1, FIELD_HALF_WIDTH - 1);
        }
        return {
            intent,
            targetX,
            targetZ,
            speedFactor: 0.75 * styleOffset.speed
        };
    }
    computeDefenderMovement(player, dir, ballX, ballZ, styleOffset, ctx) {
        const scenarioIntent = SCENARIO_ANTICIPATION[ctx.scenario]?.[player.role];
        const hintIntent = ctx.behaviorHints?.defender;
        let intent = hintIntent ?? scenarioIntent ?? "Support";
        let supportX;
        let supportZ;
        if (ctx.scenario === "GiveAndGo" && ctx.phaseElapsed < 2.0) {
            intent = "Support";
            supportX = clamp(ballX - dir * (5 - styleOffset.x * 0.5), -FIELD_HALF_LENGTH + 1, FIELD_HALF_LENGTH - 1);
            supportZ = clamp(ballZ * 0.2 + player.basePosition.z * 0.8, -FIELD_HALF_WIDTH + 1, FIELD_HALF_WIDTH - 1);
        }
        else if (ctx.scenario === "WingAttack") {
            intent = "DriftWide";
            const sideZ = player.basePosition.z >= 0 ? 1 : -1;
            supportX = clamp(ballX - dir * 4, -FIELD_HALF_LENGTH + 1, FIELD_HALF_LENGTH - 1);
            supportZ = clamp(sideZ * 2.5, -FIELD_HALF_WIDTH + 1, FIELD_HALF_WIDTH - 1);
        }
        else if (ctx.style === "Aggressive" || ctx.style === "Counter") {
            intent = "PushForward";
            supportX = clamp(ballX - dir * (4 - styleOffset.x), -FIELD_HALF_LENGTH + 1, FIELD_HALF_LENGTH - 1);
            supportZ = clamp(ballZ * 0.3 + player.basePosition.z * 0.7, -FIELD_HALF_WIDTH + 1, FIELD_HALF_WIDTH - 1);
        }
        else {
            intent = "Support";
            supportX = clamp(ballX - dir * 5.5, -FIELD_HALF_LENGTH + 1, FIELD_HALF_LENGTH - 1);
            supportZ = clamp(ballZ * 0.25 + player.basePosition.z * 0.75 + deterministicSigned(ctx.seed, ctx.playIndex * 23 + 7) * styleOffset.z, -FIELD_HALF_WIDTH + 1, FIELD_HALF_WIDTH - 1);
        }
        return {
            intent,
            targetX: supportX,
            targetZ: supportZ,
            speedFactor: 0.55 * styleOffset.speed
        };
    }
    computeBallCarrier(player, ctx) {
        return {
            intent: "Support",
            targetX: player.targetPosition.x,
            targetZ: player.targetPosition.z,
            speedFactor: 1.0
        };
    }
    computeDefendingBehavior(player, ctx) {
        const dir = attackDirection(ctx.attackingTeam);
        const ballX = ctx.ballPosition.x;
        const ballZ = ctx.ballPosition.z;
        const styleOffsets = STYLE_DEFENSIVE_MARK_OFFSET[ctx.style];
        if (player.role === "attacker") {
            const pressX = ballX + dir * (2.5 * styleOffsets.pressIntensity);
            const pressZ = clamp(ballZ * 0.6 + player.basePosition.z * 0.4, -FIELD_HALF_WIDTH + 1, FIELD_HALF_WIDTH - 1);
            return {
                intent: "Recover",
                targetX: clamp(pressX, -FIELD_HALF_LENGTH + 1, FIELD_HALF_LENGTH - 1),
                targetZ: pressZ,
                speedFactor: 0.65 * styleOffsets.pressIntensity
            };
        }
        const ownGoalX = -dir * GOAL_X;
        const distToGoal = Math.abs(ownGoalX - ballX);
        const blockDist = clamp(distToGoal * 0.28 * styleOffsets.blockDistance, 3.6, 5.8);
        const blockX = ballX + dir * blockDist;
        const blockZ = clamp(ballZ * 0.5 + player.basePosition.z * 0.5 - Math.sign(ballZ || 1) * 0.5, -FIELD_HALF_WIDTH + 1, FIELD_HALF_WIDTH - 1);
        return {
            intent: "ClosePassingLane",
            targetX: clamp(blockX, -FIELD_HALF_LENGTH + 1, FIELD_HALF_LENGTH - 1),
            targetZ: blockZ,
            speedFactor: 0.55
        };
    }
    holdPosition(player) {
        return {
            intent: "HoldPosition",
            targetX: player.basePosition.x,
            targetZ: player.basePosition.z,
            speedFactor: 0.4
        };
    }
    shouldRecalculateIntent(ctx) {
        const hintKey = this.buildHintKey(ctx);
        const phaseChanged = ctx.phase !== this.lastPhase;
        const scenarioChanged = ctx.scenario !== this.lastScenario;
        const hintsChanged = hintKey !== this.lastHintKey;
        this.lastPhase = ctx.phase;
        this.lastScenario = ctx.scenario;
        this.lastHintKey = hintKey;
        return phaseChanged || scenarioChanged || hintsChanged;
    }
    reset() {
        this.playerIntents.clear();
        this.lastPhase = "Neutral";
        this.lastScenario = null;
        this.lastHintKey = "";
    }
}
