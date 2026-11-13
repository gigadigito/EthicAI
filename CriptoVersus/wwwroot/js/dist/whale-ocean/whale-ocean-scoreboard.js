export const CREATURE_KINDS = ["small", "medium", "large", "shark", "whale"];
/**
 * JS interop normally emits camelCase, but accepting PascalCase here keeps
 * the HUD resilient to older Blazor/System.Text.Json serialization settings.
 */
export function normalizeScoreboard(value) {
    const root = asRecord(value);
    if (!root)
        return null;
    const matchId = safeCount(read(root, "matchId", "MatchId"));
    if (matchId <= 0)
        return null;
    return {
        matchId,
        windowStartUtc: safeString(read(root, "windowStartUtc", "WindowStartUtc")),
        windowEndUtc: safeString(read(root, "windowEndUtc", "WindowEndUtc")),
        isFinalized: Boolean(read(root, "isFinalized", "IsFinalized")),
        teamA: normalizeTeam(read(root, "teamA", "TeamA")),
        teamB: normalizeTeam(read(root, "teamB", "TeamB"))
    };
}
export function normalizeCreatureCounts(value) {
    const root = asRecord(value);
    return {
        buy: normalizeCreatureSideCounts(root ? read(root, "buy", "Buy") : null),
        sell: normalizeCreatureSideCounts(root ? read(root, "sell", "Sell") : null)
    };
}
function normalizeTeam(value) {
    const root = asRecord(value);
    const sequences = root ? read(root, "lastSequences", "LastSequences") : null;
    return {
        symbol: safeString(root ? read(root, "symbol", "Symbol") : null).trim().toUpperCase(),
        last30Seconds: normalizeCreatureCounts(root ? read(root, "last30Seconds", "Last30Seconds") : null),
        matchTotal: normalizeCreatureCounts(root ? read(root, "matchTotal", "MatchTotal") : null),
        lastSequences: Array.isArray(sequences)
            ? sequences.map(value => {
                const sequence = asRecord(value);
                return {
                    sourceId: safeString(sequence ? read(sequence, "sourceId", "SourceId") : null),
                    symbol: safeString(sequence ? read(sequence, "symbol", "Symbol") : null).trim().toUpperCase(),
                    sequence: safeCount(sequence ? read(sequence, "sequence", "Sequence") : null)
                };
            })
            : []
    };
}
function normalizeCreatureSideCounts(value) {
    const root = asRecord(value);
    return {
        small: safeCount(root ? read(root, "small", "Small") : null),
        medium: safeCount(root ? read(root, "medium", "Medium") : null),
        large: safeCount(root ? read(root, "large", "Large") : null),
        shark: safeCount(root ? read(root, "shark", "Shark") : null),
        whale: safeCount(root ? read(root, "whale", "Whale") : null)
    };
}
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
    const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
    return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
}
function asRecord(value) {
    return value !== null && typeof value === "object" ? value : null;
}
function read(value, camelCase, pascalCase) {
    return value[camelCase] ?? value[pascalCase];
}
function safeString(value) {
    return typeof value === "string" ? value : value == null ? "" : String(value);
}
