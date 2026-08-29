import { MAX_SCENARIO_BRANCHES } from "./futurebol-possession-types.js";
const ACTION_TIMEOUT_SECONDS = 6;
export class ActionController {
    constructor() {
        this.scenario = null;
        this.actionIndex = 0;
        this.elapsed = 0;
        this.actionElapsed = 0;
        this.disposed = false;
        this.timeoutTriggered = false;
        this.branchCount = 0;
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
    get currentBranchCount() {
        return this.branchCount;
    }
    startScenario(scenario) {
        this.scenario = scenario;
        this.actionIndex = 0;
        this.elapsed = 0;
        this.actionElapsed = 0;
        this.timeoutTriggered = false;
        this.branchCount = 0;
    }
    update(deltaSeconds, completionContext) {
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
        const timedOut = this.actionElapsed >= action.duration ||
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
    injectContinuationActions(actions) {
        if (!this.scenario || this.branchCount >= MAX_SCENARIO_BRANCHES)
            return;
        this.branchCount += 1;
        const remaining = this.scenario.actions.slice(this.actionIndex + 1);
        this.scenario = {
            ...this.scenario,
            actions: [...actions, ...remaining]
        };
        this.actionIndex = 0;
        this.actionElapsed = 0;
    }
    cancel() {
        this.scenario = null;
        this.actionIndex = 0;
        this.elapsed = 0;
        this.actionElapsed = 0;
        this.timeoutTriggered = false;
        this.branchCount = 0;
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
            officialGoal: this.scenario?.expectedOutcome === "Goal",
            branchCount: this.branchCount
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
    getActionResult(action, ctx) {
        switch (action.type) {
            case "PassToPlayer":
                if (ctx.lastActionResult === "Intercepted")
                    return "Intercepted";
                if (ctx.ballOwnerId === action.targetPlayerId && ctx.ballState === "Controlled")
                    return "Completed";
                return "Pending";
            case "ShootToGoal":
                if (ctx.lastActionResult === "Parried")
                    return "Parried";
                if (ctx.outcome !== null)
                    return "Completed";
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
