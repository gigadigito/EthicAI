import type {
    FootballScenario,
    FuturebolAction,
    FuturebolActionCompletionContext
} from "./futurebol-action-types.js";

const ACTION_TIMEOUT_SECONDS = 6;

export interface ActionControllerDiagnostics {
    scenarioType: string | null;
    actionIndex: number;
    actionCount: number;
    currentActionType: string;
    elapsed: number;
    officialGoal: boolean;
}

export class ActionController {
    private scenario: FootballScenario | null = null;
    private actionIndex = 0;
    private elapsed = 0;
    private actionElapsed = 0;
    private disposed = false;
    private timeoutTriggered = false;

    public get isActive(): boolean {
        return this.scenario !== null;
    }

    public get currentAction(): FuturebolAction | null {
        if (!this.scenario || this.actionIndex >= this.scenario.actions.length)
            return null;
        return this.scenario.actions[this.actionIndex];
    }

    public get currentScenario(): FootballScenario | null {
        return this.scenario;
    }

    public get totalElapsed(): number {
        return this.elapsed;
    }

    public get actionProgress(): number {
        const action = this.currentAction;
        if (!action || action.duration <= 0) return 1;
        return Math.min(1, this.actionElapsed / action.duration);
    }

    public startScenario(scenario: FootballScenario): void {
        this.scenario = scenario;
        this.actionIndex = 0;
        this.elapsed = 0;
        this.actionElapsed = 0;
        this.timeoutTriggered = false;
    }

    public update(
        deltaSeconds: number,
        completionContext: FuturebolActionCompletionContext
    ): boolean {
        if (!this.scenario || this.disposed)
            return false;

        const safeDelta = Math.min(deltaSeconds, 0.1);
        this.elapsed += safeDelta;
        this.actionElapsed += safeDelta;

        const action = this.currentAction;
        if (!action) {
            this.finishScenario();
            return true;
        }

        const completed = this.isActionCompleted(action, completionContext)
            || this.actionElapsed >= action.duration
            || this.actionElapsed >= ACTION_TIMEOUT_SECONDS;

        if (completed) {
            this.advanceToNextAction();
            return this.scenario === null;
        }

        return false;
    }

    public cancel(): void {
        this.scenario = null;
        this.actionIndex = 0;
        this.elapsed = 0;
        this.actionElapsed = 0;
        this.timeoutTriggered = false;
    }

    public dispose(): void {
        this.disposed = true;
        this.cancel();
    }

    public diagnostics(): ActionControllerDiagnostics {
        const action = this.currentAction;
        return {
            scenarioType: this.scenario?.type ?? null,
            actionIndex: this.actionIndex,
            actionCount: this.scenario?.actions.length ?? 0,
            currentActionType: action?.type ?? "none",
            elapsed: Math.round(this.elapsed * 100) / 100,
            officialGoal: this.scenario?.expectedOutcome === "Goal"
        };
    }

    private advanceToNextAction(): void {
        if (!this.scenario) return;

        this.actionIndex += 1;
        this.actionElapsed = 0;

        if (this.actionIndex >= this.scenario.actions.length)
            this.finishScenario();
    }

    private finishScenario(): void {
        this.scenario = null;
        this.actionIndex = 0;
        this.elapsed = 0;
        this.actionElapsed = 0;
    }

    private isActionCompleted(
        action: FuturebolAction,
        ctx: FuturebolActionCompletionContext
    ): boolean {
        switch (action.type) {
            case "PassToPlayer":
                return ctx.ballOwnerId === action.targetPlayerId
                    && ctx.ballState === "Controlled";

            case "ShootToGoal":
                return ctx.outcome !== null
                    || this.actionElapsed >= action.duration;

            case "AttachToPlayer":
                return ctx.ballOwnerId === action.targetPlayerId
                    && ctx.ballState === "Controlled";

            case "ReturnToFormation":
            case "RecoverRun":
            case "SupportRun":
            case "MoveTo":
            case "RunTo":
                return false;

            case "Celebrate":
            case "Disappointed":
                return ctx.playPhase === "Resetting";

            default:
                return false;
        }
    }
}
