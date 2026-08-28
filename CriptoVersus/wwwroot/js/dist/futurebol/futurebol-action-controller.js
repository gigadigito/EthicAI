const ACTION_TIMEOUT_SECONDS = 6;
export class ActionController {
    constructor() {
        this.scenario = null;
        this.actionIndex = 0;
        this.elapsed = 0;
        this.actionElapsed = 0;
        this.disposed = false;
        this.timeoutTriggered = false;
    }
    get isActive() {
        return this.scenario !== null;
    }
    get currentAction() {
        if (!this.scenario || this.actionIndex >= this.scenario.actions.length)
            return null;
        return this.scenario.actions[this.actionIndex];
    }
    get currentScenario() {
        return this.scenario;
    }
    get totalElapsed() {
        return this.elapsed;
    }
    get actionProgress() {
        const action = this.currentAction;
        if (!action || action.duration <= 0)
            return 1;
        return Math.min(1, this.actionElapsed / action.duration);
    }
    startScenario(scenario) {
        this.scenario = scenario;
        this.actionIndex = 0;
        this.elapsed = 0;
        this.actionElapsed = 0;
        this.timeoutTriggered = false;
    }
    update(deltaSeconds, completionContext) {
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
    cancel() {
        this.scenario = null;
        this.actionIndex = 0;
        this.elapsed = 0;
        this.actionElapsed = 0;
        this.timeoutTriggered = false;
    }
    dispose() {
        this.disposed = true;
        this.cancel();
    }
    diagnostics() {
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
    advanceToNextAction() {
        if (!this.scenario)
            return;
        this.actionIndex += 1;
        this.actionElapsed = 0;
        if (this.actionIndex >= this.scenario.actions.length)
            this.finishScenario();
    }
    finishScenario() {
        this.scenario = null;
        this.actionIndex = 0;
        this.elapsed = 0;
        this.actionElapsed = 0;
    }
    isActionCompleted(action, ctx) {
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
