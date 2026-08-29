import type {
    FootballScenario,
    FuturebolAction,
    FuturebolActionCompletionContext
} from "./futurebol-action-types.js";
import type { FuturebolActionResult } from "./futurebol-possession-types.js";
import { MAX_SCENARIO_BRANCHES } from "./futurebol-possession-types.js";

const ACTION_TIMEOUT_SECONDS = 6;

export interface ActionControllerDiagnostics {
    scenarioType: string | null;
    actionIndex: number;
    actionCount: number;
    currentActionType: string;
    elapsed: number;
    officialGoal: boolean;
    branchCount: number;
}

export class ActionController {
    private scenario: FootballScenario | null = null;
    private actionIndex = 0;
    private elapsed = 0;
    private actionElapsed = 0;
    private disposed = false;
    private timeoutTriggered = false;
    private branchCount = 0;

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

    public get currentBranchCount(): number {
        return this.branchCount;
    }

    public startScenario(scenario: FootballScenario): void {
        this.scenario = scenario;
        this.actionIndex = 0;
        this.elapsed = 0;
        this.actionElapsed = 0;
        this.timeoutTriggered = false;
        this.branchCount = 0;
    }

    public update(
        deltaSeconds: number,
        completionContext: FuturebolActionCompletionContext
    ): { completed: boolean; result: FuturebolActionResult | null } {
        if (!this.scenario || this.disposed)
            return { completed: false, result: null };

        const safeDelta = Math.min(deltaSeconds, 0.1);
        this.elapsed += safeDelta;
        this.actionElapsed += safeDelta;

        const action = this.currentAction;
        if (!action) {
            this.finishScenario();
            return { completed: true, result: null };
        }

        const actionResult = this.getActionResult(action, completionContext);

        const timedOut =
            this.actionElapsed >= action.duration ||
            this.actionElapsed >= ACTION_TIMEOUT_SECONDS;

        if ((actionResult === "Intercepted" || actionResult === "Parried") && !timedOut) {
            return { completed: false, result: actionResult };
        }

        const completed = actionResult === "Completed" || timedOut;

        if (completed) {
            this.advanceToNextAction();
            return { completed: this.scenario === null, result: actionResult };
        }

        return { completed: false, result: null };
    }

    public injectContinuationActions(actions: FuturebolAction[]): void {
        if (!this.scenario || this.branchCount >= MAX_SCENARIO_BRANCHES) return;
        this.branchCount += 1;
        const remaining = this.scenario.actions.slice(this.actionIndex + 1);
        this.scenario = {
            ...this.scenario,
            actions: [...actions, ...remaining]
        };
        this.actionIndex = 0;
        this.actionElapsed = 0;
    }

    public cancel(): void {
        this.scenario = null;
        this.actionIndex = 0;
        this.elapsed = 0;
        this.actionElapsed = 0;
        this.timeoutTriggered = false;
        this.branchCount = 0;
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
            officialGoal: this.scenario?.expectedOutcome === "Goal",
            branchCount: this.branchCount
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

    private getActionResult(
        action: FuturebolAction,
        ctx: FuturebolActionCompletionContext
    ): FuturebolActionResult {
        switch (action.type) {
            case "PassToPlayer":
                if (ctx.lastActionResult === "Intercepted") return "Intercepted";
                if (ctx.ballOwnerId === action.targetPlayerId && ctx.ballState === "Controlled")
                    return "Completed";
                return "Pending";

            case "ShootToGoal":
                if (ctx.lastActionResult === "Parried") return "Parried";
                if (ctx.outcome !== null) return "Completed";
                return "Pending";

            case "AttachToPlayer":
                if (ctx.ballOwnerId === action.targetPlayerId && ctx.ballState === "Controlled")
                    return "Completed";
                return "Pending";

            case "Celebrate":
            case "Disappointed":
                return ctx.playPhase === "Resetting" ? "Completed" : "Pending";

            default:
                return "Pending";
        }
    }
}
