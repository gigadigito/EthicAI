export type WhaleOceanCreatureKind = "small" | "medium" | "large" | "shark" | "whale";
export type WhaleOceanCreatureSide = "buy" | "sell";

export interface WhaleOceanCreatureSideCounts {
    small: number;
    medium: number;
    large: number;
    shark: number;
    whale: number;
}

export interface WhaleOceanCreatureCounts {
    buy: WhaleOceanCreatureSideCounts;
    sell: WhaleOceanCreatureSideCounts;
}

export interface WhaleOceanScoreboardSequence {
    sourceId: string;
    symbol: string;
    sequence: number;
}

export interface WhaleOceanScoreboardTeam {
    symbol: string;
    last30Seconds: WhaleOceanCreatureCounts;
    matchTotal: WhaleOceanCreatureCounts;
    lastSequences?: WhaleOceanScoreboardSequence[];
}

export interface WhaleOceanScoreboard {
    matchId: number;
    windowStartUtc: string;
    windowEndUtc: string;
    isFinalized: boolean;
    teamA: WhaleOceanScoreboardTeam;
    teamB: WhaleOceanScoreboardTeam;
}

export const CREATURE_KINDS: readonly WhaleOceanCreatureKind[] = ["small", "medium", "large", "shark", "whale"];

export function emptyCreatureSideCounts(): WhaleOceanCreatureSideCounts {
    return { small: 0, medium: 0, large: 0, shark: 0, whale: 0 };
}

export function emptyCreatureCounts(): WhaleOceanCreatureCounts {
    return { buy: emptyCreatureSideCounts(), sell: emptyCreatureSideCounts() };
}

export function cloneCreatureCounts(value?: Partial<WhaleOceanCreatureCounts> | null): WhaleOceanCreatureCounts {
    return {
        buy: cloneCreatureSideCounts(value?.buy),
        sell: cloneCreatureSideCounts(value?.sell)
    };
}

function cloneCreatureSideCounts(value?: Partial<WhaleOceanCreatureSideCounts> | null): WhaleOceanCreatureSideCounts {
    return {
        small: safeCount(value?.small),
        medium: safeCount(value?.medium),
        large: safeCount(value?.large),
        shark: safeCount(value?.shark),
        whale: safeCount(value?.whale)
    };
}

export function addCreatureCounts(target: WhaleOceanCreatureCounts, increment?: Partial<WhaleOceanCreatureCounts> | null): void {
    if (!increment) return;
    for (const side of ["buy", "sell"] as const) {
        for (const kind of CREATURE_KINDS)
            target[side][kind] += safeCount(increment[side]?.[kind]);
    }
}

export function creatureTradeCount(value: WhaleOceanCreatureCounts): number {
    return CREATURE_KINDS.reduce((total, kind) => total + value.buy[kind] + value.sell[kind], 0);
}

export function creaturePoints(value: WhaleOceanCreatureCounts): number {
    return value.buy.small + value.sell.small
        + (value.buy.medium + value.sell.medium) * 3
        + (value.buy.large + value.sell.large) * 8
        + (value.buy.shark + value.sell.shark) * 20
        + (value.buy.whale + value.sell.whale) * 60;
}

export function sidePoints(value: WhaleOceanCreatureCounts, side: WhaleOceanCreatureSide): number {
    const counts = value[side];
    return counts.small + counts.medium * 3 + counts.large * 8 + counts.shark * 20 + counts.whale * 60;
}

export function oceanControl(leftPoints: number, rightPoints: number): { left: number | null; right: number | null } {
    const left = safeCount(leftPoints);
    const right = safeCount(rightPoints);
    const total = left + right;
    if (total <= 0) return { left: null, right: null };
    const leftPercent = Math.round((left / total) * 1000) / 10;
    return { left: leftPercent, right: Math.round((100 - leftPercent) * 10) / 10 };
}

function safeCount(value: unknown): number {
    return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}
