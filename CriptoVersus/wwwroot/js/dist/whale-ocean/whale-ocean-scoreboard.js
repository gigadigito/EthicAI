export const CREATURE_KINDS = ["small", "medium", "large", "shark", "whale"];
export function emptyCreatureSideCounts() {
    return { small: 0, medium: 0, large: 0, shark: 0, whale: 0 };
}
export function emptyCreatureCounts() {
    return { buy: emptyCreatureSideCounts(), sell: emptyCreatureSideCounts() };
}
export function cloneCreatureCounts(value) {
    return {
        buy: cloneCreatureSideCounts(value?.buy),
        sell: cloneCreatureSideCounts(value?.sell)
    };
}
function cloneCreatureSideCounts(value) {
    return {
        small: safeCount(value?.small),
        medium: safeCount(value?.medium),
        large: safeCount(value?.large),
        shark: safeCount(value?.shark),
        whale: safeCount(value?.whale)
    };
}
export function addCreatureCounts(target, increment) {
    if (!increment)
        return;
    for (const side of ["buy", "sell"]) {
        for (const kind of CREATURE_KINDS)
            target[side][kind] += safeCount(increment[side]?.[kind]);
    }
}
export function creatureTradeCount(value) {
    return CREATURE_KINDS.reduce((total, kind) => total + value.buy[kind] + value.sell[kind], 0);
}
export function creaturePoints(value) {
    return value.buy.small + value.sell.small
        + (value.buy.medium + value.sell.medium) * 3
        + (value.buy.large + value.sell.large) * 8
        + (value.buy.shark + value.sell.shark) * 20
        + (value.buy.whale + value.sell.whale) * 60;
}
export function sidePoints(value, side) {
    const counts = value[side];
    return counts.small + counts.medium * 3 + counts.large * 8 + counts.shark * 20 + counts.whale * 60;
}
export function oceanControl(leftPoints, rightPoints) {
    const left = safeCount(leftPoints);
    const right = safeCount(rightPoints);
    const total = left + right;
    if (total <= 0)
        return { left: null, right: null };
    const leftPercent = Math.round((left / total) * 1000) / 10;
    return { left: leftPercent, right: Math.round((100 - leftPercent) * 10) / 10 };
}
function safeCount(value) {
    return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}
