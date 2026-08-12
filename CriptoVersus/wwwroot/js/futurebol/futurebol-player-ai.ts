import type {
    FuturebolBallAction,
    FuturebolPlayerState,
    FuturebolTeam,
    FuturebolVector3State
} from "./futurebol-types.js";

export interface FuturebolPassOption {
    receiver: FuturebolPlayerState;
    target: FuturebolVector3State;
    score: number;
    laneRisk: number;
}

export interface FuturebolDecisionContext {
    owner: FuturebolPlayerState;
    teammates: readonly FuturebolPlayerState[];
    opponents: readonly FuturebolPlayerState[];
    attackingTeam: FuturebolTeam;
}

export interface FuturebolBallDecision {
    action: FuturebolBallAction;
    pass: FuturebolPassOption | null;
}

export class FuturebolPlayerAI {
    public decide(context: FuturebolDecisionContext): FuturebolBallDecision {
        const direction = attackDirection(context.attackingTeam);
        const goalX = direction * 25;
        const distanceToGoal = Math.abs(goalX - context.owner.position.x);
        const nearestOpponent = minimumDistance(
            context.owner.position,
            context.opponents
        );
        const pass = this.selectPassReceiver(context);
        const shotLaneRisk = laneRisk(
            context.owner.position,
            { x: goalX, y: 1, z: 0 },
            context.opponents
        );

        if (distanceToGoal <= 11.5 && shotLaneRisk < 0.72)
            return { action: "Shoot", pass };

        if (
            pass &&
            (
                context.owner.role === "defender" ||
                nearestOpponent < 2.75 ||
                (pass.score > 4.2 && distanceToGoal > 15)
            )
        ) {
            return { action: "Pass", pass };
        }

        const spaceAhead = forwardSpace(
            context.owner.position,
            direction,
            context.opponents
        );

        if (spaceAhead >= 3.2)
            return { action: "Dribble", pass };

        return pass
            ? { action: "Pass", pass }
            : { action: distanceToGoal <= 14 ? "Shoot" : "Dribble", pass: null };
    }

    public selectPassReceiver(
        context: FuturebolDecisionContext
    ): FuturebolPassOption | null {
        const direction = attackDirection(context.attackingTeam);
        let best: FuturebolPassOption | null = null;

        for (const teammate of context.teammates) {
            if (teammate.id === context.owner.id)
                continue;

            const target = predictReceptionPoint(teammate, direction);
            const distance = planarDistance(context.owner.position, target);
            if (distance < 2.5 || distance > 22)
                continue;

            const progress =
                (target.x - context.owner.position.x) * direction;
            const openness = minimumDistance(target, context.opponents);
            const risk = laneRisk(
                context.owner.position,
                target,
                context.opponents
            );
            const rolePenalty = teammate.role === "goalkeeper" ? 5.5 : 0;
            const score =
                progress * 0.62 +
                Math.min(openness, 7) * 0.52 -
                Math.abs(distance - 10) * 0.18 -
                risk * 4.1 -
                rolePenalty;
            const option = { receiver: teammate, target, score, laneRisk: risk };

            if (!best || option.score > best.score)
                best = option;
        }

        return best && best.score > -1.25 ? best : null;
    }
}

function predictReceptionPoint(
    player: FuturebolPlayerState,
    direction: number
): FuturebolVector3State {
    const movementX = player.targetPosition.x - player.position.x;
    const movementZ = player.targetPosition.z - player.position.z;
    const movementLength = Math.hypot(movementX, movementZ);
    const lead = Math.min(2.1, Math.max(0.75, movementLength * 0.42));

    if (movementLength < 0.05) {
        return {
            x: player.position.x + direction * 0.9,
            y: 0.55,
            z: player.position.z
        };
    }

    return {
        x: player.position.x + movementX / movementLength * lead,
        y: 0.55,
        z: player.position.z + movementZ / movementLength * lead
    };
}

function laneRisk(
    start: FuturebolVector3State,
    end: FuturebolVector3State,
    opponents: readonly FuturebolPlayerState[]
): number {
    let risk = 0;

    for (const opponent of opponents) {
        const projection = distanceToSegment(
            opponent.position,
            start,
            end
        );
        if (projection.along <= 0.08 || projection.along >= 0.94)
            continue;

        risk = Math.max(
            risk,
            clamp((2.2 - projection.distance) / 2.2, 0, 1)
        );
    }

    return risk;
}

function forwardSpace(
    position: FuturebolVector3State,
    direction: number,
    opponents: readonly FuturebolPlayerState[]
): number {
    let space = 8;

    for (const opponent of opponents) {
        const forward = (opponent.position.x - position.x) * direction;
        const lateral = Math.abs(opponent.position.z - position.z);
        if (forward > 0 && lateral < 2.8)
            space = Math.min(space, forward + lateral * 0.35);
    }

    return space;
}

function minimumDistance(
    position: FuturebolVector3State,
    players: readonly FuturebolPlayerState[]
): number {
    if (players.length === 0)
        return Number.POSITIVE_INFINITY;

    return Math.min(...players.map(player => planarDistance(position, player.position)));
}

function distanceToSegment(
    point: FuturebolVector3State,
    start: FuturebolVector3State,
    end: FuturebolVector3State
): { distance: number; along: number } {
    const dx = end.x - start.x;
    const dz = end.z - start.z;
    const lengthSquared = dx * dx + dz * dz;
    const along = lengthSquared <= 0.0001
        ? 0
        : clamp(
            ((point.x - start.x) * dx + (point.z - start.z) * dz) /
            lengthSquared,
            0,
            1
        );
    const nearestX = start.x + dx * along;
    const nearestZ = start.z + dz * along;

    return {
        distance: Math.hypot(point.x - nearestX, point.z - nearestZ),
        along
    };
}

function planarDistance(
    first: FuturebolVector3State,
    second: FuturebolVector3State
): number {
    return Math.hypot(first.x - second.x, first.z - second.z);
}

function attackDirection(team: FuturebolTeam): number {
    return team === "home" ? 1 : -1;
}

function clamp(value: number, minimum: number, maximum: number): number {
    return Math.min(maximum, Math.max(minimum, value));
}
