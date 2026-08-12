import { FUTUREBOL_FIELD } from "./futurebol-match-rules.js";
import type {
    FuturebolPlayerState,
    FuturebolVector3State
} from "./futurebol-types.js";

const BALL_RADIUS = 0.525;
const POST_RADIUS = 0.09;
const GRAVITY = 9.4;
const AIR_DRAG = 0.13;
const ROLLING_DECELERATION = 3.1;
const CONTROL_ACCELERATION = 38;
const CONTROL_DAMPING = 8.5;

export interface FuturebolBallStepResult {
    playerCollisions: readonly string[];
    postCollision: boolean;
}

export class FuturebolBallController {
    public readonly velocity: FuturebolVector3State = { x: 0, y: 0, z: 0 };
    public lastLaunchSpeed = 0;

    public constructor(
        private readonly position: FuturebolVector3State
    ) { }

    public reset(position: FuturebolVector3State): void {
        copyPoint(this.position, position);
        setPoint(this.velocity, 0, 0, 0);
        this.lastLaunchSpeed = 0;
    }

    public controlToward(
        target: FuturebolVector3State,
        deltaSeconds: number
    ): void {
        const safeDelta = clamp(deltaSeconds, 0, 0.1);
        if (safeDelta === 0)
            return;

        this.velocity.x += (
            (target.x - this.position.x) * CONTROL_ACCELERATION -
            this.velocity.x * CONTROL_DAMPING
        ) * safeDelta;
        this.velocity.z += (
            (target.z - this.position.z) * CONTROL_ACCELERATION -
            this.velocity.z * CONTROL_DAMPING
        ) * safeDelta;
        this.velocity.y += (
            (target.y - this.position.y) * CONTROL_ACCELERATION -
            this.velocity.y * CONTROL_DAMPING
        ) * safeDelta;

        this.position.x += this.velocity.x * safeDelta;
        this.position.y = Math.max(
            FUTUREBOL_FIELD.ballGroundY,
            this.position.y + this.velocity.y * safeDelta
        );
        this.position.z += this.velocity.z * safeDelta;
    }

    public launchPass(target: FuturebolVector3State): number {
        const distance = planarDistance(this.position, target);
        const speed = clamp(9.5 + distance * 0.34, 10.5, 14.2);
        this.launch(target, speed, 3.25 + distance * 0.035);
        return speed;
    }

    public launchShot(target: FuturebolVector3State): number {
        const distance = planarDistance(this.position, target);
        const speed = clamp(20.5 + distance * 0.16, 21, 24);
        this.launch(target, speed, 3.8);
        return speed;
    }

    public updateFlight(
        deltaSeconds: number,
        players: readonly FuturebolPlayerState[],
        ignoredPlayerIds: ReadonlySet<string> = new Set<string>()
    ): FuturebolBallStepResult {
        const collisions = new Set<string>();
        let postCollision = false;
        let remaining = clamp(deltaSeconds, 0, 0.1);

        while (remaining > 0) {
            const step = Math.min(remaining, 1 / 120);
            remaining -= step;

            this.velocity.y -= GRAVITY * step;
            const airMultiplier = Math.max(0, 1 - AIR_DRAG * step);
            this.velocity.x *= airMultiplier;
            this.velocity.z *= airMultiplier;

            this.position.x += this.velocity.x * step;
            this.position.y += this.velocity.y * step;
            this.position.z += this.velocity.z * step;

            if (this.resolveGoalFrameCollision())
                postCollision = true;

            for (const player of players) {
                if (ignoredPlayerIds.has(player.id))
                    continue;

                if (this.resolvePlayerCollision(player))
                    collisions.add(player.id);
            }

            this.resolveGround(step);
        }

        return {
            playerCollisions: [...collisions],
            postCollision
        };
    }

    public horizontalSpeed(): number {
        return Math.hypot(this.velocity.x, this.velocity.z);
    }

    public stopAt(position: FuturebolVector3State): void {
        copyPoint(this.position, position);
        setPoint(this.velocity, 0, 0, 0);
    }

    private launch(
        target: FuturebolVector3State,
        horizontalSpeed: number,
        lift: number
    ): void {
        const dx = target.x - this.position.x;
        const dz = target.z - this.position.z;
        const distance = Math.max(0.001, Math.hypot(dx, dz));
        const travelSeconds = distance / horizontalSpeed;

        this.velocity.x = dx / distance * horizontalSpeed;
        this.velocity.z = dz / distance * horizontalSpeed;
        this.velocity.y =
            (target.y - this.position.y) / Math.max(0.08, travelSeconds) +
            lift;
        this.lastLaunchSpeed = horizontalSpeed;
    }

