export function isPlayerAction(action) {
    return action.kind === "PlayerAction";
}
export function isBallAction(action) {
    return action.kind === "BallAction";
}
export function isTeamAction(action) {
    return action.kind === "TeamAction";
}
