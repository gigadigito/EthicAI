export interface MoneyFlowBatch {
    matchId: number;
    symbol: string;
    sequence: number;
    windowStartUtc: string;
    windowEndUtc: string;
    eventTimeUtc: string;
    receivedAtUtc: string;
    publishedAtUtc: string;
    tradeCount: number;
    totalBaseQuantity: string;
    takerBuyBaseQuantity: string;
    takerSellBaseQuantity: string;
    takerBuyQuote: string;
    takerSellQuote: string;
    netQuote: string;
    firstPrice: string;
    lastPrice: string;
    highPrice: string;
    lowPrice: string;
    isPartial: boolean;
}

interface BufferedBatch { batch: MoneyFlowBatch; receivedMonotonicMs: number; }
interface State { latestSequenceBySymbol: Map<string, number>; dropped: number; duplicates: number; gaps: number; items: BufferedBatch[]; }

const DEFAULT_CAPACITY = 32;
const MAX_AGE_MS = 15_000;
const states = new Map<number, State>();

function stateFor(matchId: number): State {
    let state = states.get(matchId);
    if (!state) {
        state = { latestSequenceBySymbol: new Map(), dropped: 0, duplicates: 0, gaps: 0, items: [] };
        states.set(matchId, state);
    }
    return state;
}

function valid(batch: MoneyFlowBatch): boolean {
    return Number.isInteger(batch.matchId) && batch.matchId > 0
        && typeof batch.symbol === 'string' && /^[A-Z0-9]{2,30}$/.test(batch.symbol)
        && Number.isInteger(batch.sequence) && batch.sequence > 0
        && Number.isInteger(batch.tradeCount) && batch.tradeCount > 0;
}

export function receiveMoneyFlowBatch(batch: MoneyFlowBatch, capacity = DEFAULT_CAPACITY): boolean {
    if (!valid(batch)) return false;
    const state = stateFor(batch.matchId);
    const latestSequence = state.latestSequenceBySymbol.get(batch.symbol) ?? 0;
    if (batch.sequence <= latestSequence) { state.duplicates++; return false; }
    if (latestSequence > 0 && batch.sequence > latestSequence + 1) { state.gaps++; batch = { ...batch, isPartial: true }; }
    state.latestSequenceBySymbol.set(batch.symbol, batch.sequence);
    const now = performance.now();
    state.items.push({ batch, receivedMonotonicMs: now });
    const limit = Math.max(1, Math.min(500, capacity));
    while (state.items.length > limit) { state.items.shift(); state.dropped++; }
    while (state.items.length && now - state.items[0].receivedMonotonicMs > MAX_AGE_MS) { state.items.shift(); state.dropped++; }
    document.dispatchEvent(new CustomEvent('money-flow-batch', { detail: batch }));
    return true;
}

export function resetMoneyFlowBuffer(matchId?: number): void {
    if (matchId == null) states.clear();
    else states.delete(matchId);
}

export function getMoneyFlowBuffer(matchId: number): MoneyFlowBatch[] {
    const state = states.get(matchId);
    return state?.items.map(item => item.batch) ?? [];
}

export function inspectMoneyFlowBuffer(matchId: number): { count: number; latestSequence: number; symbolCount: number; dropped: number; duplicates: number; gaps: number } {
    const state = stateFor(matchId);
    const latestSequence = Math.max(0, ...state.latestSequenceBySymbol.values());
    return { count: state.items.length, latestSequence, symbolCount: state.latestSequenceBySymbol.size, dropped: state.dropped, duplicates: state.duplicates, gaps: state.gaps };
}