    private resolveGround(deltaSeconds: number): void {
        if (this.position.y > FUTUREBOL_FIELD.ballGroundY)
            return;

        this.position.y = FUTUREBOL_FIELD.ballGroundY;
        if (this.velocity.y < -1.1)
            this.velocity.y = -this.velocity.y * 0.28;
        else
            this.velocity.y = 0;

        const speed = this.horizontalSpeed();
        if (speed === 0)
            return;

        const nextSpeed = Math.max(0, speed - ROLLING_DECELERATION * deltaSeconds);
        const ratio = nextSpeed / speed;
        this.velocity.x *= ratio;
        this.velocity.z *= ratio;
    }

    private resolvePlayerCollision(player: FuturebolPlayerState): boolean {
        if (this.position.y > 1.62)
            return false;

        const dx = this.position.x - player.position.x;
        const dz = this.position.z - player.position.z;
        const distance = Math.hypot(dx, dz);
        const minimumDistance = BALL_RADIUS + 0.58;
        if (distance >= minimumDistance)
            return false;

        const nx = distance > 0.001 ? dx / distance : player.team === "home" ? 1 : -1;
        const nz = distance > 0.001 ? dz / distance : 0;
        const overlap = minimumDistance - distance;
        this.position.x += nx * overlap;
        this.position.z += nz * overlap;

        const approach = this.velocity.x * nx + this.velocity.z * nz;
        if (approach < 0) {
            this.velocity.x -= nx * approach * 1.48;
            this.velocity.z -= nz * approach * 1.48;
            this.velocity.x += nx * Math.min(1.4, player.currentSpeed * 0.3);
            this.velocity.z += nz * Math.min(1.4, player.currentSpeed * 0.3);
        }

        this.velocity.y = Math.max(this.velocity.y, 1.15);
        return true;
    }

    private resolveGoalFrameCollision(): boolean {
        let collided = false;

        for (const goalX of [-FUTUREBOL_FIELD.goalLineX, FUTUREBOL_FIELD.goalLineX]) {
            for (const postZ of [-FUTUREBOL_FIELD.goalHalfWidth, FUTUREBOL_FIELD.goalHalfWidth]) {
                const dx = this.position.x - goalX;
                const dz = this.position.z - postZ;
                const distance = Math.hypot(dx, dz);
                const minimumDistance = BALL_RADIUS + POST_RADIUS;
                if (distance >= minimumDistance || this.position.y > FUTUREBOL_FIELD.goalHeight + BALL_RADIUS)
                    continue;

                const nx = distance > 0.001 ? dx / distance : -Math.sign(goalX);
                const nz = distance > 0.001 ? dz / distance : -Math.sign(postZ);
                const approach = this.velocity.x * nx + this.velocity.z * nz;
                if (approach < 0) {
                    this.velocity.x -= nx * approach * 1.72;
                    this.velocity.z -= nz * approach * 1.72;
                }
                this.position.x = goalX + nx * minimumDistance;
                this.position.z = postZ + nz * minimumDistance;
                collided = true;
            }

            const nearCrossbar =
                Math.abs(this.position.x - goalX) < BALL_RADIUS + POST_RADIUS &&
                Math.abs(this.position.y - FUTUREBOL_FIELD.goalHeight) < BALL_RADIUS + POST_RADIUS &&
                Math.abs(this.position.z) <= FUTUREBOL_FIELD.goalHalfWidth;
            if (nearCrossbar) {
                this.velocity.x *= -0.58;
                this.velocity.y = -Math.abs(this.velocity.y) * 0.52;
                collided = true;
            }
        }

        return collided;
    }
}

function planarDistance(
    first: FuturebolVector3State,
    second: FuturebolVector3State
): number {
    return Math.hypot(first.x - second.x, first.z - second.z);
}

function copyPoint(
    target: FuturebolVector3State,
    source: FuturebolVector3State
): void {
    setPoint(target, source.x, source.y, source.z);
}

function setPoint(
    target: FuturebolVector3State,
    x: number,
    y: number,
    z: number
): void {
    target.x = x;
    target.y = y;
    target.z = z;
}

function clamp(value: number, minimum: number, maximum: number): number {
    return Math.min(maximum, Math.max(minimum, value));
}
