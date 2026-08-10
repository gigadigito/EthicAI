export const FUTUREBOL_ACTION_TIMING = Object.freeze({
    passPreparationStartSeconds: 1.05,
    passDurationSeconds: 0.78,
    passContactRatio: 0.62,
    shootDurationSeconds: 0.72,
    shootContactRatio: 0.67
});
export function hasReachedContact(progress, ratio) {
    return Math.min(1, Math.max(0, progress)) >= ratio;
}
