const DEFAULT_CAPACITY = 32;
const MAX_AGE_MS = 15000;
const states = new Map();
function stateFor(matchId) {
    let state = states.get(matchId);
    if (!state) {
        state = { latestSequence: 0, dropped: 0, duplicates: 0, gaps: 0, items: [] };
        states.set(matchId, state);
    }
    return state;
}
function valid(batch) {
    return Number.isInteger(batch.matchId) && batch.matchId > 0
        && typeof batch.symbol === 'string' && /^[A-Z0-9]{2,30}$/.test(batch.symbol)
        && Number.isInteger(batch.sequence) && batch.sequence > 0
        && Number.isInteger(batch.tradeCount) && batch.tradeCount > 0;
}
export function receiveMoneyFlowBatch(batch, capacity = DEFAULT_CAPACITY) {
    if (!valid(batch))
        return false;
    const state = stateFor(batch.matchId);
    if (batch.sequence <= state.latestSequence) {
        state.duplicates++;
        return false;
    }
    if (state.latestSequence > 0 && batch.sequence > state.latestSequence + 1) {
        state.gaps++;
        batch = { ...batch, isPartial: true };
    }
    state.latestSequence = batch.sequence;
    const now = performance.now();
    state.items.push({ batch, receivedMonotonicMs: now });
    const limit = Math.max(1, Math.min(500, capacity));
    while (state.items.length > limit) {
        state.items.shift();
        state.dropped++;
    }
    while (state.items.length && now - state.items[0].receivedMonotonicMs > MAX_AGE_MS) {
        state.items.shift();
        state.dropped++;
    }
    document.dispatchEvent(new CustomEvent('money-flow-batch', { detail: batch }));
    return true;
}
export function resetMoneyFlowBuffer(matchId) {
    if (matchId == null)
        states.clear();
    else
        states.delete(matchId);
}
export function getMoneyFlowBuffer(matchId) {
    const state = states.get(matchId);
    return state?.items.map(item => item.batch) ?? [];
}
export function inspectMoneyFlowBuffer(matchId) {
    const state = stateFor(matchId);
    return { count: state.items.length, latestSequence: state.latestSequence, dropped: state.dropped, duplicates: state.duplicates, gaps: state.gaps };
}
