export const FUTUREBOL_FIELD = Object.freeze({
    halfLength: 25,
    halfWidth: 15,
    goalLineX: 25,
    goalHalfWidth: 3.5,
    goalHeight: 3,
    ballGroundY: 0.55
});
const IN_PLAY = Object.freeze({
    kind: "InPlay",
    scoringTeam: null,
    restartingTeam: null,
    restartType: null
});
export class FuturebolMatchRules {
    evaluateBoundary(previous, current, lastTouchTeam) {
        const crossedPositiveGoalLine = previous.x <= FUTUREBOL_FIELD.goalLineX &&
            current.x > FUTUREBOL_FIELD.goalLineX;
        const crossedNegativeGoalLine = previous.x >= -FUTUREBOL_FIELD.goalLineX &&
            current.x < -FUTUREBOL_FIELD.goalLineX;
        const insideGoal = Math.abs(current.z) < FUTUREBOL_FIELD.goalHalfWidth - 0.08 &&
            current.y < FUTUREBOL_FIELD.goalHeight - 0.08;
        if ((crossedPositiveGoalLine || crossedNegativeGoalLine) && insideGoal) {
            return {
                kind: "Goal",
                scoringTeam: crossedPositiveGoalLine ? "home" : "away",
                restartingTeam: crossedPositiveGoalLine ? "away" : "home",
                restartType: "Kickoff"
            };
        }
        if (Math.abs(current.z) > FUTUREBOL_FIELD.halfWidth) {
            return {
                kind: "Out",
                scoringTeam: null,
                restartingTeam: lastTouchTeam ? opponent(lastTouchTeam) : null,
                restartType: "ThrowIn"
            };
        }
        if (Math.abs(current.x) <= FUTUREBOL_FIELD.halfLength)
            return IN_PLAY;
        const defendingTeam = current.x > 0 ? "away" : "home";
        const corner = lastTouchTeam === defendingTeam;
        return {
            kind: "Out",
            scoringTeam: null,
            restartingTeam: corner ? opponent(defendingTeam) : defendingTeam,
            restartType: corner ? "Corner" : "GoalKick"
        };
    }
}
function opponent(team) {
    return team === "home" ? "away" : "home";
}
