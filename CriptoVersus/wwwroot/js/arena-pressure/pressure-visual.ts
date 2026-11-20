export type PressureSide = 'buy' | 'sell' | 'balanced';
export type PressureLevel = 1 | 2 | 3 | 4;

export interface PressureVisualState {
    dominant: PressureSide;
    level: PressureLevel;
    buy: string;
    sell: string;
}

const states = {
    buy: {
        balanced: 'buy_state_1_balanced',
        winning: [null, 'buy_state_2_advantage', 'buy_state_3_dominant', 'buy_state_4_extreme'],
        losing: [null, 'buy_state_2_pressed', 'buy_state_3_struggling', 'buy_state_4_collapsed']
    },
    sell: {
        balanced: 'sell_state_1_balanced',
        winning: [null, 'sell_state_2_advantage', 'sell_state_3_dominant', 'sell_state_4_extreme'],
        losing: [null, 'sell_state_2_pressed', 'sell_state_3_struggling', 'sell_state_4_collapsed']
    }
} as const;

export const PRESSURE_SPRITE_KEYS: string[] = [
    ...Object.values(states.buy).flat(),
    ...Object.values(states.sell).flat()
].filter((key) => typeof key === 'string') as string[];

function safePercent(value: number): number {
    return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 50;
}

export function resolvePressureVisualState(buyPercent: number, sellPercent: number): PressureVisualState {
    const buy = safePercent(buyPercent);
    const sell = safePercent(sellPercent);
    const total = buy + sell;
    const share = total > 0 ? 100 * Math.max(buy, sell) / total : 50;
    const dominant: PressureSide = share <= 55 ? 'balanced' : buy > sell ? 'buy' : 'sell';
    const level: PressureLevel = dominant === 'balanced' ? 1 : share <= 70 ? 2 : share <= 85 ? 3 : 4;
    if (level === 1) return { dominant, level, buy: states.buy.balanced, sell: states.sell.balanced };
    return {
        dominant,
        level,
        buy: (dominant === 'buy' ? states.buy.winning[level - 1] : states.buy.losing[level - 1])!,
        sell: (dominant === 'sell' ? states.sell.winning[level - 1] : states.sell.losing[level - 1])!
    };
}

export class PressureVisualStateMachine {
    private current: PressureVisualState;
    private changedAt: number;

    constructor(buy: number, sell: number, time: number = 0,
        private readonly dwellMs: number = 300, private readonly hysteresis: number = 2) {
        this.current = resolvePressureVisualState(buy, sell);
        this.changedAt = time;
    }

    get state(): PressureVisualState { return this.current; }

    update(buy: number, sell: number, time: number): PressureVisualState {
        const candidate = resolvePressureVisualState(buy, sell);
        if (candidate.buy === this.current.buy && candidate.sell === this.current.sell) return this.current;
        const total = safePercent(buy) + safePercent(sell);
        const share = total > 0 ? 100 * Math.max(safePercent(buy), safePercent(sell)) / total : 50;
        const extremeReversal = this.current.dominant !== 'balanced' && candidate.dominant !== 'balanced'
            && this.current.dominant !== candidate.dominant && share > 85;
        if (!extremeReversal && time - this.changedAt < this.dwellMs) return this.current;
        if (!extremeReversal && this.current.dominant === candidate.dominant) {
            const boundaries = [55, 70, 85];
            const boundary = boundaries[Math.min(this.current.level, candidate.level) - 1];
            if (candidate.level > this.current.level && share <= boundary + this.hysteresis) return this.current;
            if (candidate.level < this.current.level && share >= boundary - this.hysteresis) return this.current;
        }
        if (!extremeReversal && this.current.dominant !== candidate.dominant) {
            if (candidate.dominant === 'balanced' && share >= 55 - this.hysteresis) return this.current;
            if (candidate.dominant !== 'balanced' && share <= 55 + this.hysteresis) return this.current;
        }
        this.current = candidate;
        this.changedAt = time;
        return this.current;
    }
}
