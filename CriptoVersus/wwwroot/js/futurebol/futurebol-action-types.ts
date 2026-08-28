import type { FuturebolPlayOutcome, FuturebolPlayPhase, FuturebolTeam, FuturebolVector3State } from "./futurebol-types.js";

export type FuturebolActionKind = "PlayerAction" | "BallAction" | "TeamAction";

export interface FuturebolActionBase {
    readonly kind: FuturebolActionKind;
    readonly type: string;
    readonly duration: number;
    readonly playerId?: string;
    readonly team?: FuturebolTeam;
}

export interface FuturebolPlayerAction extends FuturebolActionBase {
    readonly kind: "PlayerAction";
    readonly type:
        | "MoveTo"
        | "RunTo"
        | "LookAt"
        | "SupportRun"
        | "RecoverRun"
        | "Mark"
        | "Celebrate"
        | "Disappointed"
        | "ReturnToFormation"
        | "Dribble";
    readonly target?: FuturebolVector3State;
    readonly targetPlayerId?: string;
}

export interface FuturebolBallAction extends FuturebolActionBase {
    readonly kind: "BallAction";
    readonly type:
        | "AttachToPlayer"
        | "PassToPlayer"
        | "ShootToGoal"
        | "ResetToCenter";
    readonly targetPlayerId?: string;
    readonly target?: FuturebolVector3State;
}

export interface FuturebolTeamAction extends FuturebolActionBase {
    readonly kind: "TeamAction";
    readonly type:
        | "PressForward"
        | "RecoverBlock"
        | "HoldShape"
        | "SpreadWide";
}

export type FuturebolAction = FuturebolPlayerAction | FuturebolBallAction | FuturebolTeamAction;

export type FuturebolScenarioType = "DirectAttack" | "GiveAndGo" | "CounterAttack";

export interface FootballScenario {
    readonly id: string;
    readonly type: FuturebolScenarioType;
    readonly attackingTeam: FuturebolTeam;
    readonly expectedOutcome: FuturebolPlayOutcome;
    readonly actions: readonly FuturebolAction[];
}

export interface FuturebolActionCompletionContext {
    readonly ballOwnerId: string | null;
    readonly ballState: string;
    readonly ballPosition: Readonly<FuturebolVector3State>;
    readonly ballVelocity: Readonly<FuturebolVector3State>;
    readonly playPhase: FuturebolPlayPhase;
    readonly outcome: FuturebolPlayOutcome | null;
    readonly phaseElapsed: number;
    readonly intendedReceiverId: string | null;
}

export function isPlayerAction(action: FuturebolAction): action is FuturebolPlayerAction {
    return action.kind === "PlayerAction";
}

export function isBallAction(action: FuturebolAction): action is FuturebolBallAction {
    return action.kind === "BallAction";
}

export function isTeamAction(action: FuturebolAction): action is FuturebolTeamAction {
    return action.kind === "TeamAction";
}
