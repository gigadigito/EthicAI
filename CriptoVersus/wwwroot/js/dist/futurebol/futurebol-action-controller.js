import { MAX_SCENARIO_BRANCHES } from "./futurebol-possession-types.js";
import { isPlayerAction, isBallAction } from "./futurebol-action-types.js";
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
    isPlayerControlled(playerId) {
        if (!this.scenario)
            return false;
        if (this.actionIndex < this.scenario.actions.length) {
            if (this.isActionControllingPlayer(this.scenario.actions[this.actionIndex], playerId))
                return true;
        }
        if (this.isImminentNextAction()) {
            const next = this.scenario.actions[this.actionIndex + 1];
            if (this.isActionControllingPlayer(next, playerId))
                return true;
        }
        return false;
    }
    getControlledPlayerIds() {
        const controlled = new Set();
        if (!this.scenario)
            return controlled;
        if (this.actionIndex < this.scenario.actions.length) {
            this.collectControlledIds(this.scenario.actions[this.actionIndex], controlled);
        }
        if (this.isImminentNextAction()) {
            this.collectControlledIds(this.scenario.actions[this.actionIndex + 1], controlled);
        }
        return controlled;
    }
    isImminentNextAction() {
        if (!this.scenario)
            return false;
        if (this.actionIndex + 1 >= this.scenario.actions.length)
            return false;
        return this.actionProgress >= 0.7;
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
    isActionControllingPlayer(action, playerId) {
        if (isPlayerAction(action)) {
            return action.playerId === playerId;
        }
        if (isBallAction(action)) {
            return action.targetPlayerId === playerId;
        }
        return false;
    }
    collectControlledIds(action, controlled) {
        if (isPlayerAction(action) && action.playerId) {
            controlled.add(action.playerId);
        }
        else if (isBallAction(action) && action.targetPlayerId) {
            controlled.add(action.targetPlayerId);
        }
    }
}
