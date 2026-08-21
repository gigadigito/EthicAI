import assert from "node:assert/strict";
import {
    FUTUREBOL_ANIMATION_MAP,
    resolveAnimationName,
    resolveCandidateName,
    resolvePlayerVisualKind,
    selectFuturebolAnimation
} from "../../dist/futurebol/player/futurebol-animation-map.js";
import { FUTUREBOL_ACTION_TIMING, hasReachedContact } from "../../dist/futurebol/futurebol-action-timing.js";
import { FuturebolAnimationController } from "../../dist/futurebol/player/futurebol-animation-controller.js";

const basePlayer = {
    id: "home-attacker", team: "home", role: "attacker",
    position: { x: 0, y: 0, z: 0 }, targetPosition: { x: 1, y: 0, z: 1 },
    movementSpeed: 5, currentSpeed: 0, facingAngle: 0,
    animation: "idle", animationTime: 0, actionProgress: 0
};
const context = { phase: "Neutral", activeTeam: null, ballOwnerId: null, outcome: null };
const movingContext = { ...context, phase: "Attacking", activeTeam: "home" };

assert.equal(selectFuturebolAnimation(basePlayer, context), "Idle");
assert.equal(selectFuturebolAnimation({ ...basePlayer, currentSpeed: 1, animation: "walk" }, movingContext), "Walk");
assert.equal(selectFuturebolAnimation({ ...basePlayer, currentSpeed: 4, animation: "run" }, movingContext), "Run");
assert.equal(selectFuturebolAnimation({ ...basePlayer, currentSpeed: 4, animation: "run" }, { ...movingContext, ballOwnerId: basePlayer.id }), "Dribble");
assert.equal(selectFuturebolAnimation({ ...basePlayer, animation: "kick" }, { ...context, phase: "Passing", activeTeam: "home" }), "Pass");
assert.equal(selectFuturebolAnimation({ ...basePlayer, animation: "kick" }, { ...context, phase: "PreparingShot", activeTeam: "home" }), "Shoot");
const goalkeeper = { ...basePlayer, id: "away-goalkeeper", team: "away", role: "goalkeeper", animation: "goalkeeper-dive" };
assert.equal(selectFuturebolAnimation({ ...goalkeeper, targetPosition: { x: 0, y: 0, z: -2 } }, { ...context, phase: "Shooting", activeTeam: "home" }), "GoalkeeperDiveLeft");
assert.equal(selectFuturebolAnimation({ ...goalkeeper, targetPosition: { x: 0, y: 0, z: 2 } }, { ...context, phase: "Shooting", activeTeam: "home" }), "GoalkeeperDiveRight");
assert.equal(selectFuturebolAnimation(basePlayer, { ...context, phase: "Outcome", activeTeam: "home", outcome: "Goal" }), "Celebrate");

assert.equal(resolveAnimationName(["Idle", "Walking"], FUTUREBOL_ANIMATION_MAP.Idle.candidates), "Idle");
assert.equal(resolveCandidateName(["home:mixamorig:Head"], ["Head", "mixamorig:Head"]), "home:mixamorig:Head");
assert.equal(resolvePlayerVisualKind("Skeletal", "High"), "Skeletal");
assert.equal(resolvePlayerVisualKind("Skeletal", "Medium"), "Skeletal");
assert.equal(resolvePlayerVisualKind("Skeletal", "Low"), "Skeletal");
assert.equal(resolvePlayerVisualKind("Auto", "High"), "Skeletal");
assert.equal(resolvePlayerVisualKind("Auto", "Medium"), "Skeletal");
assert.equal(resolvePlayerVisualKind("Auto", "Low"), "Skeletal");
assert.equal(resolvePlayerVisualKind("Primitives", "High"), "Primitives");
assert.equal(resolvePlayerVisualKind("Primitives", "Medium"), "Primitives");
assert.equal(resolvePlayerVisualKind("Primitives", "Low"), "Primitives");
assert.equal(hasReachedContact(FUTUREBOL_ACTION_TIMING.passContactRatio - .01, FUTUREBOL_ACTION_TIMING.passContactRatio), false);
assert.equal(hasReachedContact(FUTUREBOL_ACTION_TIMING.shootContactRatio, FUTUREBOL_ACTION_TIMING.shootContactRatio), true);

class FakeObservable {
    observers = [];
    add(callback) { const observer = { callback }; this.observers.push(observer); return observer; }
    remove(observer) { this.observers = this.observers.filter(value => value !== observer); }
}
class FakeGroup {
    constructor(name) { this.name = name; }
    name; from = 0; to = 30; speedRatio = 1; enableBlending = false; blendingSpeed = 0;
    targetedAnimations = [{ animation: { framePerSecond: 30 } }];
    onAnimationGroupEndObservable = new FakeObservable();
    starts = 0; stops = 0; disposals = 0; weight = 0;
    start() { this.starts += 1; }
    stop() { this.stops += 1; }
    dispose() { this.disposals += 1; }
    setWeightForAllAnimatables(weight) { this.weight = weight; }
}
const idle = new FakeGroup("Idle");
const running = new FakeGroup("Running");
const controller = new FuturebolAnimationController([idle, running], "test-player");
controller.request("Idle", 0);
controller.request("Idle", 0);
assert.equal(idle.starts, 1, "repeated per-frame requests must not restart the clip");
controller.request("Run", 4);
controller.request("Run", 4.5);
controller.update(.2);
assert.equal(running.starts, 1);
assert.equal(running.weight, 1);
controller.dispose();
controller.dispose();
assert.equal(idle.disposals, 1, "dispose must be idempotent");
assert.equal(running.disposals, 1, "dispose must be idempotent");

console.log("Futurebol player animation tests passed.");
