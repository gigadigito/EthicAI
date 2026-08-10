import { FUTUREBOL_ANIMATION_MAP, resolveCandidateName } from "./futurebol-animation-map.js";
const warnedMissingAnimations = new Set();
export class FuturebolAnimationController {
    constructor(groups, playerId, blendingSeconds = 0.18) {
        this.groups = groups;
        this.playerId = playerId;
        this.blendingSeconds = blendingSeconds;
        this.currentAnimation = null;
        this.requestedAnimation = null;
        this.currentGroup = null;
        this.previousGroup = null;
        this.endObserver = null;
        this.blendElapsed = 0;
        this.completedRequest = null;
        this.disposed = false;
        for (const group of groups) {
            group.stop();
            group.enableBlending = true;
            group.blendingSpeed = 0.09;
            group.setWeightForAllAnimatables(0);
        }
    }
    request(state, movementSpeed, preserveCompletedRequest = false) {
        if (this.disposed)
            return;
        this.requestedAnimation = state;
        if (state === this.completedRequest)
            return;
        if (!preserveCompletedRequest)
            this.completedRequest = null;
        if (state === this.currentAnimation) {
            this.applySpeed(this.currentGroup, state, movementSpeed);
            return;
        }
        const definition = FUTUREBOL_ANIMATION_MAP[state];
        const name = resolveCandidateName(this.groups.map(group => group.name), definition.candidates);
        const next = name ? this.groups.find(group => group.name === name) ?? null : null;
        if (!next) {
            this.warnMissingOnce(state);
            if (state !== "Idle")
                this.request("Idle", movementSpeed);
            return;
        }
        this.removeEndObserver();
        if (this.previousGroup && this.previousGroup !== this.currentGroup)
            this.previousGroup.stop();
        this.previousGroup = this.currentGroup;
        this.currentGroup = next;
        this.currentAnimation = state;
        this.blendElapsed = 0;
        this.applySpeed(next, state, movementSpeed);
        next.setWeightForAllAnimatables(0);
        next.start(definition.loop, next.speedRatio);
        if (!definition.loop) {
            this.endObserver = next.onAnimationGroupEndObservable.add(() => {
                this.removeEndObserver();
                const fallback = state.startsWith("GoalkeeperDive") ? "GoalkeeperReady" : "Idle";
                this.completedRequest = state;
                this.currentAnimation = null;
                this.request(fallback, movementSpeed, true);
            });
        }
    }
    update(deltaSeconds) {
        if (this.disposed || !this.currentGroup)
            return;
        if (!this.previousGroup || this.previousGroup === this.currentGroup) {
            this.currentGroup.setWeightForAllAnimatables(1);
            return;
        }
        this.blendElapsed += Math.max(0, deltaSeconds);
        const ratio = Math.min(1, this.blendElapsed / this.blendingSeconds);
        this.currentGroup.setWeightForAllAnimatables(ratio);
        this.previousGroup.setWeightForAllAnimatables(1 - ratio);
        if (ratio >= 1) {
            this.previousGroup.stop();
            this.previousGroup = null;
        }
    }
    reset() {
        if (this.disposed)
            return;
        this.removeEndObserver();
        for (const group of this.groups) {
            group.stop();
            group.setWeightForAllAnimatables(0);
        }
        this.currentGroup = null;
        this.previousGroup = null;
        this.currentAnimation = null;
        this.requestedAnimation = null;
        this.blendElapsed = 0;
        this.completedRequest = null;
    }
    dispose() {
        if (this.disposed)
            return;
        this.reset();
        this.disposed = true;
        for (const group of this.groups)
            group.dispose();
    }
    applySpeed(group, state, movementSpeed) {
        if (!group)
            return;
        const definition = FUTUREBOL_ANIMATION_MAP[state];
        if (definition.nominalDurationSeconds) {
            const targeted = group.targetedAnimations[0]?.animation;
            const frames = Math.max(1, group.to - group.from);
            const sourceDuration = targeted ? frames / targeted.framePerSecond : definition.nominalDurationSeconds;
            group.speedRatio = clamp(sourceDuration / definition.nominalDurationSeconds, 0.55, 1.8);
            return;
        }
        if (state === "Walk")
            group.speedRatio = clamp(movementSpeed / 1.55, 0.55, 1.35);
        else if (state === "Run" || state === "Dribble")
            group.speedRatio = clamp(movementSpeed / 3.35, 0.72, 1.55);
        else
            group.speedRatio = 1;
    }
    removeEndObserver() {
        if (this.endObserver && this.currentGroup)
            this.currentGroup.onAnimationGroupEndObservable.remove(this.endObserver);
        this.endObserver = null;
    }
    warnMissingOnce(state) {
        if (warnedMissingAnimations.has(state))
            return;
        warnedMissingAnimations.add(state);
        console.warn(`[Futurebol] animação '${state}' indisponível para ${this.playerId}; fallback seguro aplicado.`);
    }
}
function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
}
